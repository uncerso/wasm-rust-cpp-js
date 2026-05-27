# Phase 1.1.3 shape_dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shape_dispatch workload (4 binaries × 2×2 factorial dispatch×layout × 342 measurement cases) + close Phase 1.1 (reporter v2 final layout + systematic guidelines harvest). Produces ≥1 confirmed dispatch claim + ≥1 confirmed monomorphization-bundle claim в `docs/guidelines.md`.

**Architecture:** 4 wasm binaries (`shape_dispatch_{homo,mixed}_{static,dyn}`) each с single entry point + shared 24-byte shape fixture format. Quantized checksum (`floor(score · 1e6 + 0.5) mod 2^64`) ensures cross-binary equality independent of iteration order. Raw heap storage в всех toolchains (no Vec/std::vector — container axis deliberately excluded). Anti-devirt friction для `homo_dyn` binaries: `core::hint::black_box` (Rust) + `asm volatile` с input operand (C++). 6 waves: W0 pre-flight; W1 infra+spec; W2 implementations (16 native + 3 JS); W3 bench full matrix; W4 reporter v2; W5 guidelines harvest; W6 Phase 1.1 close.

**Tech Stack:** TypeScript (ESM, esbuild), Rust 1.95.0 (wasm-bindgen + raw no_std), C++23 (Emscripten + wasi-sdk freestanding, virtual + placement new), pnpm workspaces, vitest, zod.

**Spec:** [`docs/superpowers/specs/2026-05-27-phase-1-1-3-shape-dispatch-design.md`](../specs/2026-05-27-phase-1-1-3-shape-dispatch-design.md)

**Risk protocol:** Per spec § Open risks — when verification command detects risk fired (R1 devirt, R3 wasi-sdk placement new, R4 rust/raw fat pointer, R5 cross-binary checksum, R6 reporter rewrite), **STOP, surface to user пакетом с 2-3 mitigation alternatives, ждать decision**. Mitigations в плане — hypotheses, не pre-approved decisions.

---

## Wave 0 — Pre-flight

### Task 0: Verify master gates green

**Files:** none (verification only)

- [ ] **Step 1: Verify clean working tree**

Run: `git status`
Expected: branch master; untracked `.claude/settings.local.json` + `"Какие есть существующие бенчмарки wasm под браузер.md"` OK; no other untracked/modified.

- [ ] **Step 2: Run build + typecheck + lint + test**

Run: `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test 2>&1 | tee /tmp/preflight.log; rc=${PIPESTATUS[0]}; echo "exit=$rc"`
Expected: `exit=0`. Lint warnings допустимы (12 known no-console warnings в reference.ts); errors не допустимы.

- [ ] **Step 3: Run smoke**

Run with `dangerouslyDisableSandbox: true`: `pnpm smoke`
Expected: exit 0; все cases `validated: true`. (Sandbox blocking tsx IPC pipes — see CLAUDE.md.)

If any gate fails — STOP. Surface to user before proceeding. **Не маскировать** через out-of-scope cleanup commit (CLAUDE.md plan executor protocol).

---

## Wave 1 — Infrastructure + spec

### Task 1: Add `genShapes(n, seed)` to `benches/common/fixtures.ts`

**Files:**
- Modify: `benches/common/fixtures.ts` (extend)
- Modify: `benches/common/fixtures.test.ts` (extend)

Spec § Common infrastructure → `genShapes` definition. 24-byte packed layout: `[tag_u8, padding × 7, p1_f64, p2_f64]`. Distribution ~33/33/33% via `floor(rand() × 3)`. Parameters in [0.5, 5.0).

- [ ] **Step 1: Write failing test for genShapes determinism + layout**

Append to `benches/common/fixtures.test.ts`:

```ts
import { genShapes } from "./fixtures.js";
import { createHash } from "node:crypto";

describe("genShapes", () => {
    it("produces 24 bytes per shape", () => {
        const buf = genShapes(10, 0xFACE_0001);
        expect(buf.length).toBe(240);
    });

    it("tag values ∈ {0, 1, 2}", () => {
        const buf = genShapes(100, 0xFACE_0001);
        const tags = new Set<number>();
        for (let i = 0; i < 100; i++) tags.add(buf[i * 24]);
        expect([...tags].sort()).toEqual([0, 1, 2]);
    });

    it("p1 ∈ [0.5, 5.0) — DataView read", () => {
        const buf = genShapes(100, 0xFACE_0001);
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        for (let i = 0; i < 100; i++) {
            const p1 = view.getFloat64(i * 24 + 8, true);
            expect(p1).toBeGreaterThanOrEqual(0.5);
            expect(p1).toBeLessThan(5.0);
        }
    });

    it("deterministic SHA256 snapshot (n=4, seed=0xFACE_0001)", () => {
        const buf = genShapes(4, 0xFACE_0001);
        const sha = createHash("sha256").update(buf).digest("hex");
        // PLACEHOLDER — replace after implementation runs once
        expect(sha).toBe("REPLACE_AFTER_IMPL");
    });
});
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm exec vitest run benches/common/fixtures.test.ts`
Expected: 4 new tests fail (`genShapes` not exported).

- [ ] **Step 3: Implement genShapes**

Append to `benches/common/fixtures.ts`:

```ts
export function genShapes(n: number, seed: number): Uint8Array {
    const buf = new Uint8Array(n * 24);
    const view = new DataView(buf.buffer);
    const rand = mulberry32(seed);
    for (let i = 0; i < n; i++) {
        const off = i * 24;
        const tag = Math.floor(rand() * 3);  // 0, 1, or 2
        buf[off] = tag;
        // padding bytes [off+1 .. off+8) already zero
        const p1 = 0.5 + rand() * 4.5;
        view.setFloat64(off + 8, p1, true);
        const p2 = tag === 2 ? 0.5 + rand() * 4.5 : 0;  // Triangle uses p2; others ignored
        view.setFloat64(off + 16, p2, true);
    }
    return buf;
}
```

- [ ] **Step 4: Capture SHA256 golden value**

Run: `pnpm exec tsx -e 'import {genShapes} from "./benches/common/fixtures.ts"; import {createHash} from "node:crypto"; console.log(createHash("sha256").update(genShapes(4, 0xFACE_0001)).digest("hex"));'`
Expected: prints 64-char hex. Replace `REPLACE_AFTER_IMPL` in test with captured value.

- [ ] **Step 5: Verify tests pass**

Run: `pnpm exec vitest run benches/common/fixtures.test.ts`
Expected: all tests pass (matmul SHA256 unchanged + new genShapes tests).

- [ ] **Step 6: Commit**

```bash
git add benches/common/fixtures.ts benches/common/fixtures.test.ts
git commit --no-gpg-sign -m "feat(common/fixtures): add genShapes generator (24B packed: tag + p1 + p2)"
```

### Task 2: Create `benches/common/shape-reference.ts`

**Files:**
- Create: `benches/common/shape-reference.ts`
- Create: `benches/common/shape-reference.test.ts`

- [ ] **Step 1: Write failing tests**

Create `benches/common/shape-reference.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseShapes, computeScore, checksumQuantized, ShapeKind } from "./shape-reference.js";
import { genShapes } from "./fixtures.js";

describe("shape-reference", () => {
    it("parseShapes round-trips genShapes layout", () => {
        const buf = genShapes(10, 0xFACE_0001);
        const shapes = parseShapes(buf);
        expect(shapes.length).toBe(10);
        for (const s of shapes) {
            expect([ShapeKind.Circle, ShapeKind.Square, ShapeKind.Triangle]).toContain(s.kind);
            expect(s.p1).toBeGreaterThanOrEqual(0.5);
            expect(s.p1).toBeLessThan(5.0);
        }
    });

    it("computeScore positive для всех 3 shape types", () => {
        expect(computeScore({ kind: ShapeKind.Circle,   p1: 1.0, p2: 0 })).toBeGreaterThan(0);
        expect(computeScore({ kind: ShapeKind.Square,   p1: 1.0, p2: 0 })).toBeGreaterThan(0);
        expect(computeScore({ kind: ShapeKind.Triangle, p1: 1.0, p2: 1.0 })).toBeGreaterThan(0);
    });

    it("checksumQuantized order-independent", () => {
        const shapes = parseShapes(genShapes(100, 0xFACE_0001));
        const c1 = checksumQuantized(shapes);
        const shuffled = [...shapes].reverse();
        const c2 = checksumQuantized(shuffled);
        expect(c1).toBe(c2);
    });

    it("Math.round equivalent к floor(x+0.5) для positive values", () => {
        // Sanity check that JS Math.round matches our cross-language convention
        expect(Math.round(2.5)).toBe(3);
        expect(Math.round(0.4999999999999999)).toBe(0);
        expect(Math.round(0.5)).toBe(1);
    });
});
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm exec vitest run benches/common/shape-reference.test.ts`
Expected: 4 tests fail (module not found).

- [ ] **Step 3: Implement shape-reference.ts**

Create `benches/common/shape-reference.ts`:

