# Phase 1.1.3 — shape_dispatch workload — execution design

**Status:** ready for implementation plan
**Refines:** [`2026-05-20-phase-1-1-design.md § Phase 1.1.3`](2026-05-20-phase-1-1-design.md)
**Predecessor:** Phase 1.1.2.1 closed 2026-05-26 (tag `phase-1-1-2-1`, master HEAD `04f7202`)

## Purpose

Закрыть Phase 1.1 четвёртой workload — **shape_dispatch** — и собрать первые
confirmed claims в категории dispatch для `docs/guidelines.md`. Workload measures
product-engineering trade-off **dispatch × data layout** в 2×2 factorial design:
static (generics/templates/tagged) vs dynamic (virtual/dyn Trait) dispatch на
homogeneous-per-type arrays vs mixed array. Bundle-size signal — от
monomorphization premium. Runtime signal — от vtable indirection + cache pattern.

Phase 1.1 close включает **Phase 1.1 summary** (reporter v2 final layout +
systematic guidelines harvest across 4 workloads).

## Scope

**In scope:**

- 4 binaries (2×2 factorial — см. Workload contract).
- 1 entry per binary (matmul precedent) = 4 total entries.
- 3 sizes: S=1k, M=10k, L=100k shapes (cache-regime spanning).
- 5 toolchains (skip `js/typed-array` — workload не motivates it):
  - `js/idiomatic` — 3 binaries (binary 1 collapses в JS — см. JS asymmetry).
  - `rust/raw` — 4 binaries (no_std + no alloc crate; fat pointers `&dyn Shape`).
  - `rust/bindgen` — 4 binaries (raw heap via `alloc::alloc::alloc`, **не Vec**).
  - `cpp/emscripten` — 4 binaries (`malloc` + placement new + virtual).
  - `cpp/wasi-sdk` — 4 binaries (freestanding placement new, libc++ не требуется).
- Shared `genShapes(n, seed)` generator + `shape-reference.ts` checksum computer
  в `benches/common/`.
- Quantized checksum (`floor(score · 1e6 + 0.5)` integer sum) — order-independent,
  cross-binary equality invariant.
- **Phase 1.1 close** — reporter v2 final layout, systematic guidelines harvest,
  Phase 1.1 umbrella tag.

**Out of scope (→ documented в roadmap or accepted limitation):**

- `js/typed-array` — workload не requires typed arrays; same as `js/idiomatic`.
- `Vec` / `std::vector` storage анывэр в shape_dispatch path — container overhead
  axis = different workload (already в Phase 1.2 backlog via
  `hashmap-stdlib-no-glue`). shape_dispatch использует raw heap arrays.
- Additional shape types (>3) — workload pinned at Circle/Square/Triangle для
  predictable polymorphic IC behavior (3 hidden classes, под V8 IC megamorphic
  threshold of 5).
- LTO / opt-level flag exploration — speed/size profiles только, fixed.

**Rejected explicitly (not roadmap):**

- `#[inline(never)]` annotations on shape methods — would kill monomorphization
  win, equates static с dynamic per-call cost, defeats workload purpose.
- 3-way split (homogeneous-static + tagged-mixed + virtual-mixed без factorial
  separation) — 2×2 factorial isolates two effects atomically (см. rationale в
  brainstorm trail).

## Workload contract

### Binaries (2×2 factorial)

| Binary directory | Data layout | Dispatch model | Native | JS |
|---|---|---|---|---|
| `shape_dispatch_homo_static` | 3 typed arrays (per-type) | Generics/templates (3× monomorphized) | ✓ | ✗ |
| `shape_dispatch_homo_dyn` | 3 typed arrays (per-type) | `&dyn Shape` / virtual on `Shape*` | ✓ | ✓ |
| `shape_dispatch_mixed_static` | 1 mixed array (inline tagged) | enum match / `std::variant` visitor | ✓ | ✓ |
| `shape_dispatch_mixed_dyn` | 1 mixed Box<dyn>/Shape* array | virtual / dyn Trait | ✓ | ✓ |

**Comparison axes:**

- **(1) vs (2):** pure dispatch cost при monomorphic call site (BTB-predictable).
- **(3) vs (4):** pure dispatch cost при polymorphic call site (BTB worst case).
- **(1) vs (3):** data-layout effect при static dispatch.
- **(2) vs (4):** data-layout effect при dynamic dispatch.
- **(1) bundle vs (3) bundle:** monomorphization premium (per-type instantiation
  vs single tagged dispatcher).

### JS asymmetry rationale

В JS нет generics/dyn Trait — runtime types полностью стираются. **Binaries (1) и (2) в JS производят identical code** (TypeScript generics compile в same JS):

```js
function process(arr) { let acc = 0; for (const s of arr) acc += s.area_complex(); return acc; }
```

Call site `s.area_complex()` на homogeneous array → V8 IC monomorphic в обоих
случаях. Skip binary (1) для JS, document в `supported`. Binary (2) measurements
представляют оба factorial cells для JS path.

JS coverage: binaries 2, 3, 4. Binary 1 has empty cells under JS в reporter.

### Entries

1 entry per binary, named identically к binary directory (matmul precedent):

