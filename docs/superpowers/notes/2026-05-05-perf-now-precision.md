# performance.now() precision investigation — Wave 4

**Дата:** 2026-05-05
**Ветка:** feature/phase-1-0-5
**Base SHA:** 2657d4a (HEAD before Task 15)

## Gate 1 — baseline данные

Workload: matmul M-size, quick mode (3 warmup, 5–10 samples, CV ≤ 0.05), all 10 combos.
Probe: busy-loop until `performance.now()` advances; report the first non-zero delta.
Focus combo for comparison: `cpp/emscripten/size`.

### Node
- resolution: ~0.0004 ms (range across runs: 0.000333–0.00125 ms; sub-microsecond, true high-res)
- per-sample timings (cpp/emscripten/size, M-size, ms): [5.151, 5.124, 5.136, 5.181, 4.847]
- all sample values are **fractional** (non-integer ms), confirming Node uses un-jittered `CLOCK_MONOTONIC`

### Chromium
- resolution: ~0.1 ms (observed: 0.09999990463256836 and 0.10000002384185791 ms — floating-point representation of exactly 100 µs)
- per-sample timings (cpp/emscripten/size, M-size, ms): [5.0, 4.9, 4.9, 4.9, 5.0]
- all sample values are **multiples of 0.1 ms** — Chromium quantizes `performance.now()` to 100 µs increments
- note: first sample across many combos shows a JIT warm-up spike (e.g., 21 ms for js-idiomatic, 18 ms for js-typed-array) that disappears by sample 2–3

### Firefox
- resolution: **1 ms** (exact integer: busy-loop exits at exactly +1.0 ms tick)
- per-sample timings (cpp/emscripten/size, M-size, ms): [107, 107, 106, 107, 109]
- **all sample values are whole integers** — Firefox quantizes `performance.now()` to 1 ms granularity in Workers
- Firefox wasm timings are ~20–25× higher than Node/Chromium for the same workload (e.g., rust/raw/speed: FF 127–128 ms vs Chromium 6.7–6.9 ms vs Node 7.0–7.2 ms)

## Сравнение

| env | resolution (ms) | cpp/emscripten/size warm samples (ms) | observation |
|---|---|---|---|
| node | ~0.0004 | [5.151, 5.124, 5.136, 5.181, 4.847] | sub-µs precision, fractional values, stable CV |
| chromium | ~0.1 | [5.0, 4.9, 4.9, 4.9, 5.0] | 100 µs quantization, values rounded to nearest 0.1 ms |
| firefox | **1.0** | [107, 107, 106, 107, 109] | **1 ms quantization** in Workers; wasm perf ~20× worse than Chromium |

## Key findings

1. **Firefox `performance.now()` resolution is 1 ms in Workers** — this is by design (Firefox applies 1 ms jitter + rounding in Workers as a Spectre mitigation). Chromium uses 100 µs. Node uses full OS precision (~0.4 µs).

2. **Firefox wasm performance is catastrophically worse** — 107 ms vs 5 ms for cpp/emscripten/size. The same discrepancy appears across ALL wasm combos (rust/raw: 127 ms FF vs 6.9 ms Chrome; rust/bindgen: 131 ms FF vs 6.9 ms Chrome; cpp/wasi-sdk: 86 ms FF vs 4.3 ms Chrome). JS combos are much closer (js-idiomatic: 20 ms FF vs 6.7 ms Chrome, js-typed-array: 17 ms FF vs 12 ms Chrome).

3. **The discrepancy is NOT a measurement artifact** — the magnitude (20–25×) far exceeds what 1 ms rounding could cause on a ~5 ms workload. The underlying wasm execution is genuinely much slower in Firefox's SpiderMonkey than Chrome's V8 for this workload, at least in headless/worker context.

4. **Chromium quantization effect on CV**: With 100 µs resolution on ~5 ms samples, the quantization noise is ~2% of signal. This can inflate CV slightly for fast combos but should not cause false-noisy classifications at the 5% CV threshold used.

5. **Firefox quantization effect on CV**: With 1 ms resolution on ~107 ms samples, the quantization noise is ~0.9% of signal — acceptable precision for the actual measurement values observed. However, for hypothetical shorter workloads where the signal would be near the 1 ms tick size, CV would be dominated by quantization noise.

## Gate 2 / Gate 3 — TBD

(Decisions deferred — controller will discuss findings with user before proceeding to Task 16.)

The main finding to evaluate: the Firefox wasm slowdown is a real execution performance issue (SpiderMonkey Liftoff tier, lack of SIMD, or headless-mode JIT limits), not a timer precision artifact. Gate 3 (Liftoff/JIT hypothesis) is the more relevant path.
