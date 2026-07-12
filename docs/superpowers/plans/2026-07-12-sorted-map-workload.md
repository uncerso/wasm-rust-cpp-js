# sorted_map_int Workload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new benchmark workload `sorted_map_int` (ordered map under a range-query core) across the full toolchain matrix, sibling of `hashmap_int`.

**Architecture:** Near-exact copy of `hashmap_int` per toolchain; container swapped hash→ordered (`std::map` / `BTreeMap` / userland sorted arrays); the `delete` entry replaced by a `range` entry that sums values in a deterministic key-window. Fixture, state-model, loaders, build orchestration are all reused unchanged (auto-discovery via `spec.json`); only Rust crates need workspace-member registration.

**Tech Stack:** TS (tsx/esbuild), Rust (cargo raw + wasm-pack bindgen), C++ (emscripten + wasi-sdk), zod `BenchResultSchema`.

## Global Constraints

- **Workload id:** `sorted_map_int`. **Entries (exact):** `sorted_map_int_build`, `sorted_map_int_lookup`, `sorted_map_int_range` (+ `_reset` companion per entry).
- **Fixture:** reuse `benches/common/fixtures.ts::genIntPairs53(n, seed)` with hashmap_int's params — S/M/L → n=`1000/10000/100000`, seeds `0xBEEF_0001/0xBEEF_0002/0xBEEF_0003`. Byte-identical to hashmap_int.
- **innerIterations:** `{ S: 1000, M: 10000, L: 100000 }`.
- **Range-window formula (IDENTICAL across all impls):** `WINDOW_KEYS = 16`; `MAX_KEY = 2^53 - 1`; `span = floor(2^53 / n) * WINDOW_KEYS` (div-then-multiply, `n` = total pairs); per query `i`: `lo = pairs[i].key`, `hi = min(lo + span, MAX_KEY)`; sum values of all keys `k ∈ [lo, hi]` in the built (deduped, last-wins) structure.
- **Pinned checksums:** `build` = `{S:1000, M:10000, L:99996}` (== `hashmap_int_insert`); `lookup` = `{S:2078117175396, M:21674342192136, L:213944096178963}` (== `hashmap_int_lookup`); `range` = computed in Task 2, pinned in Task 3.
- **spec.json:** v2 (`version: 2`, `entries: string[]`, `expectedChecksums`). `supported`: `js:[idiomatic,typed-array]`, `rust:[raw,bindgen]`, `cpp:[emscripten,wasi-sdk]`, `profiles:[speed,size]`.
- **TS:** 4-space indent, double quotes, semicolons, trailing comma (multiline), `curly: all`, `verbatimModuleSyntax` + strict.
- **Rust:** edition 2024; `warnings/clippy::all = deny`, pedantic+nursery warn; `unsafe_code` allowed only in `raw` (with `#![allow(unsafe_code, reason=...)]`). Copy sibling clippy `#[allow(...)]` attributes verbatim.
- **C++:** `-std=c++23`, full `-Werror` warn set from sibling scripts; never edit generated `glue.mjs`.
- **wasm-opt:** universal via `scripts/lib/wasm-opt.ts` — do NOT add inline `wasm-opt` to build scripts. bindgen `Cargo.toml` keeps `wasm-opt = false` under both wasm-pack profiles.
- **Commits:** `--no-gpg-sign`. Push/PR are user actions.
- **All-gates pre-flight:** `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke`. `build:all`/`fixtures`/`smoke` run with `dangerouslyDisableSandbox: true` (tsx pipe); `typecheck`/`test`/`lint:*` run sandboxed.

---

## Execution Protocol

**Routing (hybrid inline/subagent).** Each task is tagged `[I]` (inline — this session) or `[S]` (subagent). All-`[I]` waves execute inline without re-asking. Subagent dispatches get the **full** gate set (`build:all` + typecheck + lint:all + test + smoke as applicable), never a subset.

| Task | Route | Why |
|---|---|---|
| 1 fixtures | `[I]` | trivial copy + path change |
| 2 reference + tests | `[S]` | novel range logic; correctness foundation for the whole workload |
| 3 spec.json + pin | `[I]` | mechanical (paste computed values) |
| 4 cpp/wasi-sdk **(GATE)** | `[S]` | feasibility risk: `std::map` under trap-shim no-libc setup |
| 5 cpp/emscripten | `[I]` | copy + rename after shared `.cpp` proven |
| 6 rust/raw | `[S]` | new crate + range in Rust |
| 7 rust/bindgen | `[I]` | mirror of raw; only binding layer differs |
| 8 js/idiomatic | `[S]` | novel binary-search range logic |
| 9 js/typed-array **(GATE)** | `[S]` | parity + binary-search off-by-one risk on typed arrays |
| 10 matrix + gates | `[I]` | run + inspect |
| 11 bench + close | `[I]` | user handoff for heavy `bench:all` |

**Static break-points (recommend `/finish-session`, user decides):**
- After **Task 3** — Wave-0 gate: reference pinned, cross-check passed. Natural session boundary.
- After **Task 4** — feasibility gate: `std::map` builds to memory-only wasm. STOP + rethink if it fails (retry ≤2).
- After **Task 9** — all six impls validated on S.
- After **Task 10** — full matrix + gates green.

**Per-task break-check:** after each task — retry budget ≤2 at the same approach; if a Wave-0 risk (spec § Риски) materializes, STOP and surface to the user with alternatives (do not silently re-scope). Commit per task.

---

## File Structure

```
benches/sorted_map_int/
├── spec.json                              # Task 3
├── fixtures/
│   ├── .gitignore                         # "*.bin"        Task 1
│   └── generate.ts                        # Task 1
├── validate/
│   ├── reference.ts                       # Task 2
│   └── reference.test.ts                  # Task 2  (run via `npx vitest run`; not in `pnpm test`)
├── cpp/
│   ├── src/{sorted_map_int.cpp,sorted_map_int.h,wasi-shims.cpp}   Task 4
│   ├── build-wasi-sdk.sh                   # Task 4
│   └── build-emscripten.sh                 # Task 5
├── rust/
│   ├── raw/{Cargo.toml,src/lib.rs}         # Task 6  (+ workspace member)
│   └── bindgen/{Cargo.toml,src/lib.rs,pkg-tmp/.gitignore,pkg-attr/.gitignore}  # Task 7 (+ workspace member)
└── js/
    ├── idiomatic/{package.json,tsconfig.json,src/index.ts}       Task 8
    └── typed-array/{package.json,tsconfig.json,src/index.ts,tests/parity.test.ts}  Task 9
```