| Binary | Entry name |
|---|---|
| `shape_dispatch_homo_static` | `shape_dispatch_homo_static` |
| `shape_dispatch_homo_dyn` | `shape_dispatch_homo_dyn` |
| `shape_dispatch_mixed_static` | `shape_dispatch_mixed_static` |
| `shape_dispatch_mixed_dyn` | `shape_dispatch_mixed_dyn` |

Total entries: 4.

### Sizes и innerIterations

| Size | N (shapes) | innerIterations | Fixture size | Approx warm-median |
|---|---|---|---|---|
| S | 1 000 | 1 000 | 24 KB | ~30 µs (clear FF precision floor) |
| M | 10 000 | 10 000 | 240 KB | ~300 µs |
| L | 100 000 | 100 000 | 2.4 MB | ~3 ms |

`innerIterations[size] = N` — каждый sample выполняет full pass над fixture
shapes. Iter-dependent checksum (см. § Checksum).

Cache regime: S → L1 borderline; M → L2 fits; L → L2 spill, LLC pressure
(particularly для binary 4 mixed_dyn where Box-allocated shapes тащат pointer
chasing).

### Shape definitions

3 fixed shape types:

| Tag | Type | Fields | Parameters |
|---|---|---|---|
| 0 | Circle | r: f64 | r ∈ [0.5, 5.0) |
| 1 | Square | s: f64 | s ∈ [0.5, 5.0) |
| 2 | Triangle | b: f64, h: f64 | b, h ∈ [0.5, 5.0) |

Distribution: ~33%/33%/33% (deterministic via `floor(rand() * 3)` over
`mulberry32`).

### Body formula — `area_complex()`

Identical FP-op count across 3 shape types для fair per-shape perf comparison:

```
Per-shape (a, p) prelude:
  Circle:    a = π·r²              p = 2·π·r
  Square:    a = s²                p = 4·s
  Triangle:  a = 0.5·b·h           p = b + h + √(b² + h²)

Common formula над (a, p):
  score = a · √(p / (a + 1)) + ln(a + p + 1)
```

~12 FP ops + 1 √ + 1 ln per shape ≈ 20-30 ns warm. Body sized so что:
- Достаточно велик чтобы compiler не выпилил dispatch path entirely.
- Достаточно мал чтобы dispatch overhead (~1-3 ns/call) constitutes measurable
  fraction (~5-15%) of total per-element cost.

### Checksum — quantized for cross-binary equality

**Problem:** naive `Σ score` (f64) ломается через iteration order — binary (1)
processes per-type clusters, binary (3) processes mixed-fixture order; f64
addition non-associative → разные totals per binary → impossible to verify
cross-binary correctness via single `expectedChecksum`.

**Resolution — integer-quantized sum:**

```
per-shape contribution = floor(score · 1e6 + 0.5) as u64   // round-half-up
total checksum         = (Σ contributions) mod 2^64        // wrapping u64 sum
```

Properties:
- Integer sum is **order-independent** modulo wrapping → identical через все 4
  binaries для same shape data.
- Quantization at 1e6 = 6 decimal digits precision — adequate verification.
- Round-half-up (`floor(x + 0.5)`) chosen over ties-to-even для consistency
  across rust/cpp/js (some toolchains differ on ties-to-even default).

**Cross-binary invariant:** для same (binary_layout, size, shape_data),
`expectedChecksum` **bit-identical** через все 4 binaries. Sanity check в spec.json
+ verification гейт в W1.

### Fixture format

**Per-shape layout (24 bytes packed, little-endian):**

```
[0]      tag_u8       (0=Circle, 1=Square, 2=Triangle)
[1..8]   padding × 7  (ignored, kept для f64 alignment of p1)
[8..16]  p1_f64       (Circle.r, Square.s, Triangle.b)
[16..24] p2_f64       (Triangle.h; ignored для Circle/Square)
```

N shapes × 24 bytes per binary. **Все 4 binaries делят byte-identical fixture
content** per size (same generator + same seed) — verify via `fixtureSha256`
cross-binary equality.

**Seeds (deterministic per size, shared across 4 binaries):**

```ts
SEEDS = { S: 0xFACE_0001, M: 0xFACE_0002, L: 0xFACE_0003 }
```

(matmul `0xC0FFEE_*` и hashmap `0xDEAD_*` / `0xBEEF_*` SEEDS unchanged — byte-preserve
constraint per pitfall §P1.)

**ioContract в spec.json:**

```json
{
    "iterSemantics": "Iter-dependent. expectedChecksum валиден только для N = innerIterations[size].",
    "stateModel": "Read-only после loadInput. No reset companion needed (no run() state mutation).",
    "outputLayout": "Single u64 checksum: floor(score · 1e6 + 0.5) sum mod 2^64; identical across 4 binaries для same shape data."
}
```

### Pitfall §P1 invariants

1. **Iter-dependent:** `expectedChecksum` valid только при `iterations = innerIterations[size] = N`.
2. **No state mutation в run():** read-only iteration over fixture-loaded shapes;
   no reset companion exports needed (existing matmul-style loader contract).
3. **innerIterations[S/M/L] = 1000 / 10000 / 100000** — equals N (shape count).

