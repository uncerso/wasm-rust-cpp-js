import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregate.js";
import { renderHtml } from "../src/render.js";
import type { BenchResult } from "@bench/result-schema";

function fakeResult(
    over: Partial<BenchResult["benchmark"]> = {},
    warmMedian = 1.234,
): BenchResult {
    return {
        schemaVersion: 2,
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
            warmMin: 1.1, warmMax: 1.7, warmMad: 0.04, endToEndMedian: warmMedian,
        },
        memory: { wasmMemoryBytesPeak: 0, wasmMemoryDeltaBytes: 0, jsHeapUsedAfter: null },
        stats: { nSamples: 30, cv: 0.01, relSem: 0.002, meanImprecise: false, subResolution: false },
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
        expect(html).toContain('class="app"');
        expect(html).toContain('class="tabbar"');
        expect(html).toContain('data-tab="size"');
        expect(html).toContain('data-tab="perf"');
        expect(html).toContain('id="tab-size"');
        expect(html).toContain('id="tab-perf"');
        expect(html).not.toContain("font-family: ui-monospace, monospace; max-width");
    });

    it("wires every view's CSS into the shell <style> (size + perf)", () => {
        const html = renderHtml(aggregate([fakeResult()]), { binaries: [] });
        // SIZE_CSS marker (size bars) and PERF_CSS markers (small-multiples track +
        // detail hatch) must all reach the <style> block — guards against a view's
        // CSS export not being imported into render.ts (the Perf tab once shipped unstyled).
        expect(html).toContain(".size-bar");
        expect(html).toContain(".em-trk");
        expect(html).toContain("repeating-linear-gradient");   // PERF_CSS hatch — CSS-only, never in markup
    });

    it("escapes potentially-hazardous characters in fields", () => {
        const r = fakeResult();
        r.benchmark.id = "<script>alert(1)</script>";
        const html = renderHtml(aggregate([r]), { binaries: [] });
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;");
    });

});