Auto-discovery: `scripts/fixtures.ts`, `scripts/lib/matrix.ts`, `scripts/build-all.ts` all key off `benches/*/spec.json` + `spec.supported`; `pnpm-workspace.yaml` globs `benches/*/js/*`. **Only** the two Rust crates need explicit `Cargo.toml` `members` entries.

---

## Task 1: Fixtures generator `[I]`

**Files:**
- Create: `benches/sorted_map_int/fixtures/.gitignore`
- Create: `benches/sorted_map_int/fixtures/generate.ts`

**Interfaces:**
- Consumes: `benches/common/fixtures.ts::genIntPairs53(n, seed) → Uint8Array`.
- Produces: `s.bin`/`m.bin`/`l.bin` + prints `{ S,M,L: {bytes, sha256} }` (feeds Task 3 `inputSizes`).

- [ ] **Step 1: `.gitignore`**

```
*.bin
```

- [ ] **Step 2: `generate.ts`** — copy `benches/hashmap_int/fixtures/generate.ts` verbatim (it is workload-agnostic: same `genIntPairs53`, same SIZES/SEEDS, writes to its own dir via `import.meta.url`). No edits needed.

- [ ] **Step 3: Generate + capture hashes**

Run: `pnpm fixtures --bench=sorted_map_int` (with `dangerouslyDisableSandbox: true`).
Expected: prints `S/M/L` with `bytes=16000/160000/1600000` and sha256 **identical** to `hashmap_int/spec.json` `inputSizes[*].fixtureSha256` (byte-identical fixture). Record the three `{bytes, sha256}` for Task 3.

- [ ] **Step 4: Commit**

```bash
git add benches/sorted_map_int/fixtures/
git commit --no-gpg-sign -m "feat(sorted_map_int): fixture generator (reuse genIntPairs53)"
```

---

## Task 2: Reference validator + unit tests `[S]`

**Files:**
- Create: `benches/sorted_map_int/validate/reference.ts`
- Create: `benches/sorted_map_int/validate/reference.test.ts`

**Interfaces:**
- Consumes: fixtures from Task 1 (`benches/sorted_map_int/fixtures/*.bin`).
- Produces: exported pure functions `parsePairs`, `computeBuild`, `computeLookup`, `computeRange`, constants `WINDOW_KEYS`, `TWO_53`, `MAX_KEY`; a `main()` that prints `{entry:{S,M,L}}`. The printed `sorted_map_int_range` values feed Task 3.

- [ ] **Step 1: Write `reference.ts`** (exact content)

```ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = ["S", "M", "L"] as const;
const PAIR_BYTES = 16;
export const TWO_53 = 0x20000000000000; // 2^53
export const MAX_KEY = TWO_53 - 1;
export const WINDOW_KEYS = 16;

export interface Pair { key: number; value: number; }

export function parsePairs(buf: Uint8Array): Pair[] {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const n = buf.byteLength / PAIR_BYTES;
    const pairs: Pair[] = [];
    for (let i = 0; i < n; i++) {
        const base = i * PAIR_BYTES;
        const key = Number(dv.getBigUint64(base, true));
        const value = Number(dv.getBigUint64(base + 8, true));
        pairs.push({ key, value });
    }
    return pairs;
}

// Build the deduped (last-wins) sorted structure from the first `iters` pairs.
function buildSorted(pairs: Pair[], iters: number): { keys: number[]; vals: number[] } {
    const map = new Map<number, number>();
    for (let i = 0; i < iters; i++) {
        map.set(pairs[i]!.key, pairs[i]!.value);
    }
    const keys = [...map.keys()].sort((a, b) => a - b);
    const vals = keys.map((k) => map.get(k)!);
    return { keys, vals };
}

// First index i with keys[i] >= target.
function lowerBound(keys: number[], target: number): number {
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (keys[mid]! < target) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

export function computeBuild(pairs: Pair[], iters: number): number {
    return buildSorted(pairs, iters).keys.length;
}

export function computeLookup(pairs: Pair[], iters: number): number {
    const { keys, vals } = buildSorted(pairs, pairs.length);
    let acc = 0;
    for (let i = 0; i < iters; i++) {
        const k = pairs[i]!.key;
        const idx = lowerBound(keys, k);
        if (idx < keys.length && keys[idx] === k) {
            acc += vals[idx]!;
        }
    }
    return acc;
}

export function computeRange(pairs: Pair[], iters: number): number {
    const { keys, vals } = buildSorted(pairs, pairs.length);
    const n = pairs.length;
    const span = Math.floor(TWO_53 / n) * WINDOW_KEYS;
    let acc = 0;
    for (let i = 0; i < iters; i++) {
        const lo = pairs[i]!.key;
        const hi = Math.min(lo + span, MAX_KEY);
        let idx = lowerBound(keys, lo);
        while (idx < keys.length && keys[idx]! <= hi) {
            acc += vals[idx]!;
            idx++;
        }
    }
    return acc;
}

async function main(): Promise<void> {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixturesDir = join(here, "..", "fixtures");
    const iters: Record<string, number> = { S: 1000, M: 10000, L: 100000 };
    const report: Record<string, Record<string, number>> = {
        sorted_map_int_build: {},
        sorted_map_int_lookup: {},
        sorted_map_int_range: {},
    };
    for (const size of SIZES) {
        const buf = await readFile(join(fixturesDir, `${size.toLowerCase()}.bin`));
        const pairs = parsePairs(new Uint8Array(buf));
        const it = iters[size]!;
        report["sorted_map_int_build"]![size] = computeBuild(pairs, it);
        report["sorted_map_int_lookup"]![size] = computeLookup(pairs, it);
        report["sorted_map_int_range"]![size] = computeRange(pairs, it);
    }
    console.log(JSON.stringify(report, null, 2));
}

// Only run main() when invoked directly (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((e) => {
        console.error(e); process.exit(1);
    });
}
```

