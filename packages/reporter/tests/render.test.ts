import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregate.js";
import { renderHtml } from "../src/render.js";
import type { BenchResult } from "@bench/result-schema";

function fakeResult(): BenchResult {
  return {
    schemaVersion: 1,
    timestamp: "2026-05-01T00:00:00.000Z",
    machine: { os: "linux", cpu: "x", memoryGb: 32 },
    env: { kind: "node", name: "node", version: "v22.0.0", engine: "V8" },
    benchmark: {
      id: "matmul", inputSize: "S", fixtureBytes: 0, fixtureSha256: "x".repeat(64),
      language: "js", toolchain: "idiomatic", profile: "speed", postprocess: [],
    },
    artifacts: {
      wasmRawBytes: 0, wasmGzipBytes: 0, wasmBrotliBytes: 0,
      jsGlueRawBytes: 0, jsGlueGzipBytes: 0, totalTransferGzipBytes: 1234,
      artifactHash: `sha256:${"a".repeat(64)}`,
    },
    timingsMs: {
      fetch: 0, compile: 0, instantiate: 0, initTotal: 0, firstCall: 0,
      warmMedian: 1.234, warmP95: 1.5, warmP99: 1.7, warmStddev: 0.05,
      warmMin: 1.1, warmMax: 1.7, endToEndMedian: 1.234,
    },
    memory: { wasmMemoryBytesPeak: 0, wasmMemoryDeltaBytes: 0, jsHeapUsedAfter: null },
    stats: { nSamples: 30, cv: 0.01, noisy: false },
    quality: { checksum: 0, validated: true, correctnessFailed: false },
    notes: { streamingInstantiation: false, worker: true, wasmFeatures: [] },
  };
}

describe("renderHtml", () => {
  it("produces non-empty HTML containing the benchmark id and warmMedian", () => {
    const html = renderHtml(aggregate([fakeResult()]));
    expect(html).toContain("matmul");
    expect(html).toContain("1.234"); // warmMedian formatted to 3 decimals
    expect(html).toContain("1234");  // totalTransferGzipBytes
    expect(html).toContain("<!doctype html>");
  });

  it("escapes potentially-hazardous characters in fields", () => {
    const r = fakeResult();
    r.benchmark.id = "<script>alert(1)</script>";
    const html = renderHtml(aggregate([r]));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes units in size and timing column headers", () => {
    const html = renderHtml(aggregate([fakeResult()]));
    expect(html).toContain("<th>wasm raw (B)</th>");
    expect(html).toContain("<th>wasm gz (B)</th>");
    expect(html).toContain("<th>total gz (B)</th>");
    expect(html).toContain("<th>init (ms)</th>");
    expect(html).toContain("<th>first (ms)</th>");
    expect(html).toContain("<th>warm med (ms)</th>");
    expect(html).toContain("<th>warm p95 (ms)</th>");
    expect(html).toContain("<th>cv</th>");
    expect(html).toContain("<th>ok</th>");
  });
});
