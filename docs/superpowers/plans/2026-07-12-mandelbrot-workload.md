# mandelbrot Workload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new compute-bound benchmark workload `mandelbrot` (escape-time Mandelbrot over a fixed complex region) across the full toolchain matrix — the first academic-algo, complementary to the container-heavy current set. It isolates raw FLOP throughput (dense f64 loop, no allocation, no hot-path marshalling) and the pure-compute `no_std` size floor.

**Branch:** executes on `feature/phase-1.2-mandelbrot`, forked from `master` **after** the parallel-bench slice (Slice A) merges. The Slice-B plan (this file) is committed to the Slice-A branch alongside the shared spec, then branch B inherits it (see spec § Sequencing).

**Architecture:** Single-entry compute workload modeled on `matmul` (single entry, pure f64 arithmetic, checksum returned directly by an arity-1 `run(iters)`). Fixture encodes RUN PARAMETERS (region bounds + dims + max_iter) as 7 little-endian f64 — not random data, so `benches/common` (`mulberry32`) is NOT used. `run(iters)` renders the full grid `iters` times and returns the invariant per-grid checksum; `innerIterations` is omitted so the CLI default (1) applies, exactly like matmul (one `run()` = one full grid render). All orchestration auto-discovers via `spec.json`; only the two Rust crates need workspace-member registration.

**Tech Stack:** TS (tsx/esbuild), Rust (cargo raw `no_std` + wasm-pack bindgen), C++ (emscripten + wasi-sdk freestanding), zod `SpecSchema`/`BenchResultSchema`.

## Global Constraints

- **Workload id:** `mandelbrot`. **Entry (exact):** `mandelbrot` (single entry, like matmul). Reset is a **generic no-op** `reset()` (no per-entry `_reset` — matmul precedent; mandelbrot is pure compute with no mutable output state), resolved by `bindReset` via the generic-`reset` fallback.
- **Fixture layout (IDENTICAL across all impls):** 7 little-endian f64 = **56 bytes**, offsets `[minX@0, maxX@8, minY@16, maxY@24, dimsX@32, dimsY@40, maxIter@48]`. `dimsX/dimsY/maxIter` are integer-valued f64. Same byte layout for all sizes; only the values differ. `fixtureBytes = 56` for S/M/L.
- **Fixed region (all sizes):** `minX=-2.5, maxX=1.0, minY=-1.25, maxY=1.25` (classic full view — non-trivial escape distribution: ~18% in-set, rest escapes).
- **S/M/L (dims_x, dims_y, max_iter):** `S=(280,200,200)`, `M=(700,500,500)`, `L=(1400,1000,1000)`. Prototyped node render times: S≈6 ms, M≈64 ms, L≈536 ms/sample — L is in the "hundreds of ms" band (matmul js L≈604 ms). cpp/rust are faster; still measurable. Checksum ceiling `dimsX*dimsY*maxIter` for L = 1.4e9 < 2^53 (JS-safe, exact integer).
- **Canonical algorithm (the SINGLE source of truth is `validate/reference.ts`; every impl copies its expression structure verbatim):**
  ```
  step_x = (maxX - minX) / dimsX          // single f64 division
  step_y = (maxY - minY) / dimsY
  for py in [0, dimsY):  cy = minY + py * step_y
    for px in [0, dimsX):  cx = minX + px * step_x
      acc += escape(cx, cy, maxIter)
  escape(cx, cy, maxIter):
    zx = 0; zy = 0; iter = 0
    while iter < maxIter:
      zx2 = zx*zx; zy2 = zy*zy
      if zx2 + zy2 > 4.0: break
      zy = 2.0*zx*zy + cy
      zx = zx2 - zy2 + cx
      iter += 1
    return iter
  checksum = acc  // Σ escape-iteration-counts, exact integer
  ```
