import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregate.js";
import { renderHtml } from "../src/render.js";
import type { BenchResult } from "@bench/result-schema";

function fakeResult(
    over: Partial<BenchResult["benchmark"]> = {},
    warmMedian = 1.234,
): BenchResult {
    return {
        schemaVersion: 1,
        timestamp: "2026-05-01T00:00:00.000Z",
        machine: { os: "linux", cpu: "x", memoryGb: 32 },
        env: { kind: "node", name: "node", version: "v22.0.0", engine: "V8" },
        benchmark: {
            id: "matmul", inputSize: "S", fixtureBytes: 0, fixtureSha256: "x".repeat(64),
            language: "js", toolchain: "idiomatic", profile: "speed", postprocess: [],
            ...over,
        },
        artifacts: {
            wasmRawBytes: 0, wasmGzipBytes: 0, wasmBrotliBytes: 0,
            jsGlueRawBytes: 0, jsGlueGzipBytes: 0, totalTransferGzipBytes: 1234,
            artifactHash: `sha256:${"a".repeat(64)}`,
        },
        timingsMs: {
            fetch: 0, compile: 0, instantiate: 0, initTotal: 0, firstCall: 0,
            warmMedian, warmP95: 1.5, warmP99: 1.7, warmStddev: 0.05,
            warmMin: 1.1, warmMax: 1.7, endToEndMedian: warmMedian,
        },
        memory: { wasmMemoryBytesPeak: 0, wasmMemoryDeltaBytes: 0, jsHeapUsedAfter: null },
        stats: { nSamples: 30, cv: 0.01, noisy: false },
        quality: { checksum: 0, validated: true, correctnessFailed: false },
        notes: { streamingInstantiation: false, worker: true, wasmFeatures: [] },
    };
}

describe("renderHtml", () => {
    it("produces non-empty HTML containing the benchmark id and warmMedian", () => {
        const html = renderHtml(aggregate([fakeResult()]), { binaries: [] });
        expect(html).toContain("matmul");
        expect(html).toContain("1.234"); // warmMedian formatted to 3 decimals
        expect(html).toContain("<!doctype html>");
    });

    it("renders a tabbed shell with Size and Perf panels", () => {
        const html = renderHtml(aggregate([fakeResult()]), { binaries: [] });
        expect(html).toContain('<nav class="tabs">');
        expect(html).toContain('data-tab="size"');
        expect(html).toContain('data-tab="perf"');
        expect(html).toContain('id="tab-size"');
        expect(html).toContain('id="tab-perf"');
    });

    it("renders Perf-tab filters (env/size/profile) over filterable rows", () => {
        const html = renderHtml(aggregate([fakeResult()]), { binaries: [] });
        expect(html).toContain('class="size-controls perf-controls"');
        expect(html).toContain('name="perfEnv"');
        expect(html).toContain('name="perfSize"');
        expect(html).toContain('name="perfProfile"');
        expect(html).toMatch(/<tr[^>]*data-env="[^"]+"[^>]*data-size="[^"]+"[^>]*data-profile="[^"]+"/);
    });

    it("escapes potentially-hazardous characters in fields", () => {
        const r = fakeResult();
        r.benchmark.id = "<script>alert(1)</script>";
        const html = renderHtml(aggregate([r]), { binaries: [] });
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;");
    });

    it("includes timing column headers and drops size columns (moved to Size view)", () => {
        const html = renderHtml(aggregate([fakeResult()]), { binaries: [] });
        expect(html).toContain("<th>init (ms)</th>");
        expect(html).toContain("<th>first (ms)</th>");
        expect(html).toContain("<th>warm med (ms)</th>");
        expect(html).toContain("<th>warm p95 (ms)</th>");
        expect(html).toContain("<th>cv</th>");
        expect(html).toContain("<th>ok</th>");
        expect(html).not.toContain("<th>wasm raw (B)</th>");
        expect(html).not.toContain("<th>total gz (B)</th>");
    });
});

describe("renderHtml shape_dispatch 2×2 factorial grid", () => {
    const pinned = { env: { kind: "node", name: "node", version: "v22.0.0", engine: "V8" } } as const;

    function shapeCase(id: string, warmMedian: number): BenchResult {
        const r = fakeResult(
            { id, language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" },
            warmMedian,
        );
        r.env = { ...pinned.env };
        return r;
    }

    it("emits a 2×2 factorial super-section with the 4 pinned warm-medians", () => {
        const results = [
            shapeCase("shape_dispatch_homo_static", 11.111),
            shapeCase("shape_dispatch_homo_dyn", 22.222),
            shapeCase("shape_dispatch_mixed_static", 33.333),
            shapeCase("shape_dispatch_mixed_dyn", 44.444),
            fakeResult(), // a normal matmul flat section
        ];
        const html = renderHtml(aggregate(results), { binaries: [] });
        expect(html).toContain("shape_dispatch (2×2 factorial)");
        // the 4 grid cell values
        expect(html).toContain("11.111");
        expect(html).toContain("22.222");
        expect(html).toContain("33.333");
        expect(html).toContain("44.444");
        // non-shape_dispatch flat section still rendered
        expect(html).toContain("<h2>matmul</h2>");
        // the 4 detail tables still appear (reusing renderBenchmark)
        expect(html).toContain("<h2>shape_dispatch_homo_static</h2>");
        expect(html).toContain("<h2>shape_dispatch_mixed_dyn</h2>");
    });

    it("renders — for a missing pinned cell", () => {
        const results = [
            shapeCase("shape_dispatch_homo_static", 11.111),
            // homo_dyn missing
            shapeCase("shape_dispatch_mixed_static", 33.333),
            shapeCase("shape_dispatch_mixed_dyn", 44.444),
        ];
        const html = renderHtml(aggregate(results), { binaries: [] });
        expect(html).toContain("shape_dispatch (2×2 factorial)");
        expect(html).toContain("—");
    });
});