- [ ] **Step 2: Write `reference.test.ts`** (exact content — determinism, window sanity, cross-check math)

```ts
import { describe, it, expect } from "vitest";
import { genIntPairs53 } from "../../common/fixtures.js";
import { parsePairs, computeBuild, computeLookup, computeRange, TWO_53, MAX_KEY, WINDOW_KEYS } from "./reference.js";

const L_N = 100000;
const L_SEED = 0xBEEF_0003;

describe("sorted_map_int reference", () => {
    const pairs = parsePairs(genIntPairs53(L_N, L_SEED));

    it("is deterministic (same input → same range checksum)", () => {
        expect(computeRange(pairs, L_N)).toBe(computeRange(pairs, L_N));
    });

    it("build checksum equals unique-key count and matches hashmap_int pin (L=99996)", () => {
        expect(computeBuild(pairs, L_N)).toBe(99996);
    });

    it("lookup checksum matches hashmap_int pin (L)", () => {
        expect(computeLookup(pairs, L_N)).toBe(213944096178963);
    });

    it("range sum stays < 2^53 (JS-safe) and > 0", () => {
        const r = computeRange(pairs, L_N);
        expect(r).toBeGreaterThan(0);
        expect(r).toBeLessThan(TWO_53);
    });

    it("range windows are bounded (no pathological O(n) window)", () => {
        // Reconstruct sorted keys, measure the max keys-in-window across all anchors.
        const keys = [...new Set(pairs.map((p) => p.key))].sort((a, b) => a - b);
        const span = Math.floor(TWO_53 / pairs.length) * WINDOW_KEYS;
        let maxCount = 0;
        for (let i = 0; i < pairs.length; i++) {
            const lo = pairs[i]!.key;
            const hi = Math.min(lo + span, MAX_KEY);
            // linear count is fine for a test
            let c = 0;
            for (const k of keys) {
                if (k >= lo && k <= hi) { c++; }
                if (k > hi) { break; }
            }
            if (c > maxCount) { maxCount = c; }
        }
        // expected ~16; assert comfortably bounded (Poisson tail)
        expect(maxCount).toBeLessThan(200);
    });
});
```

- [ ] **Step 3: Run test — expect PASS**

Run (sandboxed OK): `npx vitest run benches/sorted_map_int/validate/reference.test.ts` (confirmed working for `benches/**` — vitest resolves `.js`→`.ts`; these files are NOT in `pnpm test`, they are Wave-0 dev aids, mirroring `benches/common/*.test.ts`).
Expected: 5 passing. If `build`/`lookup` assertions fail → the fixture is not byte-identical to hashmap_int (investigate Task 1 before proceeding).

- [ ] **Step 4: Run reference to capture range checksums**

Run: `tsx benches/sorted_map_int/validate/reference.ts` (with `dangerouslyDisableSandbox: true`).
Expected: JSON with `build={S:1000,M:10000,L:99996}`, `lookup` matching the pins, and `range={S:…,M:…,L:…}`. **Record the three `range` values for Task 3.**

- [ ] **Step 5: Commit**

```bash
git add benches/sorted_map_int/validate/
git commit --no-gpg-sign -m "feat(sorted_map_int): reference validator + tests (range window, cross-check)"
```

---

## Task 3: spec.json + pin checksums `[I]`

**Files:**
- Create: `benches/sorted_map_int/spec.json`

**Interfaces:**
- Consumes: Task 1 `inputSizes` hashes; Task 2 `range` checksums.
- Produces: the workload manifest that all orchestration auto-discovers.

- [ ] **Step 1: Write `spec.json`** — copy `benches/hashmap_int/spec.json`, then apply: `id`→`sorted_map_int`; rewrite `description`; `entries`→ the 3 sorted-map entries; keep `inputSizes` (bytes/sha256/innerIterations identical — verify against Task 1 output); replace `expectedChecksums` with the 3 sorted-map entries (build/lookup pins from Global Constraints, range from Task 2); `supported.toolchains.js`→`["idiomatic","typed-array"]`; rewrite `ioContract` for the range semantics + window formula. Fill `<RANGE_S>/<RANGE_M>/<RANGE_L>` with Task 2 values.

```jsonc
{
    "id": "sorted_map_int",
    "version": 2,
    "description": "Ordered-map workload (std::map / BTreeMap / userland sorted-array) with u64 keys in [0, 2^53). 3 entries: build (construct sorted structure), lookup (exact-key), range (sum values in a deterministic key-window). Range-query core distinguishes it from hashmap_int; fixture shared with hashmap_int (build/lookup checksums cross-check).",
    "entries": ["sorted_map_int_build", "sorted_map_int_lookup", "sorted_map_int_range"],
    "inputSizes": {
        "S": { "fixtureBytes": 16000, "fixtureSha256": "054201d12abb3008d5990517ae600749988e1e66a5651fb9906477af2cd1d2a8", "innerIterations": 1000 },
        "M": { "fixtureBytes": 160000, "fixtureSha256": "0a8e5759899167143ba388aee2b015e2d396adf644b44f90820e04fdb36a8d5e", "innerIterations": 10000 },
        "L": { "fixtureBytes": 1600000, "fixtureSha256": "3d04f7948bc873ac5c338f2196ca7f69865d545bf0edbd2701df0fec9d2665c3", "innerIterations": 100000 }
    },
    "expectedChecksums": {
        "sorted_map_int_build": { "S": 1000, "M": 10000, "L": 99996 },
        "sorted_map_int_lookup": { "S": 2078117175396, "M": 21674342192136, "L": 213944096178963 },
        "sorted_map_int_range": { "S": <RANGE_S>, "M": <RANGE_M>, "L": <RANGE_L> }
    },
    "supported": {
        "languages": ["js", "rust", "cpp"],
        "toolchains": {
            "js": ["idiomatic", "typed-array"],
            "rust": ["bindgen", "raw"],
            "cpp": ["emscripten", "wasi-sdk"]
        },
        "profiles": ["speed", "size"]
    },
    "ioContract": {
        "fixtureLayout": "N pairs of (u64_key_le ∈ [0, 2^53), u64_value_le ∈ [0, 2^32)); 16N bytes. Byte-identical to hashmap_int.",
        "iterSemantics": "Iter-dependent. expectedChecksum valid only for N = innerIterations[size].",
        "stateModel": "load_input parses pairs AND builds the ordered structure. Per-entry <entry>_reset: build→clear; lookup→no-op; range→no-op.",
        "outputLayout": "Single scalar checksum: build→structure size; lookup→Σ values for exact-key hits; range→Σ values over all query windows.",
        "rangeWindow": "WINDOW_KEYS=16; span=floor(2^53/n)*WINDOW_KEYS; per query i: lo=pairs[i].key, hi=min(lo+span, 2^53-1); sum values of keys in [lo,hi] in the built structure."
    }
}
```

