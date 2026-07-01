import { afterEach, describe, expect, it, vi } from "vitest";
import type { BenchModule } from "../src/types.js";
import { runMeasure } from "../src/measure.js";

function mockModule(opts: { checksum: number }): BenchModule {
    return {
        loadInput: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- iters is part of BenchModule.run signature but unused in this stub
        run: vi.fn((_iters: number) => {
            return { checksum: opts.checksum };
        }),
        reset: vi.fn(),
    };
}

describe("runMeasure", () => {
    it("collects minSamples warm samples when noise is low", async () => {
        const mod = mockModule({ checksum: 42 });
        const out = await runMeasure({
            module: mod,
            fixture: new Uint8Array([1]),
            expectedChecksum: 42,
            config: {
                warmupIterations: 5,
                innerIterations: 100,
                minSamples: 30,
                maxSamples: 100,
                semThreshold: 0.05,
                wallBudgetMs: 100_000,
            },
        });
        expect(out.warmSamplesMs.length).toBeGreaterThanOrEqual(30);
        expect(out.warmSamplesMs.length).toBeLessThanOrEqual(100);
        expect(out.correctnessFailed).toBe(false);
        expect(out.finalChecksum).toBe(42);
    });

    it("flags correctness failure on checksum mismatch", async () => {
        const mod = mockModule({ checksum: 99 });
        const out = await runMeasure({
            module: mod,
            fixture: new Uint8Array([1]),
            expectedChecksum: 42,
            config: {
                warmupIterations: 1,
                innerIterations: 10,
                minSamples: 5,
                maxSamples: 5,
                semThreshold: 0.05,
                wallBudgetMs: 100_000,
            },
        });
        expect(out.correctnessFailed).toBe(true);
    });
});

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
