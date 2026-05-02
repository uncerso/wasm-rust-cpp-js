import type { BenchResult } from "@bench/result-schema";

export interface AggregatedCase {
  result: BenchResult;
  key: string; // env|lang|toolchain|profile|size
}

export interface AggregatedBenchmark {
  id: string;
  cases: AggregatedCase[];
}

export interface Aggregated {
  generatedAt: string;
  benchmarks: Record<string, AggregatedBenchmark>;
}

export function aggregate(results: readonly BenchResult[]): Aggregated {
  const out: Aggregated = { generatedAt: new Date().toISOString(), benchmarks: {} };
  for (const r of results) {
    const id = r.benchmark.id;
    let b = out.benchmarks[id];
    if (!b) {
      b = { id, cases: [] };
      out.benchmarks[id] = b;
    }
    const key = [
      r.env.name,
      r.benchmark.language,
      r.benchmark.toolchain,
      r.benchmark.profile,
      r.benchmark.inputSize,
    ].join("|");
    b.cases.push({ result: r, key });
  }
  return out;
}