- [ ] **Step 2: Validate spec parses**

Run (sandboxed OK): `pnpm typecheck` — no schema-related failures. (Optional sharper check: `tsx -e "import('@bench/result-schema').then(m=>m.SpecSchema.parse(require('./benches/sorted_map_int/spec.json')))"` with `dangerouslyDisableSandbox: true` — avoid `!`/heredoc; write to a file if needed.)

- [ ] **Step 3: Commit**

```bash
git add benches/sorted_map_int/spec.json
git commit --no-gpg-sign -m "feat(sorted_map_int): spec.json v2 with pinned checksums"
```

**⏸ BREAK-POINT (Wave-0 gate):** reference pinned + build/lookup cross-check green. Recommend `/finish-session` (user decides).

---

## Task 4: C++ shared source + wasi-sdk build (FEASIBILITY GATE) `[S]`

**Files:**
- Create: `benches/sorted_map_int/cpp/src/sorted_map_int.h`
- Create: `benches/sorted_map_int/cpp/src/sorted_map_int.cpp`
- Create: `benches/sorted_map_int/cpp/src/wasi-shims.cpp`
- Create: `benches/sorted_map_int/cpp/build-wasi-sdk.sh`

**Interfaces:**
- Produces exported C symbols: `alloc`, `load_input`, `sorted_map_int_build`, `sorted_map_int_build_reset`, `sorted_map_int_lookup`, `sorted_map_int_lookup_reset`, `sorted_map_int_range`, `sorted_map_int_range_reset`. Consumed by `raw-wasm` loader (unchanged).

- [ ] **Step 1: `sorted_map_int.h`** — copy `benches/hashmap_int/cpp/src/hashmap_int.h` verbatim:

```cpp
#pragma once
#include <cstdint>
```

- [ ] **Step 2: `wasi-shims.cpp`** — copy `benches/hashmap_int/cpp/src/wasi-shims.cpp` **verbatim** (workload-agnostic trap shims; the `__throw_*`/`__libcpp_verbose_abort` overrides apply to `std::map` growth identically).

- [ ] **Step 3: `sorted_map_int.cpp`** — copy `benches/hashmap_int/cpp/src/hashmap_int.cpp`, then apply these exact edits:
  - Include line: `#include "sorted_map_int.h"`.
  - Replace `#include <unordered_map>` with `#include <map>`; add `#include <algorithm>` (for `std::min`).
  - In `struct State`: `std::unordered_map<uint64_t, uint64_t> map;` → `std::map<uint64_t, uint64_t> map;`.
  - Rename `hashmap_int_insert` → `sorted_map_int_build` (+ `_reset`), `hashmap_int_lookup` → `sorted_map_int_lookup` (+ `_reset`); **delete** `hashmap_int_delete` and `hashmap_int_delete_reset`.
  - Add `sorted_map_int_range` + `sorted_map_int_range_reset` (below).
  - `parse_pairs`, `alloc`, `load_input` unchanged (`std::map::operator[]` is last-wins, identical semantics).

The final entry section (everything after `load_input`) reads exactly:

```cpp
extern "C" double sorted_map_int_build(uint32_t iters) {
    for (uint32_t i = 0; i < iters; i++) {
        state().map[state().pairs[i].first] = state().pairs[i].second;
    }
    return static_cast<double>(state().map.size());
}

extern "C" void sorted_map_int_build_reset() {
    state().map.clear();
}

extern "C" double sorted_map_int_lookup(uint32_t iters) {
    double acc = 0.0;
    for (uint32_t i = 0; i < iters; i++) {
        const auto it = state().map.find(state().pairs[i].first);
        if (it != state().map.end()) {
            acc += static_cast<double>(it->second);
        }
    }
    return acc;
}

extern "C" void sorted_map_int_lookup_reset() {
    // No-op.
}

static constexpr uint64_t WINDOW_KEYS = 16;
static constexpr uint64_t MAX_KEY = (static_cast<uint64_t>(1) << 53) - 1;

extern "C" double sorted_map_int_range(uint32_t iters) {
    const uint64_t n = state().pairs.size();
    const uint64_t span = ((static_cast<uint64_t>(1) << 53) / n) * WINDOW_KEYS;
    double acc = 0.0;
    for (uint32_t i = 0; i < iters; i++) {
        const uint64_t lo = state().pairs[i].first;
        const uint64_t hi = std::min(lo + span, MAX_KEY);
        for (auto it = state().map.lower_bound(lo); it != state().map.end() && it->first <= hi; ++it) {
            acc += static_cast<double>(it->second);
        }
    }
    return acc;
}

extern "C" void sorted_map_int_range_reset() {
    // No-op — range is read-only.
}
```

- [ ] **Step 4: `build-wasi-sdk.sh`** — copy `benches/hashmap_int/cpp/build-wasi-sdk.sh`, then: replace both `src/hashmap_int.cpp` → `src/sorted_map_int.cpp`; replace the two `-Wl,--export=hashmap_int_*` blocks (production + attr) with the sorted-map exports:

```bash
  -Wl,--export=sorted_map_int_build -Wl,--export=sorted_map_int_build_reset \
  -Wl,--export=sorted_map_int_lookup -Wl,--export=sorted_map_int_lookup_reset \
  -Wl,--export=sorted_map_int_range -Wl,--export=sorted_map_int_range_reset \
```

Keep `alloc`/`load_input`/`--export-memory`/`--strip-all` lines and the `SIZE_ATTR` block structure unchanged.

- [ ] **Step 5: Build wasi-sdk (size profile) — feasibility gate**