## Common infrastructure

### `benches/common/fixtures.ts` extension

Add `genShapes(n: number, seed: number): Uint8Array` to existing fixture toolkit:

```ts
export function genShapes(n: number, seed: number): Uint8Array {
    // n shapes × 24 bytes layout = 24n bytes
    // tag distribution: floor(rand() * 3)
    // parameters: 0.5 + rand() * 4.5 (range [0.5, 5.0))
}
```

**Tests** (extend `benches/common/fixtures.test.ts`):
- `genShapes(seed=0xFACE_0001, n=4)` SHA256 snapshot — defends against silent drift.
- Tag distribution sanity (chi-square-style smoke с n=10k).

### `benches/common/shape-reference.ts` (NEW)

Shared quantized-checksum computer, used by all 4 binaries' `validate/reference.ts`:

```ts
export interface Shape { kind: ShapeKind; p1: number; p2: number; }
const enum ShapeKind { Circle = 0, Square = 1, Triangle = 2 }

export function computeScore(s: Shape): number { /* a, p prelude per kind + common formula */ }
export function parseShapes(buf: Uint8Array): Shape[] { /* 24-byte layout */ }
export function checksumQuantized(shapes: Shape[]): bigint {
    let acc = 0n;
    const mask = (1n << 64n) - 1n;
    for (const s of shapes) {
        const score = computeScore(s);
        acc = (acc + BigInt(Math.round(score * 1e6))) & mask;
    }
    return acc;
}
```

`Math.round` в JS = round-half-away-from-zero для positive numbers = round-half-up
(scores всегда positive due to formula structure). Cross-language equivalence:

| Language | Rounding | Notes |
|---|---|---|
| JS | `Math.round(x)` = `floor(x + 0.5)` для x ≥ 0 | banker's rounding не используется |
| Rust | `(x + 0.5).floor()` ⊥ avoid `f64::round` (rounds half away from zero, ties-to-even не applies) | explicit form для consistency |
| C++ | `floor(x + 0.5)` ⊥ avoid `round()` (round-half-away — equivalent на positive, но explicit form safer) | |

**Tests** (`benches/common/shape-reference.test.ts`):
- 1 case: known shape → known score (golden value).
- 1 case: `checksumQuantized` order-independent (shuffle input → same result).

### Dev infra changes

- `tsconfig.json` уже include'ит `benches/common/**/*` (from Phase 1.1.2 W1).
- `eslint.config.js` уже линтует `benches/common/**` как production.
- Workspace lint conventions unchanged.

## Per-toolchain implementation outlines

### Common discipline (all native toolchains)

**No `Vec` / `std::vector` usage anywhere в shape_dispatch path.** All storage —
raw heap arrays managed manually:

- homo binaries (1, 2): 3 separate raw arrays `(ptr: *T, len: usize)` per shape
  type.
- mixed_static (3): 1 raw array of tagged struct/enum inline (24-byte stride).
- mixed_dyn (4): 1 raw array of pointers (`*const dyn Shape` / `Shape**`),
  shape instances heap-allocated separately.

**Lint gate (W2 close):** `grep -rE 'Vec<|std::vector|alloc::vec' benches/shape_dispatch_*/` — must return 0 hits. Lifting в CI via post-build check скрипт acceptable.

### Rust/raw (`benches/shape_dispatch_*/rust/raw/`)

No_std + **no alloc crate** (deliberately preserves "raw" toolchain character).
Manual HEAP management via existing patterns (matmul/rust/raw `addr_of!(HEAP)`
precedent).

Skeleton (binary 4 mixed_dyn — наиболее nontrivial):

```rust
#![no_std]
#![no_main]

use core::hint::black_box;

trait Shape { fn score(&self) -> f64; }
#[repr(C)] struct Circle   { r: f64 }
#[repr(C)] struct Square   { s: f64 }
#[repr(C)] struct Triangle { b: f64, h: f64 }

impl Shape for Circle   { fn score(&self) -> f64 { /* … */ } }
impl Shape for Square   { fn score(&self) -> f64 { /* … */ } }
impl Shape for Triangle { fn score(&self) -> f64 { /* … */ } }

// HEAP layout (managed manually):
//   [0..N*24)         fixture bytes (raw shape data, after load_input parse)
//   [aligned_after)   N × storage for concrete Circle/Square/Triangle (per-tag offset)
//   [aligned_after)   N × *const dyn Shape (fat pointer array)
static mut HEAP: [u8; HEAP_SIZE] = [0; HEAP_SIZE];

#[no_mangle] pub extern "C" fn load_input(ptr: u32, len: u32) {
    // 1. Parse fixture bytes from HEAP at ptr.
    // 2. For each shape, construct concrete Circle/Square/Triangle in HEAP at known offset.
    // 3. Build fat-pointer array: для каждого constructed shape создать &dyn Shape;
    //    apply core::hint::black_box(shape_ref) ПЕРЕД store, чтобы defeat devirt.
    // 4. Store base + len в global state (raw u32 offsets).
}

#[no_mangle] pub extern "C" fn shape_dispatch_homo_dyn(iters: u32) -> f64 {
    let mut acc: u64 = 0;
    for i in 0..iters as usize {
        let shape_ref = unsafe { &*(STORAGE.dyn_array.add(i) as *const &dyn Shape) };
        let score = shape_ref.score();
        acc = acc.wrapping_add((score * 1e6 + 0.5) as u64);
    }
    acc as f64  // checksum as f64; harness validates against expectedChecksum
}
```

