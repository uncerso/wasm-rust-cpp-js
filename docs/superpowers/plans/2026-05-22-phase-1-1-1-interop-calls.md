# Phase 1.1.1 — interop_calls + Multi-Entry Infra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ввести второй workload (`interop_calls`) с тремя benchmark IDs внутри одного binary и переключить инфру с hardcoded-single-bench на multi-entry-point + auto-discovery.

**Architecture:** Spec.json получает поле `entries: string[]` и top-level `expectedChecksums: { entry: { S, M, L } }`. Wasm export name ≡ entry id напрямую (matmul переименовывается с `run` на `matmul`; interop_calls экспортирует `interop_calls_noop / interop_calls_add_i32 / interop_calls_add_f64` + counter reader для noop). Loaders получают `entry?: string` в `LoaderInput` и биндят `BenchModule.run` к нужному export'у. `scripts/lib/matrix.ts` enumerates **binaries** (build unit) и отдельно **run cases** (binary × entry); `build-all.ts` discoверит benches через `glob("benches/*/spec.json")`. interop_calls — fixture-less (0 байт, `loadInput` = reset state); inner loop по `iters` в **JS-side**, каждая итерация делает один JS→wasm call (это и есть измеряемая стоимость interop).

**Tech Stack:** pnpm + cargo workspace; TypeScript (ESM, vitest, zod); Rust 1.95 (wasm32, wasm-pack, wasm-bindgen); C++ (emcc, wasi-sdk clang); existing tooling (`wasm-opt`, `tsx`).

---

## File Structure

**Create:**
- `docs/superpowers/plans/2026-05-22-phase-1-1-1-interop-calls.md` (this plan)
- `benches/interop_calls/spec.json`
- `benches/interop_calls/fixtures/generate.ts` (empty-fixture generator)
- `benches/interop_calls/fixtures/.gitignore` (`*.bin`)
- `benches/interop_calls/validate/reference.ts` (JS reference: computes expected checksums per (entry,size))
- `benches/interop_calls/js/idiomatic/{package.json,tsconfig.json,src/index.ts}`
- `benches/interop_calls/js/typed-array/{package.json,tsconfig.json,src/index.ts}`
- `benches/interop_calls/rust/raw/{Cargo.toml,src/lib.rs}`
- `benches/interop_calls/rust/bindgen/{Cargo.toml,src/lib.rs}`
- `benches/interop_calls/cpp/src/{interop_calls.h,interop_calls.cpp}`
- `scripts/fixtures.ts` (standalone fixtures runner)

**Modify:**
- `packages/result-schema/src/schema.ts` — add `SpecSchema` (spec.json input has its own `version: 2`; `BenchResult.schemaVersion` unchanged)
- `packages/result-schema/tests/schema.test.ts` — coverage for `SpecSchema`
- `packages/loaders/src/{plain-js,raw-wasm,rust-bindgen,emscripten}.ts` — `entry?: string` in `LoaderInput`, per-entry export binding
- `packages/loaders/tests/{plain-js,raw-wasm}.test.ts` — multi-entry mock cases
- `packages/loaders/tests/fixtures/<new fixtures>` — mock multi-entry binaries
- `scripts/lib/matrix.ts` — split `Binary[]` (build unit) and `enumerateRunCases(spec)` (binary × entry); drop hardcoded `ALL_COMBINATIONS`
- `scripts/build-all.ts` — discover benches via glob; loop per bench
- `scripts/build-{js,rust,cpp}.ts` — parametrize by bench id; iterate over its supported toolchains
- `scripts/run-matrix.ts` — iterate over `enumerateRunCases(loadSpec(bench))` per bench
- `apps/runner-node/src/{main.ts,run-case.ts}` — `--entry` flag; new spec layout; result filename by entry
- `apps/runner-web/src/{driver.ts,worker.ts}` — `--entry` flag; result filename by entry
- `benches/matmul/spec.json` — migrate to v2 schema (`entries: ["matmul"]`, top-level `expectedChecksums`, drop nested `expectedChecksum`)
- `benches/matmul/rust/raw/src/lib.rs` — rename `run` export → `matmul`
- `benches/matmul/rust/bindgen/src/lib.rs` — rename `run` → `matmul`
- `benches/matmul/cpp/src/{matmul.h,matmul.cpp}` — rename `run` → `matmul`
- `benches/matmul/js/{idiomatic,typed-array}/src/index.ts` — factory takes `(entry: string)`; dispatch on entry
- `Cargo.toml` — add `interop_calls` crates to workspace
- `package.json` (root) — add `"fixtures": "tsx scripts/fixtures.ts"` script
- `docs/guidelines.md` — append ≥1 tentative claim from interop_calls findings
- `README.md` — update if spec-driven examples shown

---

## Conventions used in this plan

- **Commit policy:** `--no-gpg-sign`, one logical change per commit, conventional-style messages.
- **`pnpm` always requires `dangerouslyDisableSandbox: true`** per pitfall #4. Steps don't repeat this each time.
- **Use `$TMPDIR`, not `/tmp`** per pitfall #5.
- **After each task** — run scoped gates (`pnpm --filter <pkg> test`, `pnpm typecheck`, `pnpm lint:ts`) before commit. Final task closes Wave 3 with full `pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke`.
- **All wasm exports use entry id verbatim** (no `run` legacy). Matmul becomes a single-entry binary with export `matmul`.
- **Plain-JS factory signature uniform:** `default: (entry: string) => BenchModule`. Matmul factory accepts and ignores; interop_calls factory dispatches.
- **Spec-driven matmul checksums migrate to top-level map** but values stay the same. Re-bench is NOT required (no code-path change for matmul math; symbol rename is byte-level).

---

## Wave 0 — Baseline check

### Task 0: Verify master green

**Files:** none (read-only)

- [ ] **Step 1: Run all gates**

```bash
pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke
```

Expected: all four exit 0.

If any gate fails, STOP execution and surface to user per pitfall #1.

- [ ] **Step 2: Capture pre-plan size baseline for matmul (M-size)**

```bash
ls -la dist/matmul/*-speed/module.wasm dist/matmul/*-speed/module.js 2>/dev/null || pnpm build:all
ls -la dist/matmul/*/module.wasm dist/matmul/*/module.js 2>/dev/null
```

Record raw bytes per artifact in a scratch note. We will compare against post-rename matmul sizes in Wave 1 Task 2 verification (export-name change only — expect ±a few bytes).

No commit (read-only step).

---

## Wave 1 — Scaffolding

### Task 1: SpecSchema for spec.json (v2)

**Files:**
- Modify: `packages/result-schema/src/schema.ts` (add `SpecSchema`)
- Modify: `packages/result-schema/tests/schema.test.ts` (parse/reject coverage)

> **Note:** `BenchResult.schemaVersion` is NOT bumped. The on-the-wire result format is unchanged; only `benchmark.id` semantics shift (was binary id, now entry id) and that's a meaning change, not a field change. The new `SpecSchema` has its own `version: 2` field (independent of `BenchResult.schemaVersion`).

- [ ] **Step 1: Add `SpecSchema` to `packages/result-schema/src/schema.ts`**

Append at end of file (after existing `BenchResult` definition; before/after the `type` re-exports — match local file conventions):

```typescript
// ─── spec.json (per-bench input) ─────────────────────────────────────────

export const SpecInputSizeSchema = z
    .object({
        fixtureBytes: z.number().int().nonnegative(),
        fixtureSha256: z.string().length(64),
    })
    .passthrough(); // workload-specific params (n, innerIterations, ...) allowed

export const SpecSchema = z.object({
    id: z.string().min(1),
    version: z.literal(2),
    description: z.string().optional(),
    entries: z.array(z.string().min(1)).min(1),
    inputSizes: z.record(InputSizeSchema, SpecInputSizeSchema),
    expectedChecksums: z.record(
        z.string(),
        z.record(InputSizeSchema, z.union([z.string(), z.number()])),
    ),
    supported: z
        .object({
            languages: z.array(LanguageSchema),
            toolchains: z.record(z.string(), z.array(ToolchainSchema)),
            profiles: z.array(ProfileSchema),
        })
        .optional(),
    ioContract: z.record(z.string(), z.string()).optional(),
});

export type Spec = z.infer<typeof SpecSchema>;
export type SpecInputSize = z.infer<typeof SpecInputSizeSchema>;
```

- [ ] **Step 2: Write failing tests**

Edit `packages/result-schema/tests/schema.test.ts` — append:

```typescript
import { SpecSchema } from "../src/schema.js";

describe("SpecSchema", () => {
    const validSpec = {
        id: "demo",
        version: 2,
        entries: ["demo"],
        inputSizes: {
            S: { fixtureBytes: 0, fixtureSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", innerIterations: 100 },
        },
        expectedChecksums: { demo: { S: 42 } },
    };

    it("accepts a minimal multi-entry spec", () => {
        const parsed = SpecSchema.parse({
            ...validSpec,
            entries: ["a", "b"],
            expectedChecksums: { a: { S: 1 }, b: { S: 2 } },
        });
        expect(parsed.entries).toEqual(["a", "b"]);
    });

    it("accepts workload-specific size params via passthrough", () => {
        const parsed = SpecSchema.parse({
            ...validSpec,
            inputSizes: {
                S: { fixtureBytes: 65536, fixtureSha256: "a".repeat(64), n: 64 },
            },
        });
        expect((parsed.inputSizes.S as { n: number }).n).toBe(64);
    });

    it("rejects empty entries", () => {
        expect(() => SpecSchema.parse({ ...validSpec, entries: [] })).toThrow();
    });

    it("rejects bad fixtureSha256 length", () => {
        expect(() =>
            SpecSchema.parse({
                ...validSpec,
                inputSizes: { S: { fixtureBytes: 0, fixtureSha256: "abc" } },
            }),
        ).toThrow();
    });

    it("rejects wrong version", () => {
        expect(() => SpecSchema.parse({ ...validSpec, version: 1 })).toThrow();
    });
});
```

- [ ] **Step 3: Run tests — verify they pass**

```bash
pnpm --filter @bench/result-schema test
```

Expected: 5 new tests pass; rerun if iterating.

- [ ] **Step 4: Typecheck full repo**

```bash
pnpm typecheck
```