Run (dangerouslyDisableSandbox): `pnpm build:all --bench=sorted_map_int` (or the narrowest build entrypoint for one binary; confirm the flag from `README.md § Сборка`). If no per-bench flag exists, build the whole workload.
Expected: `dist/sorted_map_int/cpp-wasi-sdk-{speed,size}/module.wasm` produced, no compile errors.

- [ ] **Step 6: Assert only-`memory` imports (GATE)**

Run (dangerouslyDisableSandbox): inspect imports of the built wasm — e.g. `node scripts/…` or a one-off with `WebAssembly.Module.imports`. Write a tiny `$TMPDIR/imports.mjs` (avoid inline `!`) that loads `dist/sorted_map_int/cpp-wasi-sdk-size/module.wasm` and prints `WebAssembly.Module.imports(new WebAssembly.Module(bytes))`.
Expected: only `{ module: "env", name: "memory", kind: "memory" }` (or equivalent single memory import) — **zero WASI imports**. If any WASI import appears, `std::map` pulled a symbol the shims miss → STOP, extend `wasi-shims.cpp`, retry (≤2), else surface to user.

- [ ] **Step 7: Validate checksums (node)**

Run (dangerouslyDisableSandbox): the node runner for `sorted_map_int` cpp/wasi-sdk × S (see `README.md § Запуск`). Expected: `build/lookup/range` checksums == `spec.json` pins; `correctnessFailed:false`.

- [ ] **Step 8: Commit**

```bash
git add benches/sorted_map_int/cpp/
git commit --no-gpg-sign -m "feat(sorted_map_int): C++ shared source + wasi-sdk build (std::map)"
```

**⏸ BREAK-POINT (feasibility gate):** if Steps 6–7 pass, the workload is viable end-to-end. Recommend `/finish-session` (user decides).

---

## Task 5: C++ emscripten build `[I]`

**Files:**
- Create: `benches/sorted_map_int/cpp/build-emscripten.sh`

- [ ] **Step 1: `build-emscripten.sh`** — copy `benches/hashmap_int/cpp/build-emscripten.sh`, then: replace both `src/hashmap_int.cpp` → `src/sorted_map_int.cpp`; replace the `EXPORTS` array with:

```bash
EXPORTS='["_alloc","_load_input","_sorted_map_int_build","_sorted_map_int_build_reset","_sorted_map_int_lookup","_sorted_map_int_lookup_reset","_sorted_map_int_range","_sorted_map_int_range_reset"]'
```

Everything else (RT_METHODS, OPT, WARN_FLAGS, MODULARIZE, SIZE_ATTR block) unchanged. Do NOT add inline `wasm-opt` (universal pass handles it).

- [ ] **Step 2: Build + validate**

Run (dangerouslyDisableSandbox): build `sorted_map_int` cpp/emscripten, then node-validate × S.
Expected: `dist/sorted_map_int/cpp-emscripten-{speed,size}/glue.mjs` + wasm; checksums == pins.

- [ ] **Step 3: Commit**

```bash
git add benches/sorted_map_int/cpp/build-emscripten.sh
git commit --no-gpg-sign -m "feat(sorted_map_int): C++ emscripten build"
```

---

## Task 6: Rust raw crate `[S]`

**Files:**
- Create: `benches/sorted_map_int/rust/raw/Cargo.toml`
- Create: `benches/sorted_map_int/rust/raw/src/lib.rs`
- Modify: `Cargo.toml` (workspace `members`)

**Interfaces:**
- Produces exported C symbols identical to Task 4's list. Consumed by `raw-wasm` loader.

- [ ] **Step 1: `Cargo.toml`** — copy `benches/hashmap_int/rust/raw/Cargo.toml`, change `name = "sorted-map-int-rust-raw"`.

- [ ] **Step 2: Register workspace member** — in root `Cargo.toml`, add to `members` (after the hashmap_int entries):

```toml
    "benches/sorted_map_int/rust/raw",
```

- [ ] **Step 3: `src/lib.rs`** — copy `benches/hashmap_int/rust/raw/src/lib.rs`, then: `use std::collections::HashMap;` → `use std::collections::BTreeMap;`; `map: HashMap<u64, u64>` → `map: BTreeMap<u64, u64>` (struct + `HashMap::new()` → `BTreeMap::new()`, `HashMap::with_capacity(...)` → `BTreeMap::new()` — BTreeMap has no `with_capacity`); rename `hashmap_int_insert`→`sorted_map_int_build` (+reset), `hashmap_int_lookup`→`sorted_map_int_lookup` (+reset); **remove** `hashmap_int_delete`(+reset); add the range fn + consts. The changed regions:

`load_input` map construction:

```rust
    let pairs = parse_pairs(buf);
    let mut map = BTreeMap::new();
    for (k, v) in &pairs {
        map.insert(*k, *v);
    }
    STATE.0.replace(State { pairs, map });
```

Entry functions (replace everything from the first entry fn to EOF):

```rust
#[unsafe(no_mangle)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "map len bounded by fixture size; < 2^53")]
pub extern "C" fn sorted_map_int_build(iters: u32) -> f64 {
    let mut st = STATE.0.borrow_mut();
    let n = iters as usize;
    let pairs_snapshot: Vec<(u64, u64)> = st.pairs[..n].to_vec();
    for (k, v) in pairs_snapshot {
        st.map.insert(k, v);
    }
    st.map.len() as f64
}

#[unsafe(no_mangle)]
pub extern "C" fn sorted_map_int_build_reset() {
    STATE.0.borrow_mut().map.clear();
}

#[unsafe(no_mangle)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "values in [0, 2^32) per spec ioContract; < 2^53 mantissa")]
pub extern "C" fn sorted_map_int_lookup(iters: u32) -> f64 {
    let st = STATE.0.borrow();
    let mut acc: f64 = 0.0;
    for i in 0..iters as usize {
        if let Some(v) = st.map.get(&st.pairs[i].0) {
            acc += *v as f64;
        }
    }
    acc
}

#[unsafe(no_mangle)]
pub const extern "C" fn sorted_map_int_lookup_reset() {
    // No-op — lookup is read-only.
}

const WINDOW_KEYS: u64 = 16;
const MAX_KEY: u64 = (1u64 << 53) - 1;

#[unsafe(no_mangle)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "values in [0, 2^32) per spec ioContract; < 2^53 mantissa")]
pub extern "C" fn sorted_map_int_range(iters: u32) -> f64 {
    let st = STATE.0.borrow();
    let n = st.pairs.len() as u64;
    let span = ((1u64 << 53) / n) * WINDOW_KEYS;
    let mut acc: f64 = 0.0;
    for i in 0..iters as usize {
        let lo = st.pairs[i].0;
        let hi = (lo + span).min(MAX_KEY);
        for (_k, v) in st.map.range(lo..=hi) {
            acc += *v as f64;
        }
    }
    acc
}

#[unsafe(no_mangle)]
pub const extern "C" fn sorted_map_int_range_reset() {
    // No-op — range is read-only.
}
```