- **CHECKSUM PARITY IS CRITICAL (spec § cross-toolchain checksum-паритет).** The per-pixel escape count depends on the rounding of `zx2+zy2` vs `4.0`. Parity holds iff (1) **identical operation order** in all 6 impls — `zx2=zx*zx`, `zy2=zy*zy`, `zx2+zy2`, `2.0*zx*zy+cy` (left-assoc: `((2.0*zx)*zy)+cy`), `zx2-zy2+cx` (`(zx2-zy2)+cx`) — copied verbatim from `reference.ts`; (2) **matmul's FP-safe build flags** (no `-ffast-math`/reassociation). Standard wasm has **no scalar FMA**, so `a*b+c` is never contracted regardless of `-ffp-contract`; the only residual risk is fast-math reassociation, which matmul's flags already exclude (we copy them unchanged). The accumulator is an **exact integer sum** (counts are small integers, running total < 2^53), so accumulation order is irrelevant — only the per-pixel count matters. A Task-8 parity gate (JS idiomatic ≡ reference on a small grid) + the Task-5/6/7 per-impl S-checksum validation catch drift before the full matrix.
- **`innerIterations`:** **omitted** for all sizes (matmul precedent). `SpecInputSizeSchema` makes it optional; runner falls back to the CLI default `1`. `dimsX/dimsY/maxIter` ARE recorded per size in `inputSizes` (informational, allowed by the schema's `.passthrough()`, mirrors matmul's `n`) — but the **fixture is authoritative**; those keys drive nothing.
- **spec.json:** v2 (`version: 2`, `entries: ["mandelbrot"]`, `expectedChecksums`). `supported`: `js:["idiomatic"]`, `rust:["raw","bindgen"]`, `cpp:["emscripten","wasi-sdk"]`, `profiles:["speed","size"]`.
- **JS variant decision — idiomatic ONLY (RECOMMENDED; declared in `spec.json.supported.toolchains.js`).** The idiomatic-vs-typed-array axis in this suite captures "boxed native arrays (`number[][]`) vs contiguous typed buffers (`Float64Array`) for **array-shaped** data" (that is precisely matmul's distinction). mandelbrot has **no array-shaped input or output** — 7 scalar params in, 1 scalar out — so both variants would share a **bit-identical scalar hot loop** (the escape-time inner loop is pure scalar f64 arithmetic either way). A typed-array variant could only fabricate an artificial per-pixel `Uint32Array` scratch that a real mandelbrot never writes, adding O(pixels) noise and zero evidence. Precedent: the suite already ships idiomatic-only for the other non-array-shaped workloads (`hashmap_*`, `shape_dispatch_*`). If, while writing Task 8, a genuinely-distinct typed-array variant emerges, surface it to the user rather than silently adding it.
- **`no_std` raw crate:** the raw crate MUST be `#![no_std]` (pure f64 arithmetic + a scalar accumulator + a 64-byte fixture scratch — **no heap**, no allocator, `core` only). It needs a `#[panic_handler] { loop {} }` (matmul/interop/shape_dispatch raw crates all use exactly this — `on_panic(_: &PanicInfo) -> !` with `#[allow(clippy::missing_const_for_fn, reason=...)]`). Because there is **no allocation**, **no `#![no_main]`, no `alloc` crate, no global allocator** is required. Exports drop matmul's `output_ptr`/`output_len` (no output buffer): only `alloc`, `load_input`, `mandelbrot`, `reset`, `memory`.
- **No wasi-shims / no shared crate.** Unlike `sorted_map_int`/`hashmap_*` (which needed `wasi-shims.cpp` for `std::map`), mandelbrot uses **no std containers, no libc, no math builtins** (no `sqrt`/`fabs` — the escape test is `>` on doubles). So the cpp/wasi-sdk build is freestanding exactly like matmul's, with **zero** wasm imports expected (simpler than matmul, which at least called `__builtin_sqrt`). No `matmul-shared`-style crate: the escape loop is small and is duplicated verbatim into the raw and bindgen crates (task expects exactly two crates).
- **TS:** 4-space indent, double quotes, semicolons, trailing comma (multiline), `curly: all`, `verbatimModuleSyntax` + strict, `noUncheckedIndexedAccess` (applies to `validate/**` via root `tsconfig.json`; js-variant dirs opt out via their local tsconfig).
- **Rust:** edition 2024; `[lints] workspace = true`; `warnings = "deny"` + clippy `all = deny`, `pedantic`/`nursery = warn`. The lint gate runs `cargo clippy … -- -D warnings`, which **escalates pedantic/nursery warnings to errors** — so guard casts / const-candidates with `#[allow(clippy::…, reason=…)]` mirroring matmul/raw. `unsafe_code` allowed only in `raw` (ABI FFI) and in `bindgen` (the vacuous `unsafe impl Sync`), each via a crate-level `#![allow(unsafe_code, reason=…)]`.
- **C++:** `-std=c++23`, full `-Werror` warn set from matmul's scripts (`-Wall -Wextra -Wpedantic -Wshadow -Wconversion -Wsign-conversion -Wcast-align -Wold-style-cast -Wnon-virtual-dtor -Wnull-dereference -Wdouble-promotion`); use `static_cast`/`reinterpret_cast` (never C casts — `-Wold-style-cast`), `[[maybe_unused]]` (never `(void)x`); never edit generated `glue.mjs`.
- **wasm-opt:** universal via `scripts/lib/wasm-opt.ts` (invoked by `build-rust.ts`/`build-cpp.ts` for every rust/cpp profile). Do NOT add inline `wasm-opt` to build scripts. bindgen `Cargo.toml` keeps `wasm-opt = false` under both wasm-pack profiles.
- **Size attribution:** works out-of-the-box — `scripts/lib/size-attr-build.ts` keys its "observed" export set off `${c.sourceBench}` (== `"mandelbrot"`) plus `alloc`/`load_input`/`reset`; mandelbrot's exports are all covered, no registration needed (the extra `output_ptr`/`output_len` names in the set are simply absent — harmless).
- **Commits:** `--no-gpg-sign`. Push/PR are user actions.
- **All-gates pre-flight:** `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke`. `build:all`/`fixtures`/`smoke`/per-bench `build:*`/single-case `tsx runner` run with `dangerouslyDisableSandbox: true` (tsx binds a Unix pipe the sandbox blocks); `typecheck`/`test`/`lint:*`/`npx vitest run` run sandboxed.

---

## Execution Protocol

**Routing (hybrid inline/subagent).** Each task is tagged `[I]` (inline — this session) or `[S]` (subagent). All-`[I]` waves execute inline without re-asking. Subagent dispatches get the **full** gate set (`build:*` + typecheck + lint:all + test + smoke as applicable), never a subset.

| Task | Route | Why |
|---|---|---|
| 1 fixtures | `[I]` | trivial new generator (params, not random) |
| 2 reference + tests | `[S]` | canonical algorithm + pinned checksums — correctness foundation for all 6 impls |
| 3 spec.json + pin | `[I]` | mechanical (paste computed hashes + checksums) |
| 4 cpp/wasi-sdk **(FEASIBILITY GATE)** | `[S]` | first native build; assert freestanding memory-only wasm (low-risk here: no std/libc) |
| 5 cpp/emscripten | `[I]` | copy + rename after shared `.cpp` proven; full `build:cpp` + validate both cpp |
| 6 rust/raw (no_std) | `[S]` | new `no_std` crate + FFI unsafe + the size-floor story |
| 7 rust/bindgen | `[I]` | mirror of raw; only the binding layer differs |
| 8 js/idiomatic + parity **(GATE)** | `[S]` | canonical escape loop in JS + parity gate vs reference on a small grid |
| 9 matrix + gates | `[I]` | run + inspect |
| 10 bench + guidelines + close | `[I]` | user handoff for heavy `bench:all` |

**Static break-points (recommend `/finish-session`, user decides):**
- After **Task 3** — Wave-0 gate: reference pinned, fixture hashes captured. Natural session boundary.
- After **Task 4** — feasibility gate: freestanding cpp/wasi-sdk compiles to a memory-only wasm. STOP + rethink if it fails (retry ≤2).
- After **Task 8** — all six impls validated on S; JS parity gate green.
- After **Task 9** — full matrix + all gates green.

**Per-task break-check:** after each task — retry budget ≤2 at the same approach; then STOP and rethink, do not keep hammering. Commit per task. **If a checksum diverges from the reference pin on any impl (spec § cross-toolchain checksum-паритет risk materializes): STOP and surface to the user** with the concrete alternatives — (a) diff the impl's escape/grid expression char-by-char against `reference.ts` (most likely a transcription slip); (b) verify no `-ffast-math`/`-ffp-contract=fast` crept into a build script. Do NOT silently loosen the checksum tolerance, reorder operations, or re-scope.

---

## File Structure

```
benches/mandelbrot/
├── spec.json                              # Task 3
├── fixtures/
│   ├── .gitignore                         # "*.bin"        Task 1
│   └── generate.ts                        # Task 1
├── validate/
│   ├── reference.ts                       # Task 2   (canonical algorithm; `tsx …/reference.ts` prints checksums)
│   ├── reference.test.ts                  # Task 2   (npx vitest run; NOT in `pnpm test`)
│   └── parity.test.ts                     # Task 8   (idiomatic ≡ reference, small grid; npx vitest run)
├── cpp/
│   ├── src/{mandelbrot.cpp,mandelbrot.h}  # Task 4   (NO wasi-shims — freestanding, no std/libc)
│   ├── build-wasi-sdk.sh                  # Task 4
│   └── build-emscripten.sh                # Task 5
├── rust/
│   ├── raw/{Cargo.toml,src/lib.rs}        # Task 6   (no_std; + workspace member)
│   └── bindgen/{Cargo.toml,src/lib.rs,pkg-tmp/.gitignore,pkg-attr/.gitignore}  # Task 7 (+ workspace member)
└── js/
    └── idiomatic/{package.json,tsconfig.json,src/index.ts}  # Task 8  (idiomatic-only — see Global Constraints)
```

Auto-discovery: `scripts/fixtures.ts`, `scripts/build-all.ts`, `scripts/lib/matrix.ts` all key off `benches/*/spec.json` + `spec.supported`; `pnpm-workspace.yaml` globs `benches/*/js/*`. **Only** the two Rust crates need explicit root `Cargo.toml` `members` entries. No `benches/mandelbrot/README.md` (matches the `sorted_map_int`/`hashmap_*` convention; matmul's is legacy).

---

## Task 1: Fixtures generator `[I]`

**Files:**
- Create: `benches/mandelbrot/fixtures/.gitignore`
- Create: `benches/mandelbrot/fixtures/generate.ts`

**Interfaces:**
- Produces: `s.bin`/`m.bin`/`l.bin` (56 bytes each) + prints `{ S,M,L: {bytes, sha256} }` (feeds Task 3 `inputSizes`). No `benches/common` dependency (params, not random data).

- [ ] **Step 1: `.gitignore`**

```
*.bin
```

- [ ] **Step 2: `generate.ts`** (exact content)

```ts
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface Params {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    dimsX: number;
    dimsY: number;
    maxIter: number;
}

const REGION = { minX: -2.5, maxX: 1.0, minY: -1.25, maxY: 1.25 } as const;

const SIZES: Record<"S" | "M" | "L", Params> = {
    S: { ...REGION, dimsX: 280, dimsY: 200, maxIter: 200 },
    M: { ...REGION, dimsX: 700, dimsY: 500, maxIter: 500 },
    L: { ...REGION, dimsX: 1400, dimsY: 1000, maxIter: 1000 },
};

function encode(p: Params): Uint8Array {
    const buf = new Uint8Array(7 * 8);
    const dv = new DataView(buf.buffer);
    const vals = [p.minX, p.maxX, p.minY, p.maxY, p.dimsX, p.dimsY, p.maxIter];
    for (let i = 0; i < vals.length; i++) {
        dv.setFloat64(i * 8, vals[i]!, true);
    }
    return buf;
}

async function main() {
    const here = dirname(fileURLToPath(import.meta.url));
    await mkdir(here, { recursive: true });

    const result: Record<string, { bytes: number; sha256: string }> = {};
    for (const [size, p] of Object.entries(SIZES) as [keyof typeof SIZES, Params][]) {
        const buf = encode(p);
        const path = join(here, `${size.toLowerCase()}.bin`);
        await writeFile(path, buf);
        const sha = createHash("sha256").update(buf).digest("hex");
        result[size] = { bytes: buf.byteLength, sha256: sha };
        console.log(`${size}: dims=${p.dimsX}x${p.dimsY} maxIter=${p.maxIter} bytes=${buf.byteLength} sha256=${sha}`);
    }
    console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Generate + capture hashes**

Run (`dangerouslyDisableSandbox: true`): `pnpm fixtures --bench=mandelbrot`.
Expected: prints `S/M/L` with `bytes=56` and three sha256 hashes. **Record the three `{bytes, sha256}` for Task 3.** (`benches/mandelbrot/fixtures/*.bin` are gitignored.)

- [ ] **Step 4: Commit**

```bash
git add benches/mandelbrot/fixtures/
git commit --no-gpg-sign -m "feat(mandelbrot): fixture generator (region + dims + max_iter params)"
```

---

## Task 2: Reference validator + unit tests `[S]`

**Files:**
- Create: `benches/mandelbrot/validate/reference.ts`
- Create: `benches/mandelbrot/validate/reference.test.ts`

**Interfaces:**
- Consumes: fixtures from Task 1 (`benches/mandelbrot/fixtures/*.bin`).
- Produces: exported pure functions `parseParams`, `escape`, `render`, type `Params`; a `main()` that reads the three fixtures and prints `{ S,M,L }`. The printed checksums feed Task 3. **This file is the single source of the canonical algorithm — Tasks 4/6/8 copy its expression structure verbatim.**

- [ ] **Step 1: Write `reference.ts`** (exact content)

```ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = ["S", "M", "L"] as const;

export interface Params {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    dimsX: number;
    dimsY: number;
    maxIter: number;
}

export function parseParams(buf: Uint8Array): Params {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    return {
        minX: dv.getFloat64(0, true),
        maxX: dv.getFloat64(8, true),
        minY: dv.getFloat64(16, true),
        maxY: dv.getFloat64(24, true),
        dimsX: dv.getFloat64(32, true),
        dimsY: dv.getFloat64(40, true),
        maxIter: dv.getFloat64(48, true),
    };
}

// Canonical escape-time iteration count for one point c=(cx,cy). Operation order
// here is authoritative: every toolchain copies these five expressions verbatim
// so the per-pixel count (and thus the checksum) is bit-identical. No FMA on wasm.
export function escape(cx: number, cy: number, maxIter: number): number {
    let zx = 0.0;
    let zy = 0.0;
    let iter = 0;
    while (iter < maxIter) {
        const zx2 = zx * zx;
        const zy2 = zy * zy;
        if (zx2 + zy2 > 4.0) {
            break;
        }
        zy = 2.0 * zx * zy + cy;
        zx = zx2 - zy2 + cx;
        iter++;
    }
    return iter;
}

// Full grid render → Σ escape-iteration-counts (exact integer < 2^53).
export function render(p: Params): number {
    const stepX = (p.maxX - p.minX) / p.dimsX;
    const stepY = (p.maxY - p.minY) / p.dimsY;
    let acc = 0;
    for (let py = 0; py < p.dimsY; py++) {
        const cy = p.minY + py * stepY;
        for (let px = 0; px < p.dimsX; px++) {
            const cx = p.minX + px * stepX;
            acc += escape(cx, cy, p.maxIter);
        }
    }
    return acc;
}

async function main(): Promise<void> {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixturesDir = join(here, "..", "fixtures");
    const out: Record<string, number> = {};
    for (const size of SIZES) {
        const buf = await readFile(join(fixturesDir, `${size.toLowerCase()}.bin`));
        out[size] = render(parseParams(new Uint8Array(buf)));
    }
    console.log(JSON.stringify(out, null, 2));
}

// Only run main() when invoked directly (not when imported by the tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((e) => {
        console.error(e); process.exit(1);
    });
}
```

- [ ] **Step 2: Write `reference.test.ts`** (exact content — escape landmarks, determinism, sanity bounds, non-trivial distribution, fixture round-trip)

```ts
import { describe, it, expect } from "vitest";
import { parseParams, escape, render, type Params } from "./reference.js";

const TWO_53 = 0x20000000000000; // 2^53

const L: Params = {
    minX: -2.5, maxX: 1.0, minY: -1.25, maxY: 1.25,
    dimsX: 1400, dimsY: 1000, maxIter: 1000,
};

describe("mandelbrot reference", () => {
    it("escape(0,0) never escapes -> maxIter", () => {
        expect(escape(0, 0, 1000)).toBe(1000);
    });

    it("escape(-0.5,0) is in the main cardioid -> maxIter", () => {
        expect(escape(-0.5, 0, 1000)).toBe(1000);
    });

    it("escape(10,10) escapes after one step", () => {
        expect(escape(10, 10, 1000)).toBe(1);
    });

    it("render is deterministic", () => {
        expect(render(L)).toBe(render(L));
    });

    it("checksum is a positive JS-safe integer below the all-in-set ceiling", () => {
        const c = render(L);
        expect(c).toBeGreaterThan(0);
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeLessThan(TWO_53);
        expect(c).toBeLessThan(L.dimsX * L.dimsY * L.maxIter);
    });

    it("escape distribution is non-trivial (both in-set and fast-escape pixels exist)", () => {
        let hasInSet = false;
        let hasEscape = false;
        const stepX = (L.maxX - L.minX) / L.dimsX;
        const stepY = (L.maxY - L.minY) / L.dimsY;
        for (let py = 0; py < L.dimsY && !(hasInSet && hasEscape); py += 50) {
            const cy = L.minY + py * stepY;
            for (let px = 0; px < L.dimsX; px += 50) {
                const cx = L.minX + px * stepX;
                const it = escape(cx, cy, L.maxIter);
                if (it === L.maxIter) {
                    hasInSet = true;
                }
                if (it < L.maxIter) {
                    hasEscape = true;
                }
            }
        }
        expect(hasInSet).toBe(true);
        expect(hasEscape).toBe(true);
    });

    it("parseParams round-trips an encoded header", () => {
        const buf = new Uint8Array(56);
        const dv = new DataView(buf.buffer);
        const vals = [L.minX, L.maxX, L.minY, L.maxY, L.dimsX, L.dimsY, L.maxIter];
        for (let i = 0; i < vals.length; i++) {
            dv.setFloat64(i * 8, vals[i]!, true);
        }
        expect(parseParams(buf)).toEqual(L);
    });
});
```

- [ ] **Step 3: Run test — expect PASS**

Run (sandboxed OK): `npx vitest run benches/mandelbrot/validate/reference.test.ts`.
Expected: 7 passing (vitest resolves `.js`→`.ts`; these files are Wave-0 dev aids, NOT in `pnpm test`, mirroring `benches/common/*.test.ts`).

- [ ] **Step 4: Run reference to capture checksums**

Run (`dangerouslyDisableSandbox: true`): `tsx benches/mandelbrot/validate/reference.ts`.
Expected JSON (design prototype — reference MUST reproduce these exactly; any drift = algorithm transcription error, investigate before proceeding):
`{ "S": 2190038, "M": 31887455, "L": 248487617 }`.
**Record these three values for Task 3** (`<CKSUM_S>=2190038`, `<CKSUM_M>=31887455`, `<CKSUM_L>=248487617` if they match).

- [ ] **Step 5: Commit**

```bash
git add benches/mandelbrot/validate/reference.ts benches/mandelbrot/validate/reference.test.ts
git commit --no-gpg-sign -m "feat(mandelbrot): reference validator + tests (canonical escape-time algorithm)"
```

---

## Task 3: spec.json + pin checksums `[I]`

**Files:**
- Create: `benches/mandelbrot/spec.json`

**Interfaces:**
- Consumes: Task 1 fixture hashes; Task 2 checksums.
- Produces: the workload manifest all orchestration auto-discovers.

- [ ] **Step 1: Write `spec.json`** — fill `<SHA_S/M/L>` from Task 1 and `<CKSUM_S/M/L>` from Task 2.

```jsonc
{
    "id": "mandelbrot",
    "version": 2,
    "description": "Escape-time Mandelbrot over the fixed region [-2.5,1.0]x[-1.25,1.25]. One entry `mandelbrot`: for each of dims_x*dims_y grid points, iterate z=z^2+c until |z|^2>4 or max_iter; checksum = sum of escape-iteration-counts (exact integer). Pure f64 compute — no allocation, no hot-path marshalling — isolates raw FLOP throughput and the no_std size floor. Run params (region, dims, max_iter) live in the fixture, not random data.",
    "entries": ["mandelbrot"],
    "inputSizes": {
        "S": { "fixtureBytes": 56, "fixtureSha256": "<SHA_S>", "dimsX": 280, "dimsY": 200, "maxIter": 200 },
        "M": { "fixtureBytes": 56, "fixtureSha256": "<SHA_M>", "dimsX": 700, "dimsY": 500, "maxIter": 500 },
        "L": { "fixtureBytes": 56, "fixtureSha256": "<SHA_L>", "dimsX": 1400, "dimsY": 1000, "maxIter": 1000 }
    },
    "expectedChecksums": {
        "mandelbrot": { "S": <CKSUM_S>, "M": <CKSUM_M>, "L": <CKSUM_L> }
    },
    "supported": {
        "languages": ["js", "rust", "cpp"],
        "toolchains": {
            "js": ["idiomatic"],
            "rust": ["raw", "bindgen"],
            "cpp": ["emscripten", "wasi-sdk"]
        },
        "profiles": ["speed", "size"]
    },
    "ioContract": {
        "fixtureLayout": "7 little-endian f64 (56 bytes): [minX, maxX, minY, maxY, dimsX, dimsY, maxIter]. dims/maxIter are integer-valued f64. Same byte layout across all sizes; only the values differ.",
        "outputLayout": "Single scalar checksum = sum over all dims_x*dims_y grid points of the escape-iteration count (exact integer < 2^53).",
        "iterSemantics": "iter-independent: run(iters) renders the full grid `iters` times and returns the invariant per-grid checksum. innerIterations omitted -> default 1 (one run() = one full grid render), matching matmul.",
        "algorithm": "step_x=(maxX-minX)/dimsX; step_y=(maxY-minY)/dimsY. For py in [0,dimsY): cy=minY+py*step_y. For px in [0,dimsX): cx=minX+px*step_x; acc+=escape(cx,cy,maxIter). escape: zx=zy=0; iter=0; while iter<maxIter { zx2=zx*zx; zy2=zy*zy; if zx2+zy2>4.0 break; zy=2.0*zx*zy+cy; zx=zx2-zy2+cx; iter++ }; return iter. Operation order fixed by validate/reference.ts; every toolchain copies it verbatim (no -ffast-math; wasm has no scalar FMA -> no contraction)."
    }
}
```

- [ ] **Step 2: Validate spec parses**

Run (sandboxed OK): `pnpm typecheck` — no schema-related failures. (Sharper optional check, `dangerouslyDisableSandbox: true`: write a tiny `$TMPDIR/spec-check.mjs` that imports `@bench/result-schema` and calls `SpecSchema.parse(JSON.parse(readFileSync("benches/mandelbrot/spec.json")))`, then `node $TMPDIR/spec-check.mjs` — avoid inline `!`/heredoc per CLAUDE.md.)

- [ ] **Step 3: Commit**

```bash
git add benches/mandelbrot/spec.json
git commit --no-gpg-sign -m "feat(mandelbrot): spec.json v2 with pinned checksums"
```

**⏸ BREAK-POINT (Wave-0 gate):** reference pinned + fixture hashes captured. Recommend `/finish-session` (user decides).

---

## Task 4: C++ shared source + wasi-sdk build (FEASIBILITY GATE) `[S]`

**Files:**
- Create: `benches/mandelbrot/cpp/src/mandelbrot.h`
- Create: `benches/mandelbrot/cpp/src/mandelbrot.cpp`
- Create: `benches/mandelbrot/cpp/build-wasi-sdk.sh`

**Interfaces:**
- Produces exported C symbols: `alloc`, `load_input`, `mandelbrot`, `reset` (+ exported `memory`). Consumed by the `raw-wasm` loader (arity-1 dispatch: `mandelbrot(iters)` returns the checksum directly).

- [ ] **Step 1: `mandelbrot.h`** (exact content — mirrors matmul.h, drops `output_ptr`/`output_len`)

```cpp
#pragma once
#include <stdint.h>

extern "C" {
uint32_t alloc(uint32_t sz);
void load_input(uint32_t ptr, uint32_t len);
double mandelbrot(uint32_t iters);
void reset(void);
}
```

- [ ] **Step 2: `mandelbrot.cpp`** (exact content — escape/grid expressions copied verbatim from `reference.ts`)

```cpp
#include "mandelbrot.h"

// Pure f64 compute: no libc, no heap growth, no <math.h> (the escape test uses
// only *, -, +, > on doubles). Compiles freestanding under wasi-sdk (-nostdlib)
// exactly like matmul — simpler, since there is no sqrt/fabs libcall at all.

static const uint32_t HEAP_SIZE = 64u; // fixture is 7 * f64 = 56 bytes
// alignas(8) makes &heap[0] 8-aligned at link time; the bump allocator keeps
// 8-byte alignment, so the reinterpret_cast<double*> in load_input is defined.
alignas(8) static uint8_t heap[HEAP_SIZE];
static uint32_t next_off = 0;

static double MIN_X = 0.0;
static double MAX_X = 0.0;
static double MIN_Y = 0.0;
static double MAX_Y = 0.0;
static uint32_t DIMS_X = 0;
static uint32_t DIMS_Y = 0;
static uint32_t MAX_ITER = 0;

extern "C" uint32_t alloc(uint32_t sz) {
    uint32_t p = next_off;
    next_off = (next_off + sz + 7u) & ~7u;
    if (next_off > HEAP_SIZE) {
        return 0xFFFFFFFFu;
    }
    return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(&heap[p]));
}

extern "C" void load_input(uint32_t ptr, [[maybe_unused]] uint32_t len) {
    // Host copied 7 little-endian f64 (region + dims + max_iter) to `ptr`.
    // alloc() returns 8-aligned addresses, so the f64 reads are aligned.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wcast-align"
    const double* d = reinterpret_cast<const double*>(static_cast<uintptr_t>(ptr));
#pragma clang diagnostic pop
    MIN_X = d[0];
    MAX_X = d[1];
    MIN_Y = d[2];
    MAX_Y = d[3];
    DIMS_X = static_cast<uint32_t>(d[4]);
    DIMS_Y = static_cast<uint32_t>(d[5]);
    MAX_ITER = static_cast<uint32_t>(d[6]);
}

// Canonical escape-time count (order fixed by validate/reference.ts; verbatim).
// No FMA: wasm32 has no scalar fma opcode, so `2.0*zx*zy+cy` is never contracted
// regardless of -ffp-contract; combined with no -ffast-math this is bit-identical
// across every toolchain.
static uint32_t escape(double cx, double cy, uint32_t max_iter) {
    double zx = 0.0;
    double zy = 0.0;
    uint32_t iter = 0;
    while (iter < max_iter) {
        const double zx2 = zx * zx;
        const double zy2 = zy * zy;
        if (zx2 + zy2 > 4.0) {
            break;
        }
        zy = 2.0 * zx * zy + cy;
        zx = zx2 - zy2 + cx;
        iter++;
    }
    return iter;
}

extern "C" double mandelbrot(uint32_t iters) {
    const double step_x = (MAX_X - MIN_X) / static_cast<double>(DIMS_X);
    const double step_y = (MAX_Y - MIN_Y) / static_cast<double>(DIMS_Y);
    double last = 0.0;
    for (uint32_t it = 0; it < iters; it++) {
        uint64_t acc = 0;
        for (uint32_t py = 0; py < DIMS_Y; py++) {
            const double cy = MIN_Y + static_cast<double>(py) * step_y;
            for (uint32_t px = 0; px < DIMS_X; px++) {
                const double cx = MIN_X + static_cast<double>(px) * step_x;
                acc += escape(cx, cy, MAX_ITER);
            }
        }
        last = static_cast<double>(acc);
    }
    return last;
}

extern "C" void reset() {}
```

- [ ] **Step 3: `build-wasi-sdk.sh`** — copy `benches/matmul/cpp/build-wasi-sdk.sh`, then apply: replace both `src/matmul.cpp` → `src/mandelbrot.cpp`; replace both export blocks (production + attr) with the mandelbrot exports (drop `matmul`/`output_ptr`/`output_len`). Keep `set -euo pipefail`, `-nostdlib`, `-fno-exceptions -fno-rtti -fvisibility=hidden -mbulk-memory`, `-std=c++23`, the WARN_FLAGS, the `-Wl,--no-entry`/`--allow-undefined`/`--strip-all`/`--export=memory` lines, and the `SIZE_ATTR` block structure unchanged. Exact content:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Args: $1 = profile (speed|size), $2 = output dir
PROFILE="$1"
OUT_DIR="$2"
mkdir -p "$OUT_DIR"
HERE="$(cd "$(dirname "$0")" && pwd)"
WASI_SDK_PATH="${WASI_SDK_PATH:?WASI_SDK_PATH must point to wasi-sdk install root}"

if [[ "$PROFILE" == "speed" ]]; then
  OPT="-O3 -flto"
elif [[ "$PROFILE" == "size" ]]; then
  OPT="-Oz -flto"
else
  echo "unknown profile: $PROFILE" >&2; exit 1
fi

WARN_FLAGS="-Wall -Wextra -Wpedantic -Werror \
-Wshadow -Wconversion -Wsign-conversion \
-Wcast-align -Wold-style-cast -Wnon-virtual-dtor \
-Wnull-dereference -Wdouble-promotion"

STD_FLAG="-std=c++23"

# Freestanding build: no wasi-libc; mandelbrot uses no heap growth and no math
# libcalls (no sqrt/fabs) — pure *, -, +, > on doubles.

"$WASI_SDK_PATH/bin/clang++" \
  --target=wasm32 \
  $STD_FLAG \
  $WARN_FLAGS \
  -nostdlib \
  $OPT \
  -fno-exceptions -fno-rtti \
  -fvisibility=hidden \
  -mbulk-memory \
  "$HERE/src/mandelbrot.cpp" \
  -Wl,--no-entry \
  -Wl,--export=alloc -Wl,--export=load_input -Wl,--export=mandelbrot \
  -Wl,--export=reset \
  -Wl,--export=memory \
  -Wl,--allow-undefined \
  -Wl,--strip-all \
  -o "$OUT_DIR/module.wasm"


# Name-bearing build for size attribution (opt-in via SIZE_ATTR=1). Same flags as the
# production build but WITHOUT -Wl,--strip-all (and no wasm-opt) so wasm-ld keeps the
# "function names" subsection; twiggy reads + demangles it. Never touches module.wasm.
if [[ "${SIZE_ATTR:-0}" == "1" ]]; then
  mkdir -p "${ATTR_OUT:-$OUT_DIR}"
  "$WASI_SDK_PATH/bin/clang++" \
    --target=wasm32 \
    $STD_FLAG \
    $WARN_FLAGS \
    -nostdlib \
    $OPT \
    -fno-exceptions -fno-rtti \
    -fvisibility=hidden \
    -mbulk-memory \
    "$HERE/src/mandelbrot.cpp" \
    -Wl,--no-entry \
    -Wl,--export=alloc -Wl,--export=load_input -Wl,--export=mandelbrot \
    -Wl,--export=reset \
    -Wl,--export=memory \
    -Wl,--allow-undefined \
    -o "${ATTR_OUT:-$OUT_DIR}/module.attr.wasm"
fi
```

- [ ] **Step 4: Build wasi-sdk directly — feasibility gate (compile)**

`build-cpp.ts` builds ALL cpp combos for the bench and aborts if a script is missing, so we cannot run `pnpm build:cpp mandelbrot` until Task 5 creates `build-emscripten.sh`. For the feasibility gate we only need the compiled wasm + its imports, so invoke the wasi-sdk script directly (`dangerouslyDisableSandbox: true`):

```bash
PATH=/usr/bin:/bin \
WASI_SDK_PATH="$(echo "$PWD"/.tools/wasi-sdk-*)" \
bash benches/mandelbrot/cpp/build-wasi-sdk.sh size "$TMPDIR/mand-wasi-gate"
```
Expected: `$TMPDIR/mand-wasi-gate/module.wasm` produced, no compile errors. (`PATH=/usr/bin:/bin` keeps the `-flto` driver from auto-finding a `wasm-opt`; the versioned `.tools/wasi-sdk-*` glob resolves the pinned SDK — if it does not expand, run `pnpm setup-tools` first or read the version from `tool-versions.json`.)

- [ ] **Step 5: Assert only-`memory` imports (GATE)**

Write `$TMPDIR/imports.mjs` (via the Write tool — avoid inline `!`):

```js
import { readFileSync } from "node:fs";
const bytes = readFileSync(process.argv[2]);
const mod = new WebAssembly.Module(bytes);
console.log(JSON.stringify(WebAssembly.Module.imports(mod), null, 2));
```
Run (`dangerouslyDisableSandbox: true`): `node "$TMPDIR/imports.mjs" "$TMPDIR/mand-wasi-gate/module.wasm"`.
Expected: `[]` (zero imports) — mandelbrot has no libc/std/math dependency, so nothing is imported (memory is *exported*, not imported). **If any `wasi_snapshot_preview1` / unexpected import appears** → an unforeseen libcall leaked in → STOP, investigate (retry ≤2), else surface to user. (Checksum node-validation for cpp is deferred to Task 5, where the full `pnpm build:cpp` produces the `meta.json` the runner needs.)

- [ ] **Step 6: Commit**

```bash
git add benches/mandelbrot/cpp/src/ benches/mandelbrot/cpp/build-wasi-sdk.sh
git commit --no-gpg-sign -m "feat(mandelbrot): C++ shared source + wasi-sdk freestanding build"
```

**⏸ BREAK-POINT (feasibility gate):** freestanding wasi-sdk compiles to a memory-only wasm. Recommend `/finish-session` (user decides).

---

## Task 5: C++ emscripten build + validate both cpp `[I]`

**Files:**
- Create: `benches/mandelbrot/cpp/build-emscripten.sh`

- [ ] **Step 1: `build-emscripten.sh`** — copy `benches/matmul/cpp/build-emscripten.sh`, then apply: replace both `src/matmul.cpp` → `src/mandelbrot.cpp`; replace the `EXPORTS` line with the mandelbrot exports (drop `_matmul`/`_output_ptr`/`_output_len`). Keep `RT_METHODS`, `OPT` (speed `-O3 -flto`, size `-Oz -flto --closure 1`), WARN_FLAGS, `MODULARIZE=1`/`EXPORT_ES6=1`/`ENVIRONMENT=web,worker,node`/`ALLOW_MEMORY_GROWTH=1`/`INITIAL_MEMORY=67108864`, and the `SIZE_ATTR` block unchanged. Do NOT add inline `wasm-opt`. The two changed lines:

```bash
EXPORTS='["_alloc","_load_input","_mandelbrot","_reset"]'
RT_METHODS='["HEAPU8","HEAPF64","wasmMemory"]'
```

(`RT_METHODS` is unchanged from matmul — `HEAPU8` writes the 56-byte fixture, `wasmMemory` backs the memory ref; `HEAPF64` is unused here but harmless and kept for parity with matmul's script.)

- [ ] **Step 2: Build all cpp combos + validate both toolchains × S**

Run (`dangerouslyDisableSandbox: true`): `pnpm build:cpp mandelbrot` — now that both scripts exist, this builds all 4 cpp combos (`cpp-{emscripten,wasi-sdk}-{speed,size}`) with `meta.json` + wasm-opt + size attribution.
Then node-validate each cpp toolchain × S (`dangerouslyDisableSandbox: true`), e.g.:

```bash
pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=mandelbrot --entry=mandelbrot \
  --language=cpp --toolchain=wasi-sdk --profile=speed \
  --size=S --out=results/raw/single --mode=quick
pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=mandelbrot --entry=mandelbrot \
  --language=cpp --toolchain=emscripten --profile=speed \
  --size=S --out=results/raw/single --mode=quick
```
Expected: both write a result JSON with `quality.validated=true`, `correctnessFailed=false`, `quality.checksum == <CKSUM_S>` (== 2190038). A non-zero exit code = correctness fail → parity break-check (STOP + surface, per Execution Protocol).

- [ ] **Step 3: Commit**

```bash
git add benches/mandelbrot/cpp/build-emscripten.sh
git commit --no-gpg-sign -m "feat(mandelbrot): C++ emscripten build (both cpp toolchains validated on S)"
```

---

## Task 6: Rust raw crate (no_std) `[S]`

**Files:**
- Create: `benches/mandelbrot/rust/raw/Cargo.toml`
- Create: `benches/mandelbrot/rust/raw/src/lib.rs`
- Modify: root `Cargo.toml` (workspace `members`)

**Interfaces:**
- Produces exported C symbols identical to Task 4's list (arity-1 `mandelbrot(iters)`). Consumed by `raw-wasm` loader. Artifact: `target/wasm32-unknown-unknown/<profile>/mandelbrot_rust_raw.wasm` (crate name `mandelbrot-rust-raw`).

- [ ] **Step 1: `Cargo.toml`** (exact content — no `matmul-shared` dep; mandelbrot has no shared crate)

```toml
[package]
name = "mandelbrot-rust-raw"
version.workspace = true
edition.workspace = true
publish.workspace = true

[lib]
crate-type = ["cdylib"]

[dependencies]

[lints]
workspace = true
```

- [ ] **Step 2: Register workspace member** — in root `Cargo.toml`, add to `members` (after the `sorted_map_int` entries):

```toml
    "benches/mandelbrot/rust/raw",
```

- [ ] **Step 3: `src/lib.rs`** (exact content — `no_std`, `#[panic_handler]`, escape/grid copied verbatim from `reference.ts`)

```rust
#![no_std]
// Raw WASM cdylib: ABI-level unsafe (#[unsafe(no_mangle)], reading the host-copied
// fixture through a raw pointer) is inherent to the FFI surface. no_std + no heap
// growth: the only state is a fixed 64-byte scratch for the fixture plus scalar
// params — this is the pure-compute size floor.
#![allow(
    unsafe_code,
    reason = "raw WASM cdylib: ABI-level unsafe (no_mangle, raw-ptr fixture read) is inherent and cannot be avoided"
)]

use core::cell::UnsafeCell;
use core::panic::PanicInfo;

#[panic_handler]
#[allow(clippy::missing_const_for_fn, reason = "panic_handler cannot be const")]
fn on_panic(_: &PanicInfo) -> ! {
    loop {}
}

const HEAP_SIZE: usize = 64; // fixture = 7 * f64 = 56 bytes

#[derive(Clone, Copy)]
struct Params {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    dims_x: u32,
    dims_y: u32,
    max_iter: u32,
}

// Wasm32 single-threaded — UnsafeCell wrapped with a vacuous Sync impl is the
// minimal global-mutable pattern (same recipe as matmul/rust/raw).
struct GlobalHeap(UnsafeCell<[u8; HEAP_SIZE]>);
// SAFETY: Sync requires `&T` to be shareable across threads. wasm32 is
// single-threaded, so no `&T` ever crosses a thread boundary; the obligation is vacuous.
unsafe impl Sync for GlobalHeap {}
static HEAP: GlobalHeap = GlobalHeap(UnsafeCell::new([0u8; HEAP_SIZE]));

struct GlobalState {
    next: UnsafeCell<usize>,
    params: UnsafeCell<Params>,
}
// SAFETY: same vacuous Sync obligation as GlobalHeap — wasm32 is single-threaded.
unsafe impl Sync for GlobalState {}
static STATE: GlobalState = GlobalState {
    next: UnsafeCell::new(0),
    params: UnsafeCell::new(Params {
        min_x: 0.0,
        max_x: 0.0,
        min_y: 0.0,
        max_y: 0.0,
        dims_x: 0,
        dims_y: 0,
        max_iter: 0,
    }),
};

#[inline]
fn heap_base() -> usize {
    core::ptr::addr_of!(HEAP.0) as usize
}

#[unsafe(no_mangle)]
#[allow(clippy::cast_possible_truncation, reason = "wasm32 address space is always 32-bit")]
pub extern "C" fn alloc(sz: u32) -> u32 {
    // SAFETY: wasm32 single-threaded — STATE.next is the only mutable global here
    // and alloc() is its only writer; concurrent calls are impossible.
    unsafe {
        let next = &mut *STATE.next.get();
        let p = *next;
        *next = (*next + sz as usize + 7) & !7;
        if *next > HEAP_SIZE {
            return u32::MAX;
        }
        (heap_base() + p) as u32
    }
}

#[unsafe(no_mangle)]
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "dims_x/dims_y/max_iter are small non-negative integers stored as f64 in the fixture"
)]
pub extern "C" fn load_input(ptr: u32, _len: u32) {
    // SAFETY: the host copied 7 little-endian f64 to `ptr` (via alloc). alloc()
    // returns 8-aligned addresses; read_unaligned is used defensively regardless.
    unsafe {
        let d = ptr as *const f64;
        *STATE.params.get() = Params {
            min_x: d.read_unaligned(),
            max_x: d.add(1).read_unaligned(),
            min_y: d.add(2).read_unaligned(),
            max_y: d.add(3).read_unaligned(),
            dims_x: d.add(4).read_unaligned() as u32,
            dims_y: d.add(5).read_unaligned() as u32,
            max_iter: d.add(6).read_unaligned() as u32,
        };
    }
}

// Canonical escape-time count (order fixed by validate/reference.ts; verbatim).
#[allow(clippy::missing_const_for_fn, reason = "runtime hot loop; const-ness is incidental and unused")]
fn escape(cx: f64, cy: f64, max_iter: u32) -> u32 {
    let mut zx = 0.0_f64;
    let mut zy = 0.0_f64;
    let mut iter = 0_u32;
    while iter < max_iter {
        let zx2 = zx * zx;
        let zy2 = zy * zy;
        if zx2 + zy2 > 4.0 {
            break;
        }
        zy = 2.0 * zx * zy + cy;
        zx = zx2 - zy2 + cx;
        iter += 1;
    }
    iter
}

#[unsafe(no_mangle)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "acc = sum of iteration counts, bounded by dims_x*dims_y*max_iter < 2^53")]
pub extern "C" fn mandelbrot(iters: u32) -> f64 {
    // SAFETY: load_input set STATE.params before the host calls mandelbrot; the
    // Copy read takes a snapshot with no aliasing.
    let p = unsafe { *STATE.params.get() };
    let step_x = (p.max_x - p.min_x) / f64::from(p.dims_x);
    let step_y = (p.max_y - p.min_y) / f64::from(p.dims_y);
    let mut last = 0.0_f64;
    for _ in 0..iters {
        let mut acc: u64 = 0;
        for py in 0..p.dims_y {
            let cy = p.min_y + f64::from(py) * step_y;
            for px in 0..p.dims_x {
                let cx = p.min_x + f64::from(px) * step_x;
                acc += u64::from(escape(cx, cy, p.max_iter));
            }
        }
        last = acc as f64;
    }
    last
}

#[unsafe(no_mangle)]
pub const extern "C" fn reset() {}
```

- [ ] **Step 4: Build + lint + validate**

Run: `pnpm lint:rust` (sandboxed OK) → no clippy errors (the `--workspace` clippy covers the new crate for the wasm target). If clippy flags an unforeseen pedantic/nursery lint, add a matmul-style `#[allow(clippy::…, reason=…)]` (retry ≤2).
Then (`dangerouslyDisableSandbox: true`): `pnpm build:rust mandelbrot`, then node-validate raw × S (both profiles ideally; at minimum speed):

```bash
pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=mandelbrot --entry=mandelbrot \
  --language=rust --toolchain=raw --profile=speed \
  --size=S --out=results/raw/single --mode=quick
```
Expected: `dist/mandelbrot/rust-raw-{speed,size}/module.wasm`; `checksum == <CKSUM_S>`; `correctnessFailed=false`. (Optionally re-run the Task-5 imports check on `dist/mandelbrot/rust-raw-size/module.wasm` — expect memory export, no imports.)

- [ ] **Step 5: Commit**

```bash
git add benches/mandelbrot/rust/raw/ Cargo.toml Cargo.lock
git commit --no-gpg-sign -m "feat(mandelbrot): Rust raw crate (no_std, no alloc)"
```

---

## Task 7: Rust bindgen crate `[I]`

**Files:**
- Create: `benches/mandelbrot/rust/bindgen/Cargo.toml`
- Create: `benches/mandelbrot/rust/bindgen/src/lib.rs`
- Create: `benches/mandelbrot/rust/bindgen/pkg-tmp/.gitignore`
- Create: `benches/mandelbrot/rust/bindgen/pkg-attr/.gitignore`
- Modify: root `Cargo.toml` (workspace `members`)

- [ ] **Step 1: `Cargo.toml`** (exact content — no `matmul-shared` dep; keep `wasm-opt = false` metadata)

```toml
[package]
name = "mandelbrot-rust-bindgen"
version.workspace = true
edition.workspace = true
publish.workspace = true

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"

# wasm-pack invokes wasm-opt by default. Disable here — the build script
# (scripts/build-rust.ts) runs wasm-opt explicitly with the right feature flags.
[package.metadata.wasm-pack.profile.release]
wasm-opt = false

[package.metadata.wasm-pack.profile.release-size]
wasm-opt = false

[lints]
workspace = true
```

- [ ] **Step 2: Register workspace member** — in root `Cargo.toml`, add to `members` (after the raw entry from Task 6):

```toml
    "benches/mandelbrot/rust/bindgen",
```

- [ ] **Step 3: pkg `.gitignore`s** — create both `pkg-tmp/.gitignore` and `pkg-attr/.gitignore`, each containing exactly (single `*`, matching matmul):

```
*
```

- [ ] **Step 4: `src/lib.rs`** (exact content — std + wasm-bindgen; params read via safe `f64::from_le_bytes` so the only unsafe is the vacuous `Sync` impl; escape/grid copied verbatim)

```rust
// Bindgen crate: state is a single Params in a RefCell singleton (SyncCell with a
// vacuous Sync impl — wasm32 is single-threaded). mandelbrot's input is 7 scalar
// params (no array to marshal), so unlike matmul/bindgen there is no byte->f64
// reinterpret: the 7 f64 are read with f64::from_le_bytes (safe).
#![allow(
    unsafe_code,
    reason = "vacuous Sync impl for the wasm32-single-threaded RefCell singleton; no &T ever crosses a thread boundary"
)]

use std::cell::RefCell;

use wasm_bindgen::prelude::*;

#[derive(Clone, Copy)]
struct Params {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    dims_x: u32,
    dims_y: u32,
    max_iter: u32,
}

impl Params {
    const fn zeroed() -> Self {
        Self {
            min_x: 0.0,
            max_x: 0.0,
            min_y: 0.0,
            max_y: 0.0,
            dims_x: 0,
            dims_y: 0,
            max_iter: 0,
        }
    }
}

// Wasm32 single-threaded — RefCell wrapped in SyncCell with a vacuous Sync impl.
// Same pattern as matmul/rust/bindgen.
struct SyncCell<T>(RefCell<T>);
// SAFETY: Sync requires &T to be shareable across threads. wasm32 is
// single-threaded, so no &T ever crosses a thread boundary; the obligation is vacuous.
unsafe impl<T> Sync for SyncCell<T> {}

static STATE: SyncCell<Params> = SyncCell(RefCell::new(Params::zeroed()));

fn read_f64(buf: &[u8], i: usize) -> f64 {
    let mut b = [0_u8; 8];
    b.copy_from_slice(&buf[i * 8..i * 8 + 8]);
    f64::from_le_bytes(b)
}

#[wasm_bindgen]
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "dims_x/dims_y/max_iter are small non-negative integers stored as f64 in the fixture"
)]
pub fn load_input(buf: &[u8]) {
    *STATE.0.borrow_mut() = Params {
        min_x: read_f64(buf, 0),
        max_x: read_f64(buf, 1),
        min_y: read_f64(buf, 2),
        max_y: read_f64(buf, 3),
        dims_x: read_f64(buf, 4) as u32,
        dims_y: read_f64(buf, 5) as u32,
        max_iter: read_f64(buf, 6) as u32,
    };
}

// Canonical escape-time count (order fixed by validate/reference.ts; verbatim).
#[allow(clippy::missing_const_for_fn, reason = "runtime hot loop; const-ness is incidental and unused")]
fn escape(cx: f64, cy: f64, max_iter: u32) -> u32 {
    let mut zx = 0.0_f64;
    let mut zy = 0.0_f64;
    let mut iter = 0_u32;
    while iter < max_iter {
        let zx2 = zx * zx;
        let zy2 = zy * zy;
        if zx2 + zy2 > 4.0 {
            break;
        }
        zy = 2.0 * zx * zy + cy;
        zx = zx2 - zy2 + cx;
        iter += 1;
    }
    iter
}

#[must_use]
#[wasm_bindgen]
#[allow(clippy::cast_precision_loss, reason = "acc = sum of iteration counts, bounded by dims_x*dims_y*max_iter < 2^53")]
pub fn mandelbrot(iters: u32) -> f64 {
    let p = *STATE.0.borrow();
    let step_x = (p.max_x - p.min_x) / f64::from(p.dims_x);
    let step_y = (p.max_y - p.min_y) / f64::from(p.dims_y);
    let mut last = 0.0_f64;
    for _ in 0..iters {
        let mut acc: u64 = 0;
        for py in 0..p.dims_y {
            let cy = p.min_y + f64::from(py) * step_y;
            for px in 0..p.dims_x {
                let cx = p.min_x + f64::from(px) * step_x;
                acc += u64::from(escape(cx, cy, p.max_iter));
            }
        }
        last = acc as f64;
    }
    last
}

#[wasm_bindgen]
#[allow(clippy::missing_const_for_fn, reason = "wasm_bindgen requires non-const fns")]
pub fn reset() {}

#[must_use]
#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}
```

- [ ] **Step 5: Build + lint + validate**

Run: `pnpm lint:rust` (sandboxed). Then (`dangerouslyDisableSandbox: true`) `pnpm build:rust mandelbrot`, then node-validate bindgen × S:

```bash
pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=mandelbrot --entry=mandelbrot \
  --language=rust --toolchain=bindgen --profile=speed \
  --size=S --out=results/raw/single --mode=quick
```
Expected: `dist/mandelbrot/rust-bindgen-{speed,size}/` glue + wasm; `checksum == <CKSUM_S>`; `correctnessFailed=false`.

- [ ] **Step 6: Commit**

```bash
git add benches/mandelbrot/rust/bindgen/ Cargo.toml Cargo.lock
git commit --no-gpg-sign -m "feat(mandelbrot): Rust bindgen crate"
```

---

## Task 8: JS idiomatic + parity test (GATE) `[S]`

**Files:**
- Create: `benches/mandelbrot/js/idiomatic/package.json`
- Create: `benches/mandelbrot/js/idiomatic/tsconfig.json`
- Create: `benches/mandelbrot/js/idiomatic/src/index.ts`
- Create: `benches/mandelbrot/validate/parity.test.ts`

**Interfaces:**
- Produces default-export `create(entry: string): BenchModule` (`{ loadInput, run, reset }`). Consumed by the `plain-js` loader via esbuild bundle → `dist/mandelbrot/js-idiomatic-speed/module.js`.

- [ ] **Step 1: `package.json`** (exact content)

```json
{
  "name": "@bench-impl/mandelbrot-js-idiomatic",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "devDependencies": { "typescript": "^5.6.3" }
}
```

- [ ] **Step 2: `tsconfig.json`** (exact content — copy matmul's; opts out of `noUncheckedIndexedAccess` for the DataView-heavy hot path)

```json
{
  "extends": "../../../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "noUncheckedIndexedAccess": false
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: `src/index.ts`** (exact content — escape/grid inlined but expression-identical to `reference.ts`; scalar accumulator)

```ts
// Idiomatic JS mandelbrot: escape-time over a fixed complex region, scalar
// accumulator. mandelbrot's input is 7 scalar params (no array) and its output
// is one scalar, so there is no boxed-array-vs-typed-buffer distinction to draw
// -> this is the sole JS variant (see spec.json supported.toolchains.js).

interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

export default function create(entry: string): BenchModule {
    if (entry !== "mandelbrot") {
        throw new Error(`mandelbrot/js-idiomatic: unknown entry "${entry}"`);
    }
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    let dimsX = 0;
    let dimsY = 0;
    let maxIter = 0;

    return {
        loadInput(input: Uint8Array) {
            const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
            minX = dv.getFloat64(0, true);
            maxX = dv.getFloat64(8, true);
            minY = dv.getFloat64(16, true);
            maxY = dv.getFloat64(24, true);
            dimsX = dv.getFloat64(32, true);
            dimsY = dv.getFloat64(40, true);
            maxIter = dv.getFloat64(48, true);
        },

        run(iterations: number): { checksum: number } {
            const stepX = (maxX - minX) / dimsX;
            const stepY = (maxY - minY) / dimsY;
            let last = 0;
            for (let it = 0; it < iterations; it++) {
                let acc = 0;
                for (let py = 0; py < dimsY; py++) {
                    const cy = minY + py * stepY;
                    for (let px = 0; px < dimsX; px++) {
                        const cx = minX + px * stepX;
                        let zx = 0;
                        let zy = 0;
                        let iter = 0;
                        while (iter < maxIter) {
                            const zx2 = zx * zx;
                            const zy2 = zy * zy;
                            if (zx2 + zy2 > 4.0) {
                                break;
                            }
                            zy = 2.0 * zx * zy + cy;
                            zx = zx2 - zy2 + cx;
                            iter++;
                        }
                        acc += iter;
                    }
                }
                last = acc;
            }
            return { checksum: last };
        },

        reset() {},
    };
}
```

- [ ] **Step 4: `validate/parity.test.ts`** (GATE — idiomatic ≡ reference on a small grid; catches expression drift before the full matrix. Placed in `validate/` so the root `tsconfig.json` `benches/*/validate/**` include gives ESLint's projectService a typed project — the landed convention for cross-impl tests)

```ts
import { describe, it, expect } from "vitest";
import { render, type Params } from "./reference.js";
import createIdiomatic from "../js/idiomatic/src/index.js";

// Small grid — fast, still exercises in-set + escaping pixels.
const SMALL: Params = {
    minX: -2.5, maxX: 1.0, minY: -1.25, maxY: 1.25,
    dimsX: 64, dimsY: 48, maxIter: 128,
};

function encode(p: Params): Uint8Array {
    const buf = new Uint8Array(56);
    const dv = new DataView(buf.buffer);
    const vals = [p.minX, p.maxX, p.minY, p.maxY, p.dimsX, p.dimsY, p.maxIter];
    for (let i = 0; i < vals.length; i++) {
        dv.setFloat64(i * 8, vals[i]!, true);
    }
    return buf;
}

describe("mandelbrot JS parity", () => {
    it("idiomatic == reference on a small grid", () => {
        const expected = render(SMALL);
        const m = createIdiomatic("mandelbrot");
        m.loadInput(encode(SMALL));
        m.reset();
        expect(m.run(1).checksum).toBe(expected);
    });
});
```

- [ ] **Step 5: Run parity test — expect PASS**

Run (sandboxed OK): `npx vitest run benches/mandelbrot/validate/parity.test.ts`.
Expected: 1 passing. A failure → the idiomatic escape/grid expressions drifted from `reference.ts`; diff char-by-char and fix (retry ≤2). Do NOT change the reference to match the impl.

- [ ] **Step 6: Typecheck + build + validate**

Run: `pnpm typecheck` (sandboxed — typechecks the idiomatic package). Then (`dangerouslyDisableSandbox: true`) `pnpm build:js mandelbrot`, then node-validate js/idiomatic × S:

```bash
pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=mandelbrot --entry=mandelbrot \
  --language=js --toolchain=idiomatic --profile=speed \
  --size=S --out=results/raw/single --mode=quick
```
Expected: `dist/mandelbrot/js-idiomatic-speed/module.js`; `checksum == <CKSUM_S>`; `correctnessFailed=false`.

- [ ] **Step 7: Commit**

```bash
git add benches/mandelbrot/js/ benches/mandelbrot/validate/parity.test.ts
git commit --no-gpg-sign -m "feat(mandelbrot): JS idiomatic + cross-impl parity test"
```

**⏸ BREAK-POINT:** all six impls validated on S; JS parity gate green. Recommend `/finish-session` (user decides).

---

## Task 9: Full matrix correctness + all gates `[I]`

**Files:** none (verification).

- [ ] **Step 1: Full node-correctness matrix**

Run (`dangerouslyDisableSandbox: true`): the node correctness sweep for `mandelbrot` across all binaries × entry × S (quick mode):

```bash
pnpm bench --benchmarks=mandelbrot --envs=node --sizes=S --mode=quick --out=results/raw/mandelbrot-matrix
```
Expected: every combo (js-idiomatic + rust-{raw,bindgen} + cpp-{emscripten,wasi-sdk}, both profiles) writes a result with `correctnessFailed=false` and `checksum == <CKSUM_S>`; `results/raw/mandelbrot-matrix/failures.txt` absent/empty. Any divergence → parity break-check (STOP + surface).

- [ ] **Step 2: All-gates pre-flight**

Run: `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke` (`build:all` + `smoke` with `dangerouslyDisableSandbox: true`; run the sandbox-safe `typecheck`/`lint:all`/`test` separately if convenient). Read the producer exit status via `${pipestatus[1]}` (zsh) — do not trust a piped `$?`.
Expected: all green. NOTE: `pnpm test` runs the package suites only; it does NOT pick up `benches/**/*.test.ts`. Also run the workload's dev-aid tests explicitly: `npx vitest run benches/mandelbrot/validate/reference.test.ts benches/mandelbrot/validate/parity.test.ts` — expect 8 passing. (Authoritative workload correctness = the node matrix in Step 1.)

- [ ] **Step 3: Commit (if any lint/format touch-ups)**

```bash
git add -A
git commit --no-gpg-sign -m "chore(mandelbrot): gate fixes" || echo "nothing to commit"
```

**⏸ BREAK-POINT:** matrix + gates green. Recommend `/finish-session` (user decides).

---

## Task 10: Bench + guidelines harvest + close `[I]`

**Files:**
- Modify: `docs/guidelines.md` (only if a finding is confirmed)
- Modify: `docs/roadmap.md` (mark mandelbrot shipped under `academic-algos`)
- Modify: `CLAUDE.md` (workload list)

- [ ] **Step 1: Heavy bench (USER ACTION)** — `bench:all` is a heavy, machine-quiet run. Hand off: **user** runs `pnpm bench:all` (or a mandelbrot-scoped `pnpm bench --benchmarks=mandelbrot --envs=node,chromium,firefox --sizes=S,M,L --mode=eval --out=results/raw/<run>` + `pnpm report`) per `README.md`. Agent waits for the fresh `results/`.

- [ ] **Step 2: Reporter eyeball (visual deliverable check)** — `pnpm report` → open. Confirm `mandelbrot` appears on the Size bar (8 wasm combos + 1 js-idiomatic) and in the Perf tab as a single-entry compute workload (like matmul: `mandelbrot` × impl × env), bars scale sanely, no stale strings. (Reporter auto-discovers — no reporter code changes needed.)

- [ ] **Step 3: Guidelines harvest** — from the numbers, add a claim to `docs/guidelines.md` **only if confirmed** (reproducible across ≥2 sizes; format per the file's `## Format` header — `**Status:** confirmed | tentative`, `**Evidence:**`, `**Phase:**`, `**Caveats:**`). Candidate claims:
  - (a) **raw FLOP-throughput ranking of toolchains on pure compute** → bucket `## Toolchain choice`. Evidence: `results/raw/<run>` mandelbrot warmMedian per (toolchain, size). This is the cleanest compute-only signal in the suite (no container/marshalling confound); note whether the ranking agrees with or diverges from matmul (which also has a light marshalling/output-write component).
  - (b) **size-floor of pure-compute `no_std` rust/raw** → bucket `## Artifact size`. Evidence: `dist/mandelbrot/rust-raw-size/meta.json` vs the std-container floors (`sorted_map_int`/`hashmap_int` rust-raw-size). mandelbrot/raw has no allocator, no `std::collections` — the absolute rust-raw floor.
  Write nothing for a single-run anecdote; mark `tentative` if only one size is clean.

- [ ] **Step 4: Roadmap update** — in `docs/roadmap.md`, edit the `academic-algos` item to reflect mandelbrot shipped:
  - old: `- **academic-algos** — sort, parsing, mandelbrot, hash ([→ design spec § Открытые вопросы]...)`
  - new: `- **academic-algos** — sort, parsing, hash (mandelbrot shipped Phase 1.2) ([→ design spec § Открытые вопросы]...)`

- [ ] **Step 5: CLAUDE.md workload list** — add `mandelbrot` to the Current-workloads line:
  - old: `Current: \`matmul\`, \`interop_calls\`,`
  - new: `Current: \`matmul\`, \`mandelbrot\`, \`interop_calls\`,`

- [ ] **Step 6: Commit + PR prep**

```bash
git add docs/guidelines.md docs/roadmap.md CLAUDE.md
git commit --no-gpg-sign -m "docs(mandelbrot): guidelines harvest + roadmap + workload list"
```

Hand off to user: `git push -u origin feature/phase-1.2-mandelbrot` + the GitHub compare link. Recommend `/finish-session`.

---

## Self-Review (author)

- **Spec coverage (§ Slice B — mandelbrot):**
  - *Purpose / evidence-signals* — Task 10 guidelines (raw FLOP ranking + no_std size floor). Covered.
  - *Workload contract* (region, escape iteration, integer checksum) — Global Constraints + Task 2 reference (canonical). Covered.
  - *cross-toolchain checksum-паритет (critical)* — Global Constraints parity block (verbatim expression order + no fast-math + no-FMA rationale) + per-impl S-validation (Tasks 5/6/7) + JS parity gate (Task 8) + full-matrix parity (Task 9) + the break-check surface-to-user rule. Covered.
  - *Fixture* (encodes params, not random; `mulberry32` unused) — Task 1. Covered.
  - *Entry* (single `mandelbrot`, f64) — Global Constraints; f32/SIMD explicitly out of scope (spec § Entry follow-up). Covered.
  - *Toolchain matrix* (cpp emsc+wasi × {speed,size}; rust raw no_std + bindgen; js idiomatic) — Tasks 4–8, spec.json Task 3. Covered.
  - *js typed-array open sub-question* — resolved **idiomatic-only** with reasoning (no array-shaped I/O → no boxed-vs-typed axis; precedent hashmap/shape_dispatch); `spec.json.supported.toolchains.js=["idiomatic"]`. Covered.
  - *Validation* (reference + pin + parity gate) — Tasks 2, 3, 8. Covered.
  - *Guidelines* (2 candidate claims) — Task 10. Covered.
  - *Files / discovery / CLAUDE.md workload-list* — File Structure + Tasks 1–8 + Task 10 Step 5. Covered.
  - *Sequencing / branch* — header (`feature/phase-1.2-mandelbrot` from master post-Slice-A). Covered.
- **Placeholder scan:** `<SHA_S/M/L>` (Task 3, from Task 1 output) and `<CKSUM_S/M/L>` (Task 3, from Task 2 output; expected 2190038 / 31887455 / 248487617 per the design prototype — mechanism specified, cross-check provided). No other unresolved placeholders. `academic-algos`/`Current:` edit strings are literal (Task 10 Steps 4–5).
- **Type / contract consistency:** entry name `mandelbrot` (arity-1 → raw-wasm/emscripten/bindgen loaders dispatch `run(iters)=fn(iters)`); generic `reset` (matmul precedent, resolved by `bindReset` fallback); exports `alloc`/`load_input`/`mandelbrot`/`reset`/`memory` (no `output_ptr`/`output_len`); fixture 56 bytes / 7 f64 LE at fixed offsets; `innerIterations` omitted → default 1 (matmul-shaped, checksum invariant to iters); window/algorithm expressions (`step=(hi-lo)/dims`, `cx=lo+px*step`, escape 5-expr body, `> 4.0`) identical across `reference.ts` / cpp / rust-raw / rust-bindgen / js. Checksum is an exact integer sum < 2^53 (validated by prototype for all three sizes).
- **Divergence from `sorted_map_int` template (intentional):** (a) 10 tasks not 11 — single JS variant merges the two JS tasks; (b) no `wasi-shims.cpp` — freestanding, no std/libc; (c) no shared Rust crate — escape loop duplicated into raw+bindgen (task requires exactly two crates); (d) Task 4 gate builds wasi-sdk *directly* (not via `pnpm build:cpp`) because `build-cpp.ts` is all-cpp-combos and the emscripten script does not exist yet — cpp checksum validation deferred to Task 5; (e) parity test lives in `validate/` (landed convention: root `tsconfig.json` includes `benches/*/validate/**` for ESLint projectService).
