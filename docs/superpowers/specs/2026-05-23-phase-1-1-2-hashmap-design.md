# Phase 1.1.2 — hashmap workload — execution design

**Status:** ready for implementation plan
**Refines:** [`2026-05-20-phase-1-1-design.md § Phase 1.1.2`](2026-05-20-phase-1-1-design.md)
**Predecessor:** Phase 1.1.1 closed 2026-05-23 (tag `phase-1-1-1`, merge `a7d4d5a`)

## Purpose

Расширить evidence-base второго workload'а — **stdlib container** на тему `(hash) map`. Это первая возможность для **confirmed** claim'ов через bundle-size signal: разные toolchains тянут разный объём stdlib (libc++ `unordered_map` vs Rust std `HashMap` vs JS native `Map`), и эти различия должны быть видны cross-key-type (string vs int) и cross-size.

Дополнительная инфра-цель: rule-of-three refactor общих fixture generators в `benches/common/fixtures.ts` (matmul + 2 hashmap binaries = 3 consumers).

## Scope

**In scope:**

- 2 binaries: `hashmap_string` (16-byte ASCII hex keys), `hashmap_int` (u64 keys в [0, 2^53)).
- 3 entry points per binary: `insert`, `lookup`, `delete` → 6 measurement IDs.
- 3 sizes: `S=1k`, `M=10k`, `L=100k` pairs.
- 3 toolchains: `js/idiomatic`, `rust/bindgen`, `cpp/emscripten`.
- `benches/common/fixtures.ts` — extracted shared PRNG + 3 generators.
- Per-entry reset companion contract в loader'ах (`<entry>_reset` export naming).
- Guidelines harvest pass — target ≥1 confirmed claim в `docs/guidelines.md`.

**Out of scope (→ roadmap entry `hashmap-stdlib-no-glue`, Phase 1.2):**

- `rust/raw` hashmap — no_std environment без std::collections::HashMap.
- `cpp/wasi-sdk` hashmap — current freestanding setup без libc++ `unordered_map`.

**Rejected explicitly (not roadmap):**

- `js/typed-array` hashmap — workload measures stdlib container, не custom hashmap implementation.
- Non-default hashers (FxHash, ahash, robin_hood) — fairness-baseline comparison требует stock stdlib defaults.

## Workload contract

### Binaries и entry points

| Binary | Entries (benchmark IDs) | State type | Key type |
|---|---|---|---|
| `hashmap_string` | `hashmap_string_insert`, `hashmap_string_lookup`, `hashmap_string_delete` | `HashMap<String, u64>` / `unordered_map<std::string, uint64_t>` / `Map<string, number>` | 16-byte ASCII lowercase hex |
| `hashmap_int` | `hashmap_int_insert`, `hashmap_int_lookup`, `hashmap_int_delete` | `HashMap<u64, u64>` / `unordered_map<uint64_t, uint64_t>` / `Map<number, number>` | u64 в [0, 2^53) для JS-safety |

Hash function defaults — stock per stdlib:
- Rust: default `RandomState` (SipHash13).
- C++: `std::hash` (typically identity для integers, libc++ string hash для strings).
- JS: V8 internal.

### Sizes и innerIterations

| Size | Pairs (N) | innerIterations | hashmap_string fixture | hashmap_int fixture |
|---|---|---|---|---|
| S | 1 000 | 1 000 | 24 KB | 16 KB |
| M | 10 000 | 10 000 | 240 KB | 160 KB |
| L | 100 000 | 100 000 | 2.4 MB | 1.6 MB |

`innerIterations[size] = N` — каждый sample выполняет full pass над fixture'ом. Fixture files `.gitignore`'д (existing `*.bin` pattern).

### State + checksum per entry (все iter-dependent)