- [ ] **Step 4: Build + lint + validate**

Run: `pnpm lint:rust` (sandboxed OK) → no clippy errors. Then (dangerouslyDisableSandbox) build + node-validate `sorted_map_int` rust/raw × S. Expected: `dist/sorted_map_int/rust-raw-{speed,size}/module.wasm`; checksums == pins; imports memory-only.

- [ ] **Step 5: Commit**

```bash
git add benches/sorted_map_int/rust/raw/ Cargo.toml Cargo.lock
git commit --no-gpg-sign -m "feat(sorted_map_int): Rust raw crate (BTreeMap)"
```

---

## Task 7: Rust bindgen crate `[I]`

**Files:**
- Create: `benches/sorted_map_int/rust/bindgen/Cargo.toml`
- Create: `benches/sorted_map_int/rust/bindgen/src/lib.rs`
- Create: `benches/sorted_map_int/rust/bindgen/pkg-tmp/.gitignore`
- Create: `benches/sorted_map_int/rust/bindgen/pkg-attr/.gitignore`
- Modify: `Cargo.toml` (workspace `members`)

- [ ] **Step 1: `Cargo.toml`** — copy `benches/hashmap_int/rust/bindgen/Cargo.toml`, change `name = "sorted-map-int-rust-bindgen"` (keep the `wasm-opt = false` metadata blocks + `wasm-bindgen = "0.2"`).

- [ ] **Step 2: Register workspace member** — add to root `Cargo.toml` `members`:

```toml
    "benches/sorted_map_int/rust/bindgen",
```

- [ ] **Step 3: pkg `.gitignore`s** — create both `pkg-tmp/.gitignore` and `pkg-attr/.gitignore`, each containing exactly:

```
**
```

- [ ] **Step 4: `src/lib.rs`** — copy `benches/hashmap_int/rust/bindgen/src/lib.rs`, apply the SAME container/rename edits as Task 6 (`HashMap`→`BTreeMap`, `with_capacity`→`new`, insert→build, remove delete, add range), but keep the bindgen shape: `use wasm_bindgen::prelude::*;`, `#[wasm_bindgen]` on each export (not `extern "C"`/`no_mangle`), keep `State::new()`, and keep the `wasm_memory()` export verbatim. The `lookup_reset`/`range_reset` use bindgen's non-const idiom:

```rust
#[wasm_bindgen]
#[allow(clippy::missing_const_for_fn, reason = "wasm_bindgen requires non-const fns")]
pub fn sorted_map_int_lookup_reset() {
    // No-op — lookup is read-only.
}
```

Range fn body identical to Task 6's, but signature `#[wasm_bindgen] pub fn sorted_map_int_range(iters: u32) -> f64` and consts `WINDOW_KEYS`/`MAX_KEY` declared once at module scope (if Task-6-style consts already added in a shared spot, redeclare here — separate crate).

- [ ] **Step 5: Build + lint + validate**

Run: `pnpm lint:rust` (sandboxed). Then (dangerouslyDisableSandbox) build + node-validate rust/bindgen × S. Expected: `dist/sorted_map_int/rust-bindgen-{speed,size}/` glue + wasm; checksums == pins.

- [ ] **Step 6: Commit**

```bash
git add benches/sorted_map_int/rust/bindgen/ Cargo.toml Cargo.lock
git commit --no-gpg-sign -m "feat(sorted_map_int): Rust bindgen crate (BTreeMap)"
```

---

## Task 8: JS idiomatic `[S]`

**Files:**
- Create: `benches/sorted_map_int/js/idiomatic/package.json`
- Create: `benches/sorted_map_int/js/idiomatic/tsconfig.json`
- Create: `benches/sorted_map_int/js/idiomatic/src/index.ts`

**Interfaces:**
- Produces default-export `create(entry: string): BenchModule` ({ loadInput, run, reset }). Consumed by `plain-js` loader (via esbuild bundle).

- [ ] **Step 1: `package.json`** — copy `benches/hashmap_int/js/idiomatic/package.json`, change `name` → `@bench-impl/sorted_map_int-js-idiomatic`.

- [ ] **Step 2: `tsconfig.json`** — copy `benches/hashmap_int/js/idiomatic/tsconfig.json` verbatim.

- [ ] **Step 3: `src/index.ts`** (exact content — factory-time dispatch to dodge the V8 switch-over-closure-const deopt, per hashmap_int idiomatic):

