import { computeStats } from "./stats.js";
import { eqChecksum } from "./validation.js";
import type { MeasureInput, MeasureOutput } from "./types.js";

/**
 * Probes performance.now() resolution by busy-looping until a tick is observed.
 * Returns the smallest non-zero delta in ms. Used in Wave 4 investigation.
 */
export function probePerformanceNowResolution(): number {
    const before = performance.now();
    let after = before;
    while (after === before) {
        after = performance.now();
    }
    return after - before;
}

// eslint-disable-next-line @typescript-eslint/require-await -- async keeps the Promise<MeasureOutput> contract; implementation is sync today but callers always await
export async function runMeasure(input: MeasureInput): Promise<MeasureOutput> {
    const { module, fixture, expectedChecksum, config } = input;

    const debugTimings = (typeof process !== "undefined"
        && process.env?.["BENCH_DEBUG_TIMINGS"] === "1")
        || (typeof globalThis !== "undefined"
            && (globalThis as { __BENCH_DEBUG_TIMINGS__?: boolean }).__BENCH_DEBUG_TIMINGS__ === true);

    if (debugTimings) {
        const res = probePerformanceNowResolution();
        // eslint-disable-next-line no-console
        console.log(`[bench-debug] performance.now() resolution: ${res} ms`);
    }

    module.loadInput(fixture);

    // firstCallMs is the latency of one wasm invocation (`run(1)`). Its
    // checksum is iter-dependent for some workloads (interop_calls *_add_* /
    // _noop) and so isn't validated here — validation against the spec's
    // `expectedChecksum` runs against `run(innerIterations)` in the warm loop.
    const firstCallStart = performance.now();
    const firstResult = module.run(1);
    const firstCallMs = performance.now() - firstCallStart;

    for (let i = 0; i < config.warmupIterations; i++) {
        module.run(config.innerIterations);
    }

    const samples: number[] = [];
    let lastChecksum: number | string = firstResult.checksum;

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
            if (stats.cv <= config.cvThreshold) {
                break;
            }
        }
    }

    return {
        firstCallMs,
        warmSamplesMs: samples,
        finalChecksum: lastChecksum,
        correctnessFailed: false,
    };
}
