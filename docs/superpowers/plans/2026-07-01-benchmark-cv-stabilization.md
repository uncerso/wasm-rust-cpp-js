# Benchmark CV Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CV-of-spread acceptance gate with an SEM-of-mean gate, report run-to-run variance as a finding (median + MAD) instead of a failure, flag sub-resolution cells, and give the reporter a stable canonical row order.

**Architecture:** Statistics-first. `computeStats` gains `mad` + `relSem`; the measure loop early-exits on `relSem ≤ semThreshold` (guarded so a sub-resolution `mean=0` artifact can't spuriously pass) with a wall-time backstop; the `BenchResult` schema swaps `stats.noisy` for `relSem` / `meanImprecise` / `subResolution` and adds `timingsMs.warmMad`; the two result assemblers and the reporter follow. A new canonical `IMPL_ORDER` fixes non-deterministic row/segment order across the perf and size tabs. No batching, no `innerIterations` change, no reset touch — the reset call stays outside timing exactly as today.

**Tech Stack:** TypeScript (ESM, strict, `verbatimModuleSyntax`), pnpm workspace, Vitest, zod. 4-space indent, double quotes, semicolons, trailing commas, `curly: all`.

## Global Constraints

- **TS style:** 4-space indent, double quotes, semicolons, trailing comma (multiline), `curly: all`; strict + `verbatimModuleSyntax`. Enforced by `eslint.config.js`.
- **Schema single source of truth:** every `BenchResult` shape change goes through `packages/result-schema/src/schema.ts`; bump `SCHEMA_VERSION` when the live shape changes.
- **Sandbox:** `pnpm typecheck` / `pnpm test` / `pnpm lint:all` run under the sandbox. `pnpm build:all` / `pnpm smoke` bind a tsx IPC pipe the sandbox blocks — run those with `dangerouslyDisableSandbox: true` (verified `wontfix`).
- **Commits:** agent commits use `--no-gpg-sign`. Commit per task. Push/PR are the user's action.
- **`relSem` must stay finite** (JSON serialization): `mean === 0` → `relSem = 0` (the `subResolution` flag, not `relSem`, carries the "unmeasurable" meaning).
- **Reset is not touched:** `module.reset?.()` stays outside the timed window (its current position). Do not move it inside timing.

---

## File Structure

- `packages/harness/src/stats.ts` — add `mad` + `relSem` to `StatsResult` + `computeStats`.
- `packages/harness/src/types.ts` — `MeasureConfig`: `cvThreshold` → `semThreshold`; add `wallBudgetMs`.
- `packages/harness/src/measure.ts` — SEM-of-mean early-exit + sub-resolution guard + wall-budget backstop.
- `packages/result-schema/src/version.ts` — `SCHEMA_VERSION` 1 → 2.
- `packages/result-schema/src/schema.ts` — `StatsSchema` (+`relSem`/`meanImprecise`/`subResolution`, −`noisy`), `TimingsSchema` (+`warmMad`).
- `apps/runner-node/src/run-case.ts` + `apps/runner-web/src/worker.ts` — build the new stats/timings fields.
- `apps/runner-node/src/main.ts` + `apps/runner-web/src/driver.ts` — config values (`semThreshold`, `maxSamples`, `wallBudgetMs`).
- `packages/reporter/src/impl-order.ts` (**new**) — canonical `IMPL_ORDER` + `implOrderRank`.
- `packages/reporter/src/perf-view-model.ts` — stable impl sort; `PerfDetailRow` field swap.
- `packages/reporter/src/render-perf.ts` — variance-as-finding rendering; sub-resolution badge; `relSem`/`mad` columns.
- `packages/reporter/src/size-data.ts` — align ordering to `IMPL_ORDER`.
- `docs/guidelines.md` — qualitative findings (quantitative refinement deferred to post-re-bench).
- Tests alongside each: `packages/harness/tests/{stats,measure}.test.ts`, `packages/result-schema/tests/schema.test.ts`, `packages/reporter/tests/{perf-view-model,render-perf,size-data}.test.ts`.

---

## Task 1: Robust stats — `mad` + `relSem`

**Files:**
- Modify: `packages/harness/src/stats.ts`
- Test: `packages/harness/tests/stats.test.ts`

**Interfaces:**
- Produces: `StatsResult` gains `mad: number` (median absolute deviation from the median) and `relSem: number` (= `cv/√n`, i.e. `stddev/(mean·√n)`; `0` when `mean === 0`). `computeStats(samples: readonly number[]): StatsResult` unchanged signature.

- [ ] **Step 1: Write the failing test** — append to `packages/harness/tests/stats.test.ts`:

```ts
describe("computeStats robust fields", () => {
    it("computes MAD as the median absolute deviation from the median", () => {
        // [1,2,3,4,5] → median 3 → abs devs [2,1,0,1,2] → median 1
        const s = computeStats([1, 2, 3, 4, 5]);
        expect(s.median).toBe(3);
        expect(s.mad).toBe(1);
    });
    it("computes relSem = stddev / (mean * sqrt(n))", () => {
        const s = computeStats([10, 12, 14, 16, 18]);
        expect(s.relSem).toBeCloseTo(s.stddev / (s.mean * Math.sqrt(s.n)), 12);
    });
    it("keeps relSem finite (0) when mean is 0 (all-zero sub-resolution samples)", () => {
        const s = computeStats([0, 0, 0, 0]);
        expect(s.mean).toBe(0);
        expect(s.cv).toBe(0);
        expect(s.relSem).toBe(0);
        expect(s.min).toBe(0);
    });
});
```

(If `stats.test.ts` does not already `import { computeStats } from "../src/stats.js";`, confirm it does — the existing file imports it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bench/harness test -- stats`
Expected: FAIL — `s.mad`/`s.relSem` are `undefined`.

- [ ] **Step 3: Implement** — in `packages/harness/src/stats.ts`, extend the interface and compute the fields. Replace the `StatsResult` interface and the return block of `computeStats`:

```ts
export interface StatsResult {
    median: number;
    p95: number;
    p99: number;
    stddev: number;
    min: number;
    max: number;
    mean: number;
    cv: number;
    mad: number;
    relSem: number;
    n: number;
}

export function computeStats(samples: readonly number[]): StatsResult {
    if (samples.length === 0) {
        throw new Error("computeStats: empty samples");
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((s, x) => s + x, 0) / n;
    const variance =
        n === 1 ? 0 : sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
    const stddev = Math.sqrt(variance);
    const median = percentile(sorted, 50);
    const absDev = sorted.map((x) => Math.abs(x - median)).sort((a, b) => a - b);
    const mad = percentile(absDev, 50);
    return {
        n,
        min: sorted[0]!,
        max: sorted[n - 1]!,
        mean,
        median,
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        stddev,
        cv: mean === 0 ? 0 : stddev / mean,
        mad,
        relSem: mean === 0 ? 0 : stddev / (mean * Math.sqrt(n)),
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bench/harness test -- stats`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/stats.ts packages/harness/tests/stats.test.ts
git commit --no-gpg-sign -m "feat(harness): add mad + relSem to computeStats"
```

---

## Task 2: Schema — bump version, swap stats fields, add `warmMad`

**Files:**
- Modify: `packages/result-schema/src/version.ts`
- Modify: `packages/result-schema/src/schema.ts:53-78` (`TimingsSchema`, `StatsSchema`)
- Test: `packages/result-schema/tests/schema.test.ts`

**Interfaces:**
- Produces: `SCHEMA_VERSION = 2`. `Stats` = `{ nSamples, cv, relSem, meanImprecise, subResolution }` (no `noisy`). `Timings` gains `warmMad`. Consumers: Tasks 4, 5, 6.

- [ ] **Step 1: Update the test fixture first (it will fail to parse until impl lands)** — in `packages/result-schema/tests/schema.test.ts`, change the sample's `timingsMs` and `stats` and the version assertion:

```ts
            timingsMs: {
                fetch: 1.2, compile: 3.4, instantiate: 0.5, initTotal: 5.1,
                firstCall: 1.0,
                warmMedian: 0.8, warmP95: 1.0, warmP99: 1.1,
                warmStddev: 0.05, warmMin: 0.7, warmMax: 1.2, warmMad: 0.04,
                endToEndMedian: 6.5,
            },
            memory: { wasmMemoryBytesPeak: 65536, wasmMemoryDeltaBytes: 0, jsHeapUsedAfter: null },
            stats: { nSamples: 30, cv: 0.02, relSem: 0.004, meanImprecise: false, subResolution: false },
```

And:

```ts
        const parsed = BenchResultSchema.parse(sample);
        expect(parsed.schemaVersion).toBe(2);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bench/result-schema test`
Expected: FAIL — `warmMad` unknown / `noisy` required / `schemaVersion` literal mismatch.

- [ ] **Step 3: Implement** — `packages/result-schema/src/version.ts`:

```ts
export const SCHEMA_VERSION = 2 as const;
```

In `packages/result-schema/src/schema.ts`, add `warmMad` to `TimingsSchema` (after `warmMax`) and replace `StatsSchema`:

```ts
export const TimingsSchema = z.object({
    fetch: z.number().nonnegative(),
    compile: z.number().nonnegative(),
    instantiate: z.number().nonnegative(),
    initTotal: z.number().nonnegative(),
    firstCall: z.number().nonnegative(),
    warmMedian: z.number().nonnegative(),
    warmP95: z.number().nonnegative(),
    warmP99: z.number().nonnegative(),
    warmStddev: z.number().nonnegative(),
    warmMin: z.number().nonnegative(),
    warmMax: z.number().nonnegative(),
    warmMad: z.number().nonnegative(),
    endToEndMedian: z.number().nonnegative(),
});

export const StatsSchema = z.object({
    nSamples: z.number().int().positive(),
    cv: z.number().nonnegative(),
    relSem: z.number().nonnegative(),
    meanImprecise: z.boolean(),
    subResolution: z.boolean(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bench/result-schema test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/result-schema/src/version.ts packages/result-schema/src/schema.ts packages/result-schema/tests/schema.test.ts
git commit --no-gpg-sign -m "feat(schema): SEM stats (relSem/meanImprecise/subResolution) + warmMad; bump SCHEMA_VERSION to 2"
```

---

## Task 3: Measure loop — SEM gate + sub-resolution guard + wall-budget

**Files:**
- Modify: `packages/harness/src/types.ts:22-28` (`MeasureConfig`)
- Modify: `packages/harness/src/measure.ts:47-85` (sample loop)
- Test: `packages/harness/tests/measure.test.ts`

**Interfaces:**
- Consumes: `computeStats` (Task 1 — `relSem`).
- Produces: `MeasureConfig` = `{ warmupIterations, innerIterations, minSamples, maxSamples, semThreshold, wallBudgetMs }` (renamed `cvThreshold`→`semThreshold`, added `wallBudgetMs`). Early-exit when `relSem ≤ semThreshold` and not sub-resolution; wall-budget stops after `minSamples`. Consumers: Tasks 4, 8, and existing measure tests.

- [ ] **Step 1: Update existing tests + add gate tests** — in `packages/harness/tests/measure.test.ts`: (a) in every `config` literal rename `cvThreshold` → `semThreshold` and add `wallBudgetMs: 100_000`; (b) add a fake-clock helper and three gate tests:

```ts
import { afterEach } from "vitest";

afterEach(() => {
    vi.restoreAllMocks();
});

// Advances performance.now() by `step` ms on every call → each timed run reads a
// constant, non-zero delta (min > 0, so never sub-resolution; stddev 0 → relSem 0).
function constantDeltaClock(step: number): void {
    let t = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
        t += step;
        return t;
    });
}

describe("runMeasure acceptance gate", () => {
    it("early-exits at minSamples when the mean is precise (relSem 0)", async () => {
        constantDeltaClock(0.5);
        const out = await runMeasure({
            module: mockModule({ checksum: 1 }),
            fixture: new Uint8Array([1]),
            expectedChecksum: 1,
            config: { warmupIterations: 0, innerIterations: 1, minSamples: 30, maxSamples: 100, semThreshold: 0.05, wallBudgetMs: 100_000 },
        });
        expect(out.warmSamplesMs.length).toBe(30);
    });

    it("keeps sampling to maxSamples on sub-resolution (all-zero deltas)", async () => {
        vi.spyOn(performance, "now").mockReturnValue(5); // every delta is 0 → min 0 → subResolution
        const out = await runMeasure({
            module: mockModule({ checksum: 1 }),
            fixture: new Uint8Array([1]),
            expectedChecksum: 1,
            config: { warmupIterations: 0, innerIterations: 1, minSamples: 10, maxSamples: 50, semThreshold: 0.05, wallBudgetMs: 100_000 },
        });
        expect(out.warmSamplesMs.length).toBe(50);
    });

    it("stops at the wall-budget backstop when precision is unreachable", async () => {
        constantDeltaClock(0.5);
        const out = await runMeasure({
            module: mockModule({ checksum: 1 }),
            fixture: new Uint8Array([1]),
            expectedChecksum: 1,
            // semThreshold negative → relSem (0) can never satisfy it; wallBudget 0 → stop at minSamples
            config: { warmupIterations: 0, innerIterations: 1, minSamples: 30, maxSamples: 1000, semThreshold: -1, wallBudgetMs: 0 },
        });
        expect(out.warmSamplesMs.length).toBe(30);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bench/harness test -- measure`
Expected: FAIL — `semThreshold` not on config type / gate not implemented.

- [ ] **Step 3: Implement config type** — `packages/harness/src/types.ts`, replace `MeasureConfig`:

```ts
export interface MeasureConfig {
    warmupIterations: number;
    innerIterations: number;
    minSamples: number;
    maxSamples: number;
    semThreshold: number;
    wallBudgetMs: number;
}
```

- [ ] **Step 4: Implement the loop** — `packages/harness/src/measure.ts`, replace the sample-loop block (from `const samples` through the closing `}` of the `while`) with:

```ts
    const samples: number[] = [];
    let lastChecksum: number | string = firstResult.checksum;
    const loopStart = performance.now();

    while (samples.length < config.maxSamples) {
        module.reset?.();
        const t0 = performance.now();
        const r = module.run(config.innerIterations);
        const t1 = performance.now();
        samples.push(t1 - t0);
        if (debugTimings) {
            // eslint-disable-next-line no-console
            console.log(`[bench-debug] sample ${samples.length}: ${(t1 - t0).toFixed(6)} ms`);
        }
        lastChecksum = r.checksum;

        if (!eqChecksum(r.checksum, expectedChecksum)) {
            return {
                firstCallMs,
                warmSamplesMs: samples,
                finalChecksum: r.checksum,
                correctnessFailed: true,
            };
        }

        if (samples.length >= config.minSamples) {
            const stats = computeStats(samples);
            // A sub-resolution cell (a sample rounded to 0) reports cv=0 → relSem=0,
            // which would spuriously pass the precision gate. Guard: never accept on
            // precision while min===0; keep sampling to pin the (nonzero) mean.
            const subResolution = stats.min === 0;
            if (!subResolution && stats.relSem <= config.semThreshold) {
                break;
            }
            if (performance.now() - loopStart > config.wallBudgetMs) {
                break;
            }
        }
    }
```

Add the `computeStats` import at the top if not present (it already is: `import { computeStats } from "./stats.js";`).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @bench/harness test -- measure`
Expected: PASS (all existing + 3 new).

- [ ] **Step 6: Commit**

```bash
git add packages/harness/src/types.ts packages/harness/src/measure.ts packages/harness/tests/measure.test.ts
git commit --no-gpg-sign -m "feat(harness): SEM-of-mean gate + sub-resolution guard + wall-budget backstop"
```

---

## Task 4: Result assemblers — build the new stats/timings fields

**Files:**
- Modify: `apps/runner-node/src/run-case.ts:134-136,174-197`
- Modify: `apps/runner-web/src/worker.ts:139-141,199-223`

**Interfaces:**
- Consumes: `computeStats` (`mad`, `relSem`), `MeasureConfig.semThreshold` (Task 3), schema fields (Task 2).
- Produces: assembled `BenchResult` with `timingsMs.warmMad`, `stats.{relSem,meanImprecise,subResolution}`. No unit test (integration path); gated by `typecheck` + `smoke`.

- [ ] **Step 1: `run-case.ts` — extend the empty-stats fallback** (line ~134). Replace:

```ts
    const stats = measure.warmSamplesMs.length > 0
        ? computeStats(measure.warmSamplesMs)
        : { median: 0, p95: 0, p99: 0, stddev: 0, min: 0, max: 0, mean: 0, cv: 0, mad: 0, relSem: 0, n: 0 };
```

- [ ] **Step 2: `run-case.ts` — add `warmMad` to `timingsMs`** (after `warmMax: stats.max,`):

```ts
            warmMax: stats.max,
            warmMad: stats.mad,
```

- [ ] **Step 3: `run-case.ts` — rewrite the `stats` block** (line ~193). Replace:

```ts
        stats: {
            nSamples: Math.max(stats.n, 1),
            cv: stats.cv,
            relSem: stats.relSem,
            meanImprecise: stats.relSem > input.measureConfig.semThreshold,
            subResolution: stats.min === 0,
        },
```

- [ ] **Step 4: `worker.ts` — mirror all three edits** — the empty fallback (line ~139, add `mad: 0, relSem: 0`), `warmMad: stats.mad` after `warmMax` (line ~210), and the `stats` block (line ~218):

```ts
            stats: {
                nSamples: Math.max(stats.n, 1),
                cv: stats.cv,
                relSem: stats.relSem,
                meanImprecise: stats.relSem > i.measureConfig.semThreshold,
                subResolution: stats.min === 0,
            },
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (both apps compile against schema v2 + `MeasureConfig.semThreshold`).

- [ ] **Step 6: Commit**

```bash
git add apps/runner-node/src/run-case.ts apps/runner-web/src/worker.ts
git commit --no-gpg-sign -m "feat(runners): assemble relSem/meanImprecise/subResolution + warmMad"
```

---

## Task 5: Reporter — canonical `IMPL_ORDER` + stable perf ordering

**Files:**
- Create: `packages/reporter/src/impl-order.ts`
- Modify: `packages/reporter/src/perf-view-model.ts`
- Test: `packages/reporter/tests/perf-view-model.test.ts`

**Interfaces:**
- Produces: `IMPL_ORDER: readonly string[]`, `implOrderRank(language: string, toolchain: string): number` (from `impl-order.ts`). `PerfDetailRow` swaps `noisy: boolean` for `relSem: number; meanImprecise: boolean; subResolution: boolean; warmMad: number` (keeps `cv`). Consumers: Tasks 6, 7.

- [ ] **Step 1: Write the failing test** — in `packages/reporter/tests/perf-view-model.test.ts`: (a) update `fakeResult` fixture to schema v2 — change `schemaVersion: 1` → `2`, add `warmMad: 0.04` to `timingsMs`, and replace `stats:` with `stats: { nSamples: 30, cv: 0.01, relSem: 0.002, meanImprecise: false, subResolution: false }`; (b) add:

```ts
    it("orders impls canonically (js, rust, cpp) regardless of speed", () => {
        // Input deliberately scrambled + slower js than rust: order must NOT follow warmMedian.
        const results = [
            fakeResult({ id: "matmul", language: "cpp", toolchain: "wasi-sdk", profile: "speed", inputSize: "L" }, 0.10, "node"),
            fakeResult({ id: "matmul", language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, 0.30, "node"),
            fakeResult({ id: "matmul", language: "cpp", toolchain: "emscripten", profile: "speed", inputSize: "L" }, 0.20, "node"),
        ];
        const wl = buildPerfModel(aggregate(results)).workloads.find((w) => w.id === "matmul")!;
        const slice = wl.slices.find((s) => s.size === "L" && s.profile === "speed")!;
        expect(slice.multiples.map((m) => m.impl)).toEqual([
            "rust/raw/speed", "cpp/emscripten/speed", "cpp/wasi-sdk/speed",
        ]);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bench/reporter test -- perf-view-model`
Expected: FAIL — order follows warmMedian (`rust/raw` 0.30 would sort last).

- [ ] **Step 3: Create `packages/reporter/src/impl-order.ts`:**

```ts
// Canonical (language, toolchain) order, taken from spec.json `supported`
// declaration order. Applied to BOTH the perf and size tabs so a given
// toolchain always sits in the same row/segment position — the alternative
// (sorting by measured speed) makes positions jump cell-to-cell.
export const IMPL_ORDER: readonly string[] = [
    "js/idiomatic",
    "js/typed-array",
    "rust/raw",
    "rust/bindgen",
    "cpp/emscripten",
    "cpp/wasi-sdk",
];

export function implOrderRank(language: string, toolchain: string): number {
    const i = IMPL_ORDER.indexOf(`${language}/${toolchain}`);
    return i < 0 ? IMPL_ORDER.length : i;
}
```

- [ ] **Step 4: Rewrite the two sorts + `PerfDetailRow` in `perf-view-model.ts`.**

Add the import at the top:

```ts
import { implOrderRank } from "./impl-order.js";
```

Add a helper near `implKey` (impl keys are `js/<tc>` or `<lang>/<tc>/<profile>`; the first two segments fully order within a slice):

```ts
function implKeyRank(implKey: string): number {
    const [language, toolchain] = implKey.split("/");
    return implOrderRank(language ?? "", toolchain ?? "");
}
```

Replace the `multiples.sort(...)` block (currently `perf-view-model.ts:108-112`) with:

```ts
    multiples.sort((a, b) => implKeyRank(a.impl) - implKeyRank(b.impl) || a.impl.localeCompare(b.impl));
```

Delete the now-unused `implRepWm` map (currently `:120-127`) and replace the `detail.sort(...)` block (`:146-156`) with:

```ts
    const envRankFor = (env: string): number => {
        const i = ENV_ORDER.indexOf(env);
        return i < 0 ? ENV_ORDER.length : i;
    };
    detail.sort((a, b) =>
        implKeyRank(a.impl) - implKeyRank(b.impl)
        || a.impl.localeCompare(b.impl)
        || envRankFor(a.env) - envRankFor(b.env)
        || a.env.localeCompare(b.env));
```

Remove the old `envRank` const (`:116-119`) — replaced by `envRankFor`. If `pickRepresentativeWm` is now unreferenced, delete it (`:161-173`) to satisfy `no-unused-vars`; if any reference remains, leave it.

Update `PerfDetailRow` (`:12-23`) — swap `noisy` for the new fields:

```ts
export interface PerfDetailRow {
    impl: string;
    env: string;
    initTotal: number;
    firstCall: number;
    warmMedian: number;
    warmP95: number;
    warmMad: number;
    cv: number;
    relSem: number;
    meanImprecise: boolean;
    subResolution: boolean;
    correctnessFailed: boolean;
    validated: boolean;
}
```

Update the `detail.push({...})` mapping (`:132-143`) to source the new fields:

```ts
            detail.push({
                impl,
                env,
                initTotal: r.timingsMs.initTotal,
                firstCall: r.timingsMs.firstCall,
                warmMedian: r.timingsMs.warmMedian,
                warmP95: r.timingsMs.warmP95,
                warmMad: r.timingsMs.warmMad,
                cv: r.stats.cv,
                relSem: r.stats.relSem,
                meanImprecise: r.stats.meanImprecise,
                subResolution: r.stats.subResolution,
                correctnessFailed: r.quality.correctnessFailed,
                validated: r.quality.validated,
            });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @bench/reporter test -- perf-view-model`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/reporter/src/impl-order.ts packages/reporter/src/perf-view-model.ts packages/reporter/tests/perf-view-model.test.ts
git commit --no-gpg-sign -m "feat(reporter): canonical IMPL_ORDER for stable perf ordering; PerfDetailRow SEM fields"
```

---

## Task 6: Reporter — variance-as-finding rendering

**Files:**
- Modify: `packages/reporter/src/render-perf.ts:50-53,152-183`
- Test: `packages/reporter/tests/render-perf.test.ts`

**Interfaces:**
- Consumes: `PerfDetailRow` (Task 5).
- Produces: detail table with `mad` + `relSem` columns; amber row only for `meanImprecise`; `subResolution` shown as a neutral `<res` badge; `cv` column neutral (no red).

- [ ] **Step 1: Update the existing test + add coverage** — in `packages/reporter/tests/render-perf.test.ts`: (a) update `fakeResult` to schema v2 (`schemaVersion: 2`, add `warmMad: 0.04` to `timingsMs`, replace `stats:` with `{ nSamples: 30, cv: 0.01, relSem: 0.002, meanImprecise: false, subResolution: false }`); (b) replace the `"flags noisy and fail rows"` test with:

```ts
    it("flags imprecise-mean (amber) and fail rows, and a sub-resolution badge", () => {
        const results = [
            fakeResult({ language: "rust", toolchain: "raw" }, 1.0, "node"),
            fakeResult({ language: "rust", toolchain: "bindgen" }, 2.0, "node"),
            fakeResult({ language: "cpp", toolchain: "emscripten" }, 3.0, "node"),
        ];
        results[0]!.stats.meanImprecise = true;
        results[1]!.quality.correctnessFailed = true;
        results[2]!.stats.subResolution = true;
        const html = renderPerfView(aggregate(results));
        expect(html).toContain('tr class="noisy"');   // imprecise mean → amber row
        expect(html).toContain('class="hatch"');
        expect(html).toContain('tr class="fail"');
        expect(html).toContain('class="hatch-fail"');
        expect(html).toContain("&lt;res");            // sub-resolution badge
    });

    it("renders relSem and mad columns in the detail table", () => {
        const html = renderPerfView(aggregate([fakeResult({}, 1.0, "node")]));
        expect(html).toContain(">relSem<");
        expect(html).toContain(">mad<");
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bench/reporter test -- render-perf`
Expected: FAIL — `row.noisy` gone / no `relSem`/`mad` columns / no `<res` badge.

- [ ] **Step 3: Implement.** In `render-perf.ts`, add a CSS rule for the badge (append inside `PERF_CSS`, before the closing backtick, e.g. after the `.hatch-fail` line):

```
.subres{font:600 8px ui-monospace,monospace;color:#8a93a0;margin-left:5px;vertical-align:super}
```

Replace `renderDetailRow` (`:152-166`):

```ts
function renderDetailRow(row: PerfDetailRow, maxInit: number, maxWarm: number): string {
    const isFail = row.correctnessFailed;
    const isImprecise = !isFail && row.meanImprecise;

    const trClass = isFail ? ' class="fail"' : isImprecise ? ' class="noisy"' : "";
    const warmFillClass = isFail ? "hatch-fail" : isImprecise ? "hatch" : "";
    const okClass = isFail ? ' class="failx"' : "";
    const okMark = row.validated ? "✓" : "✗";
    const badge = row.subResolution ? '<span class="subres">&lt;res</span>' : "";

    const initCell = `<td>${renderDataBar(row.initTotal, maxInit, "")}</td>`;
    const warmCell = `<td>${renderDataBar(row.warmMedian, maxWarm, warmFillClass)}</td>`;

    return `<tr${trClass}><td>${escape(row.impl)}${badge}</td><td>${escape(row.env)}</td>${initCell}<td>${row.firstCall.toFixed(3)}</td>${warmCell}<td>${row.warmP95.toFixed(3)}</td><td>${row.warmMad.toFixed(3)}</td><td>${row.cv.toFixed(3)}</td><td>${row.relSem.toFixed(3)}</td><td${okClass}>${okMark}</td></tr>`;
}
```

Update the table header in `renderPerfDetail` (`:178`) to match the new columns:

```ts
<thead><tr><th>impl</th><th>env</th><th>init</th><th>first</th><th>warm med</th><th>p95</th><th>mad</th><th>cv</th><th>relSem</th><th>ok</th></tr></thead>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bench/reporter test -- render-perf`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reporter/src/render-perf.ts packages/reporter/tests/render-perf.test.ts
git commit --no-gpg-sign -m "feat(reporter): variance-as-finding — mad/relSem columns, sub-resolution badge, amber only on imprecise mean"
```

---

## Task 7: Reporter — align size-tab ordering to `IMPL_ORDER`

**Files:**
- Modify: `packages/reporter/src/size-data.ts:43`
- Test: `packages/reporter/tests/size-data.test.ts`

**Interfaces:**
- Consumes: `implOrderRank` (Task 5).

- [ ] **Step 1: Write the failing test** — append to the `describe("buildSizeData", ...)` block:

```ts
    it("orders same-workload binaries by IMPL_ORDER (js, rust, cpp), not alphabetically", () => {
        const mk = (language: string, toolchain: string) =>
            meta({ combination: { benchmarkId: "matmul", language, toolchain, profile: "speed" } });
        const d = buildSizeData([mk("cpp", "wasi-sdk"), mk("rust", "raw"), mk("js", "idiomatic")]);
        expect(d.binaries.map((x) => x.label)).toEqual([
            "js/idiomatic/speed", "rust/raw/speed", "cpp/wasi-sdk/speed",
        ]);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bench/reporter test -- size-data`
Expected: FAIL — current sort is alphabetical (`cpp` first).

- [ ] **Step 3: Implement** — add the import and replace the sort (`size-data.ts:43`):

```ts
import { implOrderRank } from "./impl-order.js";
```

```ts
    binaries.sort((a, b) =>
        a.id.localeCompare(b.id)
        || implOrderRank(a.language, a.toolchain) - implOrderRank(b.language, b.toolchain)
        || a.profile.localeCompare(b.profile));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bench/reporter test -- size-data`
Expected: PASS (and the existing "sorts by id then label" test stays green — its ids differ, so id sort dominates).

- [ ] **Step 5: Commit**

```bash
git add packages/reporter/src/size-data.ts packages/reporter/tests/size-data.test.ts
git commit --no-gpg-sign -m "feat(reporter): align size-tab ordering to canonical IMPL_ORDER"
```

---

## Task 8: Runner configs — semThreshold / maxSamples / wall-budget

**Files:**
- Modify: `apps/runner-node/src/main.ts:40-42`
- Modify: `apps/runner-web/src/driver.ts:61-63`

**Interfaces:**
- Consumes: `MeasureConfig` (Task 3).

- [ ] **Step 1: `main.ts` (node)** — replace the config ternary (`:40-42`):

```ts
    const config = a.mode === "quick"
        ? { warmupIterations: 3, innerIterations: 1, minSamples: 5, maxSamples: 20, semThreshold: 0.10, wallBudgetMs: 200 }
        : { warmupIterations: 10, innerIterations: 1, minSamples: 30, maxSamples: 200, semThreshold: 0.03, wallBudgetMs: 1000 };
```

- [ ] **Step 2: `driver.ts` (browser)** — replace `baseMeasureConfig` (`:61-63`):

```ts
        const baseMeasureConfig = input.mode === "quick"
            ? { warmupIterations: 3, innerIterations: 1, minSamples: 5, maxSamples: 20, semThreshold: 0.10, wallBudgetMs: 300 }
            : { warmupIterations: 10, innerIterations: 1, minSamples: 30, maxSamples: 512, semThreshold: 0.03, wallBudgetMs: 2000 };
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/runner-node/src/main.ts apps/runner-web/src/driver.ts
git commit --no-gpg-sign -m "feat(runners): SEM config — semThreshold 0.03 eval, maxSamples up, wall-budget"
```

---

## Task 9: Guidelines — qualitative findings

**Files:**
- Modify: `docs/guidelines.md`

**Note:** quantitative variance numbers (e.g. "~18 % L|browser") depend on a post-implementation re-bench and are **out of scope here** — add only claims true regardless of the exact re-benched percentages. Follow the file's format (`###` claim + `**Status/Evidence/Phase/Caveats**`); read the header first.

- [ ] **Step 1: Refine the existing sub-resolution entry** (currently `guidelines.md:188`) so it names the measured floors and the metric framing. Ensure it reads (adjust to the surrounding bucket/format):

```markdown
### Sub-10–20 µs operations are unmeasurable per-call in-browser — compare at M
**Status:** confirmed
**Evidence:** `docs/superpowers/specs/2026-06-30-benchmark-cv-stabilization-design.md` (measured `performance.now()` floors); `results/raw/2026-06-25T22-11-21-860Z`
**Phase:** introduced 1.1 / refined (CV-stabilization)
**Caveats:** applies to browser only; Node resolves ~40 ns.

Cross-origin isolation (COOP+COEP) is already enabled, giving Chromium 5 µs and Firefox 20 µs
`performance.now()` resolution — the floor cannot be lowered further (disabling `reduceTimerPrecision`
has no effect; only a SharedArrayBuffer counter-thread beats it, not worth it). A single call below
that floor is unmeasurable; only the mean is recoverable (averaging is unbiased under quantization).
Use the M tier for these workloads.
```

- [ ] **Step 2: Add a measurement-methodology claim:**

```markdown
### Read measurement precision (SEM) separately from operation variance (spread)
**Status:** confirmed
**Evidence:** `results/raw/2026-06-25T22-11-21-860Z` (offline re-analysis: 47 % CV-flagged → 16 % under a 3 % SEM gate)
**Phase:** introduced (CV-stabilization)
**Caveats:** none — this is how to read the perf tab.

A high run-to-run spread (CV) does not mean the *mean* is imprecise: with n samples the mean's error is
`CV/√n`. The reporter accepts a cell on `relSem` (SEM of the mean) and reports the spread (MAD/CV) as a
property of the operation, not a failure. Large wasm operations in-browser carry real run-to-run
variance (GC / event-loop / scheduling) even when their mean is precise — budget for it; do not read it
as measurement error.
```

- [ ] **Step 3: Commit**

```bash
git add docs/guidelines.md
git commit --no-gpg-sign -m "docs(guidelines): sub-resolution floor + precision-vs-variance reading"
```

---

## Execution Protocol

**Routing (hybrid inline/subagent).** Every task is fully specified with exact code and a single package's test cycle, so all tasks are **`[I]` inline** — do not dispatch subagents and do not re-ask the harness (all-`[I]` ⇒ inline, per project convention). If, while executing, a task's actual edit turns out materially larger than written (e.g. `pickRepresentativeWm` has unexpected references, or a render assertion needs restructuring), escalate that single task to a subagent with the **full** gate set (`pnpm typecheck && pnpm lint:all && pnpm --filter <pkg> test`), not a subset.

**Wave-0 baseline gate (before Task 1).** Confirm a green start: `pnpm typecheck && pnpm lint:all && pnpm test` (sandbox-OK). If red before any edit, stop and report — do not build on a broken base.

**Waves + static break-points:**
- **Wave 1 — harness core:** Task 1 → Task 3. Gate: `pnpm --filter @bench/harness test && pnpm typecheck`.
- **Wave 2 — schema + assemblers + config:** Task 2 → Task 4 → Task 8. Gate: `pnpm --filter @bench/result-schema test && pnpm typecheck`, then the end-to-end check `pnpm build:all && pnpm smoke` (**`dangerouslyDisableSandbox: true`** — tsx pipe). **BREAK-POINT:** first point where a real run validates the new pipeline end-to-end; recommend `/finish-session` decision to the user here.
- **Wave 3 — reporter:** Task 5 → Task 6 → Task 7. Gate: `pnpm --filter @bench/reporter test && pnpm typecheck && pnpm lint:all`.
- **Wave 4 — docs:** Task 9. Gate: prose read.

**Per-task break-check.** After each task: run its Step gate; if it fails twice on the same approach, STOP and rethink (retry budget ≤2, per CLAUDE.md) — do not keep hammering. Commit only on green.

**Landing gate (before declaring done).**
1. Full pre-flight: `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke` (build/smoke need `dangerouslyDisableSandbox: true`).
2. **Visual deliverable check (iterate Phase 7):** the reporter is a rendered artifact — regenerate a report from `results/raw/` and OPEN it. Eyeball: (a) perf + size tabs list impls in one stable order (js → rust → cpp) across every cell; (b) the detail table shows `mad` + `relSem` columns; (c) sub-resolution cells show the `<res` badge and high-variance-but-precise cells are NOT painted amber. Gates do not catch render regressions.
3. **Spec-coverage diff:** confirm every spec § maps to a task; note explicitly that the **re-bench** and its **quantitative guideline numbers** are a deferred user action (not in this plan), and that the spec's **Wave-0 live re-analysis** of the SEM drop should be run against the fresh re-benched data.
4. **Schema-break note:** `SCHEMA_VERSION` is now 2 — the reporter will reject pre-existing v1 `results/raw/` JSON; a re-bench regenerates them (expected, per spec).

**Hand-off.** Push + PR are the user's action (CLAUDE.md § Commits): provide `git push -u origin feature/benchmark-cv-stabilization` + the GitHub compare link.

---

## Self-Review

**Spec coverage:** SEM gate → T3; robust dispersion (MAD) → T1/T4/T6; sub-resolution flag → T3/T4/T6; schema (relSem/meanImprecise/subResolution/warmMad, version bump) → T2; assemblers → T4; config (semThreshold 3 %, maxSamples, wall-budget) → T8; reporter variance-as-finding → T6; stable IMPL_ORDER (perf + size) → T5/T7; guidelines → T9 (qualitative; quantitative deferred to re-bench, flagged in landing gate). "Out of scope" spec items (batching, innerIterations, reset, calibration, Phase C, caffeinate) have no task — correct.

**Placeholder scan:** every code step carries complete code; test steps carry real assertions; commands have expected output. No TBD/TODO.

**Type consistency:** `StatsResult.{mad,relSem}` (T1) consumed by T3 gate + T4 assemblers + T6 columns. `MeasureConfig.semThreshold`/`wallBudgetMs` (T3) consumed by T4 (`meanImprecise`) + T8 configs + measure tests. Schema `stats.{relSem,meanImprecise,subResolution}` + `timingsMs.warmMad` (T2) produced by T4, consumed by T5 `PerfDetailRow` + T6 render. `implOrderRank` (T5, `impl-order.ts`) consumed by T5 perf + T7 size. `PerfDetailRow` field swap (T5) consumed by T6 render. Names align across tasks.