```ts
export const enum ShapeKind {
    Circle = 0,
    Square = 1,
    Triangle = 2,
}

export interface Shape {
    kind: ShapeKind;
    p1: number;
    p2: number;
}

export function parseShapes(buf: Uint8Array): Shape[] {
    const n = buf.length / 24;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const out: Shape[] = new Array(n);
    for (let i = 0; i < n; i++) {
        const off = i * 24;
        const kind = buf[off] as ShapeKind;
        const p1 = view.getFloat64(off + 8, true);
        const p2 = view.getFloat64(off + 16, true);
        out[i] = { kind, p1, p2 };
    }
    return out;
}

export function computeScore(s: Shape): number {
    let a: number, p: number;
    switch (s.kind) {
        case ShapeKind.Circle:
            a = Math.PI * s.p1 * s.p1;
            p = 2 * Math.PI * s.p1;
            break;
        case ShapeKind.Square:
            a = s.p1 * s.p1;
            p = 4 * s.p1;
            break;
        case ShapeKind.Triangle:
            a = 0.5 * s.p1 * s.p2;
            p = s.p1 + s.p2 + Math.sqrt(s.p1 * s.p1 + s.p2 * s.p2);
            break;
    }
    return a * Math.sqrt(p / (a + 1)) + Math.log(a + p + 1);
}

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

- [ ] **Step 4: Verify tests pass**

Run: `pnpm exec vitest run benches/common/shape-reference.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add benches/common/shape-reference.ts benches/common/shape-reference.test.ts
git commit --no-gpg-sign -m "feat(common/shape-reference): quantized checksum + parseShapes + computeScore"
```

### Task 3: Create 4 binary `spec.json` skeletons

**Files:**
- Create: `benches/shape_dispatch_homo_static/spec.json`
- Create: `benches/shape_dispatch_homo_dyn/spec.json`
- Create: `benches/shape_dispatch_mixed_static/spec.json`
- Create: `benches/shape_dispatch_mixed_dyn/spec.json`

`expectedChecksums` populated в Task 5 после reference impl runs.

- [ ] **Step 1: Create `shape_dispatch_homo_static/spec.json`**

```json
{
    "id": "shape_dispatch_homo_static",
    "version": 2,
    "description": "Static dispatch (generics/templates) over 3 homogeneous typed arrays. 3× monomorphized processor per shape type — measures monomorphization bundle premium + per-type cache locality. No Vec/std::vector — raw heap arrays.",
    "entries": ["shape_dispatch_homo_static"],
    "inputSizes": {
        "S": { "fixtureBytes": 24000,    "fixtureSha256": "REPLACE_AFTER_FIXTURES", "innerIterations": 1000 },
        "M": { "fixtureBytes": 240000,   "fixtureSha256": "REPLACE_AFTER_FIXTURES", "innerIterations": 10000 },
        "L": { "fixtureBytes": 2400000,  "fixtureSha256": "REPLACE_AFTER_FIXTURES", "innerIterations": 100000 }
    },
    "expectedChecksums": {
        "shape_dispatch_homo_static": { "S": 0, "M": 0, "L": 0 }
    },
    "supported": {
        "languages": ["rust", "cpp"],
        "toolchains": {
            "rust": ["raw", "bindgen"],
            "cpp": ["emscripten", "wasi-sdk"]
        },
        "profiles": ["speed", "size"]
    },
    "ioContract": {
        "fixtureLayout": "N shapes × 24 B packed LE: [tag_u8, padding × 7, p1_f64, p2_f64]. tag ∈ {0=Circle, 1=Square, 2=Triangle}; p1 ∈ [0.5, 5.0); p2 ∈ [0.5, 5.0) for Triangle, else ignored.",
        "iterSemantics": "Iter-dependent. expectedChecksum валиден только для N = innerIterations[size].",
        "stateModel": "Read-only after loadInput. No reset companion needed.",
        "outputLayout": "Single u64 checksum: floor(score · 1e6 + 0.5) sum mod 2^64; identical across 4 binaries для same shape data."
    }
}
```

- [ ] **Step 2: Create `shape_dispatch_homo_dyn/spec.json`**

Same structure, `id` + `entries` + `description` adjusted:
- `id`: `"shape_dispatch_homo_dyn"`
- `entries`: `["shape_dispatch_homo_dyn"]`
- `description`: `"Dynamic dispatch (virtual / &dyn Shape) over 3 homogeneous typed arrays. Monomorphic call site (one type per loop) — measures BTB-predictable dispatch cost vs static. Anti-devirt friction required (core::hint::black_box / asm volatile). No Vec/std::vector — raw heap arrays."`
- `supported.languages`: `["js", "rust", "cpp"]`
- `supported.toolchains.js`: `["idiomatic"]`
- `expectedChecksums`: `{ "shape_dispatch_homo_dyn": { "S": 0, "M": 0, "L": 0 } }`

- [ ] **Step 3: Create `shape_dispatch_mixed_static/spec.json`**

- `id`: `"shape_dispatch_mixed_static"`
- `entries`: `["shape_dispatch_mixed_static"]`
- `description`: `"Static dispatch (enum match / std::variant visitor / switch(kind)) over 1 mixed-shape array (inline tagged). Compile-time-visible branches — measures branch-on-tag cost vs vtable on same data layout. No Vec/std::vector — raw heap arrays."`
- `supported.languages`: `["js", "rust", "cpp"]`
- `supported.toolchains.js`: `["idiomatic"]`
- `expectedChecksums`: `{ "shape_dispatch_mixed_static": { "S": 0, "M": 0, "L": 0 } }`

- [ ] **Step 4: Create `shape_dispatch_mixed_dyn/spec.json`**

- `id`: `"shape_dispatch_mixed_dyn"`
- `entries`: `["shape_dispatch_mixed_dyn"]`
- `description`: `"Dynamic dispatch (virtual / dyn Trait) over 1 mixed-shape array (heap-allocated polymorphic objects). Polymorphic-3 call site — measures vtable indirection + BTB miss + cache pointer chasing. No Vec/std::vector — raw heap arrays."`
- `supported.languages`: `["js", "rust", "cpp"]`
- `supported.toolchains.js`: `["idiomatic"]`
- `expectedChecksums`: `{ "shape_dispatch_mixed_dyn": { "S": 0, "M": 0, "L": 0 } }`

- [ ] **Step 5: Commit**

```bash
git add benches/shape_dispatch_*/spec.json
git commit --no-gpg-sign -m "feat(shape_dispatch): 4 binary spec.json skeletons (2×2 factorial dispatch×layout)"
```

### Task 4: Create 4 `fixtures/generate.ts` thin wrappers

**Files:**
- Create: `benches/shape_dispatch_{homo_static,homo_dyn,mixed_static,mixed_dyn}/fixtures/generate.ts`

All 4 wrappers byte-identical (call `genShapes` with same seed schema). Difference только в filesystem path target.

- [ ] **Step 1: Create generate.ts for shape_dispatch_homo_static**

`benches/shape_dispatch_homo_static/fixtures/generate.ts`:

```ts
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { genShapes } from "../../common/fixtures.js";

const SIZES = { S: 1000, M: 10000, L: 100000 } as const;
const SEEDS = { S: 0xFACE_0001, M: 0xFACE_0002, L: 0xFACE_0003 } as const;
const HERE = dirname(fileURLToPath(import.meta.url));

for (const [size, n] of Object.entries(SIZES) as Array<[keyof typeof SIZES, number]>) {
    const buf = genShapes(n, SEEDS[size]);
    const path = `${HERE}/${size}.bin`;
    mkdirSync(HERE, { recursive: true });
    writeFileSync(path, buf);
    const sha = createHash("sha256").update(buf).digest("hex");
    console.log(`${size}: ${buf.length} bytes, sha256=${sha}`);
}
```

- [ ] **Step 2: Create identical generate.ts for other 3 binaries**

Copy step 1's file content to `benches/shape_dispatch_{homo_dyn,mixed_static,mixed_dyn}/fixtures/generate.ts`. The imports use relative path `../../common/fixtures.js` which resolves к benches/common/ from each binary's fixtures/ subdir — verify.

- [ ] **Step 3: Commit**

```bash
git add benches/shape_dispatch_*/fixtures/generate.ts
git commit --no-gpg-sign -m "feat(shape_dispatch): 4 fixtures/generate.ts thin wrappers (shared genShapes)"
```

### Task 5: Create 4 `validate/reference.ts` thin wrappers

**Files:**
- Create: `benches/shape_dispatch_{homo_static,homo_dyn,mixed_static,mixed_dyn}/validate/reference.ts`

Each wrapper parses its binary's fixture and computes quantized checksum. Output JSON copied to spec.json `expectedChecksums` in Task 7.

- [ ] **Step 1: Create reference.ts for shape_dispatch_homo_static**

`benches/shape_dispatch_homo_static/validate/reference.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseShapes, checksumQuantized } from "../../common/shape-reference.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "fixtures");
const ENTRY = "shape_dispatch_homo_static";
const out: Record<string, Record<string, string>> = { [ENTRY]: {} };

for (const size of ["S", "M", "L"] as const) {
    const buf = readFileSync(join(FIXTURES, `${size}.bin`));
    const shapes = parseShapes(new Uint8Array(buf));
    out[ENTRY][size] = checksumQuantized(shapes).toString();
}
console.log(JSON.stringify(out, null, 2));
```

- [ ] **Step 2: Create 3 identical references для other binaries**

Copy step 1 content to other 3 binaries' `validate/reference.ts`. Change `ENTRY` constant per binary:
- `homo_dyn`: `"shape_dispatch_homo_dyn"`
- `mixed_static`: `"shape_dispatch_mixed_static"`
- `mixed_dyn`: `"shape_dispatch_mixed_dyn"`

- [ ] **Step 3: Commit**

```bash
git add benches/shape_dispatch_*/validate/reference.ts
git commit --no-gpg-sign -m "feat(shape_dispatch): 4 validate/reference.ts thin wrappers (shared shape-reference)"
```

### Task 6: Run fixtures, verify cross-binary `fixtureSha256` equality

**Files:**
- Modify: `benches/shape_dispatch_*/spec.json` (populate `fixtureSha256`)

- [ ] **Step 1: Generate fixtures for all 4 binaries**

Run for each binary (sandbox-disable needed для tsx):

```bash
pnpm exec tsx benches/shape_dispatch_homo_static/fixtures/generate.ts
pnpm exec tsx benches/shape_dispatch_homo_dyn/fixtures/generate.ts
pnpm exec tsx benches/shape_dispatch_mixed_static/fixtures/generate.ts
pnpm exec tsx benches/shape_dispatch_mixed_dyn/fixtures/generate.ts
```

Expected: each prints `S: 24000 bytes, sha256=<hex>` + M (240000) + L (2400000).

- [ ] **Step 2: Verify cross-binary fixture equality**

Run:
```bash
for size in S M L; do
    sha256sum benches/shape_dispatch_*/fixtures/${size}.bin | awk '{print $1}' | sort -u | wc -l
done
```
Expected: prints `1` three times (one unique SHA per size — bit-identical fixtures across 4 binaries).

If output is `> 1` для any size → **STOP, R5 verification failed**. Surface to user.

- [ ] **Step 3: Populate `fixtureSha256` в 4 spec.json'ах**

For each size's SHA256 captured в Step 1, update all 4 spec.json files' `inputSizes[<size>].fixtureSha256`. Same SHA value in all 4.

- [ ] **Step 4: Verify matmul + hashmap fixture SHA256 unchanged**

Run:
```bash
pnpm exec tsx benches/matmul/fixtures/generate.ts
pnpm exec tsx benches/hashmap_string/fixtures/generate.ts
pnpm exec tsx benches/hashmap_int/fixtures/generate.ts
```
Compare emitted SHA256s with values в их spec.json's. If diff → **STOP**, P1 §1 byte-preserve violation.

- [ ] **Step 5: Commit spec.json updates**

```bash
git add benches/shape_dispatch_*/spec.json
git commit --no-gpg-sign -m "feat(shape_dispatch): populate fixtureSha256 (cross-binary identical per size)"
```

### Task 7: Run reference impls, populate `expectedChecksums`, verify cross-binary equality

**Files:**
- Modify: `benches/shape_dispatch_*/spec.json` (populate `expectedChecksums`)

- [ ] **Step 1: Run all 4 reference impls**

```bash
pnpm exec tsx benches/shape_dispatch_homo_static/validate/reference.ts
pnpm exec tsx benches/shape_dispatch_homo_dyn/validate/reference.ts
pnpm exec tsx benches/shape_dispatch_mixed_static/validate/reference.ts
pnpm exec tsx benches/shape_dispatch_mixed_dyn/validate/reference.ts
```
Each prints JSON: `{ "<entry>": { "S": "<u64>", "M": "<u64>", "L": "<u64>" } }`.

- [ ] **Step 2: Verify cross-binary checksum equality per size**

Extract S/M/L checksums from 4 outputs. Verify S value identical across 4; M identical; L identical.

If any mismatch → **STOP, R5 verification failed**. Surface to user.

- [ ] **Step 3: Populate `expectedChecksums` в 4 spec.json'ах**

For each size, place the (shared) checksum value as a **number** (not string) under the entry name in `expectedChecksums`. Note: numbers > 2^53 will lose precision in JS spec.json reader — verify all 3 values within safe integer range, else change schema to accept string. Validation in Step 4.

Sanity bound: max contribution = N × max(score) × 1e6 ≈ 100000 × ~30 × 1e6 = 3e12; ≤ 2^53 (9.007e15). Fits.

- [ ] **Step 4: Verify spec.json parses cleanly**

Run: `pnpm typecheck`
Expected: all packages typecheck green; `BenchmarkSpecSchema.parse(spec)` (через harness) accepts new spec.json files.

- [ ] **Step 5: Commit**

```bash
git add benches/shape_dispatch_*/spec.json
git commit --no-gpg-sign -m "feat(shape_dispatch): populate expectedChecksums (cross-binary identical via quantization)"
```

### Task 8: Wave 1 close — verify gates

**Files:** none (verification only)

- [ ] **Step 1: Run typecheck + lint + test**

Run: `pnpm typecheck && pnpm lint:all && pnpm test 2>&1 | tee /tmp/w1.log; rc=${PIPESTATUS[0]}; echo "exit=$rc"`
Expected: `exit=0`.

- [ ] **Step 2: Verify fixture SHA256 unchanged для existing workloads**

Already verified в Task 6 Step 4. Re-run if any доubt.

- [ ] **Step 3: Wave 1 summary commit**

No additional code changes — just verify all W1 commits present. List:

```bash
git log --oneline -10
```

Expected: 7 commits since Task 0 baseline (Tasks 1-7).

---

## Wave 2 — Implementations (16 native + 3 JS)

**Risk-first ordering:** Task 9 (cpp/wasi-sdk binary 4) + Task 10 (rust/raw binary 4) run **first** для R3, R4 fail-fast. Если either fails → STOP, surface to user before continuing with remaining 14 native + 3 JS implementations.

### Task 9: cpp/wasi-sdk binary 4 (mixed_dyn) — **R3 fail-fast**

**Files:**
- Create: `benches/shape_dispatch_mixed_dyn/cpp/src/main.cpp`
- Create: `benches/shape_dispatch_mixed_dyn/cpp/build-wasi-sdk.sh`
- Create: `benches/shape_dispatch_mixed_dyn/cpp/build-emscripten.sh` (also needed для consistency — both build paths share .cpp)

Spec § Per-toolchain implementation outlines / C++/emscripten + C++/wasi-sdk.

- [ ] **Step 1: Create main.cpp с placement new + virtual + anti-devirt asm**

`benches/shape_dispatch_mixed_dyn/cpp/src/main.cpp`:

```cpp
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>

// Inline placement new declaration — wasi-sdk freestanding не имеет <new>
inline void* operator new(size_t, void* p) noexcept { return p; }