```ts
interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

const PAIR_BYTES = 16;
const TWO_53 = 0x20000000000000;
const MAX_KEY = TWO_53 - 1;
const WINDOW_KEYS = 16;

export default function create(entry: string): BenchModule {
    let pairs: Array<readonly [number, number]> = [];
    let keys: number[] = [];
    let vals: number[] = [];

    function parsePairs(buf: Uint8Array): void {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const n = buf.byteLength / PAIR_BYTES;
        const next: Array<readonly [number, number]> = [];
        for (let i = 0; i < n; i++) {
            const base = i * PAIR_BYTES;
            const key = Number(dv.getBigUint64(base, true));
            const value = Number(dv.getBigUint64(base + 8, true));
            next.push([key, value]);
        }
        pairs = next;
    }

    function buildSorted(iters: number): void {
        const m = new Map<number, number>();
        for (let i = 0; i < iters; i++) {
            m.set(pairs[i][0], pairs[i][1]);
        }
        const ks = [...m.keys()].sort((a, b) => a - b);
        keys = ks;
        vals = ks.map((k) => m.get(k) as number);
    }

    function lowerBound(target: number): number {
        let lo = 0;
        let hi = keys.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (keys[mid] < target) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    let runFn: (iters: number) => { checksum: number };
    let resetFn: () => void;

    switch (entry) {
        case "sorted_map_int_build":
            resetFn = () => {
                keys = [];
                vals = [];
            };
            runFn = (iters) => {
                buildSorted(iters);
                return { checksum: keys.length };
            };
            break;
        case "sorted_map_int_lookup":
            resetFn = () => {};
            runFn = (iters) => {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    const k = pairs[i][0];
                    const idx = lowerBound(k);
                    if (idx < keys.length && keys[idx] === k) {
                        acc += vals[idx];
                    }
                }
                return { checksum: acc };
            };
            break;
        case "sorted_map_int_range":
            resetFn = () => {};
            runFn = (iters) => {
                const n = pairs.length;
                const span = Math.floor(TWO_53 / n) * WINDOW_KEYS;
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    const lo = pairs[i][0];
                    const hi = Math.min(lo + span, MAX_KEY);
                    let idx = lowerBound(lo);
                    while (idx < keys.length && keys[idx] <= hi) {
                        acc += vals[idx];
                        idx++;
                    }
                }
                return { checksum: acc };
            };
            break;
        default:
            throw new Error(`sorted_map_int/js-idiomatic: unknown entry "${entry}"`);
    }

    return {
        loadInput(buf) {
            parsePairs(buf);
            buildSorted(pairs.length);
        },
        run: runFn,
        reset: resetFn,
    };
}
```

- [ ] **Step 4: Typecheck + build + validate**

Run: `pnpm typecheck` (sandboxed). Then (dangerouslyDisableSandbox) build + node-validate js/idiomatic × S. Expected: checksums == pins.

- [ ] **Step 5: Commit**

```bash
git add benches/sorted_map_int/js/idiomatic/
git commit --no-gpg-sign -m "feat(sorted_map_int): JS idiomatic (sorted array + binary search)"
```

---

## Task 9: JS typed-array + parity test (GATE) `[S]`

**Files:**
- Create: `benches/sorted_map_int/js/typed-array/package.json`
- Create: `benches/sorted_map_int/js/typed-array/tsconfig.json`
- Create: `benches/sorted_map_int/js/typed-array/src/index.ts`
- Create: `benches/sorted_map_int/js/typed-array/tests/parity.test.ts`

- [ ] **Step 1: `package.json`** — copy `benches/interop_calls/js/typed-array/package.json`, change `name` → `@bench-impl/sorted_map_int-js-typed-array`.

- [ ] **Step 2: `tsconfig.json`** — copy `benches/hashmap_int/js/idiomatic/tsconfig.json` verbatim.

- [ ] **Step 3: `src/index.ts`** — same structure as Task 8 idiomatic, but `keys`/`vals` are `Float64Array`. `buildSorted` builds via `Map` then fills typed arrays; `lowerBound` identical (typed arrays are indexable). Exact content:

```ts
interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

const PAIR_BYTES = 16;
const TWO_53 = 0x20000000000000;
const MAX_KEY = TWO_53 - 1;
const WINDOW_KEYS = 16;

export default function create(entry: string): BenchModule {
    let pairs: Array<readonly [number, number]> = [];
    let keys = new Float64Array(0);
    let vals = new Float64Array(0);

    function parsePairs(buf: Uint8Array): void {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const n = buf.byteLength / PAIR_BYTES;
        const next: Array<readonly [number, number]> = [];
        for (let i = 0; i < n; i++) {
            const base = i * PAIR_BYTES;
            const key = Number(dv.getBigUint64(base, true));
            const value = Number(dv.getBigUint64(base + 8, true));
            next.push([key, value]);
        }
        pairs = next;
    }

    function buildSorted(iters: number): void {
        const m = new Map<number, number>();
        for (let i = 0; i < iters; i++) {
            m.set(pairs[i][0], pairs[i][1]);
        }
        const ks = [...m.keys()].sort((a, b) => a - b);
        keys = Float64Array.from(ks);
        vals = Float64Array.from(ks, (k) => m.get(k) as number);
    }

    function lowerBound(target: number): number {
        let lo = 0;
        let hi = keys.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (keys[mid] < target) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    let runFn: (iters: number) => { checksum: number };
    let resetFn: () => void;

    switch (entry) {
        case "sorted_map_int_build":
            resetFn = () => {
                keys = new Float64Array(0);
                vals = new Float64Array(0);
            };
            runFn = (iters) => {
                buildSorted(iters);
                return { checksum: keys.length };
            };
            break;
        case "sorted_map_int_lookup":
            resetFn = () => {};
            runFn = (iters) => {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    const k = pairs[i][0];
                    const idx = lowerBound(k);
                    if (idx < keys.length && keys[idx] === k) {
                        acc += vals[idx];
                    }
                }
                return { checksum: acc };
            };
            break;
        case "sorted_map_int_range":
            resetFn = () => {};
            runFn = (iters) => {
                const n = pairs.length;
                const span = Math.floor(TWO_53 / n) * WINDOW_KEYS;
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    const lo = pairs[i][0];
                    const hi = Math.min(lo + span, MAX_KEY);
                    let idx = lowerBound(lo);
                    while (idx < keys.length && keys[idx] <= hi) {
                        acc += vals[idx];
                        idx++;
                    }
                }
                return { checksum: acc };
            };
            break;
        default:
            throw new Error(`sorted_map_int/js-typed-array: unknown entry "${entry}"`);
    }

    return {
        loadInput(buf) {
            parsePairs(buf);
            buildSorted(pairs.length);
        },
        run: runFn,
        reset: resetFn,
    };
}
```

- [ ] **Step 4: `tests/parity.test.ts`** (GATE — idiomatic ≡ typed-array ≡ reference on a small fixture)