Expected: pass. No downstream callers reference `SpecSchema` yet (it's a new export).

- [ ] **Step 5: Commit**

```bash
git add packages/result-schema/src/schema.ts packages/result-schema/tests/schema.test.ts
git commit --no-gpg-sign -m "feat(result-schema): add SpecSchema (v2 spec.json layout with entries + expectedChecksums)"
```

---

### Task 2: Migrate `benches/matmul/spec.json` to v2

**Files:**
- Modify: `benches/matmul/spec.json`

- [ ] **Step 1: Rewrite spec.json**

Replace file contents with:

```json
{
    "id": "matmul",
    "version": 2,
    "description": "Naive O(n^3) dense matrix multiplication on f64. Both inputs and output live in pre-allocated wasm linear memory; modules read A, B from offsets and write C. No allocations on the hot path.",
    "entries": ["matmul"],
    "inputSizes": {
        "S": {
            "n": 64,
            "fixtureBytes": 65536,
            "fixtureSha256": "a2c4b66989d6b157b19a6fb23ab883afba487c45880e4c1b149aab9ee9c2803e"
        },
        "M": {
            "n": 256,
            "fixtureBytes": 1048576,
            "fixtureSha256": "9808581790a2389ab4263529ac50bbce6c1fc611b26ba11daf61a6a4d1471b94"
        },
        "L": {
            "n": 1024,
            "fixtureBytes": 16777216,
            "fixtureSha256": "0a4225e5c197d063691e184f9888feaf4b2f88b00b6bab237436ffdacc3e77e5"
        }
    },
    "expectedChecksums": {
        "matmul": {
            "S": 8505.752465030815,
            "M": 275996.81878375803,
            "L": 8921353.464110956
        }
    },
    "supported": {
        "languages": ["js", "rust", "cpp"],
        "toolchains": {
            "js": ["idiomatic", "typed-array"],
            "rust": ["raw", "bindgen"],
            "cpp": ["emscripten", "wasi-sdk"]
        },
        "profiles": ["speed", "size"]
    },
    "ioContract": {
        "fixtureLayout": "Two square f64 matrices A and B, row-major, concatenated. Total bytes = 2 * n * n * 8.",
        "outputLayout": "One square f64 matrix C, row-major. Bytes = n * n * 8."
    }
}
```

- [ ] **Step 2: Parse-verify with schema (smoke check, not committed)**

```bash
pnpm exec tsx -e 'import("./packages/result-schema/dist/index.js").then(({SpecSchema}) => { const s = JSON.parse(require("fs").readFileSync("benches/matmul/spec.json","utf8")); console.log(SpecSchema.parse(s).id); });' 2>&1 | tail -5
```

If that fails because dist not built, use the source via tsx:

```bash
pnpm exec tsx -e 'import { SpecSchema } from "./packages/result-schema/src/schema.js"; import { readFileSync } from "node:fs"; const s = JSON.parse(readFileSync("benches/matmul/spec.json","utf8")); console.log(SpecSchema.parse(s).id);'
```

Expected output: `matmul`. (If tsx ESM resolution gives trouble, skip this verification — Task 11 typecheck and Task 21 smoke will catch any malformed spec.)

- [ ] **Step 3: Commit**

```bash
git add benches/matmul/spec.json
git commit --no-gpg-sign -m "refactor(matmul/spec): migrate to v2 schema (entries + expectedChecksums)"
```

---

### Task 3: `LoaderInput.entry?` field and shared types

**Files:**
- Modify: `packages/loaders/src/index.ts` (or wherever `LoaderInput` lives — verify)
- Modify: each loader to accept `entry` (no behavior change yet; just plumb)

- [ ] **Step 1: Locate `LoaderInput`**

```bash
grep -rn "interface LoaderInput\|type LoaderInput\|export.*Loader" packages/loaders/src/
```

Expected: `LoaderInput` lives in `packages/loaders/src/index.ts` (or a shared types file). Read it.

- [ ] **Step 2: Add `entry` to `LoaderInput`**

Edit the file declaring `LoaderInput`:

```typescript
export interface LoaderInput {
    artifactUrl: string;
    glueUrl?: string;
    entry: string; // benchmark entry id (e.g. "matmul" or "interop_calls_noop")
}
```

`entry` is **required**, not optional — callers always know which entry they're running. Each loader uses it to bind `BenchModule.run` to the right export. For single-entry binaries (matmul), entry == binary.id.

- [ ] **Step 3: Stub each loader to accept the new field (no behavior change yet)**

In each of `plain-js.ts`, `raw-wasm.ts`, `rust-bindgen.ts`, `emscripten.ts`, the `load(input: LoaderInput)` method now receives `input.entry`. Plumb to a local variable but don't dispatch yet:

```typescript
async load(input: LoaderInput): Promise<LoadedModule> {
    const { artifactUrl, entry } = input;
    void entry; // wired in Tasks 4-7
    // ... existing implementation ...
}
```

This compiles cleanly and preserves all existing matmul behavior because each loader still uses hardcoded export name (e.g. `exports.run`).

- [ ] **Step 4: Typecheck and run all loader tests**

```bash
pnpm --filter @bench/loaders typecheck
pnpm --filter @bench/loaders test
```

Expected: typecheck PASS; tests PASS (no behavioral change yet — `entry` is unused). If existing test fixtures don't pass `entry`, update them to pass `entry: "matmul"` (or whatever id the fixture represents).

- [ ] **Step 5: Update `apps/runner-node/src/run-case.ts` to pass `entry`**

Find the `loaderInput` construction (around line 79-98). Add `entry: input.benchmarkId` to all three IIFE return paths AND the final `return { artifactUrl: join(distRoot, "module.wasm") };`. Use `input.benchmarkId` as the temporary entry value (entry flag added in Task 11).

- [ ] **Step 6: Update `apps/runner-web/src/driver.ts` (and worker if it constructs `LoaderInput`)**

Similarly pass `entry: <benchmarkId>` from current call-sites. Inspect `apps/runner-web/src/{driver,worker}.ts` for `loader.load(...)` or `LoaderInput`-shaped object literals; add `entry` field equal to whatever benchmarkId is in scope.

- [ ] **Step 7: Run typecheck + smoke**

```bash
pnpm typecheck
pnpm smoke
```

Expected: typecheck PASS, smoke PASS (matmul still works unchanged — `entry` is ignored by loaders for now).

- [ ] **Step 8: Commit**

```bash
git add packages/loaders apps/runner-node/src/run-case.ts apps/runner-web/src/driver.ts apps/runner-web/src/worker.ts
git commit --no-gpg-sign -m "feat(loaders): add LoaderInput.entry field (plumbed but not yet used)"
```

---

### Task 4: plain-js loader — entry-aware factory

**Files:**
- Modify: `packages/loaders/src/plain-js.ts`
- Modify: `packages/loaders/tests/plain-js.test.ts`
- Create: `packages/loaders/tests/fixtures/multi-entry-bench/module.js`

- [ ] **Step 1: Write failing multi-entry mock test**

Create `packages/loaders/tests/fixtures/multi-entry-bench/module.js`:

```javascript
export default function create(entry) {
    if (entry === "alpha") {
        return {
            loadInput(_) {},
            run(iters) { return { checksum: iters * 2 }; },
        };
    }
    if (entry === "beta") {
        return {
            loadInput(_) {},
            run(iters) { return { checksum: iters * 3 }; },
        };
    }
    throw new Error(`unknown entry: ${entry}`);
}
```

Append to `packages/loaders/tests/plain-js.test.ts`:

```typescript
it("plain-js loader binds run to the requested entry", async () => {
    const moduleUrl = pathToFileURL(
        resolve(__dirname, "fixtures/multi-entry-bench/module.js"),
    ).href;
    const alpha = await plainJsLoader.load({ artifactUrl: moduleUrl, entry: "alpha" });
    const beta = await plainJsLoader.load({ artifactUrl: moduleUrl, entry: "beta" });
    expect(alpha.module.run(10).checksum).toBe(20);
    expect(beta.module.run(10).checksum).toBe(30);
});
```

(Imports `pathToFileURL`, `resolve`, `__dirname` — match existing test file conventions.)

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm --filter @bench/loaders test plain-js
```

Expected: FAIL — current loader calls `factory.default()` with no args.

- [ ] **Step 3: Update plain-js loader to pass entry to factory**

In `packages/loaders/src/plain-js.ts`, change the factory call:

```typescript
// Was: const inst = (mod.default as () => BenchModule)();
const factory = mod.default as (entry: string) => BenchModule;
const inst = factory(entry);
```

- [ ] **Step 4: Update matmul JS modules to accept entry**

Edit `benches/matmul/js/idiomatic/src/index.ts`:

```typescript
export default function create(entry: string): BenchModule {
    if (entry !== "matmul") {
        throw new Error(`matmul/js-idiomatic: unknown entry "${entry}"`);
    }
    // ... existing module body unchanged ...
}
```

Same for `benches/matmul/js/typed-array/src/index.ts`.

- [ ] **Step 5: Run loader tests + smoke**

```bash
pnpm --filter @bench/loaders test
pnpm smoke
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/loaders/src/plain-js.ts packages/loaders/tests/plain-js.test.ts packages/loaders/tests/fixtures/multi-entry-bench benches/matmul/js
git commit --no-gpg-sign -m "feat(loaders/plain-js): bind BenchModule to entry via factory(entry)"
```

---

### Task 5: raw-wasm loader — per-entry run binding + counter reader

**Files:**
- Modify: `packages/loaders/src/raw-wasm.ts`
- Modify: `packages/loaders/tests/raw-wasm.test.ts`
- Create: mock multi-entry wasm fixture in `packages/loaders/tests/fixtures/multi-entry-raw/module.wasm` (built from a `.wat`)

- [ ] **Step 1: Design mock multi-entry wasm fixture**

Create `packages/loaders/tests/fixtures/multi-entry-raw/module.wat`:

```wat
(module
  (memory (export "memory") 1)
  (global $counter (mut i32) (i32.const 0))
  (func $alpha (param $iters i32) (result i32)
    (local $i i32)
    (loop
      (global.set $counter (i32.add (global.get $counter) (i32.const 1)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if 0 (i32.lt_u (local.get $i) (local.get $iters))))
    (global.get $counter))
  (func $beta (param $iters i32) (result i32)
    (i32.mul (local.get $iters) (i32.const 7)))
  (func $alpha_counter (result i32) (global.get $counter))
  (func $alloc (param $sz i32) (result i32) (i32.const 0))
  (func $load_input (param $ptr i32) (param $len i32))
  (export "alpha" (func $alpha))
  (export "beta" (func $beta))
  (export "alpha_counter" (func $alpha_counter))
  (export "alloc" (func $alloc))
  (export "load_input" (func $load_input)))
```

Build to wasm:

```bash
pnpm exec wabt-wat2wasm packages/loaders/tests/fixtures/multi-entry-raw/module.wat -o packages/loaders/tests/fixtures/multi-entry-raw/module.wasm
```

If `wabt-wat2wasm` (or `wat2wasm` from wabt) isn't available locally, fall back to committing a hand-assembled wasm or use `binaryen` via `wasm-opt`. Inspect `.tools/` for an available wat→wasm binary. If none exists, switch strategy: use the existing matmul fixture and just exercise `entry` plumbing via a custom export-name override exposed by the new loader API (lower-value test). Pick the approach that works with current toolset.

- [ ] **Step 2: Write failing test**

Append to `packages/loaders/tests/raw-wasm.test.ts`:

```typescript
it("raw-wasm loader binds run to the entry's wasm export", async () => {
    const fixturePath = resolve(__dirname, "fixtures/multi-entry-raw/module.wasm");
    const alpha = await rawWasmLoader.load({ artifactUrl: fixturePath, entry: "alpha" });
    alpha.module.loadInput(new Uint8Array(0));
    const result = alpha.module.run(5);
    expect(result.checksum).toBe(5); // counter after 5 increments
    const beta = await rawWasmLoader.load({ artifactUrl: fixturePath, entry: "beta" });
    beta.module.loadInput(new Uint8Array(0));
    expect(beta.module.run(5).checksum).toBe(35); // 5*7
});
```

- [ ] **Step 3: Run test — verify it fails**

```bash
pnpm --filter @bench/loaders test raw-wasm
```

Expected: FAIL — current loader calls `exports.run(iters)`, but mock has no `run` export.

- [ ] **Step 4: Update raw-wasm loader**

In `packages/loaders/src/raw-wasm.ts`, modify `RawExports` typing and loader to bind `run` from `exports[entry]`. The `<entry>_counter` reader is OPTIONAL — only used when bench's run export returns void or otherwise needs a separate checksum source. For interop_calls noop entry: `exports.interop_calls_noop` returns void (no result); loader wraps to call N times in a JS loop reading `exports.interop_calls_noop_counter()` for checksum.

Sketch — the loader's `module.run` factory:

```typescript
// Inside raw-wasm loader, after WebAssembly.instantiate:
const exports = instance.exports as Record<string, WebAssembly.ExportValue>;
const entryFn = exports[entry];
if (typeof entryFn !== "function") {
    throw new Error(`raw-wasm: export "${entry}" not found in module`);
}
const counterFn = exports[`${entry}_counter`];

const moduleObj: BenchModule = {
    loadInput(input: Uint8Array) {
        const ptr = (exports.alloc as (sz: number) => number)(input.byteLength);
        if (input.byteLength > 0) {
            new Uint8Array(memory.buffer, ptr, input.byteLength).set(input);
        }
        (exports.load_input as (ptr: number, len: number) => void)(ptr, input.byteLength);
    },
    run(iters: number): { checksum: number } {
        if (typeof counterFn === "function") {
            // Void-returning entry: JS-side inner loop, counter export gives checksum.
            const fn = entryFn as () => void;
            for (let i = 0; i < iters; i++) fn();
            return { checksum: (counterFn as () => number)() };
        }
        // Convention: entries whose name ends in `_add_i32`/`_add_f64` (or
        // any non-void return) — JS-side inner loop with accumulator.
        // Spec contract: such entries take (a, b) returning numeric.
        const fn2 = entryFn as (a: number, b: number) => number;
        let acc = 0;
        for (let i = 0; i < iters; i++) {
            const v = fn2(i, i * 2);
            acc = needsI32Wrap(entry) ? (acc + v) | 0 : acc + v;
        }
        return { checksum: acc };
    },
    reset: typeof exports.reset === "function" ? exports.reset as () => void : undefined,
};

function needsI32Wrap(entry: string): boolean {
    return entry.endsWith("_add_i32");
}
```

**Special-case for matmul-style entries** (wasm-side inner loop, returns checksum from single call): if entry name doesn't match the interop pattern (no `_counter` export, doesn't end with `_add_*`, takes one `iters: u32` arg returning a number), call once: `entryFn(iters)`. Distinguish via arity check: `entryFn.length === 1` → matmul-style; arity 2 → add pattern; arity 0 → noop pattern.

Refined dispatch:

```typescript
run(iters: number): { checksum: number } {
    if (entryFn.length === 1) {
        // Matmul-style: wasm-side loop, returns checksum.
        return { checksum: (entryFn as (n: number) => number)(iters) };
    }
    if (entryFn.length === 0 && typeof counterFn === "function") {
        // Noop-style: void/empty-arg, counter export for checksum.
        const fn = entryFn as () => void;
        for (let i = 0; i < iters; i++) fn();
        return { checksum: (counterFn as () => number)() };
    }
    if (entryFn.length === 2) {
        // Add-style: (a, b) -> v, JS accumulator.
        const fn = entryFn as (a: number, b: number) => number;
        const wrap = entry.endsWith("_add_i32");
        let acc = 0;
        for (let i = 0; i < iters; i++) {
            const v = fn(i, i * 2);
            acc = wrap ? (acc + v) | 0 : acc + v;
        }
        return { checksum: acc };
    }
    throw new Error(`raw-wasm: cannot dispatch entry "${entry}" (arity ${entryFn.length})`);
}
```

- [ ] **Step 5: Run loader tests + smoke**

```bash
pnpm --filter @bench/loaders test
pnpm smoke
```

Expected: PASS. Smoke runs matmul which now uses `entry: "matmul"`; raw-wasm loader sees arity 1, calls `exports.matmul(iters)` — but matmul wasm still exports `run`, not `matmul`. Therefore Task 5 cannot land without Task 6 (rename matmul exports). Solution: ship them together OR keep transitional `export run` alias in Rust raw + cpp until rename lands.

**Decision:** ship a transitional commit that keeps `exports.run` AND adds `exports.matmul` as alias in matmul raw rust + cpp. Then Task 6 removes the alias. This keeps each step's smoke green.

Update `benches/matmul/rust/raw/src/lib.rs`: add at end (in addition to existing `run`):

```rust
#[unsafe(no_mangle)]
pub extern "C" fn matmul(iters: u32) -> f64 { run(iters) }
```

Update `benches/matmul/cpp/src/matmul.cpp`: add at end:

```cpp
extern "C" double matmul(uint32_t iters) { return run(iters); }
```

Add same `matmul` re-export in `benches/matmul/rust/bindgen/src/lib.rs`:

```rust
#[must_use]
#[wasm_bindgen]
pub fn matmul(iters: u32) -> f64 { run(iters) }
```

Rebuild matmul artifacts and rerun smoke:

```bash
pnpm build:all
pnpm smoke
```

Expected: smoke green.

- [ ] **Step 6: Commit**

```bash
git add packages/loaders/src packages/loaders/tests benches/matmul/rust/raw benches/matmul/rust/bindgen benches/matmul/cpp
git commit --no-gpg-sign -m "feat(loaders/raw-wasm): per-entry export binding with arity dispatch + matmul transitional alias"
```

---

### Task 6: rust-bindgen loader — per-entry binding

**Files:**
- Modify: `packages/loaders/src/rust-bindgen.ts`

- [ ] **Step 1: Adjust BindgenGlue to look up entry export by name**

`BindgenGlue` today has a hardcoded `run: (iters: u32) => number`. wasm-bindgen exports each public Rust function as a same-name property on the glue module. Update to read by entry:

```typescript
interface BindgenGlue {
    default: (input?: { module_or_path?: string | BufferSource | WebAssembly.Module }) => Promise<unknown>;
    load_input: (buf: Uint8Array) => void;
    reset?: () => void;
    wasm_memory: () => WebAssembly.Memory;
    __wasm_byte_length?: () => number;
    [name: string]: unknown;
}
```

Replace the `module.run` wiring to dispatch by arity, mirroring raw-wasm Task 5 dispatch:

```typescript
const entryFn = glue[entry] as Function | undefined;
if (typeof entryFn !== "function") {
    throw new Error(`bindgen: entry "${entry}" not exported from glue`);
}
const counterFn = glue[`${entry}_counter`] as Function | undefined;

const moduleObj: BenchModule = {
    loadInput(input: Uint8Array) { glue.load_input(input); },
    run(iters: number): { checksum: number } {
        if (entryFn.length === 1) {
            return { checksum: (entryFn as (n: number) => number)(iters) };
        }
        if (entryFn.length === 0 && typeof counterFn === "function") {
            const fn = entryFn as () => void;
            for (let i = 0; i < iters; i++) fn();
            return { checksum: (counterFn as () => number)() };
        }
        if (entryFn.length === 2) {
            const fn = entryFn as (a: number, b: number) => number;
            const wrap = entry.endsWith("_add_i32");
            let acc = 0;
            for (let i = 0; i < iters; i++) {
                const v = fn(i, i * 2);
                acc = wrap ? (acc + v) | 0 : acc + v;
            }
            return { checksum: acc };
        }
        throw new Error(`bindgen: cannot dispatch entry "${entry}" (arity ${entryFn.length})`);
    },
    reset: typeof glue.reset === "function" ? glue.reset : undefined,
};
```

- [ ] **Step 2: Add test (optional — bindgen tests are scarce; mocking wasm-pack output is heavy)**

If `packages/loaders/tests/rust-bindgen.test.ts` exists, extend it with a multi-entry mock; otherwise add an integration check via smoke alone. Either is acceptable.

- [ ] **Step 3: Build + smoke**

```bash
pnpm build:all
pnpm smoke
```

Expected: PASS. Matmul still runs via `matmul` export added in Task 5 (bindgen now picks up via arity-1 dispatch).

- [ ] **Step 4: Commit**

```bash
git add packages/loaders/src/rust-bindgen.ts packages/loaders/tests
git commit --no-gpg-sign -m "feat(loaders/rust-bindgen): per-entry export binding with arity dispatch"
```

---

### Task 7: emscripten loader — per-entry binding

**Files:**
- Modify: `packages/loaders/src/emscripten.ts`

- [ ] **Step 1: Update EmModule interface and dispatch**

Emscripten exports C functions prefixed with `_`. So `entry = "matmul"` → JS property `inst._matmul`. Update:

```typescript
interface EmModule {
    HEAPU8: Uint8Array;
    _alloc(sz: number): number;
    _load_input(ptr: number, len: number): void;
    _reset?(): void;
    wasmMemory: WebAssembly.Memory;
    [name: string]: unknown;
}
```

Dispatch logic mirrors raw-wasm:

```typescript
const entryFn = inst[`_${entry}`] as Function | undefined;
if (typeof entryFn !== "function") {
    throw new Error(`emscripten: export "_${entry}" not found in module`);
}
const counterFn = inst[`_${entry}_counter`] as Function | undefined;

const moduleObj: BenchModule = {
    loadInput(input: Uint8Array) {
        const ptr = inst._alloc(input.byteLength);
        if (input.byteLength > 0) {
            inst.HEAPU8.set(input, ptr);
        }
        inst._load_input(ptr, input.byteLength);
    },
    run(iters: number): { checksum: number } {
        if (entryFn.length === 1) {
            return { checksum: (entryFn as (n: number) => number)(iters) };
        }
        if (entryFn.length === 0 && typeof counterFn === "function") {
            const fn = entryFn as () => void;
            for (let i = 0; i < iters; i++) fn();
            return { checksum: (counterFn as () => number)() };
        }
        if (entryFn.length === 2) {
            const fn = entryFn as (a: number, b: number) => number;
            const wrap = entry.endsWith("_add_i32");
            let acc = 0;
            for (let i = 0; i < iters; i++) {
                const v = fn(i, i * 2);
                acc = wrap ? (acc + v) | 0 : acc + v;
            }
            return { checksum: acc };
        }
        throw new Error(`emscripten: cannot dispatch entry "${entry}" (arity ${entryFn.length})`);
    },
    reset: typeof inst._reset === "function" ? inst._reset : undefined,
};
```

- [ ] **Step 2: Build + smoke**

```bash
pnpm build:all
pnpm smoke
```

Expected: PASS. Emscripten matmul artifact already has `_matmul` (added in Task 5 cpp re-export).

- [ ] **Step 3: Commit**

```bash
git add packages/loaders/src/emscripten.ts
git commit --no-gpg-sign -m "feat(loaders/emscripten): per-entry export binding with arity dispatch"
```

---

### Task 8: matrix.ts — split binaries from run cases

**Files:**
- Modify: `scripts/lib/matrix.ts`

- [ ] **Step 1: Refactor matrix.ts**

Replace with:

```typescript
import type { Language, Toolchain, Profile, InputSize, Spec } from "@bench/result-schema";

/** A binary artifact: one (sourceBench, lang, toolchain, profile) build unit. */
export interface BinaryCombination {
    sourceBench: string;       // dir under benches/<sourceBench>/, also spec.id
    language: Language;
    toolchain: Toolchain;
    profile: Profile;
}

/** A measurement case: a binary × entry × size × env. */
export interface RunCase extends BinaryCombination {
    entry: string;
    inputSize: InputSize;
    env: "node" | "browser-chromium" | "browser-firefox";
}

export function distDir(b: BinaryCombination): string {
    return `dist/${b.sourceBench}/${b.language}-${b.toolchain}-${b.profile}`;
}

/** Per-spec binary expansion: cross product of supported.languages × toolchains × profiles. */
export function enumerateBinaries(spec: Spec): BinaryCombination[] {
    const out: BinaryCombination[] = [];
    if (!spec.supported) {
        throw new Error(`spec ${spec.id} has no .supported block`);
    }
    for (const lang of spec.supported.languages) {
        const toolchains = spec.supported.toolchains[lang];
        if (!toolchains) {
            continue;
        }
        for (const tc of toolchains) {
            for (const p of spec.supported.profiles) {
                out.push({ sourceBench: spec.id, language: lang, toolchain: tc, profile: p });
            }
        }
    }
    return out;
}

/** Per-spec run-case expansion: binaries × entries (× sizes/envs added by caller). */
export function enumerateRunCases(
    spec: Spec,
    sizes: readonly InputSize[],
    envs: readonly RunCase["env"][],
): RunCase[] {
    const out: RunCase[] = [];
    for (const bin of enumerateBinaries(spec)) {
        for (const entry of spec.entries) {
            for (const sz of sizes) {
                for (const env of envs) {
                    out.push({ ...bin, entry, inputSize: sz, env });
                }
            }
        }
    }
    return out;
}
```

Note: drops the old hardcoded `ALL_COMBINATIONS` constant. Callers must load `spec.json` and call `enumerateBinaries` / `enumerateRunCases` instead. Tasks 9, 11, 12, 13 update those callers.

- [ ] **Step 2: Add unit tests for matrix helpers**

Create `scripts/lib/matrix.test.ts` (or wherever scripts tests live — if none, add minimal vitest config or test via assert in a tsx run). Quick scope: skip formal tests if no scripts test infra; correctness verified at smoke level.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: FAIL — every caller of `ALL_COMBINATIONS` (build scripts, run-matrix, run-case) is broken. We deal with each in Tasks 9, 11, 13. Land matrix.ts change as a transition commit.

- [ ] **Step 4: Provide a transitional shim**

To avoid red typecheck across multiple commits, keep an `ALL_COMBINATIONS` export that synchronously reads `benches/matmul/spec.json` and expands. Mark deprecated:

```typescript
import { readFileSync } from "node:fs";
import { SpecSchema } from "@bench/result-schema";

/**
 * @deprecated Use `enumerateBinaries(loadSpec(benchId))`. Kept until call-sites migrate.
 */
export const ALL_COMBINATIONS: BinaryCombination[] = (() => {
    const spec = SpecSchema.parse(JSON.parse(readFileSync("benches/matmul/spec.json", "utf8")));
    return enumerateBinaries(spec).map((b) => ({ ...b, benchmarkId: b.sourceBench }));
})();
```

Note the `.benchmarkId` field — kept so existing callers (build-rust.ts, build-cpp.ts, build-js.ts, run-matrix.ts) compile. We remove this in Task 9.

- [ ] **Step 5: Verify typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/matrix.ts
git commit --no-gpg-sign -m "refactor(scripts/matrix): split binaries from run cases; introduce enumerateBinaries/enumerateRunCases"
```

---

### Task 9: build-all + per-language builds — auto-discovery

**Files:**
- Modify: `scripts/build-all.ts`
- Modify: `scripts/build-{js,rust,cpp}.ts`

- [ ] **Step 1: build-all.ts: glob-based discovery**

Replace `const benches = ["matmul"]` with:

```typescript
import { glob } from "node:fs/promises";
// ...
async function listBenches(): Promise<string[]> {
    const benches: string[] = [];
    for await (const path of glob("benches/*/spec.json")) {
        const segments = path.split("/");
        // path like "benches/matmul/spec.json" → benches[1] is the id
        benches.push(segments[1]!);
    }
    benches.sort();
    return benches;
}

// In main():
const benches = await listBenches();
```

(`fs/promises.glob` is available in Node 22+. Verify the project's Node version supports it; if not, use `node:fs/promises.readdir` and filter.)

- [ ] **Step 2: build-rust.ts: parametrize by bench id**

Current loops over `ALL_COMBINATIONS.filter(c => c.language === "rust")`. New approach:

```typescript
async function main() {
    const benches = process.argv.slice(2);
    if (benches.length === 0) {
        throw new Error("usage: tsx scripts/build-rust.ts <bench-id> [<bench-id>...]");
    }
    for (const benchId of benches) {
        const specPath = `benches/${benchId}/spec.json`;
        const spec = SpecSchema.parse(JSON.parse(await readFile(specPath, "utf8")));
        const bins = enumerateBinaries(spec).filter((b) => b.language === "rust");
        for (const c of bins) {
            if (c.toolchain === "raw") {
                await buildRaw(c);
            } else if (c.toolchain === "bindgen") {
                await buildBindgen(c);
            }
        }
    }
}
```

`buildRaw` / `buildBindgen` already take a `Combination` with `benchmarkId` — adapt:
- Rename param type to `BinaryCombination` (now uses `sourceBench` not `benchmarkId`).
- Replace `c.benchmarkId` with `c.sourceBench`.
- Derive wasm filename from sourceBench: `const wasmName = \`${c.sourceBench}_rust_raw.wasm\`` — but cargo crate name is per-bench. For matmul: crate `matmul-rust-raw` → output `matmul_rust_raw.wasm`. For interop_calls: crate `interop-calls-rust-raw` → output `interop_calls_rust_raw.wasm`. Generalize:

```typescript
const wasmName = `${c.sourceBench}_rust_raw.wasm`;
```

(`_` separator because cargo replaces `-` in crate name with `_` for output binary; we use `_` source bench id directly.)

- [ ] **Step 3: build-cpp.ts: parametrize by bench id**

Same pattern as Step 2. Pass `benchId` to build functions; derive paths from `c.sourceBench`.

- [ ] **Step 4: build-js.ts: parametrize by bench id**

Same. The esbuild input path becomes `benches/${benchId}/js/${toolchain}/src/index.ts`.

- [ ] **Step 5: build-all.ts: invoke per-bench builds**

```typescript
async function main() {
    const benches = await listBenches();
    for (const benchId of benches) {
        // fixtures
        const fixGen = `benches/${benchId}/fixtures/generate.ts`;
        if (await fileExists(fixGen)) {
            await run("tsx", [fixGen]);
        }
        // copy spec.json to dist
        await mkdir(`dist/${benchId}`, { recursive: true });
        await copyFile(`benches/${benchId}/spec.json`, `dist/${benchId}/spec.json`);
        // copy fixtures
        await copyFixtures(benchId);
    }
    // delegate to language builds with all benches in one invocation
    await run("tsx", ["scripts/build-js.ts", ...benches]);
    await run("tsx", ["scripts/build-rust.ts", ...benches]);
    await run("tsx", ["scripts/build-cpp.ts", ...benches]);
}
```

(`copyFixtures` is the existing inline logic — extract or inline as needed.)

- [ ] **Step 6: Remove the `ALL_COMBINATIONS` shim from matrix.ts**

Now that all callers use `enumerateBinaries`, delete the deprecated export and the `benchmarkId` alias field. Update test files if any still reference `ALL_COMBINATIONS`.

- [ ] **Step 7: typecheck + build + smoke**

```bash
pnpm typecheck
pnpm build:all
pnpm smoke
```

Expected: PASS. `dist/matmul/...` is rebuilt; smoke runs matmul cases.

- [ ] **Step 8: Commit**

```bash
git add scripts
git commit --no-gpg-sign -m "feat(scripts/build): auto-discover benches; parametrize per-language builds by bench id"
```

---

### Task 10: `pnpm fixtures` standalone command

**Files:**
- Create: `scripts/fixtures.ts`
- Modify: `package.json` (add `fixtures` script)

- [ ] **Step 1: Create scripts/fixtures.ts**

```typescript
import { glob, stat } from "node:fs/promises";
import { run } from "./lib/exec.js";

async function fileExists(p: string): Promise<boolean> {
    try { await stat(p); return true; } catch { return false; }
}

async function listBenches(): Promise<string[]> {
    const out: string[] = [];
    for await (const path of glob("benches/*/spec.json")) {
        out.push(path.split("/")[1]!);
    }
    return out.sort();
}

interface Args { bench?: string; }

function parseArgs(argv: string[]): Args {
    const v = argv.find((a) => a.startsWith("--bench="));
    return v ? { bench: v.slice("--bench=".length) } : {};
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const benches = args.bench ? [args.bench] : await listBenches();
    for (const b of benches) {
        const gen = `benches/${b}/fixtures/generate.ts`;
        if (!(await fileExists(gen))) {
            console.log(`[fixtures] ${b}: no generator at ${gen}, skipping`);
            continue;
        }
        await run("tsx", [gen]);
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add npm script**

Edit root `package.json` "scripts" block to include:

```json
"fixtures": "tsx scripts/fixtures.ts"
```

- [ ] **Step 3: Smoke test it**

```bash
pnpm fixtures
pnpm fixtures --bench=matmul
```

Expected: both regenerate matmul fixtures successfully (output identical to existing `benches/matmul/fixtures/{s,m,l}.bin`).

- [ ] **Step 4: Commit**

```bash
git add scripts/fixtures.ts package.json
git commit --no-gpg-sign -m "feat(scripts): pnpm fixtures standalone regenerator"
```

---

### Task 11: runner-node — `--entry` flag and v2 spec consumption

**Files:**
- Modify: `apps/runner-node/src/main.ts`
- Modify: `apps/runner-node/src/run-case.ts`

- [ ] **Step 1: Add `--entry` flag to main.ts**

Edit `CliArgs` to add `entry: string`; parse `--entry=<id>` from argv (required). Pass to `runCase`. Result filename becomes `${entry}__...` instead of `${benchmarkId}__...`:

```typescript
const outFile = `${args.entry}__${args.language}-${args.toolchain}-${args.profile}__${args.size}__node.json`;
```

- [ ] **Step 2: Update run-case.ts**

- Add `entry: string` to `RunCaseInput`.
- Replace inline `SpecFile` type with `Spec` from `@bench/result-schema`.
- Look up checksum via `spec.expectedChecksums[entry][size]`:

```typescript
const expected = spec.expectedChecksums[input.entry]?.[input.inputSize];
if (expected === undefined) {
    throw new Error(
        `spec missing expectedChecksum for entry "${input.entry}" size "${input.inputSize}"`,
    );
}
```

- Pass `entry: input.entry` into `loaderInput`.
- Replace `benchmark.id: input.benchmarkId` with `benchmark.id: input.entry` (entry IS the benchmark ID at result-schema level — matches user's "result filename by entry" choice).
- `input.benchmarkId` still names the source dir / dist path; keep as `sourceBench` semantics in `runCase`.

- [ ] **Step 3: Test single-case invocation**

```bash
pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=matmul --entry=matmul --language=rust --toolchain=raw --profile=speed \
  --size=S --out=results/raw/_smoke --mode=quick
```

Expected: writes `results/raw/_smoke/matmul__rust-raw-speed__S__node.json`; case passes correctness.

- [ ] **Step 4: Run smoke**

```bash
pnpm smoke
```

Expected: smoke (`scripts/smoke.ts`) needs an update to pass `--entry`. Update it:

```typescript
// inside smoke.ts loop:
for (const c of ALL_COMBINATIONS /* now enumerateBinaries(loadSpec("matmul")) */) {
    await run("tsx", [
        "apps/runner-node/src/main.ts",
        `--benchmark=${c.sourceBench}`,
        `--entry=matmul`,
        `--language=${c.language}`,
        ...
    ]);
}
```

Expected: smoke PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/runner-node scripts/smoke.ts
git commit --no-gpg-sign -m "feat(runner-node): --entry flag; consume v2 spec.expectedChecksums map"
```

---

### Task 12: runner-web — `--entry` flag

**Files:**
- Modify: `apps/runner-web/src/driver.ts`
- Modify: `apps/runner-web/src/worker.ts` (if relevant)
- Modify: `apps/runner-web/src/*.html` if URL param plumbing (check)

- [ ] **Step 1: Mirror runner-node Task 11 changes**

- Driver accepts `--entry=<id>` arg; embeds it in `WorkerInput` (base64-encoded URL param).
- Worker passes `entry` into `LoaderInput`.
- Result filename: `${entry}__...__${browser}.json`.

Find every `--benchmark=` propagation site in `apps/runner-web/`; alongside each, add `--entry=`. Result file path mirrors runner-node's `${entry}__...` convention.

- [ ] **Step 2: Test in real browsers (optional smoke)**

```bash
pnpm --filter @bench-app/runner-web dev   # terminal 1
pnpm --filter @bench-app/runner-web drive --benchmark=matmul --entry=matmul --browser=chromium \
    --language=rust --toolchain=raw --profile=speed --size=S --out=results/raw/_smoke --mode=quick
```

Expected: writes `results/raw/_smoke/matmul__rust-raw-speed__S__chromium.json`.

If browser drive verification too expensive at this point, defer to Task 22 full bench:all run.

- [ ] **Step 3: Commit**

```bash
git add apps/runner-web
git commit --no-gpg-sign -m "feat(runner-web): --entry flag; result filename by entry"
```

---

### Task 13: run-matrix — iterate per-entry

**Files:**
- Modify: `scripts/run-matrix.ts`

- [ ] **Step 1: Discover benches and enumerate run cases**

Replace the `for (const c of ALL_COMBINATIONS)` loop with per-bench discovery:

```typescript
import { glob, readFile } from "node:fs/promises";
import { SpecSchema } from "@bench/result-schema";
import { enumerateBinaries } from "./lib/matrix.js";

async function loadSpecs(): Promise<Spec[]> {
    const out: Spec[] = [];
    for await (const path of glob("benches/*/spec.json")) {
        const raw = await readFile(path, "utf8");
        out.push(SpecSchema.parse(JSON.parse(raw)));
    }
    return out;
}

// in main():
const specs = await loadSpecs();
for (const spec of specs) {
    for (const c of enumerateBinaries(spec)) {
        for (const entry of spec.entries) {
            for (const sz of args.sizes) {
                for (const env of args.envs) {
                    const common = [
                        `--benchmark=${c.sourceBench}`,
                        `--entry=${entry}`,
                        `--language=${c.language}`,
                        `--toolchain=${c.toolchain}`,
                        `--profile=${c.profile}`,
                        `--size=${sz}`,
                        `--out=${args.out}`,
                        `--mode=${args.mode}`,
                    ];
                    if (env === "node") {
                        await run("tsx", ["apps/runner-node/src/main.ts", ...common]);
                    } else {
                        await run("tsx", ["apps/runner-web/src/driver.ts", ...common, `--browser=${env}`]);
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 2: Smoke a tiny matrix**

```bash
pnpm bench --envs=node --sizes=S --mode=quick --out=$TMPDIR/bench-matmul-smoke
ls $TMPDIR/bench-matmul-smoke | head -20
```

Expected: 10 files written (10 matmul combos × 1 entry × 1 size × 1 env), names like `matmul__rust-raw-speed__S__node.json`.

- [ ] **Step 3: Commit**

```bash
git add scripts/run-matrix.ts
git commit --no-gpg-sign -m "feat(scripts/run-matrix): iterate per-entry via spec discovery"
```

---

### Task 14: Remove matmul `run` alias (cleanup transitional)

**Files:**
- Modify: `benches/matmul/rust/raw/src/lib.rs`
- Modify: `benches/matmul/rust/bindgen/src/lib.rs`
- Modify: `benches/matmul/cpp/src/{matmul.h,matmul.cpp}`

- [ ] **Step 1: Drop old `run` from matmul rust raw**

Remove the original `pub extern "C" fn run(...)`; rename the `matmul` wrapper to be the implementation directly. Final state:

```rust
#[unsafe(no_mangle)]
pub extern "C" fn matmul(iters: u32) -> f64 {
    // SAFETY: load_input was called by JS host before run; A/B/C are valid.
    unsafe {
        with_slices(|a, b, c, n| {
            let mut last = 0.0_f64;
            for _ in 0..iters {
                matmul_naive(a, b, c, n);
                last = abs_sum(c);
            }
            last
        })
    }
}
```

(Original body, just renamed.)

- [ ] **Step 2: Drop `run` from matmul bindgen**

Rename original `pub fn run(...)` → `pub fn matmul(...)`. Delete the alias.

- [ ] **Step 3: Drop `run` from matmul cpp**

In `matmul.h`: remove `double run(...)`; rename to `double matmul(...)`. In `matmul.cpp`: same — rename the implementation, delete the alias.

- [ ] **Step 4: Build + smoke**

```bash
pnpm build:all
pnpm smoke
```

Expected: PASS. matmul now exports only `matmul` (not `run`).

- [ ] **Step 5: Commit**

```bash
git add benches/matmul/rust benches/matmul/cpp
git commit --no-gpg-sign -m "refactor(matmul): rename wasm export run -> matmul (matches v2 spec.entries)"
```

---

## Wave 2 — interop_calls implementations

### Task 15: interop_calls reference implementation + spec.json

**Files:**
- Create: `benches/interop_calls/validate/reference.ts`
- Create: `benches/interop_calls/spec.json`

- [ ] **Step 1: Write the reference**

Create `benches/interop_calls/validate/reference.ts`:

```typescript
// Reference: computes expected checksums for (entry, size) combinations.
// Determinism contract:
//   - noop(iters):       counter starts at 0; one inc per call → result = iters.
//   - add_i32(iters):    acc = 0; for i in [0..iters): acc = (acc + i + 2*i) | 0
//                        (signed i32 wrap matching wasm i32.add semantics).
//   - add_f64(iters):    acc = 0; for i in [0..iters): acc += i + 2*i
//                        (f64 exact for sums up to ~2^53; with iters=10M, sum ≈ 1.5e14 — exact).

const SIZES: Array<["S" | "M" | "L", number]> = [
    ["S", 100_000],
    ["M", 1_000_000],
    ["L", 10_000_000],
];

function computeNoop(iters: number): number {
    return iters;
}

function computeAddI32(iters: number): number {
    let acc = 0;
    for (let i = 0; i < iters; i++) {
        acc = (acc + i + 2 * i) | 0;
    }
    return acc;
}

function computeAddF64(iters: number): number {
    let acc = 0;
    for (let i = 0; i < iters; i++) {
        acc += i + 2 * i;
    }
    return acc;
}

const report: Record<string, Record<string, number>> = {
    interop_calls_noop: {},
    interop_calls_add_i32: {},
    interop_calls_add_f64: {},
};

for (const [sz, iters] of SIZES) {
    report.interop_calls_noop[sz] = computeNoop(iters);
    report.interop_calls_add_i32[sz] = computeAddI32(iters);
    report.interop_calls_add_f64[sz] = computeAddF64(iters);
}

console.log(JSON.stringify(report, null, 2));
```

- [ ] **Step 2: Run reference to get checksum values**

```bash
pnpm exec tsx benches/interop_calls/validate/reference.ts
```

Capture the JSON output. Expected shape (numbers depend on exact computation):

```json
{
    "interop_calls_noop": { "S": 100000, "M": 1000000, "L": 10000000 },
    "interop_calls_add_i32": { "S": <int>, "M": <int>, "L": <int> },
    "interop_calls_add_f64": { "S": <float>, "M": <float>, "L": <float> }
}
```

Note the exact i32 values (depends on wrap behavior at S/M/L iter counts). Record verbatim — these go directly into spec.json.

- [ ] **Step 3: Write spec.json**

Create `benches/interop_calls/spec.json` using captured values. Skeleton (with placeholders for the captured numbers):

```json
{
    "id": "interop_calls",
    "version": 2,
    "description": "Three trivial wasm functions exercising JS↔wasm call overhead: noop (no args/no return), add_i32 (i32, i32) -> i32, add_f64 (f64, f64) -> f64. JS-side inner loop calls the wasm export `iters` times; checksum is either a wasm-side counter (noop) or a JS-side accumulator (add_*) for DCE-defense.",
    "entries": ["interop_calls_noop", "interop_calls_add_i32", "interop_calls_add_f64"],
    "inputSizes": {
        "S": { "fixtureBytes": 0, "fixtureSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "innerIterations": 100000 },
        "M": { "fixtureBytes": 0, "fixtureSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "innerIterations": 1000000 },
        "L": { "fixtureBytes": 0, "fixtureSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "innerIterations": 10000000 }
    },
    "expectedChecksums": {
        "interop_calls_noop": { "S": 100000, "M": 1000000, "L": 10000000 },
        "interop_calls_add_i32": { "S": <REPLACE_FROM_REFERENCE>, "M": <REPLACE>, "L": <REPLACE> },
        "interop_calls_add_f64": { "S": <REPLACE_FROM_REFERENCE>, "M": <REPLACE>, "L": <REPLACE> }
    },
    "supported": {
        "languages": ["js", "rust", "cpp"],
        "toolchains": {
            "js": ["idiomatic", "typed-array"],
            "rust": ["raw", "bindgen"],
            "cpp": ["emscripten", "wasi-sdk"]
        },
        "profiles": ["speed", "size"]
    },
    "ioContract": {
        "fixtureLayout": "Empty. Inputs are derived from inner loop index (i, 2*i for add_*).",
        "outputLayout": "Single scalar checksum: counter (noop) or accumulator (add_*)."
    }
}
```

Substitute `<REPLACE>` with captured values.

- [ ] **Step 4: Schema-verify**

```bash
pnpm exec tsx -e 'import { SpecSchema } from "./packages/result-schema/src/schema.js"; import { readFileSync } from "node:fs"; console.log(SpecSchema.parse(JSON.parse(readFileSync("benches/interop_calls/spec.json","utf8"))).id);'
```

Expected: `interop_calls`.

- [ ] **Step 5: Commit**

```bash
git add benches/interop_calls/spec.json benches/interop_calls/validate/reference.ts
git commit --no-gpg-sign -m "feat(interop_calls): reference impl + spec.json (3 entries, S/M/L)"
```

---

### Task 16: interop_calls fixture generator + .gitignore

**Files:**
- Create: `benches/interop_calls/fixtures/generate.ts`
- Create: `benches/interop_calls/fixtures/.gitignore`

- [ ] **Step 1: Generator**

Create `benches/interop_calls/fixtures/generate.ts`:

```typescript
// interop_calls is fixture-less: each size writes a 0-byte file. The file
// exists so generic build/run code can copy/read without special-casing.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const out = resolve(import.meta.dirname);
await mkdir(out, { recursive: true });
for (const sz of ["s", "m", "l"]) {
    await writeFile(`${out}/${sz}.bin`, new Uint8Array(0));
}
console.log("interop_calls fixtures: wrote 3 empty files");
```

- [ ] **Step 2: gitignore**

Create `benches/interop_calls/fixtures/.gitignore`:

```
*.bin
```

(Matches matmul fixture convention.)

- [ ] **Step 3: Run generator**

```bash
pnpm exec tsx benches/interop_calls/fixtures/generate.ts
ls -la benches/interop_calls/fixtures/
```

Expected: `s.bin`, `m.bin`, `l.bin` (each 0 bytes).

- [ ] **Step 4: Commit**

```bash
git add benches/interop_calls/fixtures/generate.ts benches/interop_calls/fixtures/.gitignore
git commit --no-gpg-sign -m "feat(interop_calls/fixtures): empty-fixture generator"
```

---

### Task 17: interop_calls js/idiomatic

**Files:**
- Create: `benches/interop_calls/js/idiomatic/{package.json,tsconfig.json,src/index.ts}`

- [ ] **Step 1: package.json**

```json
{
    "name": "@bench/interop-calls-js-idiomatic",
    "version": "0.0.0",
    "private": true,
    "type": "module"
}
```

(Mirror matmul js/idiomatic structure.)

- [ ] **Step 2: tsconfig.json**

Mirror `benches/matmul/js/idiomatic/tsconfig.json`. Likely `{ "extends": "../../../../tsconfig.base.json", "include": ["src/**/*"] }` or similar.

- [ ] **Step 3: src/index.ts**

```typescript
interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

export default function create(entry: string): BenchModule {
    let counter = 0;
    let accI32 = 0;
    let accF64 = 0;

    function noopFn(): void { counter++; }
    function addI32Fn(a: number, b: number): number { return (a + b) | 0; }
    function addF64Fn(a: number, b: number): number { return a + b; }

    function reset(): void {
        counter = 0;
        accI32 = 0;
        accF64 = 0;
    }

    function runEntry(iters: number): { checksum: number } {
        switch (entry) {
            case "interop_calls_noop": {
                for (let i = 0; i < iters; i++) noopFn();
                return { checksum: counter };
            }
            case "interop_calls_add_i32": {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    acc = (acc + addI32Fn(i, i * 2)) | 0;
                }
                accI32 = acc;
                return { checksum: acc };
            }
            case "interop_calls_add_f64": {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    acc += addF64Fn(i, i * 2);
                }
                accF64 = acc;
                return { checksum: acc };
            }
            default:
                throw new Error(`interop_calls/js-idiomatic: unknown entry "${entry}"`);
        }
    }

    return {
        loadInput(_: Uint8Array) { reset(); },
        run: runEntry,
        reset,
    };
}
```

- [ ] **Step 4: Test it locally**

```bash
pnpm exec tsx -e '
import create from "./benches/interop_calls/js/idiomatic/src/index.ts";
for (const entry of ["interop_calls_noop", "interop_calls_add_i32", "interop_calls_add_f64"]) {
    const m = create(entry);
    m.loadInput(new Uint8Array(0));
    console.log(entry, m.run(1000).checksum);
}
'
```

Expected: counter=1000; add_i32 = computed value (matches reference at iters=1000); add_f64 = f64-sum (matches reference at iters=1000).

Cross-verify against reference.ts output at `iters=1000` (extend reference.ts temporarily or compute by hand: noop=1000, add_i32 = sum_{0..999} 3i = 3*999*1000/2 = 1498500, add_f64 = 1498500.0).

- [ ] **Step 5: Commit**

```bash
git add benches/interop_calls/js/idiomatic
git commit --no-gpg-sign -m "feat(interop_calls): js/idiomatic impl (noop + add_i32 + add_f64)"
```

---

### Task 18: interop_calls js/typed-array

**Files:**
- Create: `benches/interop_calls/js/typed-array/{package.json,tsconfig.json,src/index.ts}`

- [ ] **Step 1: package.json / tsconfig**

Mirror Task 17 with name `@bench/interop-calls-js-typed-array`.

- [ ] **Step 2: src/index.ts**

Variant that stores the noop counter and the add_i32 accumulator in single-element `Int32Array`s (forcing typed-array store/load), `add_f64` in `Float64Array`. This produces a measurably different JIT path on some engines:

```typescript
interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

export default function create(entry: string): BenchModule {
    const counter = new Int32Array(1);
    const accI32 = new Int32Array(1);
    const accF64 = new Float64Array(1);

    function reset(): void {
        counter[0] = 0;
        accI32[0] = 0;
        accF64[0] = 0;
    }

    function noopFn(): void { counter[0]++; }
    function addI32Fn(a: number, b: number): number { return (a + b) | 0; }
    function addF64Fn(a: number, b: number): number { return a + b; }

    return {
        loadInput(_: Uint8Array) { reset(); },
        run(iters: number): { checksum: number } {
            switch (entry) {
                case "interop_calls_noop": {
                    for (let i = 0; i < iters; i++) noopFn();
                    return { checksum: counter[0] };
                }
                case "interop_calls_add_i32": {
                    let acc = 0;
                    for (let i = 0; i < iters; i++) {
                        acc = (acc + addI32Fn(i, i * 2)) | 0;
                    }
                    accI32[0] = acc;
                    return { checksum: accI32[0] };
                }
                case "interop_calls_add_f64": {
                    let acc = 0;
                    for (let i = 0; i < iters; i++) {
                        acc += addF64Fn(i, i * 2);
                    }
                    accF64[0] = acc;
                    return { checksum: accF64[0] };
                }
                default:
                    throw new Error(`interop_calls/js-typed-array: unknown entry "${entry}"`);
            }
        },
        reset,
    };
}
```

- [ ] **Step 3: Commit**

```bash
git add benches/interop_calls/js/typed-array
git commit --no-gpg-sign -m "feat(interop_calls): js/typed-array impl (TypedArray-backed accumulators)"
```

---

### Task 19: interop_calls rust/raw crate

**Files:**
- Create: `benches/interop_calls/rust/raw/{Cargo.toml,src/lib.rs}`
- Modify: root `Cargo.toml` (add to workspace members)

- [ ] **Step 1: Cargo.toml**

Create `benches/interop_calls/rust/raw/Cargo.toml`:

```toml
[package]
name = "interop-calls-rust-raw"
version.workspace = true
edition.workspace = true
publish.workspace = false

[lib]
crate-type = ["cdylib"]

[lints]
workspace = true
```

(Note: no `[dependencies]`; raw crate is `no_std`, no shared crate dependency for interop_calls because there's no shared kernel.)

- [ ] **Step 2: src/lib.rs**

```rust
#![no_std]
#![allow(
    unsafe_code,
    reason = "raw WASM cdylib: ABI-level unsafe (no_mangle) is inherent to the FFI surface"
)]

use core::cell::UnsafeCell;
use core::panic::PanicInfo;

#[panic_handler]
#[allow(clippy::missing_const_for_fn, reason = "panic_handler cannot be const")]
fn on_panic(_: &PanicInfo) -> ! {
    loop {}
}

// Wasm32 single-threaded — UnsafeCell wrapper is sufficient for global mutable
// state. Confirmed pattern from matmul/rust/raw (see docs/guidelines.md).
struct GlobalCounter(UnsafeCell<u32>);
// SAFETY: Sync requires `&T` to be safely shareable across threads; wasm32 is
// single-threaded, the obligation is vacuous.
unsafe impl Sync for GlobalCounter {}
static NOOP_COUNTER: GlobalCounter = GlobalCounter(UnsafeCell::new(0));

#[unsafe(no_mangle)]
pub extern "C" fn interop_calls_noop() {
    // SAFETY: wasm32 single-threaded — NOOP_COUNTER has one writer (this fn).
    unsafe { *NOOP_COUNTER.0.get() = (*NOOP_COUNTER.0.get()).wrapping_add(1); }
}

#[unsafe(no_mangle)]
pub extern "C" fn interop_calls_noop_counter() -> u32 {
    // SAFETY: wasm32 single-threaded; reader cannot race the writer.
    unsafe { *NOOP_COUNTER.0.get() }
}

#[unsafe(no_mangle)]
pub extern "C" fn interop_calls_add_i32(a: i32, b: i32) -> i32 {
    a.wrapping_add(b)
}

#[unsafe(no_mangle)]
pub extern "C" fn interop_calls_add_f64(a: f64, b: f64) -> f64 {
    a + b
}

// Required by raw-wasm loader's LoaderInput contract (loadInput → alloc +
// load_input). interop_calls is fixture-less, but the loader still calls
// these with len=0; provide trivial no-op implementations.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(_sz: u32) -> u32 { 0 }

#[unsafe(no_mangle)]
pub extern "C" fn load_input(_ptr: u32, _len: u32) {
    // Reset counter on (re)load so each measurement sample starts at 0.
    // SAFETY: wasm32 single-threaded.
    unsafe { *NOOP_COUNTER.0.get() = 0; }
}
```

- [ ] **Step 3: Workspace registration**

Edit root `Cargo.toml`, add to `members`:

```toml
[workspace]
members = [
    "benches/matmul/rust/shared",
    "benches/matmul/rust/raw",
    "benches/matmul/rust/bindgen",
    "benches/interop_calls/rust/raw",
    "benches/interop_calls/rust/bindgen",
]
```

(Both new crates added now; bindgen crate created in Task 20.)

- [ ] **Step 4: Build + verify exports**

```bash
cargo build --release --target=wasm32-unknown-unknown -p interop-calls-rust-raw
pnpm exec wasm-tools print target/wasm32-unknown-unknown/release/interop_calls_rust_raw.wasm | grep -E "^\s*\(export" | head -20
```

Expected: exports include `interop_calls_noop`, `interop_calls_noop_counter`, `interop_calls_add_i32`, `interop_calls_add_f64`, `alloc`, `load_input`, `memory`.

(If `wasm-tools` not available, use `wasm-dis` from binaryen or just check via successful `build:rust` step in Task 22.)

- [ ] **Step 5: Lint**

```bash
pnpm lint:rust
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml benches/interop_calls/rust/raw
git commit --no-gpg-sign -m "feat(interop_calls): rust/raw crate (3 exports + counter reader)"
```

---

### Task 20: interop_calls rust/bindgen crate

**Files:**
- Create: `benches/interop_calls/rust/bindgen/{Cargo.toml,src/lib.rs}`

- [ ] **Step 1: Cargo.toml**

```toml
[package]
name = "interop-calls-rust-bindgen"
version.workspace = true
edition.workspace = true
publish.workspace = false

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"

[lints]
workspace = true
```

(Pin `wasm-bindgen` version to whatever matmul/bindgen uses — copy literally; consistency simplifies tooling.)

- [ ] **Step 2: src/lib.rs**

```rust
use std::cell::Cell;
use wasm_bindgen::prelude::*;

// SyncCell pattern from matmul/bindgen (see docs/guidelines.md).
struct SyncCell<T>(Cell<T>);
// SAFETY: wasm32 single-threaded; the Sync obligation is vacuous.
unsafe impl<T> Sync for SyncCell<T> {}

static NOOP_COUNTER: SyncCell<u32> = SyncCell(Cell::new(0));

#[wasm_bindgen]
pub fn interop_calls_noop() {
    NOOP_COUNTER.0.set(NOOP_COUNTER.0.get().wrapping_add(1));
}

#[must_use]
#[wasm_bindgen]
pub fn interop_calls_noop_counter() -> u32 {
    NOOP_COUNTER.0.get()
}

#[must_use]
#[wasm_bindgen]
pub fn interop_calls_add_i32(a: i32, b: i32) -> i32 {
    a.wrapping_add(b)
}

#[must_use]
#[wasm_bindgen]
pub fn interop_calls_add_f64(a: f64, b: f64) -> f64 {
    a + b
}

#[wasm_bindgen]
pub fn load_input(_buf: &[u8]) {
    NOOP_COUNTER.0.set(0);
}

#[wasm_bindgen]
pub fn reset() {
    NOOP_COUNTER.0.set(0);
}

#[must_use]
#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}
```

- [ ] **Step 3: Build**

```bash
pnpm build:rust interop_calls
```

(Per Task 9, build-rust.ts takes bench id arg.)

Expected: produces `dist/interop_calls/rust-bindgen-*/{module.wasm,glue.js,meta.json}`.

- [ ] **Step 4: Lint**

```bash
pnpm lint:rust
```

- [ ] **Step 5: Commit**

```bash
git add benches/interop_calls/rust/bindgen
git commit --no-gpg-sign -m "feat(interop_calls): rust/bindgen crate (3 exports + counter reader)"
```

---

### Task 21: interop_calls cpp + both toolchains

**Files:**
- Create: `benches/interop_calls/cpp/src/{interop_calls.h,interop_calls.cpp}`

- [ ] **Step 1: Header**

```cpp
#pragma once
#include <stdint.h>

extern "C" {
    void interop_calls_noop(void);
    uint32_t interop_calls_noop_counter(void);
    int32_t interop_calls_add_i32(int32_t a, int32_t b);
    double interop_calls_add_f64(double a, double b);
    uint32_t alloc(uint32_t sz);
    void load_input(uint32_t ptr, uint32_t len);
}
```

- [ ] **Step 2: Source**

```cpp
#include "interop_calls.h"

// Wasm32 single-threaded; static storage suffices for the counter.
static uint32_t noop_counter = 0;

extern "C" void interop_calls_noop() {
    noop_counter += 1;
}

extern "C" uint32_t interop_calls_noop_counter() {
    return noop_counter;
}

extern "C" int32_t interop_calls_add_i32(int32_t a, int32_t b) {
    // wasm i32.add is two's-complement wrap; signed overflow in C++ is UB, so
    // do the add in uint32_t and reinterpret. Matches Rust's wrapping_add and
    // JS's `(a + b) | 0` semantics.
    return static_cast<int32_t>(static_cast<uint32_t>(a) + static_cast<uint32_t>(b));
}

extern "C" double interop_calls_add_f64(double a, double b) {
    return a + b;
}

extern "C" uint32_t alloc(uint32_t sz) {
    (void)sz;
    return 0;
}

extern "C" void load_input(uint32_t ptr, uint32_t len) {
    (void)ptr;
    (void)len;
    noop_counter = 0;
}
```

- [ ] **Step 3: Build (both emscripten + wasi-sdk via existing build-cpp.ts)**

```bash
pnpm build:cpp interop_calls
```

Expected: produces `dist/interop_calls/cpp-emscripten-*/{glue.mjs,glue.wasm}` and `dist/interop_calls/cpp-wasi-sdk-*/module.wasm`.

If build-cpp.ts has its own per-bench code path, verify it's parameterized correctly post-Task 9.

- [ ] **Step 4: Inspect wasm exports**

```bash
pnpm exec wasm-tools print dist/interop_calls/cpp-wasi-sdk-speed/module.wasm | grep -E "\(export" | head
```

Expected: exports include all 6 functions.

- [ ] **Step 5: Commit**

```bash
git add benches/interop_calls/cpp
git commit --no-gpg-sign -m "feat(interop_calls): cpp impl (single source, both toolchains)"
```

---

### Task 22: Full `pnpm build:all` discovery test

**Files:** none (verification only)

- [ ] **Step 1: Full clean build**

```bash
pnpm clear
pnpm build:all
```

Expected: builds both `dist/matmul/...` and `dist/interop_calls/...` (10 + 12 combos = 22 total — wait, interop_calls has 12 combos because all 6 toolchains × 2 profiles = 12; but `rust-raw-size` is absent in matmul historically. Let me recompute: matmul has js×2 (speed only) + rust×2 (raw both profiles, bindgen both) + cpp×2 (em both, wasi both) = 2 + 4 + 4 = 10. interop_calls supported.toolchains = same as matmul: js×2 (speed only, but spec.supported.profiles=["speed","size"] — JS toolchains may not honor size profile; matmul has only `js-idiomatic-speed` + `js-typed-array-speed` because js size profile produces nothing useful. Replicate that filter in build-js.ts if not already).

For now, count whatever `pnpm build:all` produces. Should be 10 matmul + (10 to 12 interop_calls) combo dirs.

- [ ] **Step 2: List dist contents**

```bash
ls dist/
ls dist/matmul/
ls dist/interop_calls/
```

Expected: same set of combo dirs in both, each with `module.wasm` or `module.js` + `meta.json`.

- [ ] **Step 3: Run interop_calls smoke (one case per toolchain)**

```bash
for tc in rust-raw-speed rust-bindgen-speed cpp-emscripten-speed cpp-wasi-sdk-speed; do
    for entry in interop_calls_noop interop_calls_add_i32 interop_calls_add_f64; do
        echo "=== $tc $entry ==="
        pnpm exec tsx apps/runner-node/src/main.ts \
            --benchmark=interop_calls --entry=$entry \
            --language=${tc%%-*} --toolchain=${tc#*-} --profile=${tc##*-} \
            --size=S --out=$TMPDIR/interop-smoke --mode=quick
    done
done
```

(Bash dissection: `${tc%%-*}` = first segment as language; `${tc#*-}` strips first segment; `${tc##*-}` = last segment = profile. For "rust-raw-speed": language=rust, "raw-speed" then "speed". Let me redo: actually `${tc%%-*}` of "rust-raw-speed" = "rust"; `${tc##*-}` = "speed". For "toolchain" we want "raw" — `${tc#*-}` = "raw-speed", then strip from right: `${{tc#*-}%-*}` = "raw". This is gnarly — better to hand-write each invocation, or write a small helper:

```bash
for entry in interop_calls_noop interop_calls_add_i32 interop_calls_add_f64; do
    pnpm exec tsx apps/runner-node/src/main.ts --benchmark=interop_calls --entry=$entry --language=rust --toolchain=raw --profile=speed --size=S --out=$TMPDIR/interop-smoke --mode=quick
    pnpm exec tsx apps/runner-node/src/main.ts --benchmark=interop_calls --entry=$entry --language=rust --toolchain=bindgen --profile=speed --size=S --out=$TMPDIR/interop-smoke --mode=quick
    pnpm exec tsx apps/runner-node/src/main.ts --benchmark=interop_calls --entry=$entry --language=cpp --toolchain=emscripten --profile=speed --size=S --out=$TMPDIR/interop-smoke --mode=quick
    pnpm exec tsx apps/runner-node/src/main.ts --benchmark=interop_calls --entry=$entry --language=cpp --toolchain=wasi-sdk --profile=speed --size=S --out=$TMPDIR/interop-smoke --mode=quick
done
ls $TMPDIR/interop-smoke
```

Expected: all 12 cases written; each JSON `quality.validated === true`.

- [ ] **Step 4: Update smoke.ts to include interop_calls** (so future `pnpm smoke` covers it)

Edit `scripts/smoke.ts` to enumerate all benches (use the same `loadSpecs()` helper from Task 13 or a simplified version):

```typescript
const specs = await loadSpecs();
for (const spec of specs) {
    for (const bin of enumerateBinaries(spec)) {
        for (const entry of spec.entries) {
            // S size only, node only, quick mode
            await run("tsx", [
                "apps/runner-node/src/main.ts",
                `--benchmark=${bin.sourceBench}`,
                `--entry=${entry}`,
                `--language=${bin.language}`,
                `--toolchain=${bin.toolchain}`,
                `--profile=${bin.profile}`,
                "--size=S",
                "--out=results/raw/_smoke",
                "--mode=quick",
            ]);
        }
    }
}
```

- [ ] **Step 5: Run smoke**

```bash
pnpm smoke
```

Expected: PASS for all 10 matmul + 12 (or however many) interop_calls cases.

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke.ts
git commit --no-gpg-sign -m "test(smoke): cover all discovered benches per spec"
```

---

## Wave 3 — Full bench + reporter + claim

### Task 23: Full `pnpm bench:all`

**Files:** results-only output

- [ ] **Step 1: Run full matrix**

```bash
pnpm bench:all
```

(`pnpm bench:all = setup + build:all + bench (eval) + report`.) Expected runtime: dozens of minutes depending on machine. Each case = 1 binary × 1 entry × 1 size × 1 env.

Cases:
- matmul: 10 binaries × 1 entry × 3 sizes × 3 envs = 90 cases
- interop_calls: ~12 binaries × 3 entries × 3 sizes × 3 envs = up to 324 cases

Total ~400 cases. Some may be filtered by env support (browser-only sizes etc.).

- [ ] **Step 2: Verify result counts**

```bash
ls results/raw/<latest>/ | wc -l
ls results/raw/<latest>/interop_calls_*  | wc -l
ls results/raw/<latest>/matmul__*  | wc -l
```

Expected: counts consistent with the enumeration above (allow for env-specific skips).

- [ ] **Step 3: Spot-check validation**

```bash
for f in $(ls results/raw/<latest>/interop_calls_*.json | shuf | head -5); do
    pnpm exec tsx -e 'import { readFileSync } from "node:fs"; const r = JSON.parse(readFileSync(process.argv[1],"utf8")); console.log(process.argv[1], "validated:", r.quality.validated, "checksum:", r.quality.checksum);' $f
done
```

Expected: all `validated: true`.

- [ ] **Step 4: No commit** (results files are gitignored; report is.) Just confirm the report HTML lands at `results/summarized/<ISO>/index.html`.

---

### Task 24: Reporter v0 cross-workload page validation

**Files:** none if reporter is already workload-agnostic; otherwise modify `packages/reporter/src/render.ts`.

- [ ] **Step 1: Open the report**

```bash
open results/summarized/<ISO>/index.html
```

Verify:
- Table includes both `matmul` and `interop_calls_*` rows.
- Each row shows env, impl, size, sizes (wasm/gzip/brotli), warmMedian.
- Leaders are marked or visually distinguishable per `(benchmark × profile)` group.

- [ ] **Step 2: If reporter needs a leader-highlight row**

If reporter currently has no per-group leader emphasis, extend `packages/reporter/src/render.ts` to group rows by `benchmark.id` + `profile` and highlight the row with min `wasmGzipBytes` (size leader) and min `warmMedian` (perf leader). Sample addition (sketch):

```typescript
function findLeaders(rows: RowVm[], key: "wasmGzipBytes" | "warmMedian"): Set<RowVm> {
    const byGroup = new Map<string, RowVm[]>();
    for (const r of rows) {
        const g = `${r.benchmarkId}|${r.profile}`;
        const arr = byGroup.get(g) ?? [];
        arr.push(r);
        byGroup.set(g, arr);
    }
    const leaders = new Set<RowVm>();
    for (const arr of byGroup.values()) {
        const min = arr.reduce((a, b) => (a[key] <= b[key] ? a : b));
        leaders.add(min);
    }
    return leaders;
}
```

Tag the row in HTML render. Add a unit test in `packages/reporter/tests/render.test.ts`.

- [ ] **Step 3: Run reporter tests**

```bash
pnpm --filter @bench/reporter test
```

Expected: PASS.

- [ ] **Step 4: Commit (if any reporter change)**

```bash
git add packages/reporter
git commit --no-gpg-sign -m "feat(reporter): highlight size + perf leaders per (benchmark, profile)"
```

---

### Task 25: Add ≥1 tentative claim to `docs/guidelines.md`

**Files:** Modify `docs/guidelines.md`

- [ ] **Step 1: Inspect interop_calls findings**

Look at the report HTML and a few result JSONs. Candidate observations:
- `bindgen` vs `raw` for `interop_calls_noop` — is there a per-call overhead delta? (bindgen marshalling vs direct extern C).
- `emscripten` vs `wasi-sdk` — is one faster for `add_f64`? (Emscripten glue may add cost.)
- `js/idiomatic` vs `js/typed-array` — likely identical for interop_calls (no array math); if so, note as **anti-claim** ("typed-array variant gives no benefit for non-array workloads").

Pick ONE confirmed observation visible in the data with delta > noise (CV-aware: difference > 2-3× CV). Mark `tentative` — Phase 1.1.1 has a single workload showing the effect; confirmation needs 1.1.2 or 1.1.3.

- [ ] **Step 2: Append claim to guidelines.md**

Append under `## Code patterns` (or appropriate bucket). Format follows the convention in `CLAUDE.md` § Guidelines artifact:

```markdown
### <Imperative claim — one line>

**Status:** tentative
**Evidence:** results/summarized/<ISO>/index.html (interop_calls Phase 1.1.1 run)
**Phase:** introduced 1.1.1
**Caveats:** Single workload (interop_calls). Confirmation expected after Phase 1.1.2 (hashmap) shows reproducible pattern.

<2-4 sentences explaining the claim, the measured delta, and when not to apply.>
```

Example candidate (placeholder — pick the actual observation):

```markdown
### Prefer rust/raw over rust/bindgen for sub-microsecond JS→wasm hot calls

**Status:** tentative
**Evidence:** results/summarized/<ISO>/index.html (interop_calls_noop, S/M sizes)
**Phase:** introduced 1.1.1
**Caveats:** Single workload class (trivial interop). Confirmation pending on hashmap (Phase 1.1.2) — if container ops show same gap, upgrade to confirmed.

For functions with body < 10ns, bindgen's marshalling wrapper adds ≈X ns per call vs raw `extern "C"` (measured at S=100k iters on node/V8). For matmul-sized work (~µs/call), the gap dissolves below noise.
```

(Substitute X with actual measured ns; cite which language/profile combo gave the data.)

- [ ] **Step 3: Commit**

```bash
git add docs/guidelines.md
git commit --no-gpg-sign -m "docs(guidelines): tentative claim from interop_calls (Phase 1.1.1)"
```

---

### Task 26: Phase 1.1.1 closure gates

**Files:** none (verification only)

- [ ] **Step 1: All gates green**

```bash
pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke
```

Expected: all PASS.

- [ ] **Step 2: Tag**

(User-driven — confirm with user before tagging.)

```bash
git tag phase-1-1-1 -a -m "Phase 1.1.1 closed: interop_calls + multi-entry infra"
```

- [ ] **Step 3: Roadmap entry closure**

Edit `docs/roadmap.md` § Phase 1.1 to mark `interop_calls` as DONE / remove from open cluster.

- [ ] **Step 4: Commit roadmap update**

```bash
git add docs/roadmap.md
git commit --no-gpg-sign -m "docs(roadmap): close Phase 1.1.1 (interop_calls)"
```

---

## Exit criteria (from spec § Phase 1.1.1)

- [ ] 3 benchmark IDs × 6 toolchains × 2 profiles × 3 sizes = up to 108 cases in `results/raw/` for interop_calls.
- [ ] `pnpm bench:all` green, includes interop_calls.
- [ ] Reporter cross-workload page shows matmul + interop_calls.
- [ ] ≥1 tentative claim in `guidelines.md`.
- [ ] All master gates green (`pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke`).

---

## Out of scope (deferred)

- `hashmap` workload (Phase 1.1.2).
- `shape_dispatch` workload (Phase 1.1.3).
- Final reporter layout / per-benchmark detail pages (Phase 1.1 closure or later).
- CI in GitHub Actions (Phase 1.2).