struct Shape {
    virtual double score() const = 0;
    virtual ~Shape() = default;
};

struct Circle : Shape {
    double r;
    explicit Circle(double r_) : r(r_) {}
    double score() const override {
        double a = M_PI * r * r;
        double p = 2.0 * M_PI * r;
        return a * std::sqrt(p / (a + 1.0)) + std::log(a + p + 1.0);
    }
};

struct Square : Shape {
    double s;
    explicit Square(double s_) : s(s_) {}
    double score() const override {
        double a = s * s;
        double p = 4.0 * s;
        return a * std::sqrt(p / (a + 1.0)) + std::log(a + p + 1.0);
    }
};

struct Triangle : Shape {
    double b, h;
    Triangle(double b_, double h_) : b(b_), h(h_) {}
    double score() const override {
        double a = 0.5 * b * h;
        double p = b + h + std::sqrt(b * b + h * h);
        return a * std::sqrt(p / (a + 1.0)) + std::log(a + p + 1.0);
    }
};

struct State {
    void* storage = nullptr;   // worst-case sized (Triangle) × N
    Shape** dyn_array = nullptr;  // N pointers to objects in storage
    size_t len = 0;
};
static State g_state;

extern "C" uint32_t alloc(uint32_t size) {
    return (uint32_t)(uintptr_t)malloc(size);
}

extern "C" void load_input(const uint8_t* buf, uint32_t len) {
    size_t n = len / 24;
    g_state.storage = malloc(n * sizeof(Triangle));  // worst-case
    g_state.dyn_array = (Shape**)malloc(n * sizeof(Shape*));
    g_state.len = n;
    for (size_t i = 0; i < n; ++i) {
        uint8_t tag = buf[i * 24];
        double p1, p2;
        std::memcpy(&p1, buf + i * 24 + 8,  8);
        std::memcpy(&p2, buf + i * 24 + 16, 8);
        Shape* sh;
        void* slot = (char*)g_state.storage + i * sizeof(Triangle);
        switch (tag) {
            case 0: sh = new (slot) Circle(p1);       break;
            case 1: sh = new (slot) Square(p1);       break;
            default: sh = new (slot) Triangle(p1, p2); break;
        }
        asm volatile("" : : "g"(sh) : "memory");  // anti-devirt fence (R1)
        g_state.dyn_array[i] = sh;
    }
}

extern "C" double shape_dispatch_mixed_dyn(uint32_t iters) {
    uint64_t acc = 0;
    for (uint32_t i = 0; i < iters; ++i) {
        double score = g_state.dyn_array[i]->score();
        acc += (uint64_t)(score * 1e6 + 0.5);
    }
    return (double)acc;
}
```

- [ ] **Step 2: Create build-wasi-sdk.sh**

Copy structure from existing `benches/matmul/cpp/build-wasi-sdk.sh` (or interop_calls equivalent), adjusting binary name + exported functions:

```bash
#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
PROFILE="${1:-speed}"
DIST="${2:-$HERE/dist/$PROFILE}"

WASI_SDK=$("$HERE/../../../scripts/tool-paths.ts" wasi-sdk)
WASM_OPT=$("$HERE/../../../scripts/tool-paths.ts" wasm-opt)

mkdir -p "$DIST"

OPT_FLAGS=()
case "$PROFILE" in
    speed) OPT_FLAGS=(-O3) ;;
    size)  OPT_FLAGS=(-Oz) ;;
    *)     echo "Unknown profile: $PROFILE"; exit 1 ;;
esac

"$WASI_SDK/bin/clang++" \
    --target=wasm32-unknown-unknown \
    -nostdlib \
    -fno-exceptions -fno-rtti \
    -std=c++23 \
    "${OPT_FLAGS[@]}" \
    -Wl,--no-entry -Wl,--export=alloc -Wl,--export=load_input \
    -Wl,--export=shape_dispatch_mixed_dyn \
    -Wl,--allow-undefined \
    -o "$DIST/module.wasm" \
    "$HERE/src/main.cpp"

"$WASM_OPT" --enable-bulk-memory --enable-nontrapping-float-to-int \
    "${OPT_FLAGS[@]}" "$DIST/module.wasm" -o "$DIST/module.wasm"

ls -la "$DIST/module.wasm"
```

Make executable: `chmod +x benches/shape_dispatch_mixed_dyn/cpp/build-wasi-sdk.sh`.

- [ ] **Step 3: Create matching build-emscripten.sh**

Same structure as existing emscripten build scripts. Key flags: `-std=c++23 -fno-exceptions -fno-rtti -O3` (speed) or `-Oz` (size). EXPORTED_FUNCTIONS:
```
EXPORTED_FUNCTIONS='["_alloc","_load_input","_shape_dispatch_mixed_dyn"]'
EXPORTED_RUNTIME_METHODS='["HEAPU8","HEAP8"]'
```
For size profile: `--closure 1`.

- [ ] **Step 4: Build cpp/wasi-sdk for this binary**

Run: `pnpm exec tsx scripts/build-cpp.ts --bench=shape_dispatch_mixed_dyn` (or equivalent CLI). 
Expected: produces `dist/shape_dispatch_mixed_dyn__cpp-wasi-sdk-{speed,size}/module.wasm`.

If build fails (R3 fired):
- **STOP, surface to user** с failure mode (compile error / link error / missing libc symbol) + 3 mitigation alternatives per spec R3 list.
- Не auto-apply alternative.

- [ ] **Step 5: Build cpp/emscripten for this binary**

Run: `pnpm exec tsx scripts/build-cpp.ts --bench=shape_dispatch_mixed_dyn` (если build script делает оба или separately).
Expected: produces `dist/shape_dispatch_mixed_dyn__cpp-emscripten-{speed,size}/glue.{mjs,wasm}`.

- [ ] **Step 6: R1 devirt verification**

Run для cpp/wasi-sdk artifact:
```bash
wasm-objdump -d dist/shape_dispatch_mixed_dyn__cpp-wasi-sdk-speed/module.wasm | grep -c call_indirect
```
Expected: > 0 (virtual dispatch preserved).

Same for cpp/emscripten:
```bash
wasm-objdump -d dist/shape_dispatch_mixed_dyn__cpp-emscripten-speed/glue.wasm | grep -c call_indirect
```
Expected: > 0.

If either = 0 → **STOP, R1 fired**. Surface to user with mitigation alternatives.

- [ ] **Step 7: Smoke test via Node runner**

Run одну S-size case через runner-node:
```bash
pnpm exec tsx apps/runner-node/src/main.ts \
    --benchmark=shape_dispatch_mixed_dyn --entry=shape_dispatch_mixed_dyn \
    --language=cpp --toolchain=wasi-sdk --profile=speed --size=S \
    --out=/tmp/sd-smoke --mode=quick
```
Expected: exit 0, result JSON written, `validated: true` (checksum matches expectedChecksum).

Repeat для cpp/emscripten/speed.

- [ ] **Step 8: Commit**

```bash
git add benches/shape_dispatch_mixed_dyn/cpp/
git commit --no-gpg-sign -m "feat(shape_dispatch_mixed_dyn): cpp impl (wasi-sdk + emscripten, virtual + placement new + anti-devirt asm)"
```

### Task 10: rust/raw binary 4 (mixed_dyn) — **R4 fail-fast**

**Files:**
- Create: `benches/shape_dispatch_mixed_dyn/rust/raw/Cargo.toml`
- Create: `benches/shape_dispatch_mixed_dyn/rust/raw/src/lib.rs`
- Modify: `Cargo.toml` (workspace) — add new crate to members

Spec § Per-toolchain implementation outlines / Rust/raw.

- [ ] **Step 1: Create Cargo.toml**

Model after existing `benches/matmul/rust/raw/Cargo.toml`:

```toml
[package]
name = "shape_dispatch_mixed_dyn_raw"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
strip = true

[profile.release-size]
inherits = "release"
opt-level = "z"
```

- [ ] **Step 2: Create src/lib.rs**

```rust
#![no_std]

use core::hint::black_box;
use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! { loop {} }

// libm for sqrt/ln — wasm32 без std не имеет f64::sqrt/ln intrinsics в no_std.
// Use core::intrinsics::sqrtf64 (unstable) ИЛИ manual libm. Simpler: cmath ABI.
extern "C" {
    fn sqrt(x: f64) -> f64;
    fn log(x: f64) -> f64;
}

trait Shape {
    fn score(&self) -> f64;
}

#[repr(C)]
struct Circle { r: f64 }
#[repr(C)]
struct Square { s: f64 }
#[repr(C)]
struct Triangle { b: f64, h: f64 }

impl Shape for Circle {
    fn score(&self) -> f64 {
        let a = core::f64::consts::PI * self.r * self.r;
        let p = 2.0 * core::f64::consts::PI * self.r;
        unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
    }
}

impl Shape for Square {
    fn score(&self) -> f64 {
        let a = self.s * self.s;
        let p = 4.0 * self.s;
        unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
    }
}

impl Shape for Triangle {
    fn score(&self) -> f64 {
        let a = 0.5 * self.b * self.h;
        let p = self.b + self.h + unsafe { sqrt(self.b * self.b + self.h * self.h) };
        unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
    }
}

// HEAP layout: managed manually. Max N = 100_000; each shape ≤ 24B = 2.4 MB storage.
// Pointer array: N × 16B (fat pointer = ptr + vtable) = 1.6 MB. Total ≤ 4 MB. Plus fixture parse buf.
const HEAP_SIZE: usize = 8 * 1024 * 1024;
static mut HEAP: [u8; HEAP_SIZE] = [0; HEAP_SIZE];

struct State {
    storage_offset: usize,    // offset in HEAP where Triangle-sized slots begin
    dyn_offset: usize,        // offset in HEAP where fat pointers begin
    len: usize,
}

static mut STATE: State = State { storage_offset: 0, dyn_offset: 0, len: 0 };

#[no_mangle]
pub unsafe extern "C" fn alloc(size: u32) -> u32 {
    // Trivial bump allocator into HEAP — only for fixture buf (load_input input).
    // Subsequent calls overwrite. OK for our use (one-shot load_input).
    0
}

