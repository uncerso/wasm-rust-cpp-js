# Benchmark CV Stabilization — Design Spec

**Date:** 2026-06-30 (redesigned 2026-07-01 after empirical diagnosis)
**Branch:** `feature/benchmark-cv-stabilization`

> **Redesign note.** The original spec proposed time-based adaptive batching, sized around
> two premises: "node timer ~1 µs" and "Firefox 1 ms quantization". Both were **measured false**
> (see § Diagnosis). The corrected finding: ~9/10 of "noisy" cells are a **metric artifact** — the
> acceptance gate thresholds sample *spread* (CV) where it should threshold *precision of the mean*
> (SEM). This spec is therefore statistics-first: fix the metric on honest data; do **not** batch.

## Problem

In the reference run (`results/raw/2026-06-25T22-11-21-860Z`, 1161 cells), **47 %** of cells are
flagged `noisy` (the stored flag is exactly `cv > 0.05`). The original spec cited 66 %; the actual
referenced run is 47 % — the headline number was itself off.

The `noisy` flag drives two things: early-exit (stop sampling once `cv ≤ cvThreshold`) and a red
"unreliable" badge in the reporter. Both use `cv` = sample standard deviation ÷ mean — a measure of
**how variable single calls are**, not of **how precisely we estimated the mean**. Those are
different questions, and conflating them is the root defect.

## Diagnosis

### Measured timer resolution (this machine, current COOP+COEP setup)

`performance.now()` resolution, probed by busy-loop (min observable tick):

| context                                   | crossOriginIsolated | resolution |
|-------------------------------------------|---------------------|------------|
| node v22                                  | —                   | **~40–84 ns** |
| Chromium (headless, COEP)                 | true                | **5 µs**   |
| Firefox (current driver config)           | true                | **20 µs**  |
| Firefox (`privacy.reduceTimerPrecision=false`) | true           | 20 µs (no change) |

Corrections to the original spec's premises:

1. **Firefox is 20 µs, not 1 ms.** COOP+COEP (Wave 4, `vite.config.ts`) already lifts Firefox out
   of the default 1 ms clamp to the cross-origin-isolated 20 µs floor. This is already recorded in
   the project's own docs (`docs/superpowers/notes/2026-05-05-perf-now-precision.md`,
   `docs/guidelines.md:188`); the original spec regressed to the pre-COEP 1 ms from general knowledge.
2. **node is ~40 ns, not 1 µs.** `process.hrtime.bigint()` gives the same — no gain from switching.
3. **`privacy.reduceTimerPrecision=false` does nothing** — 20 µs is the COI clamp floor, and COEP
   already selected it. The only sub-20 µs path is a SharedArrayBuffer counter-thread hack
   (overkill, fragile). Timer precision is **already maxed**; there is no lever left there.

### The metric conflation, quantified

Re-analysing the reference run offline: `relSEM = cv / √nSamples` is the relative standard error of
the mean. A cell whose mean is precise to ≤ 5 % (`relSEM ≤ 0.05`) needs no more data, regardless of
its spread.

| size × env    | N   | noisy (cv>5 %) | pass `relSEM≤5 %` | pass `relSEM≤3 %` (chosen) | sub-resolution (`warmMin=0`) |
|---------------|-----|----------------|-------------------|----------------------------|------------------------------|
| S \| node     | 129 | 73 %           | 90 %              | 82 %                       | 0 %                          |
| S \| browser  | 258 | 84 %           | 71 %              | 45 %                       | **37 %**                     |
| M \| node     | 129 | 23 %           | 97 %              | 96 %                       | 0 %                          |
| M \| browser  | 258 | 57 %           | 99 %              | 97 %                       | 0 %                          |
| L \| node     | 129 | 5 %            | 100 %             | 98 %                       | 0 %                          |
| L \| browser  | 258 | 18 %           | 100 %             | 99 %                       | 0 %                          |
| **TOTAL**     |1161 | **47 %**       | **92 %**          | **84 %**                   | 8 %                          |

Reading: switching the gate from CV-of-spread to SEM-of-mean drops flagged cells **47 % → 16 %** at
the chosen 3 % threshold, touching nothing about how data is collected. Note these pass-rates are at
the reference run's sample counts (n ≤ 100) — a **lower bound**; raising `maxSamples` lets resolvable
cells reach the target, so the live residual converges toward the sub-resolution floor (~8 %). Example:
L \| browser at 18 % CV with n=100 has `relSEM = 0.18/10 = 1.8 %` — the mean is precise; the 18 % is
real GC/scheduling variance, which is a **product finding**, not a measurement failure. The residual
after gating concentrates in **S \| browser** (45 % pass at n≤100; 37 % sub-resolution).

