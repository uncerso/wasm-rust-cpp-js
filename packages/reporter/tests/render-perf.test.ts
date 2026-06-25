import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregate.js";
import { PERF_CSS, renderPerfView } from "../src/render-perf.js";
import type { BenchResult } from "@bench/result-schema";

function fakeResult(
    over: Partial<BenchResult["benchmark"]> = {},
    warmMedian = 1.234,
    envName = "node",
): BenchResult {
    return {
        schemaVersion: 1,
        timestamp: "2026-05-01T00:00:00.000Z",
        machine: { os: "linux", cpu: "x", memoryGb: 32 },
        env: { kind: "node", name: envName, version: "v22.0.0", engine: "V8" },
        benchmark: {
            id: "hashmap_int", inputSize: "L", fixtureBytes: 0, fixtureSha256: "x".repeat(64),
            language: "rust", toolchain: "raw", profile: "speed", postprocess: [],
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

describe("renderPerfView", () => {
    it("renders env small-multiples with a column per env", () => {
        const results = [
            fakeResult({}, 1.234, "node"),
            fakeResult({}, 2.345, "chromium"),
        ];
        const html = renderPerfView(aggregate(results));
        expect(html).toContain('class="em-row"');
        expect(html).toContain('data-size="L"');
        expect(html).toContain('data-profile="speed"');
        expect(html).toContain(">node<");
        expect(html).toContain(">chromium<");
    });

    it("renders size/profile segmented controls", () => {
        const results = [
            fakeResult({ inputSize: "L", profile: "speed" }, 1.0, "node"),
            fakeResult({ inputSize: "S", profile: "speed" }, 2.0, "node"),
        ];
        const html = renderPerfView(aggregate(results));
        // size segmented control buttons
        expect(html).toContain(">L<");
        expect(html).toContain(">S<");
        // profile segmented control
        expect(html).toContain(">speed<");
    });

    it("defaults active to L/speed when present", () => {
        const results = [
            fakeResult({ inputSize: "L", profile: "speed" }, 1.0, "node"),
            fakeResult({ inputSize: "S", profile: "speed" }, 2.0, "node"),
        ];
        const html = renderPerfView(aggregate(results));
        // The L slice should be visible (no display:none), S slice hidden
        expect(html).toContain('data-size="L" data-profile="speed"');
        expect(html).toContain('data-size="S" data-profile="speed"');
    });

    it("defaults the size control to the LARGEST available size (most representative)", () => {
        // Only S and M present (no L): M is the max, so it must be the active size.
        const results = [
            fakeResult({ inputSize: "S", profile: "speed" }, 2.0, "node"),
            fakeResult({ inputSize: "M", profile: "speed" }, 1.0, "node"),
        ];
        const html = renderPerfView(aggregate(results));
        expect(html).toContain('<span class="on" data-val="M">M</span>');   // M active in the control
        expect(html).not.toContain('<span class="on" data-val="S">');       // S not active
        // and the M slice is the visible (non-hidden) one:
        expect(html).toContain('<div class="perf-slice" data-size="M" data-profile="speed">');
    });

    it("renders warmMedian via .toFixed(3)", () => {
        const results = [fakeResult({}, 1.234, "node")];
        const html = renderPerfView(aggregate(results));
        expect(html).toContain("1.234");
    });

    it("renders global-scale fill widths as percentage", () => {
        const results = [
            fakeResult({ language: "rust", toolchain: "raw" }, 2.0, "node"),
            fakeResult({ language: "rust", toolchain: "bindgen" }, 1.0, "node"),
        ];
        const html = renderPerfView(aggregate(results));
        // rust/raw is 2.0 (100%), rust/bindgen is 1.0 (50%)
        expect(html).toContain("width:100%");
        expect(html).toContain("width:50%");
    });

    it("renders empty cell with — for absent env values", () => {
        // rust/raw only runs in node; rust/bindgen only in chromium
        const results = [
            fakeResult({ language: "rust", toolchain: "raw" }, 1.0, "node"),
            fakeResult({ language: "rust", toolchain: "bindgen" }, 2.0, "chromium"),
        ];
        const html = renderPerfView(aggregate(results));
        expect(html).toContain("—");
    });

    it("escapes workload id in output", () => {
        const r = fakeResult({ id: "<script>alert(1)</script>" });
        const html = renderPerfView(aggregate([r]));
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;");
    });

    it("renders em-head with env column headers", () => {
        const results = [
            fakeResult({}, 1.0, "node"),
            fakeResult({}, 2.0, "chromium"),
        ];
        const html = renderPerfView(aggregate(results));
        expect(html).toContain('class="em-head"');
        expect(html).toContain('class="eh"');
    });

    it("flags noisy and fail rows", () => {
        const results = [
            fakeResult({ language: "rust", toolchain: "raw" }, 1.0, "node"),
            fakeResult({ language: "rust", toolchain: "bindgen" }, 2.0, "node"),
        ];
        // Patch noisy onto first, correctnessFailed onto second
        results[0]!.stats.noisy = true;
        results[1]!.quality.correctnessFailed = true;
        const html = renderPerfView(aggregate(results));
        expect(html).toContain('class="cbox"');
        expect(html).toContain('tr class="noisy"');
        expect(html).toContain('class="hatch"');
        expect(html).toContain('tr class="fail"');
        expect(html).toContain('class="hatch-fail"');
    });

    it("renders the detail table with an env column showing every env", () => {
        const results = [
            fakeResult({ language: "rust", toolchain: "raw" }, 1.0, "node"),
            fakeResult({ language: "rust", toolchain: "raw" }, 2.0, "chromium"),
        ];
        const html = renderPerfView(aggregate(results));
        expect(html).toContain('class="pf-t"');
        // env header cell + value cells inside the detail table
        expect(html).toContain(">env<");
        expect(html).toContain(">node<");
        expect(html).toContain(">chromium<");
        // summary now reflects all envs, not just node
        expect(html).toContain("details · all envs");
    });

    it("makes the filter tray sticky", () => {
        expect(PERF_CSS).toContain("position:sticky");
    });

    it("renders shape_dispatch as a 2x2 heatmap with deltas", () => {
        const mk = (id: string, wm: number): BenchResult =>
            fakeResult({ id, language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, wm, "node");
        const html = renderPerfView(aggregate([
            mk("shape_dispatch_homo_static", 0.58),
            mk("shape_dispatch_homo_dyn", 0.74),
            mk("shape_dispatch_mixed_static", 0.61),
            mk("shape_dispatch_mixed_dyn", 1.31),
        ]));
        expect(html).toContain('class="shape-heat"');
        expect(html).toContain("static");
        expect(html).toContain("dynamic");
        expect(html).toMatch(/\+\d+%/);   // delta annotation on a dynamic cell
    });
});