**Key points:**
- `&dyn Shape` — fat pointer (data + vtable), no Box needed.
- `core::hint::black_box(shape_ref)` perед store в array → compile barrier
  prevents devirtualization (см. R1).
- Wrapping u64 sum cast to f64 — harness checksum (BenchResult schema uses f64).
  Precision concern: u64 → f64 loses precision above 2^53; quantization total
  at 1e6 для L=100k × avg_score 30 = ~3e9, well within f64 precision. Should fit.
  Verify in W1 reference impl.

Binaries 1, 2, 3 — analogous structure с однотипными storage variants.

**Clippy / lints:** existing project rules. `unsafe_code` warn (raw acceptable).

### Rust/bindgen (`benches/shape_dispatch_*/rust/bindgen/`)

`#[wasm_bindgen]` exports + global state via `SyncCell` pattern. **Storage — raw
heap arrays (allocator: `alloc::alloc::alloc` with explicit Layout), не `Vec`.**

Skeleton (binary 4):

```rust
use std::alloc::{alloc, Layout};
use core::hint::black_box;

struct State {
    storage_base: *mut u8,
    dyn_array: *mut &'static dyn Shape,  // raw pointer-array, manual lifetime
    len: usize,
}

static STATE: LazyLock<SyncCell<State>> = LazyLock::new(|| /* init */);

#[wasm_bindgen] pub fn load_input(buf: &[u8]) {
    let n = buf.len() / 24;
    let layout_storage = Layout::array::<MaxShape>(n).unwrap();
    let layout_array   = Layout::array::<&dyn Shape>(n).unwrap();
    let storage_base = unsafe { alloc(layout_storage) };
    let dyn_array    = unsafe { alloc(layout_array) as *mut &dyn Shape };
    // Parse + construct each shape at storage_base + offset; populate dyn_array
    // with fat pointers; apply black_box to each before store.
}
```

**No Vec anywhere.** Verify W2 lint gate.

### C++/emscripten + C++/wasi-sdk (`benches/shape_dispatch_*/cpp/`)

Single shared `cpp/src/<binary>.cpp` per binary, built by both `cpp/build-emscripten.sh`
+ `cpp/build-wasi-sdk.sh`. Storage — `malloc` + placement new для virtual binaries
(2, 4). No `<vector>`, no `<new>` (placement new declared inline для wasi-sdk
freestanding compat).

Skeleton (binary 4):

```cpp
#include <cmath>
#include <cstdint>
#include <cstdlib>  // malloc — available в wasi-sdk libc

// Inline placement new declaration (libc++ <new> not required в freestanding):
inline void* operator new(size_t, void* p) noexcept { return p; }

struct Shape       { virtual double score() const = 0; virtual ~Shape() = default; };
struct Circle   : Shape { double r;       double score() const override; };
struct Square   : Shape { double s;       double score() const override; };
struct Triangle : Shape { double b, h;    double score() const override; };

struct State { void* storage; Shape** dyn_array; size_t len; };
static State g_state;

extern "C" void load_input(const uint8_t* buf, uint32_t len) {
    size_t n = len / 24;
    // Allocate storage for concrete shapes (worst-case sized: Triangle).
    g_state.storage = malloc(n * sizeof(Triangle));
    g_state.dyn_array = (Shape**) malloc(n * sizeof(Shape*));
    g_state.len = n;
    for (size_t i = 0; i < n; ++i) {
        uint8_t tag = buf[i * 24];
        double p1, p2;
        memcpy(&p1, buf + i * 24 + 8,  8);
        memcpy(&p2, buf + i * 24 + 16, 8);
        Shape* sh;
        switch (tag) {
            case 0: sh = new ((char*)g_state.storage + i * sizeof(Triangle)) Circle  {.r = p1};        break;
            case 1: sh = new ((char*)g_state.storage + i * sizeof(Triangle)) Square  {.s = p1};        break;
            case 2: sh = new ((char*)g_state.storage + i * sizeof(Triangle)) Triangle{.b = p1, .h=p2}; break;
        }
        asm volatile("" : : "g"(sh) : "memory");  // anti-devirt fence
        g_state.dyn_array[i] = sh;
    }
}

extern "C" double shape_dispatch_homo_dyn(uint32_t iters) {
    uint64_t acc = 0;
    for (uint32_t i = 0; i < iters; ++i) {
        double score = g_state.dyn_array[i]->score();
        acc += (uint64_t)(score * 1e6 + 0.5);
    }
    return (double)acc;  // wrapping u64 → f64
}
```

**Build flags:** `-std=c++23 -fno-exceptions -fno-rtti` + optimization profile.
emscripten + closure (size profile, matches interop_calls/hashmap precedent).
wasi-sdk freestanding standard flags.

**EXPORTED_FUNCTIONS (emscripten):**

