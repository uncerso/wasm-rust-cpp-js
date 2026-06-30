# Benchmark CV Stabilization — Design Spec

**Date:** 2026-06-30  
**Branch:** `feature/benchmark-cv-stabilization`

## Problem

66 % of cells in the latest benchmark run are flagged as noisy (CV > 5 %). Breakdown by size × env (2026-06-25 run, 1161 results):

| size × env   | noisy % | warmMs p50 | dominant cause                          |
|--------------|---------|------------|-----------------------------------------|
| S \| node    | 73 %    | 21 µs      | timer noise (1 µs resolution)           |
| S \| browser | 84 %    | 20 µs      | timer noise + Firefox 1 ms quantization |
| M \| node    | 23 %    | 257 µs     | marginal (close to threshold)           |
| M \| browser | 57 %    | 260 µs     | browser GC jitter                       |
| L \| node    | 5 %     | 3 000 µs   | acceptable                              |
| L \| browser | 18 %    | 2 700 µs   | browser GC jitter (manageable)          |

Root causes in order of impact:

1. **Sub-µs timer noise** — `performance.now()` on macOS has ~1 µs real resolution. A 5 µs sample (shape_dispatch S) has inherent CV ≈ 20 % from quantization alone. Most noisy cells.
2. **Firefox 1 ms artificial quantization** — privacy feature. For sub-1 ms samples, many measurements round to 0 ms; CV is 100 % or undefined. Affects all S-size browser cases.
3. **Browser GC / event-loop jitter** — sporadic high-latency samples inflate CV even at 260 µs. Median is robust but not enough at maxSamples=100.
4. **CPU throttling** — NOT a major factor on this machine: L|node at 5 % noisy with 3 ms samples shows frequency is stable. Deferred.

## Approach: time-based adaptive batching

After warmup, calibrate a `batchSize` B so that each measurement window covers at least `targetSampleMs` of wall-clock compute. Each "sample" then times B consecutive `run(innerIterations)` calls as a group.

CV reduction: `CV_batched ≈ CV_single / sqrt(B)` (independent error model).

Projected improvement:

| case                              | singleRunMs | B (node) | B (browser) | CV_node → target | CV_browser → target |
|-----------------------------------|-------------|----------|-------------|------------------|---------------------|
| shape_dispatch S (5 µs/run)       | 0.005       | 1 000    | 4 000       | 45 % → 1.4 %     | 45 % → 0.7 %        |
| hashmap_int lookup S (15 µs/run)  | 0.015       | 334      | 1 334       | 46 % → 2.5 %     | 46 % → 1.3 %        |
| hashmap_int M (140 µs/run)        | 0.14        | 36       | 143         | 9 % → 1.5 %      | 9 % → 0.75 %        |
| matmul S (110 µs/run)             | 0.11        | 46       | 182         | 4.6 % → 0.7 %    | 4.6 % → 0.3 %       |
| matmul M (6 ms/run)               | 6           | 1        | 1           | unchanged        | unchanged           |

For Firefox S-size (1 ms quantization): B=4000, sample=20 ms. Quantization contribution ≈ 0.5 ms / 20 ms = 2.5 % CV. Plus real variance ≈ 5–10 %. Some Firefox S cases may remain above 5 % threshold → addressed in Phase C (per-env threshold, separate decision after re-bench).

## Measurement loop semantics

**Calibration** (once, after warmup):

```
module.reset?.()
calStart = performance.now()
module.run(config.innerIterations)
singleRunMs = performance.now() - calStart
batchSize = max(1, min(config.maxBatchSize, ceil(config.targetSampleMs / singleRunMs)))
```

**Sample loop** (existing early-exit logic preserved):

```
module.reset?.()           // NOT timed; establishes fresh state
t0 = performance.now()
for b in 0..batchSize:
    r = module.run(config.innerIterations)   // timed
    assert checksum(r) == expectedChecksum   // correctness gate, all sub-runs
    if b < batchSize-1: module.reset?.()     // timed (amortized reset cost)
t1 = performance.now()
samples.push((t1 - t0) / batchSize)
```