### The two real residuals

Everything except **S \| browser** is essentially a metric artifact. The genuine residuals:

1. **S \| browser sub-resolution** — 37 % of cells have a single call below the 5/20 µs timer floor
   (`warmMin = 0`). The mean is still recoverable (quantization with random phase is **unbiased**:
   a 5 µs op read on a 20 µs clock averages to 5 µs), but needs more samples (worst cells ~400,
   ≈ 8 ms). Single-call variance at these cells is **unmeasurable** and must be flagged, not faked.
2. **Variance as a finding** — where the timer resolves single calls (node always; browser at M/L),
   `cv`/spread is a real, reportable property (e.g., "large wasm ops carry ~15–18 % run-to-run
   variance in-browser"). It must be reported, not crushed.

## Approach: SEM-of-mean acceptance + variance as a reported finding

Three coordinated changes, no change to *what* is measured (every sample stays one honest `run()`):

1. **Acceptance / early-exit gate** = precision of the mean (`relSEM`), not sample spread.
2. **Reported dispersion** = robust statistics (median + MAD, plus existing p95/p99) — the
   product-variance finding, decoupled from the acceptance decision.
3. **Sub-resolution flag** for cells whose single call is below the timer floor: report the mean,
   mark single-call variance unmeasurable.

Batching, `innerIterations` changes, reset-in-timing, and calibration are **not** used — the data
shows they are unnecessary (§ Out of scope).

## Measurement loop semantics

Current loop (`packages/harness/src/measure.ts`): sample `run(innerIterations)` until
`cv ≤ cvThreshold` (after `minSamples`) or `maxSamples`. Changes:

**Gate.** Replace the early-exit condition:

```
after minSamples, compute stats
relSem = mean === 0 ? Infinity : stddev / (mean * sqrt(n))   // = cv / sqrt(n)
if (!subResolution) and relSem <= semThreshold: break        // mean precise enough
```

- `relSem` is the relative standard error of the mean. `cv` in `stats.ts` is `stddev/mean`, so
  `relSem = cv/√n` exactly.
- **Sub-resolution guard (critical edge case).** When every sample rounds to 0, `mean = 0` and
  `stats.ts` returns `cv = 0` → `relSem` would spuriously read as "perfectly precise". Guard: a cell
  is `subResolution` when `warmMin === 0` (a single sample rounded to 0). A sub-resolution cell never
  passes the precision gate on the basis of `cv=0`; it keeps sampling to pin the (nonzero) mean and
  is flagged. `mean === 0` maps to `relSem = Infinity`.

**Sample count.** Raise `maxSamples` so high-variance / sub-resolution cells can reach the SEM
target (worst S \| browser ≈ 400). Add a per-cell wall-time budget as a backstop so a pathological
cell cannot stall the matrix; on budget exhaustion the cell is accepted with `meanImprecise = true`.

**Outputs.** The loop additionally computes MAD (median absolute deviation) for robust dispersion,
and sets `meanImprecise` (final `relSem > semThreshold`) and `subResolution` (`warmMin === 0`).

**No other change to the loop.** `reset?.()` stays exactly where it is (outside timing), so there is
zero reset contamination and cross-toolchain comparisons are unaffected.

## Schema changes (`packages/result-schema/src/schema.ts`)

Bump `SCHEMA_VERSION`. Old `results/raw/` are gitignored and re-benched, so a hard break is fine.

- `StatsSchema`:
  - **add** `relSem: z.number().nonnegative()` — relative standard error of the mean.
  - **add** `meanImprecise: z.boolean()` — acceptance flag (`relSem > semThreshold`), replaces `noisy`.
  - **add** `subResolution: z.boolean()` — single call below timer floor (`warmMin === 0`).
  - **keep** `cv` — now the variance *finding*, not a gate.
  - **remove** `noisy` (superseded by `meanImprecise` + `subResolution`).
- `TimingsSchema`:
  - **add** `warmMad: z.number().nonnegative()` — median absolute deviation (robust spread).

## Reporter changes

Two things, both presenter-only (consistent with the PR #9 redesign lineage).

### 1. Variance as a finding, not a failure (`render-perf.ts`, `perf-view-model.ts`)

- Show the mean/median with its precision (`relSem`) for toolchain comparison.
- Show dispersion (`cv` / `warmMad` / `warmP95`) as a neutral *finding*, not a red "unreliable" badge.
- Badge `subResolution` cells distinctly ("< timer floor — mean only; single-call variance
  unmeasurable"), replacing the current blanket `noisy` red.
- `meanImprecise` (rare, post-budget) keeps a genuine "low-confidence mean" marker.
- `PerfDetailRow` swaps `noisy` for `relSem` / `meanImprecise` / `subResolution` / `warmMad`.

### 2. Stable, canonical row/segment ordering (`perf-view-model.ts`, `size-data.ts`)

Current defect: the perf tab orders impls by representative `warmMedian`
(`perf-view-model.ts:108` and `:146`), so the fastest impl floats to the top and the *position* of a
given toolchain changes cell-to-cell — hard to read. `ENV_ORDER` and `SIZE_ORDER` are already fixed;
impl order is not.

Fix: add a canonical `IMPL_ORDER` and sort `multiples` + `detail` by it (env still by `ENV_ORDER`
within an impl), replacing the `warmMedian` sort. Bar lengths continue to encode the metric, so
speed remains visible — only row order becomes stable. Canonical order (from `spec.json.supported`
declaration order — `language` then `toolchain`):

```
js/idiomatic, js/typed-array, rust/raw, rust/bindgen, cpp/emscripten, cpp/wasi-sdk
```

Ranking strips the profile suffix (impl keys are `js/<tc>` or `<lang>/<tc>/<profile>`); within a
slice the profile is fixed, so `language/toolchain` fully orders. Apply the **same** `IMPL_ORDER` to
the size tab (`size-data.ts:43` currently sorts by `localeCompare` → alphabetical `cpp,js,rust`,
which would disagree with the perf tab) so both tabs read identically.

## Config values

| runner  | mode  | semThreshold | minSamples | maxSamples | wall-budget | notes                          |
|---------|-------|--------------|------------|------------|-------------|--------------------------------|
| node    | eval  | 0.03         | 30         | 200        | ~1 s        | 40 ns timer; converges fast    |
| node    | quick | 0.10         | 5          | 20         | ~0.2 s      | stays fast                     |
| browser | eval  | 0.03         | 30         | 512        | ~2 s        | S sub-resolution needs ~400    |
| browser | quick | 0.10         | 5          | 20         | ~0.3 s      | stays fast                     |

`MeasureConfig.cvThreshold` → `semThreshold`. Runners (`runner-node/src/main.ts`,
`runner-web/src/driver.ts`) updated accordingly.

### Why `semThreshold = 3 %`

`relSem` is the relative standard error of the mean; a 95 % confidence interval for the true mean is
`mean ± 1.96·relSem`. To call one toolchain faster than another at 95 %, their gap must exceed
`≈2.8·relSem` (`SE_diff = relSem·√2`, ×1.96):

| relSem | 95 % CI half-width | distinguishable toolchain gap |
|--------|--------------------|-------------------------------|
| 5 %    | ±10 %              | > ~14 %                       |
| 3 %    | ±6 %               | > ~8 %                        |
| 2 %    | ±4 %               | > ~5.5 %                      |

3 % resolves gaps > ~8 %, covering most meaningful toolchain comparisons, at moderate sample cost
(S \| browser: a few hundred samples ≈ ms). `relSem` is stored per cell, so the reporter can show the
actual CI and consumers can re-threshold post-hoc. (Assumes approximate normality of the mean via CLT
at n ≥ 30; GC-outlier tails make the raw-stddev SE conservative — a robust MAD-based SE would be
tighter.)

**Post-implementation check:** after re-bench, confirm 3 % is adequate — intended toolchain gaps are
distinguishable and total runtime is acceptable. If not, revisit the threshold by discussion (not a
silent change); `relSem` is retained per cell to make that assessment from the data.

## Guidelines updates (`docs/guidelines.md`)

- **Measurement precision ≠ operation variance.** Acceptance gates on SEM of the mean; run-to-run
  variance is reported separately as a property of the operation.
- **Large wasm ops in-browser** carry ~15–18 % run-to-run variance (GC / event-loop / scheduling);
  the *mean* is stable. Budget for the variance; don't read it as measurement error.
- Extend `guidelines.md:188`: sub-10–20 µs operations are below the browser timer floor (Chromium
  5 µs / Firefox 20 µs even with cross-origin isolation). Single-call latency is **unmeasurable**
  in-browser; only the mean (via averaging) is recoverable — the M tier is the informative one.
- node genuine-variance finding for the smallest ops (timer resolves them at ~40 ns).

## Files changed

| file                                          | change                                                        |
|-----------------------------------------------|---------------------------------------------------------------|
| `packages/harness/src/stats.ts`               | add `mad`; expose `relSem` helper                             |
| `packages/harness/src/measure.ts`             | SEM gate + sub-resolution guard; maxSamples + wall-budget; set flags |
| `packages/harness/src/types.ts`               | `cvThreshold` → `semThreshold`; add wall-budget to `MeasureConfig` |
| `packages/result-schema/src/schema.ts`        | stats: +`relSem`/`meanImprecise`/`subResolution`, −`noisy`; timings: +`warmMad`; bump `SCHEMA_VERSION` |
| `apps/runner-node/src/main.ts`                | `semThreshold`, `maxSamples`, wall-budget                     |
| `apps/runner-web/src/driver.ts`               | same, browser values                                          |
| `packages/reporter/src/perf-view-model.ts`    | `IMPL_ORDER` stable sort (replaces warmMedian); flag fields   |
| `packages/reporter/src/size-data.ts`          | align to `IMPL_ORDER`                                         |
| `packages/reporter/src/render-perf.ts`        | variance-as-finding presentation; sub-resolution badge        |
| `packages/harness/tests/*`                    | SEM gate, MAD, sub-resolution, flag tests                     |
| `packages/result-schema/tests/schema.test.ts`| new/removed field coverage                                    |
| `packages/reporter/tests/*`                   | IMPL_ORDER stability; flag rendering                          |
| `docs/guidelines.md`                          | variance-as-finding + sub-resolution guidance                 |

## Out of scope (dropped after empirical diagnosis)

- **Time-based adaptive batching** — the original approach. Unnecessary: SEM gating fixes 92 % of
  cells on honest data; the S \| browser residual is handled by more raw samples (mean is unbiased
  under quantization). Batching also risked reset-in-timing contamination (esp. hashmap `delete`,
  whose reset is `clear+refill` ≈ a full run) and per-env calibration fragility.
- **`innerIterations` changes** — it encodes workload size identity + checksum domain, not a timing
  dial. Inflating it corrupts the S/M/L taxonomy and forces checksum re-pinning.
- **`process.hrtime.bigint()` / disabling `reduceTimerPrecision`** — measured to give nothing
  (node already 40 ns; Firefox floor is the COI clamp, unaffected by the pref).
- **Per-env CV threshold (original Phase C)** — a symptom patch; the SEM gate removes the cause.
- **`caffeinate` / CPU pinning** — throttling is not dominant (L \| node 5 %). A separate concern.

## Risk register

| risk                                                        | likelihood | mitigation                                                     |
|-------------------------------------------------------------|------------|----------------------------------------------------------------|
| SEM gate accepts a sub-resolution cell via `cv=0` (all-zero)| medium     | `subResolution` guard (`warmMin===0`) overrides the gate       |
| Some S \| browser cells still don't reach `relSem≤5 %`      | low        | wall-budget accepts with `meanImprecise=true`; reporter marks it|
| Raising maxSamples inflates total bench runtime             | low        | early-exit on SEM keeps easy cells fast; only variable cells sample more; wall-budget caps the tail |
| Schema break stops reporter on old raw results              | low        | old `results/raw/` gitignored; re-bench regenerates            |
| Empirical re-analysis (47 %→8 %) not reproduced live        | low        | plan Wave-0 re-runs the offline SEM re-analysis on a fresh run before committing to thresholds |

## Expected post-fix state

After re-bench (separate user action):

- Flagged cells drop ~47 % → ~16 % at the reference run's sample budget (n ≤ 100); raising
  `maxSamples` lets resolvable cells reach the 3 % target, converging the residual toward the
  sub-resolution floor (~8 %, almost all S \| browser).
- L \| browser 18 % and M \| browser 57 % "noise" resolve to precise means + a reported ~15–18 % /
  ~7 % variance finding (no red flag).
- S \| browser sub-resolution cells: mean reported, badged "single-call variance unmeasurable"; the
  M tier remains the informative one for those workloads.
- The perf and size tabs read in one stable canonical order across every cell.

## Alternatives considered

- **Adaptive batching** — see Out of scope. Measured unnecessary; adds contamination + calibration risk.
- **Bigger `innerIterations`** — breaks size taxonomy + checksum domain; not env-adaptive.
- **`hrtime.bigint()` (node) / `reduceTimerPrecision=false` (Firefox)** — measured no benefit.
- **SharedArrayBuffer counter-thread timer** — the only sub-20 µs path in-browser; burns a core, needs
  calibration, fragile. Not worth it when the mean is recoverable by averaging.
- **In-wasm timing** — wasm has no independent clock (imports the host `performance.now()`); no
  resolution gain, and heavy workloads already loop inside one `run()`.
- **Raising the CV threshold per env** — patches the symptom; SEM gating removes the cause.