```
["_load_input","_shape_dispatch_homo_dyn"]   # per binary
```

`alloc()` export for byte buffer alloc — matches existing interop_calls pattern.

### JS/idiomatic (`benches/shape_dispatch_*/js/idiomatic/`)

3 packages (skip binary 1). TypeScript + esbuild bundling per existing convention.

**Binary 2 (`homo_dyn`)** — 3 classes на 3 typed arrays + 3 separate per-type loops:

```ts
class Circle   { constructor(public r: number)   {} score(): number { /* … */ } }
class Square   { constructor(public s: number)   {} score(): number { /* … */ } }
class Triangle { constructor(public b: number, public h: number) {} score(): number { /* … */ } }

export default function create(_entry: string): BenchModule {
    let circles: Circle[] = [];
    let squares: Square[] = [];
    let triangles: Triangle[] = [];
    function loadInput(buf: Uint8Array) { /* partition into 3 arrays by tag */ }
    function run(_iters: number): { checksum: number } {
        const mask = (1n << 64n) - 1n;
        let acc = 0n;
        for (const c of circles)   acc = (acc + BigInt(Math.round(c.score() * 1e6))) & mask;
        for (const s of squares)   acc = (acc + BigInt(Math.round(s.score() * 1e6))) & mask;
        for (const t of triangles) acc = (acc + BigInt(Math.round(t.score() * 1e6))) & mask;
        return { checksum: Number(acc) };
    }
    return { loadInput, run };
}
```

**Iteration order — non-issue с quantized checksum.** Quantization (`Math.round(score · 1e6)`)
конвертирует per-shape contribution в integer; integer sum order-independent
(commutative + associative). 3 separate per-type loops produce **bit-identical**
checksum как mixed-order loop в binaries 3, 4 — точно тот reason почему мы
выбрали quantization (см. § Checksum). Each per-type loop sees один hidden
class → **monomorphic IC at each `s.score()` call site** — это и есть signal,
который binary 2 measures в JS.

**Binary 3 (`mixed_static`)** — single `TaggedShape` class + `const enum`:

```ts
const enum ShapeKind { Circle = 0, Square = 1, Triangle = 2 }
class TaggedShape {
    constructor(public kind: ShapeKind, public p1: number, public p2: number) {}
}
function process(arr: TaggedShape[]): bigint {
    let acc = 0n;
    for (const s of arr) {
        let a: number, p: number;
        switch (s.kind) {
            case ShapeKind.Circle:   a = Math.PI*s.p1*s.p1;       p = 2*Math.PI*s.p1;        break;
            case ShapeKind.Square:   a = s.p1*s.p1;               p = 4*s.p1;                 break;
            case ShapeKind.Triangle: a = 0.5*s.p1*s.p2;
                                     p = s.p1 + s.p2 + Math.sqrt(s.p1*s.p1 + s.p2*s.p2);     break;
        }
        const score = a*Math.sqrt(p/(a+1)) + Math.log(a+p+1);
        acc += BigInt(Math.round(score * 1e6));
    }
    return acc;
}
```

`const enum` inlines к literal integers в emitted JS — zero runtime overhead.
Loop sees single hidden class (`TaggedShape`) → monomorphic IC; dispatch — via
`switch(kind)` (branch-on-tag).

**Binary 4 (`mixed_dyn`)** — 3 classes + mixed array:

```ts
const shapes: Array<Circle | Square | Triangle> = [];
// process: acc += BigInt(Math.round(s.score() * 1e6))
```

Call site `s.score()` polymorphic-3 (Circle/Square/Triangle) → IC bucket of 3
entries. Below megamorphic threshold (5) → still fast IC dispatch, но slower
чем monomorphic.

**Factory-time dispatch pattern (per V8 deopt claim — `feedback`-class):** все
3 binaries должны использовать factory-time dispatch (`create(entry)` returns
specialized `run`/`reset` closures), **не closure-const `switch(entry)` в hot
loop**. Reference: `docs/guidelines.md` § «Избегай `switch (entry)` over
closure-constant in hot loop bodies». Особенно critical for binary 3 — там два
switch'а потенциально: outer `switch(entry)` (если есть) + inner
`switch(kind)`. Factory-time eliminates outer.

## Loader changes

**No changes needed.** Single entry per binary = existing matmul-style contract.
`packages/loaders/src/bind-reset.ts` already supports no-reset case (no
`<entry>_reset` export — falls through; module returned без `reset` field).

`packages/harness/src/measure.ts` — `module.reset?.()` optional chain handles
missing reset transparently.

## Validate / reference impl

Per binary: `benches/shape_dispatch_*/validate/reference.ts` — thin wrapper над
`benches/common/shape-reference.ts`:

```ts
import { parseShapes, checksumQuantized } from "../../common/shape-reference.js";
import fs from "node:fs";
const SIZES = { S: 1000, M: 10000, L: 100000 } as const;
const out: Record<string, Record<string, string>> = {};
for (const [size, n] of Object.entries(SIZES)) {
    const buf = fs.readFileSync(`fixtures/${size}.bin`);
    const shapes = parseShapes(buf);
    out["shape_dispatch_<binary>"] = out["shape_dispatch_<binary>"] ?? {};
    out["shape_dispatch_<binary>"][size] = checksumQuantized(shapes).toString();
}
console.log(JSON.stringify(out, null, 2));
```