**Why reset is inside timing for b > 0:** keeping `reset()` outside timing requires B separate `performance.now()` calls per sample (batchSize×2 vs 2), adding ~800 µs overhead at B=4000. For stateful workloads, reset is O(n) wasm memory clear — fast and consistent (< 1 µs at S size). Resulting inflation: ≤ 10 % for hashmap S; 0 % for matmul / interop_calls. All toolchains are affected equally, so cross-toolchain comparisons remain valid.

**batchSize=1 is byte-identical to the current loop.** No regression for L-size workloads or any future workload where singleRunMs ≥ targetSampleMs.

**Checksum validation** happens inside the timed window (O(1) compare ≈ 100 ns, negligible). For stateful workloads, each sub-run starts from a fresh state because `reset()` precedes it (b=0 reset before t0; b>0 reset at the bottom of the previous iteration). All sub-run checksums must equal `expectedChecksum`.

## Config values

| runner     | mode  | targetSampleMs | maxBatchSize | notes                                  |
|------------|-------|----------------|--------------|----------------------------------------|
| node       | eval  | 5              | 4 000        | 1 µs timer → 5 ms well above noise    |
| node       | quick | 1              | 100          | quick stays fast, partial improvement |
| browser    | eval  | 20             | 4 000        | Firefox 1 ms → need 20 ms minimum     |
| browser    | quick | 5              | 100          | quick stays fast                       |

## Files changed

| file                                           | change                                              |
|------------------------------------------------|-----------------------------------------------------|
| `packages/harness/src/types.ts`                | Add `targetSampleMs`, `maxBatchSize` to `MeasureConfig` |
| `packages/harness/src/measure.ts`              | Calibration + batched sample loop; return `batchSize` in `MeasureOutput` |
| `packages/result-schema/src/schema.ts`         | Add `stats.batchSize: z.number().int().positive()`; bump `SCHEMA_VERSION` |
| `apps/runner-node/src/main.ts`                 | Add `targetSampleMs` + `maxBatchSize` to eval/quick configs |
| `apps/runner-web/src/driver.ts`                | Same, browser values                                |
| `packages/reporter/src/render-perf.ts`         | `×B` annotation in detail row when batchSize > 1   |
| `packages/harness/tests/measure.test.ts`       | Update existing configs; add batching test          |
| `packages/result-schema/tests/schema.test.ts`  | Add `batchSize` field coverage                      |

## Out of scope

- Per-env CV threshold (Phase C — assess after re-bench)
- `caffeinate` pre-flight (CPU throttling not dominant)
- spec.json innerIterations changes (Approach B — not needed)
- Guidelines update — deferred to after re-bench (needs empirical data)

## Risk register

| risk                                                      | likelihood | mitigation                                                   |
|-----------------------------------------------------------|------------|--------------------------------------------------------------|
| Calibration run lands on GC pause → wrong batchSize      | medium     | Acceptable: batchSize=1 is the worst case (current behavior); batchSize overestimated → slower, not wrong |
| Firefox S-size CV still > 5 % despite B=4000             | medium     | Expected; Phase C (browser threshold) addresses the residual |
| Total bench runtime increase exceeds budget               | low        | Browser S-size grows from < 1 s to ~2–3 min; full run still < 60 min |
| Schema bump breaks reporter on old raw results            | low        | Old `results/raw/` are gitignored; reporter gets new field with safe default |

## Expected post-fix state

After re-bench (separate user action after implementation):

- S \| node: noisy % drops from 73 % → ~5 %
- M \| node: 23 % → ~3 %
- S \| browser: 84 % → ~20–30 % (Firefox 1 ms residual)
- M \| browser: 57 % → ~10–15 %
- L sizes: unchanged (already good)

Phase C decision point: if browser S/M residual is acceptable (guidelines readable), no threshold change needed. If not, raise browser `cvThreshold` from 5 % to 15 %.
