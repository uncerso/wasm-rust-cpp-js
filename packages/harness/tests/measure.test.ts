import { describe, expect, it, vi } from "vitest";
import type { BenchModule } from "../src/types.js";
import { runMeasure } from "../src/measure.js";

function mockModule(opts: {
  checksum: number;
  perRunMs: number;
  driftCv?: number;
}): BenchModule {
  let now = 0;
  const drift = opts.driftCv ?? 0;
  return {
    loadInput: vi.fn(),
    run: vi.fn((iters: number) => {
      const noise = drift > 0 ? (Math.random() * 2 - 1) * drift * opts.perRunMs : 0;
      now += iters * (opts.perRunMs + noise);
      return { checksum: opts.checksum };
    }),
    readOutput: () => new Uint8Array(),
    reset: vi.fn(),
  };
}

describe("runMeasure", () => {
  it("collects minSamples warm samples when noise is low", async () => {
    const mod = mockModule({ checksum: 42, perRunMs: 1.0 });
    const out = await runMeasure({
      module: mod,
      fixture: new Uint8Array([1]),
      expectedChecksum: 42,
      config: {
        warmupIterations: 5,
        innerIterations: 100,
        minSamples: 30,
        maxSamples: 100,
        cvThreshold: 0.05,
      },
    });
    expect(out.warmSamplesMs.length).toBeGreaterThanOrEqual(30);
    expect(out.warmSamplesMs.length).toBeLessThanOrEqual(100);
    expect(out.correctnessFailed).toBe(false);
    expect(out.finalChecksum).toBe(42);
  });

  it("flags correctness failure on checksum mismatch", async () => {
    const mod = mockModule({ checksum: 99, perRunMs: 1.0 });
    const out = await runMeasure({
      module: mod,
      fixture: new Uint8Array([1]),
      expectedChecksum: 42,
      config: {
        warmupIterations: 1,
        innerIterations: 10,
        minSamples: 5,
        maxSamples: 5,
        cvThreshold: 0.05,
      },
    });
    expect(out.correctnessFailed).toBe(true);
  });
});