**Output identical через 4 binaries per size** by construction (same fixture,
same checksum formula). Verify в W1 — cross-binary equality is gate.

**Wave 1 sequencing:**
1. Run `pnpm fixtures --bench=shape_dispatch_homo_static` → fixture файлы +
   `fixtureSha256` для spec.json.
2. Copy / regenerate identical fixtures для остальных 3 binaries (same content
   bytes; one regen + cp pattern).
3. Run reference impls → JSON output → copy в spec.json `expectedChecksums`.
4. Verify cross-binary `fixtureSha256` + `expectedChecksums` equality manually
   (`sha256sum` + `jq`).

## Wave structure

### W1 — Infra + spec (no impls)

**Pre-flight gate (FIRST step):** `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke` — verify master baseline зелёный. Если fail — STOP, surface to user; **не маскировать out-of-scope cleanup commit'ом** (per CLAUDE.md plan executor protocol).

1. Extend `benches/common/fixtures.ts` с `genShapes(n, seed)`; add unit tests
   (mulberry32 golden, SHA256 snapshot, tag distribution sanity).
2. Create `benches/common/shape-reference.ts` (parseShapes + computeScore +
   checksumQuantized); add unit tests (known shape → known score; order-independent).
3. Create 4 binary skeletons: `spec.json` (entries field, expectedChecksums TBD),
   `fixtures/generate.ts` (thin wrapper), `validate/reference.ts` (thin wrapper).
4. Run `pnpm fixtures` → capture `fixtureSha256` per binary per size.
5. Verify cross-binary fixture equality: 4 × `fixtureSha256` per size **bit-identical**.
6. Run reference impls → JSON output → copy `expectedChecksums` в spec.json.
7. Verify cross-binary checksum equality: 4 × `expectedChecksums` per size **bit-identical**.

**W1 exit gates:**

- `pnpm typecheck && pnpm lint:all && pnpm test` зелёные.
- `pnpm fixtures` produces matmul + hashmap SHA256 unchanged (byte-preserve invariant).
- 4 × `fixtureSha256` per size identical.
- 4 × `expectedChecksums` per size identical.

### W2 — Implementations (16 native + 3 JS)

8. **Per binary × toolchain:** implement в following order (allows fail-fast on
   most-risky paths first):
   - 8a. `cpp/wasi-sdk` binary 2 mixed_dyn (R3 verification — feasibility check).
   - 8b. `rust/raw` binary 2 mixed_dyn (R4 verification).
   - 8c. Остальные 14 (combos × binaries) — parallel-able.
9. `js/idiomatic` × 3 binaries (skip binary 1). Resolve binary 2 iteration-order
   trade-off (partitioned arrays + index loop vs single flat array; choose one).
10. Loader updates — likely none. Verify via existing matmul-style test pass.

**W2 exit gates:**

- `pnpm build:all` → 32 native + 6 JS artifacts (38 total).
- `pnpm typecheck && pnpm lint:all && pnpm test` зелёные.
- **Lint gate:** `grep -rE 'Vec<|std::vector|alloc::vec' benches/shape_dispatch_*/` returns 0 hits.
- **Devirt verification (R1):**
  ```bash
  for f in dist/shape_dispatch_homo_dyn__*/main.wasm \
           dist/shape_dispatch_mixed_dyn__*/main.wasm; do
      n=$(wasm-objdump -d "$f" | grep -c call_indirect)
      [ "$n" -gt 0 ] || { echo "DEVIRT FIRED: $f"; exit 1; }
  done
  ```
  If any artifact = 0: **STOP, surface to user** (per memory
  `feedback-surface-planned-risks`).
- `pnpm smoke` (S × все combos × Node + matmul × chromium/firefox) зелёный.
- **Eval-mode validation gate** (per CLAUDE.md Wave 2 close protocol): minimum
  1 case per binary в eval mode на Node, exit 0, no correctness failures.
  Critical для JS binary 3 (`switch(kind)` factory-time dispatch verified).

### W3 — Bench full matrix

11. `pnpm bench:all --envs=node,chromium,firefox --mode=eval` — full Phase 1.1.x
    matrix (existing ~630 + new 342 = **~972 cases**, ~60-90 мин wall-time).
12. `pnpm report --in=results/raw/<run>` → HTML sanity check.
13. Sanity-diff vs Phase 1.1.2.1 baseline для existing workloads (matmul,
    interop_calls, hashmap_*) — verify no perf regression > 5% от refactor side-effects.

**W3 exit gates:**

- 342 new shape_dispatch cases × 0 failures.
- 0 correctness failures across full matrix.
- Reporter HTML renders без errors.

### W4 — Reporter v2 (final cross-workload layout)

14. Cross-workload page получает финальный layout — 4 categories grouped
    (compute / interop / container / dispatch). shape_dispatch получает 2×2
    cross-axis sub-view (layout × dispatch).
15. «Phase 1.1 summary» heading.

