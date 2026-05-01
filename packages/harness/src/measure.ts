import { computeStats } from "./stats.js";
import { eqChecksum } from "./validation.js";
import type { MeasureInput, MeasureOutput } from "./types.js";

export async function runMeasure(input: MeasureInput): Promise<MeasureOutput> {
  const { module, fixture, expectedChecksum, config } = input;

  module.loadInput(fixture);

  const firstCallStart = performance.now();
  const firstResult = module.run(1);
  const firstCallMs = performance.now() - firstCallStart;

  if (!eqChecksum(firstResult.checksum, expectedChecksum)) {
    return {
      firstCallMs,
      warmSamplesMs: [],
      finalChecksum: firstResult.checksum,
      correctnessFailed: true,
    };
  }

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
      if (stats.cv <= config.cvThreshold) break;
    }
  }

  return {
    firstCallMs,
    warmSamplesMs: samples,
    finalChecksum: lastChecksum,
    correctnessFailed: false,
  };
}
