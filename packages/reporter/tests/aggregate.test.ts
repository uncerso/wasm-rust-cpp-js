import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregate.js";
import type { BenchResult } from "@bench/result-schema";

function fakeResult(
  over: Partial<BenchResult["benchmark"]>,
  warmMedian: number,
  wasmRaw: number,
): BenchResult {
  return {
    schemaVersion: 1,
    timestamp: "2026-05-01T00:00:00.000Z",
    machine: { os: "linux", cpu: "x", memoryGb: 32 },
    env: { kind: "node", name: "node", version: "v22.0.0", engine: "V8" },
    benchmark: {
      id: "matmul",
      inputSize: "S",
      fixtureBytes: 0,
      fixtureSha256: "x".repeat(64),
      language: "js",
      toolchain: "idiomatic",
      profile: "speed",
      postprocess: [],
      ...over,
    },
    artifacts: {
      wasmRawBytes: wasmRaw,
      wasmGzipBytes: 0,
      wasmBrotliBytes: 0,
      jsGlueRawBytes: 0,
      jsGlueGzipBytes: 0,
      totalTransferGzipBytes: 0,
      artifactHash: `sha256:${"a".repeat(64)}`,
    },
    timingsMs: {
      fetch: 0, compile: 0, instantiate: 0, initTotal: 0, firstCall: 0,
      warmMedian, warmP95: warmMedian, warmP99: warmMedian, warmStddev: 0,
      warmMin: warmMedian, warmMax: warmMedian, endToEndMedian: warmMedian,
    },
    memory: { wasmMemoryBytesPeak: 0, wasmMemoryDeltaBytes: 0, jsHeapUsedAfter: null },
    stats: { nSamples: 30, cv: 0.01, noisy: false },
    quality: { checksum: 0, validated: true, correctnessFailed: false },
    notes: { streamingInstantiation: false, worker: true, wasmFeatures: [] },
  };
}

describe("aggregate", () => {
  it("groups results by benchmark and indexes by env+lang+toolchain+profile+size", () => {
    const results = [
      fakeResult({ language: "js", toolchain: "idiomatic" }, 10, 0),
      fakeResult({ language: "rust", toolchain: "raw", profile: "size" }, 5, 1234),
    ];
    const agg = aggregate(results);
    expect(Object.keys(agg.benchmarks)).toEqual(["matmul"]);
    const m = agg.benchmarks["matmul"];
    expect(m).toBeDefined();
    expect(m!.cases.length).toBe(2);
    expect(m!.cases[0]!.key).toBe("node|js|idiomatic|speed|S");
    expect(m!.cases[1]!.key).toBe("node|rust|raw|size|S");
  });

  it("merges results from multiple benchmarks separately", () => {
    const r1 = fakeResult({ id: "matmul" }, 1, 0);
    const r2 = fakeResult({ id: "hashmap" }, 2, 0);
    const agg = aggregate([r1, r2]);
    expect(Object.keys(agg.benchmarks).sort()).toEqual(["hashmap", "matmul"]);
  });
});