**Risk R6 verification:** prototype 2×2 layout на small data subset до full implementation.
Если existing reporter scaffolding (Phase 1.1.2 v1) не supports nested grouping
без major rewrite → STOP, surface to user, propose alternatives (flat 4-row
representation vs CSS-only nesting vs defer 2×2 к Phase 1.2 reporter rewrite).

**W4 exit gates:**

- All 4 workload categories rendered.
- shape_dispatch 2×2 view visible per `(toolchain, profile)`.
- Existing 3 categories' rendering unchanged (matmul / interop_calls / hashmap_*).

### W5 — Guidelines harvest (Phase 1.1 systematic review)

16. Systematic review всех Phase 1.1 results. Apply formal rules:
    - **Confirmed:** ≥2 sizes OR ≥2 workloads consistent signal.
    - **Tentative:** single-axis observation.
17. Target claim categories для shape_dispatch:
    - **Dispatch overhead** (binary 2 vs 1, binary 4 vs 3) — confirmed candidate
      если consistent across 4 native toolchains × 2-3 sizes.
    - **Monomorphization bundle premium** (binary 1 vs 3 native artifact size) —
      confirmed candidate (cross-toolchain × 2 profiles).
    - **V8 IC state cost** (JS binary 3 vs binary 4) — likely tentative single-workload.
    - **Box-allocated mixed array vs inline tagged cache pattern** (binary 4 vs 3) —
      caveats-heavy tentative (confound с dispatch).
18. Refine existing claims (hashmap, interop_calls, V8-deopt) если phase 1.1.3
    cross-confirms или contradicts.

**W5 exit gates:**

- ≥3 total claims в `docs/guidelines.md` (confirmed или well-justified tentative)
  referencing Phase 1.1 results.
- ≥1 NEW dispatch-related claim from shape_dispatch.

### W6 — Phase 1.1.3 + Phase 1.1 close

19. `docs/roadmap.md` cleanup — remove shape-dispatch entry from Phase 1.1.
20. `/backlog-review` sanity-pass — format audit + orphan candidates check.
21. Capture pitfalls если что-то всплыло
    (`docs/pitfalls/2026-??-??-phase-1-1-3-execution.md`).
22. Tag `phase-1-1-3`; optional umbrella tag `phase-1-1` если Phase 1.1 целиком
    closed (last sub-phase).
23. **Phase close hand-off** — exit criteria met → message к user: «Phase 1.1.3
    exit criteria met (gates green, tag placed). Что-то ещё в этой сессии? Иначе
    можно `/finish-session` для memory + session-state snapshot.» **Не
    auto-invoke `/finish-session`** (per memory `feedback-no-auto-finish-session`).

**Phase 1.1.3 / Phase 1.1 exit criteria:**

- 38 new artifacts в `dist/` (32 native + 6 JS).
- 342 new shape_dispatch measurement cases × 0 failures.
- Reporter v2 final layout finalized с 4 categories + 2×2 dispatch sub-view.
- Guidelines: ≥3 total claims, ≥1 from shape_dispatch.
- `docs/tech_debt/` без Phase 1.1-targeted items.
- Master gates green (typecheck + lint:all + test + smoke).
- Tag `phase-1-1-3` placed.

## Open risks / known unknowns

**Process protocol:** для каждого risk ниже, если verification command
показывает что risk fired — **STOP, surface to user пакетом с 2-3 mitigation
alternatives, ждать decision**. Mitigations здесь — hypotheses, не pre-approved
decisions. Per memory `feedback-surface-planned-risks`.

### R1 — Devirtualization in binary 2 (homo_dyn native)

**Risk:** rustc / clang prove monomorphism at call site (only Circle observed in
each per-type loop) → devirtualize `&dyn Shape::score()` → binary 2 collapses к
binary 1. Eliminates measurement.

**Verification (W2 exit gate):** `wasm-objdump -d ... | grep -c call_indirect`
per binary 2 (and binary 4) artifact must be > 0.

**Mitigation candidates if fires:**

- (a) **Primary mitigations (already in implementation outlines):**
  - Rust: `core::hint::black_box(shape_ref)` — language intrinsic, zero-cost,
    guaranteed effective на wasm32.
  - C++: `asm volatile("" : : "g"(ptr) : "memory")` — Google Benchmark pattern,
    zero-cost, type-escape via input operand defeats devirt.
- (b) If (a) fails verification: factory function в separate translation unit
  без LTO inlining (explicit opaque construction).
- (c) Accept devirtualization as a **finding** — document как tentative claim
  "rustc/clang devirtualizes Box<dyn>/Shape* при −O3 + LTO для monomorphic
  call sites, comparable to static dispatch"; binary 2 native measurement
  loses meaning, JS still measures IC distinction.

**Не используем:** `std::atomic_signal_fence(seq_cst)` — memory barrier only,
не type-escape. Inadequate для devirt prevention specifically (devirtualization
— type analysis, не memory ordering optimization).

### R2 — Body size floor (dispatch noise)

**Risk:** body (12 FP ops + √ + ln) недостаточно велик, dispatch overhead < CV →
claim становится statistically weak.

**Verification (W3):** warm-CV per binary < 10%; difference (binary 2 vs binary 1)
> 3× CV для confirmed claim status.

