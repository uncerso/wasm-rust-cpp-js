import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregate.js";
import { PERF_CSS, PERF_JS, renderPerfView } from "../src/render-perf.js";
import type { BenchResult } from "@bench/result-schema";

function fakeResult(
    over: Partial<BenchResult["benchmark"]> = {},
    warmMedian = 1.234,
    envName = "node",
): BenchResult {
    return {
        schemaVersion: 2,
        timestamp: "2026-05-01T00:00:00.000Z",
        machine: { os: "linux", cpu: "x", memoryGb: 32 },
        env: { kind: "node", name: envName, version: "v22.0.0", engine: "V8", parallel: false },
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
            warmMin: 1.1, warmMax: 1.7, warmMad: 0.04, endToEndMedian: warmMedian,
        },
        memory: { wasmMemoryBytesPeak: 0, wasmMemoryDeltaBytes: 0, jsHeapUsedAfter: null },
        stats: { nSamples: 30, cv: 0.01, relSem: 0.002, meanImprecise: false, subResolution: false },
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

    it("flags imprecise-mean (amber) and fail rows, and a sub-resolution badge", () => {
        const results = [
            fakeResult({ language: "rust", toolchain: "raw" }, 1.0, "node"),
            fakeResult({ language: "rust", toolchain: "bindgen" }, 2.0, "node"),
            fakeResult({ language: "cpp", toolchain: "emscripten" }, 3.0, "node"),
        ];
        results[0]!.stats.meanImprecise = true;
        results[1]!.quality.correctnessFailed = true;
        results[2]!.stats.subResolution = true;
        const html = renderPerfView(aggregate(results));
        expect(html).toContain('tr class="noisy"');   // imprecise mean → amber row
        expect(html).toContain('class="hatch"');
        expect(html).toContain('td class="bad"');      // relSem cell (the gate) highlighted
        expect(html).toContain('tr class="fail"');
        expect(html).toContain('class="hatch-fail"');
        expect(html).toContain("&lt;res");            // sub-resolution badge
    });

    it("renders relSem and mad columns in the detail table", () => {
        const html = renderPerfView(aggregate([fakeResult({}, 1.0, "node")]));
        expect(html).toContain(">relSem<");
        expect(html).toContain(">mad<");
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

    it("stabilizes the detail table via fixed layout + explicit column widths (full-width, no jump across filters)", () => {
        expect(PERF_CSS).toMatch(/\.pf-t\{[^}]*table-layout:fixed/);
        expect(PERF_CSS).toMatch(/\.pf-t\{[^}]*width:100%/);
        // impl + a number column get explicit % widths (content-independent → no resize on filter switch)
        expect(PERF_CSS).toMatch(/\.pf-t [^{]*:first-child\{[^}]*width:\d+%/);
        expect(PERF_CSS).toMatch(/\.pf-t [^{]*nth-child\(6\)[^{]*\{[^}]*width:\d+%/);
    });

    it("tags detail spoilers with a filter-stable data-sync key", () => {
        const html = renderPerfView(aggregate([fakeResult({ id: "hashmap_int" }, 1.0, "node")]));
        expect(html).toContain('data-sync="hashmap_int:all"');
    });

    it("tags shape_dispatch combo spoilers with a layout·dispatch data-sync key", () => {
        const rr = (id: string, wm: number): BenchResult =>
            fakeResult({ id, language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, wm, "node");
        const html = renderPerfView(aggregate([
            rr("shape_dispatch_homo_static", 1.2), rr("shape_dispatch_homo_dyn", 1.4),
            rr("shape_dispatch_mixed_static", 1.3), rr("shape_dispatch_mixed_dyn", 1.9),
        ]));
        expect(html).toContain('data-sync="shape:homo:dynamic"');
        expect(html).toContain('data-sync="shape:mixed:static"');
    });

    it("PERF_JS syncs data-sync spoiler state with a re-entry guard", () => {
        expect(PERF_JS).toContain("data-sync");
        expect(PERF_JS).toContain("CSS.escape");
    });

    it("renders shape_dispatch as an impl×env grid with a 2×2 (layout×dispatch) bar block per cell", () => {
        const rr = (id: string, wm: number, env: string): BenchResult =>
            fakeResult({ id, language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, wm, env);
        const js = (id: string, wm: number, env: string): BenchResult =>
            fakeResult({ id, language: "js", toolchain: "idiomatic", profile: "speed", inputSize: "L" }, wm, env);
        const html = renderPerfView(aggregate([
            rr("shape_dispatch_homo_static", 1.20, "node"), rr("shape_dispatch_homo_dyn", 1.40, "node"),
            rr("shape_dispatch_mixed_static", 1.30, "node"), rr("shape_dispatch_mixed_dyn", 1.90, "node"),
            js("shape_dispatch_homo_dyn", 3.80, "node"), js("shape_dispatch_mixed_static", 3.60, "node"),
            js("shape_dispatch_mixed_dyn", 4.00, "node"),
        ]));
        expect(html).toContain('class="shape-grid"');
        expect(html).not.toContain('class="shape-heat"');
        // CSS-grid bar cells (sh-c), env sub-columns static/dynamic, no heat buckets
        expect(html).toContain('class="sh-c"');
        expect(html).not.toMatch(/class="a[1-5]"/);
        // per-env scale: node max = 4.00 (js mixed·dyn) → its bar is 100%
        expect(html).toContain("width:100%");
        // impl rows, env headers, static/dynamic sub-headers, homo/mixed layout labels
        expect(html).toContain("rust/raw");
        expect(html).toContain("js/idiomatic");
        expect(html).toContain(">node<");
        expect(html).toContain(">static<");
        expect(html).toContain(">dynamic<");
        expect(html).toContain(">homo<");
        expect(html).toContain(">mixed<");
        // delta on a dynamic bar + dash for js homo·static + 4 detail tables + caption
        expect(html).toMatch(/\+\d+%/);
        expect(html).toContain("—");
        expect(html).toContain("details · homo·static");
        expect(html).toContain("details · homo·dynamic");
        expect(html).toContain("details · mixed·static");
        expect(html).toContain("details · mixed·dynamic");
        expect(html).toContain("static-typing");
        expect(html).toContain("homo_static");
    });

    it("renders a clean tray legend decoding amber/red/<res (no word-labels)", () => {
        const html = renderPerfView(aggregate([fakeResult({}, 1.0, "node")]));
        expect(html).toContain('class="perf-legend"');
        expect(html).toContain("mean not pinned to 3% → see mad/cv");
        expect(html).toContain("correctness fail (ok ✗)");
        expect(html).toContain("below timer resolution — only the mean is reliable");
        expect(html).toContain("#fdf6da");   // amber swatch
        expect(html).toContain("#fbe4e4");   // red swatch
        // clean legend: the colour speaks, no "amber ="/"red =" word-labels
        expect(html).not.toContain("amber =");
        expect(html).not.toContain("red =");
    });

    it("renders the open-by-default 'how to read this tab' glossary callout", () => {
        const html = renderPerfView(aggregate([fakeResult({}, 1.0, "node")]));
        expect(html).toContain('class="perf-guide"');
        expect(html).toMatch(/<details class="perf-guide" open>/);   // open by default
        expect(html).toContain("how to read this tab");
        expect(html).toContain("timing · ms");
        expect(html).toContain("spread · precision");
        expect(html).toContain("correctness");
        // relSem line carries the precision-vs-spread insight + the highlight clause
        expect(html).toContain("cv / √n");
        expect(html).toContain("the row turns amber");
    });

    it("glossary defines every metric column in the detail table", () => {
        const html = renderPerfView(aggregate([fakeResult({}, 1.0, "node")]));
        // identifier columns (impl, env) are self-evident and intentionally excluded
        for (const m of ["init", "first", "warm med", "p95", "mad", "cv", "relSem", "ok"]) {
            expect(html).toContain(`<dt>${m}</dt>`);
        }
    });
});