#[no_mangle]
pub unsafe extern "C" fn heap_ptr() -> *mut u8 {
    HEAP.as_mut_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn load_input(ptr: u32, len: u32) {
    // 1. Fixture bytes start at HEAP[ptr..ptr+len). Parse N = len/24 shapes.
    // 2. Lay out N × Triangle slots after fixture (aligned to 8).
    // 3. Lay out N × &dyn Shape fat pointers after slots.
    let n = (len as usize) / 24;
    let buf = HEAP.as_ptr().add(ptr as usize);

    let slots_off = ((ptr as usize + len as usize) + 7) & !7usize;
    let dyn_off   = (slots_off + n * core::mem::size_of::<Triangle>() + 15) & !15usize;

    for i in 0..n {
        let off = i * 24;
        let tag = *buf.add(off);
        let p1 = core::ptr::read_unaligned(buf.add(off + 8) as *const f64);
        let p2 = core::ptr::read_unaligned(buf.add(off + 16) as *const f64);
        let slot = HEAP.as_mut_ptr().add(slots_off + i * core::mem::size_of::<Triangle>());
        let shape_ref: &dyn Shape = match tag {
            0 => { *(slot as *mut Circle)   = Circle { r: p1 };       &*(slot as *const Circle) },
            1 => { *(slot as *mut Square)   = Square { s: p1 };       &*(slot as *const Square) },
            _ => { *(slot as *mut Triangle) = Triangle { b: p1, h: p2 }; &*(slot as *const Triangle) },
        };
        // Anti-devirt fence (R1) — force compiler to treat shape_ref as escaped
        let escaped = black_box(shape_ref);
        let dyn_slot = HEAP.as_mut_ptr().add(dyn_off + i * core::mem::size_of::<&dyn Shape>()) as *mut &dyn Shape;
        *dyn_slot = escaped;
    }
    STATE.storage_offset = slots_off;
    STATE.dyn_offset = dyn_off;
    STATE.len = n;
}

#[no_mangle]
pub unsafe extern "C" fn shape_dispatch_mixed_dyn(iters: u32) -> f64 {
    let mut acc: u64 = 0;
    let base = HEAP.as_ptr().add(STATE.dyn_offset) as *const &dyn Shape;
    for i in 0..iters as usize {
        let shape_ref = *base.add(i);
        let score = shape_ref.score();
        acc = acc.wrapping_add((score * 1e6 + 0.5) as u64);
    }
    f64::from_bits(acc)  // raw bit transfer; harness reads i64 via f64::from_bits inverse...
    // NB: harness expects checksum as f64. u64 → f64 lossy above 2^53. Our quantization
    // total ≤ 3e12 < 2^53 — so direct cast preserves value bit-for-bit when both sides
    // do same conversion. Use simpler: acc as f64.
}
```

**NOTE для executor:** the casting `acc as f64` may lose precision IF acc > 2^53. Sanity check в Task 7 verified bound ≤ 3e12 ≤ 2^53. If verification of R5 in Task 7 showed boundary issues, fall back to either:
- (a) Split u64 into 2 × u32 returned via additional export call.
- (b) Use `f64::from_bits(acc)` and update harness reader.

For initial impl: use `acc as f64`. Verify Task 11 smoke validates checksum equality.

Adjust final return: `acc as f64`.

- [ ] **Step 3: Add crate to workspace Cargo.toml**

Modify root `Cargo.toml`:

```toml
[workspace]
members = [
    # existing crates ...
    "benches/shape_dispatch_mixed_dyn/rust/raw",
]
```

- [ ] **Step 4: Build rust/raw for this binary**

Run: `pnpm exec tsx scripts/build-rust.ts --bench=shape_dispatch_mixed_dyn`
Expected: produces `dist/shape_dispatch_mixed_dyn__rust-raw-{speed,size}/module.wasm`.

If build fails (R4 fired) — typically lifetime errors на `&dyn Shape` storage, or no_std intrinsic missing → **STOP, surface to user** с failure + R4 mitigation alternatives.

- [ ] **Step 5: R1 devirt verification**

```bash
wasm-objdump -d dist/shape_dispatch_mixed_dyn__rust-raw-speed/module.wasm | grep -c call_indirect
```
Expected: > 0.

- [ ] **Step 6: Smoke test (S size)**

```bash
pnpm exec tsx apps/runner-node/src/main.ts \
    --benchmark=shape_dispatch_mixed_dyn --entry=shape_dispatch_mixed_dyn \
    --language=rust --toolchain=raw --profile=speed --size=S \
    --out=/tmp/sd-smoke --mode=quick
```
Expected: exit 0, `validated: true`.

If checksum mismatch (R5 fired) → **STOP, surface to user** с R5 mitigation alternatives.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml benches/shape_dispatch_mixed_dyn/rust/raw/
git commit --no-gpg-sign -m "feat(shape_dispatch_mixed_dyn): rust/raw impl (no_std + fat pointer storage + black_box anti-devirt)"
```

### Task 11: rust/bindgen binary 4 (mixed_dyn)

**Files:**
- Create: `benches/shape_dispatch_mixed_dyn/rust/bindgen/Cargo.toml`
- Create: `benches/shape_dispatch_mixed_dyn/rust/bindgen/src/lib.rs`
- Modify: workspace `Cargo.toml`

- [ ] **Step 1: Create Cargo.toml**

Model after `benches/hashmap_int/rust/bindgen/Cargo.toml`:

```toml
[package]
name = "shape_dispatch_mixed_dyn_bindgen"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
strip = true

[profile.release-size]
inherits = "release"
opt-level = "z"
```

- [ ] **Step 2: Create src/lib.rs**

```rust
#![allow(clippy::missing_const_for_fn, reason = "wasm_bindgen requires non-const fns")]

use core::hint::black_box;
use std::alloc::{alloc, Layout};
use std::sync::LazyLock;
use wasm_bindgen::prelude::*;

mod sync_cell {
    use core::cell::UnsafeCell;
    #[repr(transparent)]
    pub struct SyncCell<T>(pub UnsafeCell<T>);
    unsafe impl<T> Sync for SyncCell<T> {}
}
use sync_cell::SyncCell;

trait Shape: Send + Sync {
    fn score(&self) -> f64;
}

struct Circle { r: f64 }
struct Square { s: f64 }
struct Triangle { b: f64, h: f64 }

impl Shape for Circle {
    fn score(&self) -> f64 {
        let a = std::f64::consts::PI * self.r * self.r;
        let p = 2.0 * std::f64::consts::PI * self.r;
        a * (p / (a + 1.0)).sqrt() + (a + p + 1.0).ln()
    }
}

impl Shape for Square {
    fn score(&self) -> f64 {
        let a = self.s * self.s;
        let p = 4.0 * self.s;
        a * (p / (a + 1.0)).sqrt() + (a + p + 1.0).ln()
    }
}

impl Shape for Triangle {
    fn score(&self) -> f64 {
        let a = 0.5 * self.b * self.h;
        let p = self.b + self.h + (self.b * self.b + self.h * self.h).sqrt();
        a * (p / (a + 1.0)).sqrt() + (a + p + 1.0).ln()
    }
}

struct State {
    storage_ptr: *mut u8,
    dyn_array_ptr: *mut *const dyn Shape,  // raw pointer to dyn — no lifetime
    len: usize,
}
unsafe impl Send for State {}

static STATE: LazyLock<SyncCell<State>> = LazyLock::new(|| SyncCell(core::cell::UnsafeCell::new(State {
    storage_ptr: core::ptr::null_mut(),
    dyn_array_ptr: core::ptr::null_mut(),
    len: 0,
})));

#[wasm_bindgen]
pub fn load_input(buf: &[u8]) {
    let n = buf.len() / 24;
    let triangle_layout = Layout::new::<Triangle>();
    let storage_layout = Layout::from_size_align(n * triangle_layout.size(), triangle_layout.align()).unwrap();
    let ptr_layout = Layout::array::<*const dyn Shape>(n).unwrap();

    let storage_ptr = unsafe { alloc(storage_layout) };
    let dyn_array_ptr = unsafe { alloc(ptr_layout) as *mut *const dyn Shape };

    for i in 0..n {
        let off = i * 24;
        let tag = buf[off];
        let p1 = f64::from_le_bytes(buf[off + 8..off + 16].try_into().unwrap());
        let p2 = f64::from_le_bytes(buf[off + 16..off + 24].try_into().unwrap());
        let slot = unsafe { storage_ptr.add(i * triangle_layout.size()) };
        let shape_ref: &dyn Shape = unsafe {
            match tag {
                0 => { (slot as *mut Circle).write(Circle { r: p1 });       &*(slot as *const Circle) }
                1 => { (slot as *mut Square).write(Square { s: p1 });       &*(slot as *const Square) }
                _ => { (slot as *mut Triangle).write(Triangle { b: p1, h: p2 }); &*(slot as *const Triangle) }
            }
        };
        let escaped: *const dyn Shape = black_box(shape_ref) as *const dyn Shape;
        unsafe { dyn_array_ptr.add(i).write(escaped); }
    }
    let st = unsafe { &mut *STATE.0.get() };
    st.storage_ptr = storage_ptr;
    st.dyn_array_ptr = dyn_array_ptr;
    st.len = n;
}

#[wasm_bindgen]
pub fn shape_dispatch_mixed_dyn(iters: u32) -> f64 {
    let st = unsafe { &*STATE.0.get() };
    let mut acc: u64 = 0;
    for i in 0..iters as usize {
        let ptr = unsafe { *st.dyn_array_ptr.add(i) };
        let score = unsafe { (*ptr).score() };
        acc = acc.wrapping_add((score * 1e6 + 0.5) as u64);
    }
    acc as f64
}
```

- [ ] **Step 3: Add crate to workspace Cargo.toml**

```toml
[workspace]
members = [
    # ...
    "benches/shape_dispatch_mixed_dyn/rust/bindgen",
]
```

- [ ] **Step 4: Build + devirt verification + smoke test**

```bash
pnpm exec tsx scripts/build-rust.ts --bench=shape_dispatch_mixed_dyn
wasm-objdump -d dist/shape_dispatch_mixed_dyn__rust-bindgen-speed/module.wasm | grep -c call_indirect
pnpm exec tsx apps/runner-node/src/main.ts --benchmark=shape_dispatch_mixed_dyn --entry=shape_dispatch_mixed_dyn --language=rust --toolchain=bindgen --profile=speed --size=S --out=/tmp/sd-smoke --mode=quick
```
Expected: build succeeds; call_indirect count > 0; smoke `validated: true`.

If devirt count = 0 → **STOP, R1 fired**. Surface to user.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml benches/shape_dispatch_mixed_dyn/rust/bindgen/
git commit --no-gpg-sign -m "feat(shape_dispatch_mixed_dyn): rust/bindgen impl (raw heap arrays + black_box anti-devirt)"
```

### Task 12: js/idiomatic binary 4 (mixed_dyn)

**Files:**
- Create: `benches/shape_dispatch_mixed_dyn/js/idiomatic/package.json`
- Create: `benches/shape_dispatch_mixed_dyn/js/idiomatic/tsconfig.json`
- Create: `benches/shape_dispatch_mixed_dyn/js/idiomatic/src/index.ts`

Model after `benches/hashmap_int/js/idiomatic/`.

- [ ] **Step 1: Create package.json**

```json
{
    "name": "@bench/shape_dispatch_mixed_dyn-js-idiomatic",
    "private": true,
    "version": "0.1.0",
    "type": "module",
    "main": "src/index.ts",
    "scripts": { "typecheck": "tsc --noEmit" },
    "devDependencies": { "typescript": "*" }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
    "extends": "../../../../tsconfig.base.json",
    "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create src/index.ts**

```ts
import { ShapeKind } from "../../../common/shape-reference.js";

class Circle {
    constructor(public r: number) {}
    score(): number {
        const a = Math.PI * this.r * this.r;
        const p = 2 * Math.PI * this.r;
        return a * Math.sqrt(p / (a + 1)) + Math.log(a + p + 1);
    }
}
class Square {
    constructor(public s: number) {}
    score(): number {
        const a = this.s * this.s;
        const p = 4 * this.s;
        return a * Math.sqrt(p / (a + 1)) + Math.log(a + p + 1);
    }
}
class Triangle {
    constructor(public b: number, public h: number) {}
    score(): number {
        const a = 0.5 * this.b * this.h;
        const p = this.b + this.h + Math.sqrt(this.b * this.b + this.h * this.h);
        return a * Math.sqrt(p / (a + 1)) + Math.log(a + p + 1);
    }
}

type Shape = Circle | Square | Triangle;

export default function create(_entry: string) {
    let shapes: Shape[] = [];

    function loadInput(buf: Uint8Array): void {
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const n = buf.length / 24;
        shapes = new Array(n);
        for (let i = 0; i < n; i++) {
            const off = i * 24;
            const tag = buf[off] as ShapeKind;
            const p1 = view.getFloat64(off + 8, true);
            const p2 = view.getFloat64(off + 16, true);
            switch (tag) {
                case ShapeKind.Circle:   shapes[i] = new Circle(p1);    break;
                case ShapeKind.Square:   shapes[i] = new Square(p1);    break;
                case ShapeKind.Triangle: shapes[i] = new Triangle(p1, p2); break;
            }
        }
    }

    function run(_iters: number): { checksum: number } {
        let acc = 0n;
        const mask = (1n << 64n) - 1n;
        for (const s of shapes) {
            acc = (acc + BigInt(Math.round(s.score() * 1e6))) & mask;
        }
        return { checksum: Number(acc) };
    }

    return { loadInput, run };
}
```

- [ ] **Step 4: Smoke test**

```bash
pnpm typecheck
pnpm exec tsx apps/runner-node/src/main.ts --benchmark=shape_dispatch_mixed_dyn --entry=shape_dispatch_mixed_dyn --language=js --toolchain=idiomatic --profile=speed --size=S --out=/tmp/sd-smoke --mode=quick
```
Expected: typecheck green; smoke `validated: true`.

- [ ] **Step 5: Commit**

```bash
git add benches/shape_dispatch_mixed_dyn/js/
git commit --no-gpg-sign -m "feat(shape_dispatch_mixed_dyn): js/idiomatic impl (3 classes + polymorphic IC)"
```

### Task 13: cpp binary 1 (homo_static) — templates + 3 typed arrays

**Files:**
- Create: `benches/shape_dispatch_homo_static/cpp/{src/main.cpp, build-wasi-sdk.sh, build-emscripten.sh}`

- [ ] **Step 1: Create main.cpp с template process + 3 typed arrays**

```cpp
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>

struct Circle   { double r; };
struct Square   { double s; };
struct Triangle { double b, h; };

static inline double area_complex_circle(const Circle& c) {
    double a = M_PI * c.r * c.r;
    double p = 2.0 * M_PI * c.r;
    return a * std::sqrt(p / (a + 1.0)) + std::log(a + p + 1.0);
}
static inline double area_complex_square(const Square& sq) {
    double a = sq.s * sq.s;
    double p = 4.0 * sq.s;
    return a * std::sqrt(p / (a + 1.0)) + std::log(a + p + 1.0);
}
static inline double area_complex_triangle(const Triangle& t) {
    double a = 0.5 * t.b * t.h;
    double p = t.b + t.h + std::sqrt(t.b * t.b + t.h * t.h);
    return a * std::sqrt(p / (a + 1.0)) + std::log(a + p + 1.0);
}

template <typename S, double (*FN)(const S&)>
static uint64_t process(const S* arr, size_t n) {
    uint64_t acc = 0;
    for (size_t i = 0; i < n; ++i) acc += (uint64_t)(FN(arr[i]) * 1e6 + 0.5);
    return acc;
}

struct State {
    Circle*   circles   = nullptr; size_t n_c = 0;
    Square*   squares   = nullptr; size_t n_s = 0;
    Triangle* triangles = nullptr; size_t n_t = 0;
};
static State g_state;

extern "C" uint32_t alloc(uint32_t size) { return (uint32_t)(uintptr_t)malloc(size); }

extern "C" void load_input(const uint8_t* buf, uint32_t len) {
    size_t n = len / 24;
    size_t cnt[3] = {0, 0, 0};
    for (size_t i = 0; i < n; ++i) cnt[buf[i * 24]]++;
    g_state.circles   = (Circle*)   malloc(cnt[0] * sizeof(Circle));
    g_state.squares   = (Square*)   malloc(cnt[1] * sizeof(Square));
    g_state.triangles = (Triangle*) malloc(cnt[2] * sizeof(Triangle));
    g_state.n_c = g_state.n_s = g_state.n_t = 0;
    for (size_t i = 0; i < n; ++i) {
        uint8_t tag = buf[i * 24];
        double p1, p2;
        std::memcpy(&p1, buf + i * 24 + 8,  8);
        std::memcpy(&p2, buf + i * 24 + 16, 8);
        switch (tag) {
            case 0: g_state.circles[g_state.n_c++]   = Circle{.r = p1};        break;
            case 1: g_state.squares[g_state.n_s++]   = Square{.s = p1};        break;
            case 2: g_state.triangles[g_state.n_t++] = Triangle{.b = p1, .h = p2}; break;
        }
    }
}

extern "C" double shape_dispatch_homo_static(uint32_t /*iters*/) {
    uint64_t acc = 0;
    acc += process<Circle,   area_complex_circle>  (g_state.circles,   g_state.n_c);
    acc += process<Square,   area_complex_square>  (g_state.squares,   g_state.n_s);
    acc += process<Triangle, area_complex_triangle>(g_state.triangles, g_state.n_t);
    return (double)acc;
}
```

`iters` ignored — process iterates per-type arrays whose total = N. Checksum invariant via quantization commutativity.

- [ ] **Step 2: Create build-wasi-sdk.sh** — copy Task 9 Step 2 template; replace `--export=shape_dispatch_mixed_dyn` → `--export=shape_dispatch_homo_static`.

- [ ] **Step 3: Create build-emscripten.sh** — copy Task 9 Step 3 template; `EXPORTED_FUNCTIONS='["_alloc","_load_input","_shape_dispatch_homo_static"]'`.

- [ ] **Step 4: Build both toolchains**

```bash
pnpm exec tsx scripts/build-cpp.ts --bench=shape_dispatch_homo_static
```
Expected: produces 4 artifacts (wasi-sdk + emscripten × speed + size).

- [ ] **Step 5: R1 devirt verification — NOT applicable for static binaries**

Binary 1 has no virtual functions. Expected `call_indirect == 0`:
```bash
wasm-objdump -d dist/shape_dispatch_homo_static__cpp-wasi-sdk-speed/module.wasm | grep -c call_indirect
```
Expected: `0`. If > 0 → investigate (likely emcc artifact, not R1).

- [ ] **Step 6: Smoke test**

```bash
for tc in wasi-sdk emscripten; do
    pnpm exec tsx apps/runner-node/src/main.ts \
        --benchmark=shape_dispatch_homo_static --entry=shape_dispatch_homo_static \
        --language=cpp --toolchain=$tc --profile=speed --size=S \
        --out=/tmp/sd-smoke --mode=quick
done
```
Expected: exit 0, `validated: true`.

- [ ] **Step 7: Commit**

```bash
git add benches/shape_dispatch_homo_static/cpp/
git commit --no-gpg-sign -m "feat(shape_dispatch_homo_static): cpp impl (templates × 3 + 3 typed arrays + no virtual)"
```

### Task 14: cpp binary 2 (homo_dyn) — virtual + 3 typed pointer arrays + asm fence

**Files:**
- Create: `benches/shape_dispatch_homo_dyn/cpp/{src/main.cpp, build-wasi-sdk.sh, build-emscripten.sh}`

- [ ] **Step 1: Create main.cpp**

```cpp
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>

inline void* operator new(size_t, void* p) noexcept { return p; }

struct Shape { virtual double score() const = 0; virtual ~Shape() = default; };

struct Circle : Shape {
    double r;
    explicit Circle(double r_) : r(r_) {}
    double score() const override {
        double a = M_PI * r * r;
        double p = 2.0 * M_PI * r;
        return a * std::sqrt(p / (a + 1.0)) + std::log(a + p + 1.0);
    }
};
struct Square : Shape {
    double s;
    explicit Square(double s_) : s(s_) {}
    double score() const override {
        double a = s * s;
        double p = 4.0 * s;
        return a * std::sqrt(p / (a + 1.0)) + std::log(a + p + 1.0);
    }
};
struct Triangle : Shape {
    double b, h;
    Triangle(double b_, double h_) : b(b_), h(h_) {}
    double score() const override {
        double a = 0.5 * b * h;
        double p = b + h + std::sqrt(b * b + h * h);
        return a * std::sqrt(p / (a + 1.0)) + std::log(a + p + 1.0);
    }
};

struct State {
    void* circles_storage   = nullptr; Circle**   circles_arr   = nullptr; size_t n_c = 0;
    void* squares_storage   = nullptr; Square**   squares_arr   = nullptr; size_t n_s = 0;
    void* triangles_storage = nullptr; Triangle** triangles_arr = nullptr; size_t n_t = 0;
};
static State g_state;

extern "C" uint32_t alloc(uint32_t size) { return (uint32_t)(uintptr_t)malloc(size); }

extern "C" void load_input(const uint8_t* buf, uint32_t len) {
    size_t n = len / 24;
    size_t cnt[3] = {0, 0, 0};
    for (size_t i = 0; i < n; ++i) cnt[buf[i * 24]]++;
    g_state.circles_storage   = malloc(cnt[0] * sizeof(Circle));
    g_state.squares_storage   = malloc(cnt[1] * sizeof(Square));
    g_state.triangles_storage = malloc(cnt[2] * sizeof(Triangle));
    g_state.circles_arr   = (Circle**)   malloc(cnt[0] * sizeof(Circle*));
    g_state.squares_arr   = (Square**)   malloc(cnt[1] * sizeof(Square*));
    g_state.triangles_arr = (Triangle**) malloc(cnt[2] * sizeof(Triangle*));
    size_t ic = 0, is = 0, it = 0;
    for (size_t i = 0; i < n; ++i) {
        uint8_t tag = buf[i * 24];
        double p1, p2;
        std::memcpy(&p1, buf + i * 24 + 8,  8);
        std::memcpy(&p2, buf + i * 24 + 16, 8);
        Shape* sh;
        switch (tag) {
            case 0: {
                void* slot = (char*)g_state.circles_storage + ic * sizeof(Circle);
                sh = new (slot) Circle(p1);
                asm volatile("" : : "g"(sh) : "memory");
                g_state.circles_arr[ic++] = (Circle*)sh;
                break;
            }
            case 1: {
                void* slot = (char*)g_state.squares_storage + is * sizeof(Square);
                sh = new (slot) Square(p1);
                asm volatile("" : : "g"(sh) : "memory");
                g_state.squares_arr[is++] = (Square*)sh;
                break;
            }
            case 2: {
                void* slot = (char*)g_state.triangles_storage + it * sizeof(Triangle);
                sh = new (slot) Triangle(p1, p2);
                asm volatile("" : : "g"(sh) : "memory");
                g_state.triangles_arr[it++] = (Triangle*)sh;
                break;
            }
        }
    }
    g_state.n_c = ic; g_state.n_s = is; g_state.n_t = it;
}

extern "C" double shape_dispatch_homo_dyn(uint32_t /*iters*/) {
    uint64_t acc = 0;
    for (size_t i = 0; i < g_state.n_c; ++i) acc += (uint64_t)(g_state.circles_arr[i]->score()   * 1e6 + 0.5);
    for (size_t i = 0; i < g_state.n_s; ++i) acc += (uint64_t)(g_state.squares_arr[i]->score()   * 1e6 + 0.5);
    for (size_t i = 0; i < g_state.n_t; ++i) acc += (uint64_t)(g_state.triangles_arr[i]->score() * 1e6 + 0.5);
    return (double)acc;
}
```

- [ ] **Step 2-3: Build scripts** — copy Task 9 templates; replace exports / EXPORTED_FUNCTIONS с `shape_dispatch_homo_dyn`.

- [ ] **Step 4: Build both toolchains**

```bash
pnpm exec tsx scripts/build-cpp.ts --bench=shape_dispatch_homo_dyn
```

- [ ] **Step 5: R1 devirt verification — ACTIVE**

```bash
for tc in wasi-sdk emscripten; do
    f=$(ls dist/shape_dispatch_homo_dyn__cpp-${tc}-speed/*.wasm | head -1)
    n=$(wasm-objdump -d "$f" | grep -c call_indirect)
    echo "$tc: $n call_indirect"
    [ "$n" -gt 0 ] || { echo "DEVIRT FIRED: $f"; exit 1; }
done
```
Expected: both > 0. If either = 0 → **STOP, R1 fired**.

- [ ] **Step 6: Smoke test** — both toolchains, S size. Expected `validated: true`.

- [ ] **Step 7: Commit**

```bash
git add benches/shape_dispatch_homo_dyn/cpp/
git commit --no-gpg-sign -m "feat(shape_dispatch_homo_dyn): cpp impl (virtual + 3 typed pointer arrays + asm anti-devirt)"
```

### Task 15: cpp binary 3 (mixed_static) — TaggedShape inline + switch

**Files:**
- Create: `benches/shape_dispatch_mixed_static/cpp/{src/main.cpp, build-wasi-sdk.sh, build-emscripten.sh}`

- [ ] **Step 1: Create main.cpp**

```cpp
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>

struct TaggedShape {
    uint8_t kind;
    double p1;
    double p2;
};

static inline double area_complex(const TaggedShape& s) {
    double a, p;
    switch (s.kind) {
        case 0:
            a = M_PI * s.p1 * s.p1;
            p = 2.0 * M_PI * s.p1;
            break;
        case 1:
            a = s.p1 * s.p1;
            p = 4.0 * s.p1;
            break;
        default:
            a = 0.5 * s.p1 * s.p2;
            p = s.p1 + s.p2 + std::sqrt(s.p1 * s.p1 + s.p2 * s.p2);
            break;
    }
    return a * std::sqrt(p / (a + 1.0)) + std::log(a + p + 1.0);
}

struct State { TaggedShape* shapes = nullptr; size_t len = 0; };
static State g_state;

extern "C" uint32_t alloc(uint32_t size) { return (uint32_t)(uintptr_t)malloc(size); }

extern "C" void load_input(const uint8_t* buf, uint32_t len) {
    size_t n = len / 24;
    g_state.shapes = (TaggedShape*)malloc(n * sizeof(TaggedShape));
    g_state.len = n;
    for (size_t i = 0; i < n; ++i) {
        g_state.shapes[i].kind = buf[i * 24];
        std::memcpy(&g_state.shapes[i].p1, buf + i * 24 + 8,  8);
        std::memcpy(&g_state.shapes[i].p2, buf + i * 24 + 16, 8);
    }
}

extern "C" double shape_dispatch_mixed_static(uint32_t /*iters*/) {
    uint64_t acc = 0;
    for (size_t i = 0; i < g_state.len; ++i) {
        acc += (uint64_t)(area_complex(g_state.shapes[i]) * 1e6 + 0.5);
    }
    return (double)acc;
}
```

- [ ] **Step 2-3: Build scripts** — copy Task 9 templates; replace exports с `shape_dispatch_mixed_static`.

- [ ] **Step 4: Build both toolchains**

```bash
pnpm exec tsx scripts/build-cpp.ts --bench=shape_dispatch_mixed_static
```

- [ ] **Step 5: R1 devirt — NOT applicable** (no virtual). Expected `call_indirect == 0`.

- [ ] **Step 6: Smoke test** — both toolchains, S size. Expected `validated: true`.

- [ ] **Step 7: Commit**

```bash
git add benches/shape_dispatch_mixed_static/cpp/
git commit --no-gpg-sign -m "feat(shape_dispatch_mixed_static): cpp impl (TaggedShape inline + switch dispatch)"
```

### Task 16: rust/raw binary 1 (homo_static) — generics + 3 typed arrays

**Files:**
- Create: `benches/shape_dispatch_homo_static/rust/raw/{Cargo.toml, src/lib.rs}`
- Modify: workspace `Cargo.toml` (add member)

- [ ] **Step 1: Create Cargo.toml**

```toml
[package]
name = "shape_dispatch_homo_static_raw"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
strip = true

[profile.release-size]
inherits = "release"
opt-level = "z"
```

- [ ] **Step 2: Create src/lib.rs**

```rust
#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! { loop {} }

extern "C" {
    fn sqrt(x: f64) -> f64;
    fn log(x: f64) -> f64;
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Circle { r: f64 }
#[repr(C)]
#[derive(Clone, Copy)]
struct Square { s: f64 }
#[repr(C)]
#[derive(Clone, Copy)]
struct Triangle { b: f64, h: f64 }

trait Score { fn score(&self) -> f64; }

impl Score for Circle {
    fn score(&self) -> f64 {
        let a = core::f64::consts::PI * self.r * self.r;
        let p = 2.0 * core::f64::consts::PI * self.r;
        unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
    }
}
impl Score for Square {
    fn score(&self) -> f64 {
        let a = self.s * self.s;
        let p = 4.0 * self.s;
        unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
    }
}
impl Score for Triangle {
    fn score(&self) -> f64 {
        let a = 0.5 * self.b * self.h;
        let p = self.b + self.h + unsafe { sqrt(self.b * self.b + self.h * self.h) };
        unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
    }
}

// Generic process — monomorphized 3× per type
fn process<S: Score>(arr: *const S, n: usize) -> u64 {
    let mut acc: u64 = 0;
    for i in 0..n {
        let s = unsafe { &*arr.add(i) };
        acc = acc.wrapping_add((s.score() * 1e6 + 0.5) as u64);
    }
    acc
}

const HEAP_SIZE: usize = 8 * 1024 * 1024;
#[no_mangle]
static mut HEAP: [u8; HEAP_SIZE] = [0; HEAP_SIZE];

struct State {
    circles_off:   usize, n_c: usize,
    squares_off:   usize, n_s: usize,
    triangles_off: usize, n_t: usize,
}
static mut STATE: State = State {
    circles_off: 0, n_c: 0,
    squares_off: 0, n_s: 0,
    triangles_off: 0, n_t: 0,
};

#[no_mangle]
pub unsafe extern "C" fn heap_ptr() -> *mut u8 { (&raw mut HEAP).cast() }

#[no_mangle]
pub unsafe extern "C" fn load_input(ptr: u32, len: u32) {
    let n = (len as usize) / 24;
    let buf = (&raw const HEAP).cast::<u8>().add(ptr as usize);

    // Count per-type
    let mut cnt = [0usize; 3];
    for i in 0..n { cnt[*buf.add(i * 24) as usize] += 1; }

    // Layout: fixture bytes [ptr..ptr+len), затем aligned per-type arrays
    let mut cursor = ((ptr as usize + len as usize) + 7) & !7usize;
    let circles_off = cursor;   cursor += cnt[0] * core::mem::size_of::<Circle>();
    cursor = (cursor + 7) & !7usize;
    let squares_off = cursor;   cursor += cnt[1] * core::mem::size_of::<Square>();
    cursor = (cursor + 7) & !7usize;
    let triangles_off = cursor; // cursor += cnt[2] * size_of::<Triangle>(); — last, no need

    let circles   = (&raw mut HEAP).cast::<u8>().add(circles_off)   as *mut Circle;
    let squares   = (&raw mut HEAP).cast::<u8>().add(squares_off)   as *mut Square;
    let triangles = (&raw mut HEAP).cast::<u8>().add(triangles_off) as *mut Triangle;

    let mut ic = 0; let mut is = 0; let mut it = 0;
    for i in 0..n {
        let off = i * 24;
        let tag = *buf.add(off);
        let p1 = core::ptr::read_unaligned(buf.add(off + 8) as *const f64);
        let p2 = core::ptr::read_unaligned(buf.add(off + 16) as *const f64);
        match tag {
            0 => { *circles.add(ic)   = Circle { r: p1 };       ic += 1; }
            1 => { *squares.add(is)   = Square { s: p1 };       is += 1; }
            _ => { *triangles.add(it) = Triangle { b: p1, h: p2 }; it += 1; }
        }
    }
    STATE = State {
        circles_off, n_c: ic,
        squares_off, n_s: is,
        triangles_off, n_t: it,
    };
}

#[no_mangle]
pub unsafe extern "C" fn shape_dispatch_homo_static(_iters: u32) -> f64 {
    let circles   = (&raw const HEAP).cast::<u8>().add(STATE.circles_off)   as *const Circle;
    let squares   = (&raw const HEAP).cast::<u8>().add(STATE.squares_off)   as *const Square;
    let triangles = (&raw const HEAP).cast::<u8>().add(STATE.triangles_off) as *const Triangle;
    let mut acc: u64 = 0;
    acc = acc.wrapping_add(process(circles,   STATE.n_c));
    acc = acc.wrapping_add(process(squares,   STATE.n_s));
    acc = acc.wrapping_add(process(triangles, STATE.n_t));
    acc as f64
}
```

- [ ] **Step 3: Add to workspace Cargo.toml**

```toml
[workspace]
members = [
    # ...
    "benches/shape_dispatch_homo_static/rust/raw",
]
```

- [ ] **Step 4: Build + R1 verification (not applicable — static) + smoke**

```bash
pnpm exec tsx scripts/build-rust.ts --bench=shape_dispatch_homo_static
wasm-objdump -d dist/shape_dispatch_homo_static__rust-raw-speed/module.wasm | grep -c call_indirect  # expect 0
pnpm exec tsx apps/runner-node/src/main.ts --benchmark=shape_dispatch_homo_static --entry=shape_dispatch_homo_static --language=rust --toolchain=raw --profile=speed --size=S --out=/tmp/sd-smoke --mode=quick
```

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml benches/shape_dispatch_homo_static/rust/raw/
git commit --no-gpg-sign -m "feat(shape_dispatch_homo_static): rust/raw impl (generics + 3 typed arrays + no_std)"
```

### Task 17: rust/raw binary 2 (homo_dyn) — fat pointer arrays per type + black_box

**Files:**
- Create: `benches/shape_dispatch_homo_dyn/rust/raw/{Cargo.toml, src/lib.rs}`
- Modify: workspace `Cargo.toml`

- [ ] **Step 1: Create Cargo.toml** — same as Task 16 step 1, replace package name `shape_dispatch_homo_dyn_raw`.

- [ ] **Step 2: Create src/lib.rs**

```rust
#![no_std]

use core::hint::black_box;
use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! { loop {} }

extern "C" {
    fn sqrt(x: f64) -> f64;
    fn log(x: f64) -> f64;
}

trait Shape { fn score(&self) -> f64; }

#[repr(C)]
struct Circle { r: f64 }
#[repr(C)]
struct Square { s: f64 }
#[repr(C)]
struct Triangle { b: f64, h: f64 }

impl Shape for Circle {
    fn score(&self) -> f64 {
        let a = core::f64::consts::PI * self.r * self.r;
        let p = 2.0 * core::f64::consts::PI * self.r;
        unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
    }
}
impl Shape for Square {
    fn score(&self) -> f64 {
        let a = self.s * self.s;
        let p = 4.0 * self.s;
        unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
    }
}
impl Shape for Triangle {
    fn score(&self) -> f64 {
        let a = 0.5 * self.b * self.h;
        let p = self.b + self.h + unsafe { sqrt(self.b * self.b + self.h * self.h) };
        unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
    }
}

const HEAP_SIZE: usize = 16 * 1024 * 1024;  // larger — needs storage + 3 fat-pointer arrays
#[no_mangle]
static mut HEAP: [u8; HEAP_SIZE] = [0; HEAP_SIZE];

struct State {
    c_storage_off: usize, c_ptrs_off: usize, n_c: usize,
    s_storage_off: usize, s_ptrs_off: usize, n_s: usize,
    t_storage_off: usize, t_ptrs_off: usize, n_t: usize,
}
static mut STATE: State = State {
    c_storage_off: 0, c_ptrs_off: 0, n_c: 0,
    s_storage_off: 0, s_ptrs_off: 0, n_s: 0,
    t_storage_off: 0, t_ptrs_off: 0, n_t: 0,
};

#[no_mangle]
pub unsafe extern "C" fn heap_ptr() -> *mut u8 { (&raw mut HEAP).cast() }

#[no_mangle]
pub unsafe extern "C" fn load_input(ptr: u32, len: u32) {
    let n = (len as usize) / 24;
    let buf = (&raw const HEAP).cast::<u8>().add(ptr as usize);

    let mut cnt = [0usize; 3];
    for i in 0..n { cnt[*buf.add(i * 24) as usize] += 1; }

    let align_up = |x: usize, a: usize| (x + a - 1) & !(a - 1);
    let mut cursor = align_up(ptr as usize + len as usize, 8);
    let c_storage_off = cursor; cursor += cnt[0] * core::mem::size_of::<Circle>();
    cursor = align_up(cursor, 8);
    let s_storage_off = cursor; cursor += cnt[1] * core::mem::size_of::<Square>();
    cursor = align_up(cursor, 8);
    let t_storage_off = cursor; cursor += cnt[2] * core::mem::size_of::<Triangle>();
    cursor = align_up(cursor, 16);  // &dyn alignment
    let c_ptrs_off = cursor; cursor += cnt[0] * core::mem::size_of::<&dyn Shape>();
    cursor = align_up(cursor, 16);
    let s_ptrs_off = cursor; cursor += cnt[1] * core::mem::size_of::<&dyn Shape>();
    cursor = align_up(cursor, 16);
    let t_ptrs_off = cursor; // last

    let mut ic = 0; let mut is = 0; let mut it = 0;
    let heap = (&raw mut HEAP).cast::<u8>();
    for i in 0..n {
        let off = i * 24;
        let tag = *buf.add(off);
        let p1 = core::ptr::read_unaligned(buf.add(off + 8) as *const f64);
        let p2 = core::ptr::read_unaligned(buf.add(off + 16) as *const f64);
        let shape_ref: &dyn Shape = match tag {
            0 => {
                let slot = heap.add(c_storage_off + ic * core::mem::size_of::<Circle>()) as *mut Circle;
                *slot = Circle { r: p1 };
                let r = &*(slot as *const Circle);
                let escaped = black_box(r as &dyn Shape);
                let dyn_slot = heap.add(c_ptrs_off + ic * core::mem::size_of::<&dyn Shape>()) as *mut &dyn Shape;
                *dyn_slot = escaped;
                ic += 1;
                escaped
            }
            1 => {
                let slot = heap.add(s_storage_off + is * core::mem::size_of::<Square>()) as *mut Square;
                *slot = Square { s: p1 };
                let r = &*(slot as *const Square);
                let escaped = black_box(r as &dyn Shape);
                let dyn_slot = heap.add(s_ptrs_off + is * core::mem::size_of::<&dyn Shape>()) as *mut &dyn Shape;
                *dyn_slot = escaped;
                is += 1;
                escaped
            }
            _ => {
                let slot = heap.add(t_storage_off + it * core::mem::size_of::<Triangle>()) as *mut Triangle;
                *slot = Triangle { b: p1, h: p2 };
                let r = &*(slot as *const Triangle);
                let escaped = black_box(r as &dyn Shape);
                let dyn_slot = heap.add(t_ptrs_off + it * core::mem::size_of::<&dyn Shape>()) as *mut &dyn Shape;
                *dyn_slot = escaped;
                it += 1;
                escaped
            }
        };
        let _ = shape_ref;  // suppress unused warning
    }

    STATE = State {
        c_storage_off, c_ptrs_off, n_c: ic,
        s_storage_off, s_ptrs_off, n_s: is,
        t_storage_off, t_ptrs_off, n_t: it,
    };
}

#[no_mangle]
pub unsafe extern "C" fn shape_dispatch_homo_dyn(_iters: u32) -> f64 {
    let mut acc: u64 = 0;
    let heap = (&raw const HEAP).cast::<u8>();
    let c_base = heap.add(STATE.c_ptrs_off) as *const &dyn Shape;
    let s_base = heap.add(STATE.s_ptrs_off) as *const &dyn Shape;
    let t_base = heap.add(STATE.t_ptrs_off) as *const &dyn Shape;
    for i in 0..STATE.n_c { acc = acc.wrapping_add(((*c_base.add(i)).score() * 1e6 + 0.5) as u64); }
    for i in 0..STATE.n_s { acc = acc.wrapping_add(((*s_base.add(i)).score() * 1e6 + 0.5) as u64); }
    for i in 0..STATE.n_t { acc = acc.wrapping_add(((*t_base.add(i)).score() * 1e6 + 0.5) as u64); }
    acc as f64
}
```

- [ ] **Step 3: Add to workspace Cargo.toml** — add `benches/shape_dispatch_homo_dyn/rust/raw`.

- [ ] **Step 4: Build + R1 ACTIVE verification + smoke**

```bash
pnpm exec tsx scripts/build-rust.ts --bench=shape_dispatch_homo_dyn
n=$(wasm-objdump -d dist/shape_dispatch_homo_dyn__rust-raw-speed/module.wasm | grep -c call_indirect)
echo "rust/raw call_indirect: $n"
[ "$n" -gt 0 ] || { echo "DEVIRT FIRED"; exit 1; }
pnpm exec tsx apps/runner-node/src/main.ts --benchmark=shape_dispatch_homo_dyn --entry=shape_dispatch_homo_dyn --language=rust --toolchain=raw --profile=speed --size=S --out=/tmp/sd-smoke --mode=quick
```

If devirt count = 0 → **STOP, R1 fired**. Surface to user.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml benches/shape_dispatch_homo_dyn/rust/raw/
git commit --no-gpg-sign -m "feat(shape_dispatch_homo_dyn): rust/raw impl (3 typed fat-pointer arrays + black_box anti-devirt)"
```

### Task 18: rust/raw binary 3 (mixed_static) — enum match

**Files:**
- Create: `benches/shape_dispatch_mixed_static/rust/raw/{Cargo.toml, src/lib.rs}`
- Modify: workspace `Cargo.toml`

- [ ] **Step 1: Create Cargo.toml** — same as Task 16, name `shape_dispatch_mixed_static_raw`.

- [ ] **Step 2: Create src/lib.rs**

```rust
#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! { loop {} }

extern "C" {
    fn sqrt(x: f64) -> f64;
    fn log(x: f64) -> f64;
}

#[repr(C)]
#[derive(Clone, Copy)]
enum Shape {
    Circle   { r: f64 },
    Square   { s: f64 },
    Triangle { b: f64, h: f64 },
}

fn area_complex(shape: &Shape) -> f64 {
    let (a, p) = match *shape {
        Shape::Circle   { r }      => (core::f64::consts::PI * r * r, 2.0 * core::f64::consts::PI * r),
        Shape::Square   { s }      => (s * s, 4.0 * s),
        Shape::Triangle { b, h }   => (0.5 * b * h, b + h + unsafe { sqrt(b * b + h * h) }),
    };
    unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
}

const HEAP_SIZE: usize = 8 * 1024 * 1024;
#[no_mangle]
static mut HEAP: [u8; HEAP_SIZE] = [0; HEAP_SIZE];

struct State { shapes_off: usize, len: usize }
static mut STATE: State = State { shapes_off: 0, len: 0 };

#[no_mangle]
pub unsafe extern "C" fn heap_ptr() -> *mut u8 { (&raw mut HEAP).cast() }

#[no_mangle]
pub unsafe extern "C" fn load_input(ptr: u32, len: u32) {
    let n = (len as usize) / 24;
    let buf = (&raw const HEAP).cast::<u8>().add(ptr as usize);
    let shapes_off = ((ptr as usize + len as usize) + 7) & !7usize;
    let shapes = (&raw mut HEAP).cast::<u8>().add(shapes_off) as *mut Shape;

    for i in 0..n {
        let off = i * 24;
        let tag = *buf.add(off);
        let p1 = core::ptr::read_unaligned(buf.add(off + 8) as *const f64);
        let p2 = core::ptr::read_unaligned(buf.add(off + 16) as *const f64);
        let shape = match tag {
            0 => Shape::Circle { r: p1 },
            1 => Shape::Square { s: p1 },
            _ => Shape::Triangle { b: p1, h: p2 },
        };
        *shapes.add(i) = shape;
    }
    STATE = State { shapes_off, len: n };
}

#[no_mangle]
pub unsafe extern "C" fn shape_dispatch_mixed_static(_iters: u32) -> f64 {
    let shapes = (&raw const HEAP).cast::<u8>().add(STATE.shapes_off) as *const Shape;
    let mut acc: u64 = 0;
    for i in 0..STATE.len {
        acc = acc.wrapping_add((area_complex(&*shapes.add(i)) * 1e6 + 0.5) as u64);
    }
    acc as f64
}
```

- [ ] **Step 3: Add to workspace Cargo.toml** — add `benches/shape_dispatch_mixed_static/rust/raw`.

- [ ] **Step 4: Build + R1 (not applicable) + smoke**

```bash
pnpm exec tsx scripts/build-rust.ts --bench=shape_dispatch_mixed_static
wasm-objdump -d dist/shape_dispatch_mixed_static__rust-raw-speed/module.wasm | grep -c call_indirect  # expect 0
pnpm exec tsx apps/runner-node/src/main.ts --benchmark=shape_dispatch_mixed_static --entry=shape_dispatch_mixed_static --language=rust --toolchain=raw --profile=speed --size=S --out=/tmp/sd-smoke --mode=quick
```

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml benches/shape_dispatch_mixed_static/rust/raw/
git commit --no-gpg-sign -m "feat(shape_dispatch_mixed_static): rust/raw impl (enum match + no_std)"
```

### Tasks 19-21: rust/bindgen для binaries 1, 2, 3

**Files:** `benches/shape_dispatch_{homo_static,homo_dyn,mixed_static}/rust/bindgen/{Cargo.toml, src/lib.rs}` + workspace updates.

### Task 19: rust/bindgen binary 1 (homo_static)

- [ ] **Steps 1-5:** Mirror Task 16 (generic process<S>) but `#[wasm_bindgen]` exports + std-based allocation via `alloc::alloc::alloc` (NOT Vec). Raw heap arrays.

### Task 20: rust/bindgen binary 2 (homo_dyn)

- [ ] **Steps 1-5:** Mirror Task 11 (raw heap fat pointer arrays + black_box) but partitioned into 3 per-type arrays. R1 active.

### Task 21: rust/bindgen binary 3 (mixed_static)

- [ ] **Steps 1-5:** Single array of enum-tagged shapes via `alloc::alloc`. `match` dispatch. R1 not active.

### Tasks 22-23: js/idiomatic для binaries 2 (already in Task 12... actually need 3 + 4)

Wait — task numbering off. Task 12 already covers binary 4 JS. Re-number: **Task 22** = js/idiomatic binary 2, **Task 23** = js/idiomatic binary 3.

### Task 22: js/idiomatic binary 2 (homo_dyn)

- [ ] **Steps 1-5:** Per spec § JS implementation specifics / Binary 2. 3 classes + 3 typed arrays + 3 separate per-type loops (monomorphic IC each).

### Task 23: js/idiomatic binary 3 (mixed_static)

- [ ] **Steps 1-5:** Per spec § JS implementation specifics / Binary 3. Single `TaggedShape` class + `const enum ShapeKind` + switch(kind). Factory-time dispatch (no closure-const switch in hot loop — V8 deopt class hazard, see guidelines).

### Task 24: Wave 2 close — full build:all + lint gates + devirt verification + eval-mode validation

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `pnpm build:all`
Expected: 38 artifacts in `dist/` (32 native + 6 JS). Verify count:
```bash
find dist/shape_dispatch_* -name '*.wasm' -o -name '*.mjs' | wc -l
```

- [ ] **Step 2: Lint gate — no Vec/std::vector в shape_dispatch path**

Run:
```bash
grep -rE 'Vec<|std::vector|alloc::vec' benches/shape_dispatch_*/ || echo "PASS: no Vec/vector usage"
```
Expected: prints "PASS"; if any hits → **STOP**, refactor offending files.

- [ ] **Step 3: Devirt verification (R1) for binaries 2 + 4**

Run:
```bash
fail=0
for f in dist/shape_dispatch_homo_dyn__*-speed/*.wasm \
         dist/shape_dispatch_mixed_dyn__*-speed/*.wasm; do
    [ -f "$f" ] || continue
    n=$(wasm-objdump -d "$f" 2>/dev/null | grep -c call_indirect)
    if [ "$n" -le 0 ]; then
        echo "DEVIRT FIRED: $f"
        fail=1
    else
        echo "OK ($n call_indirect): $f"
    fi
done
exit $fail
```
Expected: all `*_dyn` artifacts show `call_indirect > 0`. If any failures → **STOP, R1 fired**. Surface to user with R1 mitigation alternatives.

- [ ] **Step 4: Eval-mode validation gate (per CLAUDE.md Wave 2 close protocol)**

Run minimum 1 case per binary в eval mode на Node:
```bash
for bin in shape_dispatch_homo_static shape_dispatch_homo_dyn shape_dispatch_mixed_static shape_dispatch_mixed_dyn; do
    [ "$bin" = "shape_dispatch_homo_static" ] && lang=rust && tc=bindgen || lang=js && tc=idiomatic
    # Pick: homo_static has no JS; others use js/idiomatic.
    pnpm exec tsx apps/runner-node/src/main.ts \
        --benchmark="$bin" --entry="$bin" \
        --language="$lang" --toolchain="$tc" --profile=speed --size=S \
        --out="/tmp/sd-eval/$bin" --mode=eval
done
```
Expected: each exit 0, `validated: true`. Особенно binary 3 — factory-time dispatch verified (no V8 IC deopt).

- [ ] **Step 5: Smoke test full coverage**

Run: `pnpm smoke`
Expected: existing smoke cases pass + 4 new shape_dispatch S-size cases × all combos × Node + S × chromium/firefox (if smoke auto-discovers via `glob("benches/*/spec.json")`).

- [ ] **Step 6: Commit (if any wave 2 close fixes)**

If steps 1-5 surfaced no fixes needed — no commit. Otherwise commit summary.

---

## Wave 3 — Bench full matrix

### Task 25: Full bench:all run

**Files:**
- Generated: `results/raw/<run-id>/*.json` (gitignored)

- [ ] **Step 1: Clean prior tmp dirs (pre-bench housekeeping)**

Check `/tmp/` для leaked Chromium temp dirs (Phase 1.1.2.1 precedent showed 3GB / 736 dirs leak). Optional cleanup:
```bash
ls /tmp/ | grep -c "rust_mozprofile\|.com.google.Chrome\|playwright" || echo "clean"
# If significant: rm -rf /tmp/rust_mozprofile.* /tmp/.com.google.Chrome.* (or равиваленты)
```

- [ ] **Step 2: Run full bench matrix in background**

Run with `dangerouslyDisableSandbox: true` + `run_in_background: true`:

```bash
pnpm bench:all --envs=node,chromium,firefox --sizes=S,M,L --mode=eval --out=results/raw/2026-XX-XX-phase-1-1-3
```
Expected: ~60-90 минут wall-time. **Не sleep/poll** — wait for background-completion notification. Total ~972 cases (630 existing + 342 new shape_dispatch).

- [ ] **Step 3: Verify 0 failures**

After completion:
```bash
test -f results/raw/2026-XX-XX-phase-1-1-3/failures.txt && cat results/raw/2026-XX-XX-phase-1-1-3/failures.txt || echo "clean: 0 failures"
ls results/raw/2026-XX-XX-phase-1-1-3/*.json | wc -l
```
Expected: 972 (or close) result JSONs; `failures.txt` does not exist (or is empty).

- [ ] **Step 4: Rename run dir to canonical**

```bash
mv results/raw/2026-XX-XX-phase-1-1-3 results/raw/$(date +%Y-%m-%d)-phase-1-1-3
```

### Task 26: Reporter sanity + sanity-diff vs Phase 1.1.2.1 baseline

**Files:**
- Generated: `results/summarized/<timestamp>/index.html`

- [ ] **Step 1: Generate HTML report**

```bash
pnpm report --in=results/raw/$(date +%Y-%m-%d)-phase-1-1-3
```
Expected: prints `results/summarized/<timestamp>/index.html`. Open + smoke-eye.

- [ ] **Step 2: Sanity-diff vs Phase 1.1.2.1 baseline**

If `results/raw/2026-05-26-phase-1-1-2-1/` exists locally — compare matmul / interop_calls / hashmap_* warm-median per case. >5% diff на existing workloads → potential regression from Wave 1/2 refactors; investigate before proceeding.

If baseline not available locally — primary success signal: 0 failures + reporter rendered.

- [ ] **Step 3: Commit (no code changes, just announce data)**

No git changes. Note results path in subsequent commits' messages.

---

## Wave 4 — Reporter v2 final layout

### Task 27: Explore existing reporter structure

**Files:**
- Read: `packages/reporter/src/*`

- [ ] **Step 1: Map reporter file structure**

Run: `find packages/reporter -type f -name '*.ts' | xargs wc -l | sort -n`
Read top 3 files to understand template + aggregation logic.

- [ ] **Step 2: Identify cross-workload page generator**

Locate the function that produces the cross-workload comparison page. Note: file:line where it's called from + format of input data structure (likely array of `BenchResult`).

- [ ] **Step 3: Catalog current grouping mechanism**

Document какие columns / rows currently support what grouping. Output: notes-only (или commit notes к docs/ if extensive).

### Task 28: Prototype 2×2 layout с mock data — R6 verification

**Files:**
- Create (throwaway): `packages/reporter/src/proto-2x2.ts`

- [ ] **Step 1: Create prototype script**

Take 4 mock shape_dispatch results (1 per binary), feed to a small modification of cross-workload generator that adds 2×2 sub-view. Goal: prove or disprove feasibility.

- [ ] **Step 2: Render prototype HTML**

Open в браузере. Visually verify 2×2 grid renders + readable.

- [ ] **Step 3: Surface to user**

Report findings:
- Feasibility: YES/NO with reasoning.
- If YES: estimated effort to integrate (lines changed, complexity).
- If NO: present R6 mitigation alternatives (flat 4-row / CSS-only nesting / defer к Phase 1.2). Wait for user decision.

**Не proceed к Task 29 без user approval direction.**

### Task 29: Implement final 2×2 layout (per Task 28 user direction)

**Files:** TBD per Task 28 outcome.

- [ ] **Step 1-N: per user-approved approach**

Specific steps depend on direction. Each step должен show actual code change. After Task 28 prototype + user decision, this task's steps populate inline.

### Task 30: Reporter end-to-end render check

**Files:** none (verification)

- [ ] **Step 1: Run full report on Wave 3 results**

```bash
pnpm report --in=results/raw/$(date +%Y-%m-%d)-phase-1-1-3
```
Expected: HTML renders без errors; 4 categories visible; shape_dispatch row(s) show 2×2 sub-view per (toolchain, profile).

- [ ] **Step 2: Visual smoke check**

Open + scroll: all 4 workload categories present? shape_dispatch 2×2 view visible? Existing 3 categories unchanged?

- [ ] **Step 3: Commit reporter changes**

```bash
git add packages/reporter/
git commit --no-gpg-sign -m "feat(reporter): v2 final layout — 4 categories + shape_dispatch 2×2 sub-view"
```

---

## Wave 5 — Guidelines harvest

### Task 31: Systematic review всех Phase 1.1 results

**Files:**
- Modify: `docs/guidelines.md`

- [ ] **Step 1: Compile evidence per target category**

Manual review of `results/raw/<run>/*.json` + reporter HTML. Categories для shape_dispatch:

1. **Dispatch overhead:**
   - Compare `shape_dispatch_homo_static` vs `shape_dispatch_homo_dyn` warm-median per (toolchain, profile, size).
   - Compare `shape_dispatch_mixed_static` vs `shape_dispatch_mixed_dyn` same.
   - If consistent direction (static < dynamic) across 4 native toolchains × 2-3 sizes → **confirmed candidate**.

2. **Monomorphization bundle premium:**
   - Compare `shape_dispatch_homo_static` artifact sizes (raw/gzip/brotli) vs `shape_dispatch_mixed_static` per (toolchain, profile).
   - Static homogeneous expected larger (3× instantiation). If consistent across 4 toolchains × 2 profiles → **confirmed candidate**.

3. **V8 IC state cost (JS):**
   - Compare `shape_dispatch_mixed_static` (monomorphic on TaggedShape) vs `shape_dispatch_mixed_dyn` (polymorphic-3) in JS warm-median.
   - Single workload, single toolchain → **tentative**.

4. **Box-allocated mixed array cache pattern:**
   - Compare `shape_dispatch_mixed_static` (inline) vs `shape_dispatch_mixed_dyn` (heap pointers) at L size (LLC pressure visible).
   - Confounded с dispatch → caveats-heavy **tentative**.

- [ ] **Step 2: Draft claim subsections per spec § Guidelines artifact format**

For each confirmed candidate, write subsection in `docs/guidelines.md` under appropriate bucket (`Toolchain choice` для dispatch; new `Code patterns` claim для monomorphization OR existing bucket). Format per CLAUDE.md § Guidelines artifact:

```markdown
### <Imperative claim — одна строка>
**Status:** confirmed | tentative
**Evidence:** `results/raw/<date>-phase-1-1-3/...` + specific case file paths.

| toolchain | profile | size | static (binary 1 or 3) | dynamic (binary 2 or 4) | Δ |
|---|---|---|---|---|---|
...

**Phase:** introduced 1.1.3
**Caveats:** <when not to apply>

Mechanism: <wasm-objdump or codegen evidence>
```

- [ ] **Step 3: Refine existing claims если cross-confirms**

Phase 1.1.2.1 claims (bindgen overhead, V8 hashmap, Firefox hashmap inversion, thread_local→SyncCell) — check if shape_dispatch data refines any. E.g., if shape_dispatch bindgen overhead consistent с interop_calls → update bindgen claim phase tag `introduced 1.1.1 / refined 1.1.2.1, 1.1.3`.

- [ ] **Step 4: Commit guidelines updates**

```bash
git add docs/guidelines.md
git commit --no-gpg-sign -m "docs(guidelines): Phase 1.1.3 dispatch + monomorphization + IC-state claims"
```

---

## Wave 6 — Phase 1.1.3 + Phase 1.1 close

### Task 32: Roadmap cleanup

**Files:**
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Remove shape-dispatch entry from § Phase 1.1**

Current entry:
```markdown
### Workloads
- **shape-dispatch** — static (templates/generics, monomorphization) vs dynamic ...
```
Remove (workload closed).

- [ ] **Step 2: Check if § Phase 1.1 bucket empty**

If empty → remove the `## Phase 1.1` heading entirely (or replace с note "Closed 2026-XX-XX, see specs/2026-05-20-phase-1-1-design.md history").

- [ ] **Step 3: Commit**

```bash
git add docs/roadmap.md
git commit --no-gpg-sign -m "docs(roadmap): retire shape-dispatch — Phase 1.1 workloads closed"
```

### Task 33: /backlog-review sanity-pass

**Files:** none (skill-invoked review)

- [ ] **Step 1: Invoke skill**

Use Skill tool: `backlog-review`. Skill walks через roadmap.md + tech_debt — flags format violations, orphan candidates, items с stale rationale.

- [ ] **Step 2: Address surfaced issues (если any)**

Per skill batched output: accept / defer / remove / move-to-wontdo per user direction.

- [ ] **Step 3: Commit any roadmap/tech-debt cleanup**

If skill triggered edits: separate commit per atomic change.

### Task 34: Capture pitfalls (if any surfaced during execution)

**Files:**
- Create (optional): `docs/pitfalls/2026-XX-XX-phase-1-1-3-execution.md`

- [ ] **Step 1: Inventory friction signals from execution**

Review session: were there planning gaps? Tool failures? Plan deviations? User corrections of AI proposals? Any «I should have known this» moments?

- [ ] **Step 2: If meaningful pitfalls exist — write pitfalls doc**

Format per `docs/pitfalls/README.md`. Sections: Planning gaps / Process / Implementation / Tooling.

- [ ] **Step 3: Commit**

```bash
git add docs/pitfalls/2026-XX-XX-phase-1-1-3-execution.md
git commit --no-gpg-sign -m "docs(pitfalls): Phase 1.1.3 execution lessons"
```

If no meaningful pitfalls — skip task. Trivial pitfalls (typo, single eslint warning) НЕ повод писать doc.

### Task 35: Tag phase-1-1-3 + verify final gates

**Files:** none (tag + gate verify only)

- [ ] **Step 1: Final gate verification**

```bash
pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test 2>&1 | tee /tmp/final.log; rc=${PIPESTATUS[0]}; echo "exit=$rc"
pnpm smoke
```
Expected: both exit 0.

- [ ] **Step 2: Place tag**

```bash
git tag -a phase-1-1-3 -m "Phase 1.1.3 shape_dispatch closed + Phase 1.1 closed"
git tag | grep phase-1-1-3
```

- [ ] **Step 3: Optional umbrella tag phase-1-1**

If this is last sub-phase в Phase 1.1 (no remaining sub-phases) — add umbrella:
```bash
git tag -a phase-1-1 -m "Phase 1.1 closed — 4 workloads + reporter v2 + 3+ guidelines claims"
```

- [ ] **Step 4: Verify final exit criteria**

Manually walk through spec § Phase 1.1.3 / Phase 1.1 exit criteria checklist:
- [ ] 38 new artifacts в `dist/`.
- [ ] 342 new shape_dispatch cases × 0 failures.
- [ ] Reporter v2 final layout finalized с 4 categories + 2×2 dispatch sub-view (или approved fallback per R6).
- [ ] Guidelines: ≥3 total claims, ≥1 from shape_dispatch.
- [ ] `docs/tech_debt/` без Phase 1.1-targeted items.
- [ ] Master gates green.
- [ ] Tag `phase-1-1-3` placed.

Если any unchecked → STOP, surface to user.

### Task 36: Phase close hand-off (do NOT auto-invoke /finish-session)

**Files:** none

- [ ] **Step 1: Compose hand-off message**

Message к user:

```
Phase 1.1.3 exit criteria met:
- 38 new artifacts built (32 native + 6 JS).
- 342 shape_dispatch cases run, 0 failures.
- Reporter v2 final layout finalized.
- Guidelines: <N> total claims, <M> new from shape_dispatch.
- Tag phase-1-1-3 placed; (umbrella tag phase-1-1 placed if applicable).
- Master gates green.

Что-то ещё в этой сессии? Иначе можно `/finish-session` для memory + session-state snapshot.
```

**НЕ auto-invoke `/finish-session`** — wait for explicit user decision (per memory `feedback-no-auto-finish-session`). User может ask for follow-up work.

- [ ] **Step 2: Wait for user response**

If user says «proceed» or «finish-session» → invoke skill `finish-session`. Иначе continue с user's request.

---

## Final exit criteria (= Phase 1.1.3 / Phase 1.1 done)

- [ ] 38 new artifacts в `dist/` (32 native + 6 JS).
- [ ] 342 new shape_dispatch measurement cases × 0 failures.
- [ ] Reporter v2 final layout finalized с 4 categories + 2×2 dispatch sub-view (или approved R6 fallback).
- [ ] `docs/guidelines.md`: ≥3 total claims, ≥1 NEW from shape_dispatch.
- [ ] `docs/tech_debt/` без Phase 1.1-targeted items.
- [ ] Master gates green (build:all + typecheck + lint:all + test + smoke).
- [ ] Tag `phase-1-1-3` placed; optional umbrella `phase-1-1`.
- [ ] User signed off на hand-off message (Task 36).