**Mitigation candidates if fires:**

- (a) Increase body — add ещё 1-2 transcendentals (sin/cos/exp).
- (b) Reduce N (S=1k → 500) — less amortization, dispatch dominates more.
- (c) Accept signal as tentative single-CV с caveat (insufficient to confirm).

### R3 — cpp/wasi-sdk placement new feasibility

**Risk:** wasi-sdk freestanding без libc++ — `<new>` header может быть
unavailable; placement new требует inline manual declaration.

**Verification (W1/W2 build):** `pnpm build:cpp --bench=shape_dispatch_homo_dyn`
succeeds для wasi-sdk path.

**Mitigation candidates if fires:**

- (a) Inline `void* operator new(size_t, void* p) noexcept { return p; }`
  declaration в каждом cpp/src/<binary>.cpp (already in implementation outline —
  primary path).
- (b) Skip cpp/wasi-sdk для binaries 2 & 4 — document в supported matrix
  (precedent: hashmap Phase 1.1.2 skipped cpp/wasi-sdk для container reasons).
- (c) Manual vtable initialization (struct of function pointers, bypass C++
  virtual machinery) — heavy lift, last resort.

### R4 — rust/raw without alloc crate — fat pointer storage

**Risk:** `&dyn Shape` lifetimes problematic для storage в raw HEAP — Rust
borrow checker может не allow lifetime-erased fat pointer arrays.

**Verification (W1/W2 build):** `pnpm build:rust --bench=shape_dispatch_homo_dyn`
succeeds для rust/raw path.

**Mitigation candidates if fires:**

- (a) Use `*const dyn Shape` (raw pointer to dyn, not reference) — no lifetime;
  unsafe deref at use site. Already in implementation outline.
- (b) Use raw `*const ()` pointers + manual vtable struct — heavier type erasure.
- (c) Skip rust/raw для binaries 2 & 4, document в supported matrix.

### R5 — Cross-binary checksum equality

**Risk:** quantization rounding edge case — single f64 score landing within ULP
of `*.5` may round to different integers across toolchains, breaking sum
equality.

**Verification (W1 reference impl):** generate fixture S; compute checksum в JS
reference; build any one native binary and run validate; verify bit-for-bit
equality.

**Mitigation candidates if fires:**

- (a) Standardize rounding — `floor(x + 0.5)` explicit form (round-half-up) in
  all 5 toolchains, avoid f64 native rounding intrinsics that may use ties-to-even.
- (b) Lower quantization scale (1e6 → 1e3 — 3 decimal digits precision, more
  headroom from boundary).
- (c) Allow ±1 ULP tolerance — small extension к harness checksum verification.

### R6 — Reporter 2×2 cross-axis sub-view

**Risk:** existing reporter scaffold (Phase 1.1.2 v1) — flat workload × toolchain
table; nested grouping для 2×2 sub-view may require significant rewrite.

**Verification (W4 start):** prototype 2×2 layout с small data subset до
committing к full implementation.

**Mitigation candidates if fires:**

- (a) Flat shape_dispatch_<layout>_<dispatch> rows (4 rows side-by-side) — no
  nesting.
- (b) Add minimal grouping via CSS (alternating row colors, без structural nesting).
- (c) Defer 2×2 view к Phase 1.2 reporter rewrite; accept flat presentation в
  1.1.3.

## References

- Umbrella spec: [`2026-05-20-phase-1-1-design.md § Phase 1.1.3`](2026-05-20-phase-1-1-design.md)
- BenchModule contract + checksum semantics: [`2026-05-01-wasm-benchmarks-design.md § Контракт BenchModule`](2026-05-01-wasm-benchmarks-design.md)
- Hashmap precedent (multi-entry, per-entry reset, shared fixtures): [`2026-05-23-phase-1-1-2-hashmap-design.md`](2026-05-23-phase-1-1-2-hashmap-design.md)
- Bench-infra hardening (long-lived session, retry, cross-runtime evidence): [`2026-05-26-phase-1-1-2-1-bench-infra-design.md`](2026-05-26-phase-1-1-2-1-bench-infra-design.md)
- Pitfall §P1 (iter-dependent checksum protocol): [`../../pitfalls/2026-05-23-phase-1-1-1-execution.md`](../../pitfalls/2026-05-23-phase-1-1-1-execution.md)
- Pitfall §P1 (byte-preserve refactor invariant): [`../../pitfalls/2026-05-22-phase-1-1-1-w1.md`](../../pitfalls/2026-05-22-phase-1-1-1-w1.md)
- V8 deopt bug report (closure-const switch / factory-time dispatch): [`../bug-reports/2026-05-23-v8-deopt-switch-over-closure-const.md`](../bug-reports/2026-05-23-v8-deopt-switch-over-closure-const.md)
- Phase 1.1.2.1 session state: [`../session-state-2026-05-26-phase-1-1-2-1-closed.md`](../session-state-2026-05-26-phase-1-1-2-1-closed.md)
- Roadmap: [`../../roadmap.md § Phase 1.1`](../../roadmap.md)
- Guidelines: [`../../guidelines.md`](../../guidelines.md)