| Entry | `loadInput` action | `<entry>_reset` action | `run(N)` action | Checksum |
|---|---|---|---|---|
| `insert` | parse pairs into wasm Vec; build pre-filled map (for lookup/delete to share) | clear map | insert N pairs from Vec | `map.size()` после операции |
| `lookup` | (same as insert) | no-op (map read-only во время run) | look up N keys, accumulate values | Σ values |
| `delete` | (same) | clear + refill from Vec | for each key: `get` then `remove`, accumulate values | Σ removed values |

**Note:** `lookup` и `delete` checksums **совпадают** для одного `(binary, size)` (оба = Σ всех N values fixture'а). OK — defends against entry-conflation bugs; distinct from `insert` checksum (= N).

### Pitfall §P1 invariants (обязательны для spec.json `ioContract`)

1. **Iter-семантика:** Iter-dependent для всех трёх entries. `expectedChecksum` валиден только для `N = innerIterations[size]`.
2. **State leakage:** Map state persists между `run()` calls — loader привязан к per-entry `<entry>_reset` (см. Loader changes).
3. **innerIterations[S/M/L] = 1000 / 10000 / 100000** — равно N (fixture pair count).

## Fixture format

**Pair layout (little-endian, packed, no padding):**

| Binary | Pair size | Layout |
|---|---|---|
| `hashmap_string` | 24 B | `[0..16) key_ascii_hex` + `[16..24) value_u64_le` |
| `hashmap_int` | 16 B | `[0..8) key_u64_le` + `[8..16) value_u64_le` |

Keys в [0, 2^53), values в [0, 2^32). Lookup sum ≤ N × 2^32 ≤ 100000 × 2^32 ≈ 4.3e14 — внутри `Number.MAX_SAFE_INTEGER` (2^53 ≈ 9e15).

**Seeds (deterministic per binary per size):**

```ts
SEEDS = {
    hashmap_string: { S: 0xDEAD_0001, M: 0xDEAD_0002, L: 0xDEAD_0003 },
    hashmap_int:    { S: 0xBEEF_0001, M: 0xBEEF_0002, L: 0xBEEF_0003 },
}
```

Matmul SEEDS `0xC0FFEE_01/02/03` остаются неизменными — byte-preserve constraint.

**Collision handling:** не нужно. P(collision at L=100k) ≈ 5.5e-6 (u64-53 keyspace) для int, ~10^-22 (16-byte hex) для string.

## Common infrastructure

### `benches/common/fixtures.ts` (new)

Flat local utility (не workspace package). Каталог `benches/common/` без `spec.json` — не попадает в `scripts/build-all.ts` glob workload discovery.

**API:**

```ts
export function mulberry32(seed: number): () => number;
// Lifted verbatim from benches/matmul/fixtures/generate.ts.

export function genF64Array(n: number, seed: number): Uint8Array;
// 2n² f64 entries в [-1, 1), packed Float64Array bytes. Used by matmul.

export function genIntPairs53(n: number, seed: number): Uint8Array;
// N × (u64_key_le ∈ [0, 2^53), u64_value_le ∈ [0, 2^32)); 16N bytes.

export function genAsciiHexKeys(n: number, seed: number): Uint8Array;
// N × (16 ASCII lowercase hex chars, u64_value_le ∈ [0, 2^32)); 24N bytes.
```

**Tests** (`benches/common/fixtures.test.ts`):

- `mulberry32(seed)` deterministic: first 3 outputs == golden values.
- Per-generator SHA256 snapshot (n=4, seed=`0xC0FFEE_01`) — defends against silent drift в refactors.

**Dev infra changes:**

- `tsconfig.json` include: добавить `"benches/common/**/*"`.
- `eslint.config.js`: НЕ ignore `benches/common/**` — линтуется как production code.

### Matmul refactor (byte-preserving)

`benches/matmul/fixtures/generate.ts` становится thin wrapper:

```ts
import { genF64Array } from "../../common/fixtures.js";

const SIZES = { S: 64, M: 256, L: 1024 } as const;
const SEEDS = { S: 0xC0FFEE_01, M: 0xC0FFEE_02, L: 0xC0FFEE_03 } as const;

for (const [size, n] of Object.entries(SIZES)) {
    const buf = genF64Array(n, SEEDS[size]);
    // write + sha256
}
```

**Invariant:** SHA256 output идентичен текущему. Verify через `pnpm fixtures` → diff против `benches/matmul/spec.json` existing `fixtureSha256`. Если drift — P1 §1 violation, останавливаем.

## Per-toolchain implementation outlines

### Rust/bindgen (`benches/hashmap_{string,int}/rust/bindgen/`)

Pattern: `SyncCell<RefCell<State>>` (precedent: matmul/rust/bindgen, interop_calls/rust/bindgen).

```rust
struct State {
    pairs: Vec<(Key, u64)>,        // immutable post-loadInput
    map: HashMap<Key, u64>,        // mutated by run/reset
}

#[wasm_bindgen] pub fn load_input(buf: &[u8]) {
    let pairs = parse_pairs(buf);
    let map = build_map(&pairs);   // pre-filled for lookup/delete
    STATE.0.replace(State { pairs, map });
}

#[wasm_bindgen] pub fn <bin>_insert(iters: u32) -> f64 {
    let mut st = STATE.0.borrow_mut();
    for i in 0..iters as usize {
        let (k, v) = st.pairs[i].clone();
        st.map.insert(k, v);
    }
    st.map.len() as f64
}

#[wasm_bindgen] pub fn <bin>_insert_reset() {
    STATE.0.borrow_mut().map.clear();
}

#[wasm_bindgen] pub fn <bin>_lookup(iters: u32) -> f64 {
    let st = STATE.0.borrow();
    let mut acc: f64 = 0.0;
    for i in 0..iters as usize {
        acc += *st.map.get(&st.pairs[i].0).unwrap_or(&0) as f64;
    }
    acc
}

#[wasm_bindgen] pub fn <bin>_lookup_reset() {
    // No-op — map read-only during lookup.
}

#[wasm_bindgen] pub fn <bin>_delete(iters: u32) -> f64 {
    let mut st = STATE.0.borrow_mut();
    let mut acc: f64 = 0.0;
    for i in 0..iters as usize {
        let k = st.pairs[i].0.clone();
        if let Some(v) = st.map.remove(&k) { acc += v as f64; }
    }
    acc
}

#[wasm_bindgen] pub fn <bin>_delete_reset() {
    let mut st = STATE.0.borrow_mut();
    st.map.clear();
    for (k, v) in &st.pairs { st.map.insert(k.clone(), *v); }
}

#[wasm_bindgen] pub fn wasm_memory() -> JsValue { wasm_bindgen::memory() }
```

**Per-bin specifics:**

- `hashmap_int`: `Key = u64`. Pair parse: two `u64::from_le_bytes` per 16 bytes.
- `hashmap_string`: `Key = String`. Pair parse: `String::from(std::str::from_utf8(&buf[..16])?)` + `u64::from_le_bytes(&buf[16..24])`. UTF-8 validation cost amortized once per fixture.

**Clippy / lints:** pure-fn exports под `#[wasm_bindgen]` могут триггерить `missing_const_for_fn` — добавить `#[allow(clippy::missing_const_for_fn, reason = "wasm_bindgen requires non-const fns")]` где нужно (pitfall §P3 precedent).

### C++/emscripten (`benches/hashmap_{string,int}/cpp/`)

Pattern: `extern "C"` exports + `static` global state (precedent: interop_calls/cpp).

```cpp
struct State {
    std::vector<std::pair<Key, uint64_t>> pairs;
    std::unordered_map<Key, uint64_t> map;
};
static State g_state;

extern "C" uint32_t alloc(uint32_t sz) { /* HEAP-resident buffer alloc */ }
extern "C" void load_input(uint32_t ptr, uint32_t len) {
    // Parse pairs from HEAP[ptr..len], pre-fill g_state.map.
}

extern "C" double hashmap_int_insert(uint32_t iters) {
    for (uint32_t i = 0; i < iters; i++) g_state.map[g_state.pairs[i].first] = g_state.pairs[i].second;
    return static_cast<double>(g_state.map.size());
}
extern "C" void hashmap_int_insert_reset() { g_state.map.clear(); }

extern "C" double hashmap_int_lookup(uint32_t iters) {
    double acc = 0.0;
    for (uint32_t i = 0; i < iters; i++) {
        auto it = g_state.map.find(g_state.pairs[i].first);
        if (it != g_state.map.end()) acc += static_cast<double>(it->second);
    }
    return acc;
}
extern "C" void hashmap_int_lookup_reset() { /* no-op */ }

extern "C" double hashmap_int_delete(uint32_t iters) {
    double acc = 0.0;
    for (uint32_t i = 0; i < iters; i++) {
        auto it = g_state.map.find(g_state.pairs[i].first);
        if (it != g_state.map.end()) { acc += static_cast<double>(it->second); g_state.map.erase(it); }
    }
    return acc;
}
extern "C" void hashmap_int_delete_reset() {
    g_state.map.clear();
    for (const auto& p : g_state.pairs) g_state.map[p.first] = p.second;
}
```

**Per-bench `cpp/build-emscripten.sh`** (precedent: interop_calls). EXPORTED_FUNCTIONS:

```
["_alloc","_load_input","_<bin>_insert","_<bin>_insert_reset","_<bin>_lookup","_<bin>_lookup_reset","_<bin>_delete","_<bin>_delete_reset"]
```

`-std=c++23 -fno-exceptions -fno-rtti` + standard warning flags + closure for size profile (matches interop_calls).

**`cpp/build-wasi-sdk.sh` НЕ создаём** — `scripts/build-cpp.ts` уже умеет skip'ать combos без build script. Verify this on first build run; иначе нужен explicit skip mechanism в `scripts/lib/matrix.ts`.

### JS/idiomatic (`benches/hashmap_{string,int}/js/idiomatic/`)

Plain TypeScript, ESM bundled via existing esbuild. Two separate packages (`Key` type differs).

```ts
interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

export default function create(entry: string): BenchModule {
    let pairs: ReadonlyArray<readonly [Key, number]> = [];
    let map = new Map<Key, number>();

    function parsePairs(buf: Uint8Array): void {
        // DataView over buf; for each pair extract Key + value via getBigUint64 → Number.
        // Strings: TextDecoder over 16-byte slices.
    }

    function refillMap(): void {
        map.clear();
        for (const [k, v] of pairs) map.set(k, v);
    }

    function reset(): void {
        switch (entry) {
            case "hashmap_<X>_insert": map.clear(); break;
            case "hashmap_<X>_lookup": break;
            case "hashmap_<X>_delete": refillMap(); break;
        }
    }

    function run(iters: number): { checksum: number } {
        switch (entry) {
            case "hashmap_<X>_insert": {
                for (let i = 0; i < iters; i++) map.set(pairs[i][0], pairs[i][1]);
                return { checksum: map.size };
            }
            case "hashmap_<X>_lookup": {
                let acc = 0;
                for (let i = 0; i < iters; i++) acc += map.get(pairs[i][0]) ?? 0;
                return { checksum: acc };
            }
            case "hashmap_<X>_delete": {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    const k = pairs[i][0];
                    const v = map.get(k);
                    if (v !== undefined) { acc += v; map.delete(k); }
                }
                return { checksum: acc };
            }
            default: throw new Error(`unknown entry "${entry}"`);
        }
    }

    return {
        loadInput(buf) { parsePairs(buf); refillMap(); },
        run,
        reset,
    };
}
```

## Loader changes

Three loaders touch: `packages/loaders/src/{raw-wasm.ts, rust-bindgen.ts, emscripten.ts}`. Single behavioural change: per-entry reset companion lookup.

**Pattern:**

```ts
const entryReset = glue[`${input.entry}_reset`];
const genericReset = glue.reset;
const resetFn = typeof entryReset === "function" ? entryReset
              : typeof genericReset === "function" ? genericReset
              : undefined;

const module: BenchModule = {
    loadInput: (buf) => glue.load_input(buf),
    run,
    ...(resetFn ? { reset: () => (resetFn as () => void)() } : {}),
};
```

**Contract update** в JSDoc above `Loader` interface (`packages/loaders/src/types.ts`):

> Reset binding lookup order: `glue[<entry>_reset]` (per-entry companion, Phase 1.1.2+ workloads) → `glue.reset` (generic, matmul/interop_calls). First match wins. `BenchModule.reset` omitted if neither present.

**Test coverage** (per loader test file: raw-wasm.test.ts + bindgen test if exists + emscripten test if exists):

- 1 case: per-entry reset companion bound when present.
- 1 case: fallback to generic `reset` when no `<entry>_reset` (matmul/interop_calls precedent).

`plain-js.ts` НЕ меняется — JS loader контракт не использует glue exports.

`packages/harness/src/measure.ts` НЕ меняется — `module.reset?.()` optional chain работает безотносительно к binding source.

## Validate / reference impl

Per binary: `benches/hashmap_{string,int}/validate/reference.ts`. JS impl is source of truth для expectedChecksums.

Structure (модель: `benches/interop_calls/validate/reference.ts`):

- Parse fixture bytes (same layout as wasm side reads).
- For each entry, compute checksum per formula:
  - `insert`: result = `map.size()` after N inserts = N
  - `lookup`: result = Σ of all N pair values
  - `delete`: result = Σ of all N pair values (same as lookup для full-fixture pass)
- Emit JSON `{entry: {S, M, L}}` to stdout → manually copied в `spec.json` `expectedChecksums`.

**Wave 1 sequencing:** (1) run `pnpm fixtures` → fixture files + `fixtureSha256` для spec.json; (2) `pnpm exec tsx benches/hashmap_<X>/validate/reference.ts` → JSON output → copy в `spec.json.expectedChecksums`. Reference.ts должен парсить fixture bytes из disk, не genform inline (защита от drift между fixture generator и reference computation).

## Wave structure

### Wave 1 — Infra + spec (no impls)

1. `benches/common/fixtures.ts` (mulberry32 + 3 generators) + `benches/common/fixtures.test.ts`.
2. Refactor `benches/matmul/fixtures/generate.ts` → thin wrapper. Verify SHA256 unchanged.
3. Update `tsconfig.json` include для `benches/common/**/*`.
4. Create `benches/hashmap_string/` skeleton: `spec.json`, `fixtures/generate.ts`, `validate/reference.ts`.
5. Create `benches/hashmap_int/` skeleton same.
6. Run fixtures + reference impls → capture `fixtureSha256` + `expectedChecksums` в spec.json.

**Wave 1 exit gates:**

- `pnpm typecheck && pnpm lint:all && pnpm test` зелёные.
- `pnpm fixtures` produces matmul SHA256 unchanged.
- Both `validate/reference.ts` run → spec.json'ы committed с expectedChecksums.

### Wave 2 — Implementations (6 wasm + 2 JS)

Per binary:

7. `js/idiomatic/` package.
8. `rust/bindgen/` crate (added to workspace `Cargo.toml`).
9. `cpp/build-emscripten.sh` + `cpp/src/<binary>.cpp`.

Plus:

10. Three loader updates + test cases.

**Wave 2 exit gates:**

- `pnpm build:all` → 12 wasm binaries в `dist/` (2 × 3 × 2).
- `pnpm typecheck && pnpm lint:all && pnpm test` зелёные.
- `pnpm smoke` → все hashmap S × все combos × Node validated.

### Wave 3 — Bench + guidelines + close

11. `pnpm bench:all` — full matrix.
12. `pnpm report` → reporter HTML sanity check.
13. Guidelines harvest (target ≥1 confirmed claim в `docs/guidelines.md`):
    - Bundle-size cross-language + cross-key-type analysis.
    - Per-op overhead ratios.
    - Confirmed: ≥2 sizes × ≥2 key-types consistent signal.
    - Tentative: single-axis observation.
14. `docs/roadmap.md` cleanup — remove hashmap-workload entry from Phase 1.1 bucket.
15. Phase close: tag `phase-1-1-2`, merge `--no-ff`, update `MEMORY.md`.
16. Capture pitfalls если что-то всплыло (`docs/pitfalls/2026-05-??-phase-1-1-2-execution.md`).

**Wave 3 / Phase 1.1.2 exit criteria:**

- 12 wasm binaries built.
- 108 measurement cases (6 IDs × 3 toolchains × 2 profiles × 3 sizes).
- Reporter cross-workload page показывает 10 measurement IDs: 1 matmul + 3 interop_calls + 6 hashmap.
- ≥1 confirmed или well-justified tentative claim в `docs/guidelines.md`.
- Master gates green.
- Tag `phase-1-1-2` поставлен.

## Open risks / known unknowns

- **Warmup vs sample state asymmetry для insert/delete.** loadInput pre-fills map (shared между всеми тремя entry binaries). Warmup для insert работает на pre-filled map (upserts), samples работают на empty (после `insert_reset` clear). Аналогично delete'у. JIT exercises same hot function code в обоих случаях, поэтому tier-up adequate, но noise в warmup samples (которые не reported) выше нормы. Принято как trade-off ради единого loadInput contract.
- **Matmul SHA256 drift** при `genF64Array` refactor — P1 §1 byte-preserve violation, fix-before-proceed.
- **wasm-bindgen `String` overhead** на hashmap_string — может тащить string interner code в init. Interesting bundle-size data point.
- **emscripten `std::unordered_map<std::string>` glue size** — libc++ string + hash symbols могут существенно увеличить glue.mjs. Если > 20 KB (size profile) — сильный guideline signal.
- **Firefox-emscripten 5x slowdown** (tech_debt от Phase 1.1.1, `docs/tech_debt/firefox-emscripten-noop-5x-slowdown.md`) — если повторится на hashmap, escalate в confirmed guideline. Если нет — workload-specific, остаётся investigation.
- **`scripts/build-cpp.ts` без wasi-sdk skip** — если orchestrator не умеет skip'ать combos без build script, потребуется patch (отдельный task). Verify on first build run.

## References

- Umbrella spec: [`2026-05-20-phase-1-1-design.md § Phase 1.1.2`](2026-05-20-phase-1-1-design.md)
- BenchModule contract + Checksum-семантика: [`2026-05-01-wasm-benchmarks-design.md § Контракт BenchModule`](2026-05-01-wasm-benchmarks-design.md)
- Pitfall §P1 (iter-dependent checksum protocol): [`../pitfalls/2026-05-23-phase-1-1-1-execution.md`](../../pitfalls/2026-05-23-phase-1-1-1-execution.md)
- Pitfall §P1 (byte-preserve refactor): [`../pitfalls/2026-05-22-phase-1-1-1-w1.md`](../../pitfalls/2026-05-22-phase-1-1-1-w1.md)
- Phase 1.1.1 session state: [`../session-states/session-state-2026-05-23-phase-1-1-1-closed.md`](../session-states/session-state-2026-05-23-phase-1-1-1-closed.md)
- Roadmap: [`../../roadmap.md § Phase 1.1`](../../roadmap.md)
- Guidelines: [`../../guidelines.md`](../../guidelines.md)