```ts
import { describe, it, expect } from "vitest";
import { genIntPairs53 } from "../../../../common/fixtures.js";
import { parsePairs, computeBuild, computeLookup, computeRange } from "../../../validate/reference.js";
import createIdiomatic from "../../idiomatic/src/index.js";
import createTyped from "../../typed-array/src/index.js";

const N = 500;
const SEED = 0x1234_5678;
const ENTRIES = ["sorted_map_int_build", "sorted_map_int_lookup", "sorted_map_int_range"] as const;

describe("sorted_map_int JS parity", () => {
    const fixture = genIntPairs53(N, SEED);
    const pairs = parsePairs(fixture);
    const expected: Record<string, number> = {
        sorted_map_int_build: computeBuild(pairs, N),
        sorted_map_int_lookup: computeLookup(pairs, N),
        sorted_map_int_range: computeRange(pairs, N),
    };

    for (const entry of ENTRIES) {
        it(`${entry}: idiomatic == typed-array == reference`, () => {
            const idi = createIdiomatic(entry);
            idi.loadInput(fixture);
            idi.reset();
            const ci = idi.run(N).checksum;

            const typ = createTyped(entry);
            typ.loadInput(fixture);
            typ.reset();
            const ct = typ.run(N).checksum;

            expect(ci).toBe(expected[entry]);
            expect(ct).toBe(expected[entry]);
        });
    }
});
```

- [ ] **Step 5: Run parity test — expect PASS**

Run (sandboxed OK): `npx vitest run benches/sorted_map_int/js/typed-array/tests/parity.test.ts`.
Expected: 3 passing. A failure on `range` → binary-search off-by-one; fix `lowerBound`/scan before proceeding (retry ≤2).

- [ ] **Step 6: Typecheck + build + validate**

Run: `pnpm typecheck`. Then (dangerouslyDisableSandbox) build + node-validate js/typed-array × S. Expected: checksums == pins.

- [ ] **Step 7: Commit**

```bash
git add benches/sorted_map_int/js/typed-array/
git commit --no-gpg-sign -m "feat(sorted_map_int): JS typed-array + cross-impl parity test"
```

**⏸ BREAK-POINT:** all six impls validated on S. Recommend `/finish-session` (user decides).

---

## Task 10: Full matrix correctness + all gates `[I]`

**Files:** none (verification).

- [ ] **Step 1: Full node-correctness matrix**

Run (dangerouslyDisableSandbox): the node correctness sweep for `sorted_map_int` across all (toolchain × entry × S) — see `README.md § Запуск`. Expected: every combo `correctnessFailed:false`; `failures.txt` empty.

- [ ] **Step 2: All-gates pre-flight**

Run: `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke` (build:all + smoke with `dangerouslyDisableSandbox: true`; split the sandbox-safe ones out if convenient). Read producer exit status via `${pipestatus[1]}` (zsh) — do not trust a piped `$?`.
Expected: all green. NOTE: `pnpm test` runs the 6 package suites only; it does NOT pick up `benches/**/*.test.ts`. Also run the workload's dev-aid tests explicitly: `npx vitest run benches/sorted_map_int/validate/reference.test.ts benches/sorted_map_int/js/typed-array/tests/parity.test.ts` — expect 8 passing. (Authoritative workload correctness = the node matrix in Step 1.)

- [ ] **Step 3: Commit (if any lint/format touch-ups)**

```bash
git add -A
git commit --no-gpg-sign -m "chore(sorted_map_int): gate fixes" || echo "nothing to commit"
```

**⏸ BREAK-POINT:** matrix + gates green. Recommend `/finish-session` (user decides).

---

## Task 11: Bench + guidelines harvest + close `[I]`

**Files:**
- Modify: `docs/guidelines.md` (only if a finding is confirmed)
- Modify: `docs/roadmap.md` (remove the sorted-map slice from `stdlib-containers`; also remove the 3 stale PR-#14 items noted in Phase 0)

- [ ] **Step 1: Heavy bench (USER ACTION)** — `bench:all` is a heavy, machine-quiet run. Hand off: **user** runs `pnpm bench:all` (or the sorted_map-scoped variant) per `README.md`. Agent waits for the fresh `results/`.

- [ ] **Step 2: Reporter eyeball (visual deliverable check)** — `pnpm report` → open. Confirm `sorted_map_int` appears on the Size bar (all 8 wasm + 2 js) and in the Perf tabs (build/lookup/range × impl × env), bars scale sanely, no stale strings.

- [ ] **Step 3: Guidelines harvest** — from the numbers, if a signal is confirmed (≥ consistent across sizes), add a claim to `docs/guidelines.md` (format B-1): candidate claims — (a) ordered-container size-floor vs hash (`sorted_map_int` vs `hashmap_int`, same toolchain); (b) exact-lookup perf: ordered `O(log n)` vs hash `O(1)`; (c) range-query cross-toolchain (native `range()` vs JS binary-search + scan). Only write **confirmed** claims; note caveats.

- [ ] **Step 4: Roadmap update** — remove the sorted-map branch from `stdlib-containers`; remove the 3 completed-but-stale items (`hashmap-string-cpp-emplace-latent`, `emscripten-wasm-opt-universality`, `bench-correctness-fail-surfacing`); confirm `btreemap-no-std-alloc-floor` capture landed.

- [ ] **Step 5: Commit + PR prep**

```bash
git add docs/guidelines.md docs/roadmap.md
git commit --no-gpg-sign -m "docs(sorted_map_int): guidelines harvest + roadmap update"
```

Hand off to user: `git push -u origin feature/phase-1.2-sorted-map-workload` + GitHub compare link. Recommend `/finish-session`.

---

## Self-Review (author)

- **Spec coverage:** §I/O (Tasks 1–3), §Компоненты A–G (Tasks 4–9 + auto-wiring), §Корректность (Task 2 + validate), §Риски W0 spikes (Task 4 gate = risk 3/4, Task 9 gate = risk 5, Task 2 tests = risk 1/2), §Waves (Tasks map to Wave 0/1/2), §Тестирование (Task 2 + 9 + 10). Covered.
- **Placeholder scan:** only `<RANGE_S/M/L>` in Task 3 — filled from Task 2 output at execution (mechanism specified, not a TBD). No other placeholders.
- **Type consistency:** entry names (`sorted_map_int_build/lookup/range` + `_reset`), `create(entry)` signature, `BenchModule` shape, window formula (`WINDOW_KEYS=16`, `span=floor(2^53/n)*WINDOW_KEYS`, `MAX_KEY=2^53-1`) consistent across reference/rust/cpp/js. `BTreeMap::new()` (no `with_capacity`) noted.
