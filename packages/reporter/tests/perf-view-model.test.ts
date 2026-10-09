import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregate.js";
import { buildPerfModel } from "../src/perf-view-model.js";
import { SCHEMA_VERSION, type BenchResult } from "@bench/result-schema";

function fakeResult(
    over: Partial<BenchResult["benchmark"]> & { id?: string } = {},
    warmMedian = 1.234,
    envName = "node",
): BenchResult {
    const language = over.language ?? "js";
    const stat = { rawBytes: 1234, gzipBytes: 1234, brotliBytes: 1234, hashSha256: "a".repeat(64) };
    return {
        schemaVersion: SCHEMA_VERSION,
        timestamp: "2026-05-01T00:00:00.000Z",
        machine: { os: "linux", cpu: "x", memoryGb: 32 },
        env: { kind: "node", name: envName, version: "v22.0.0", engine: "V8", parallel: false },
        benchmark: {
            id: "matmul", inputSize: "S", fixtureBytes: 0, fixtureSha256: "x".repeat(64),
            language: "js", toolchain: "idiomatic", profile: "speed", postprocess: [],
            ...over,
        },
        artifacts: {
            combination: {
                benchmarkId: over.id ?? "matmul", language,
                toolchain: over.toolchain ?? "idiomatic", profile: over.profile ?? "speed",
            },
            wasm: language === "js" ? null : stat,
            jsModule: language === "js" ? stat : null,
            jsGlue: null,
            totalTransferGzipBytes: 1234,
            toolchainVersions: {},
            composition: null,
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

describe("buildPerfModel", () => {
    it("groups warm-median per impl across envs into a slice", () => {
        const results = [
            fakeResult({ id: "hashmap_int", language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, 0.051, "node"),
            fakeResult({ id: "hashmap_int", language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, 0.072, "chromium"),
        ];
        const m = buildPerfModel(aggregate(results));
        const wl = m.workloads.find((w) => w.id === "hashmap_int")!;
        const slice = wl.slices.find((s) => s.size === "L" && s.profile === "speed")!;
        const row = slice.multiples.find((x) => x.impl === "rust/raw/speed")!;
        expect(row.byEnv.node).toBeCloseTo(0.051);
        expect(row.byEnv.chromium).toBeCloseTo(0.072);
        expect(slice.envs).toEqual(["node", "chromium"]);
    });
    it("isolates shape_dispatch into a per-(size,profile) impl×env grid + 4 combo detail slices", () => {
        // rust/raw has all 4 combos; js/idiomatic has 3 (no homo_static — language property).
        const rr = (id: string, wm: number, env: string) =>
            fakeResult({ id, language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, wm, env);
        const js = (id: string, wm: number, env: string) =>
            fakeResult({ id, language: "js", toolchain: "idiomatic", profile: "speed", inputSize: "L" }, wm, env);
        const m = buildPerfModel(aggregate([
            rr("shape_dispatch_homo_static", 1.20, "node"), rr("shape_dispatch_homo_dyn", 1.40, "node"),
            rr("shape_dispatch_mixed_static", 1.30, "node"), rr("shape_dispatch_mixed_dyn", 1.90, "node"),
            rr("shape_dispatch_homo_static", 1.26, "chromium"), rr("shape_dispatch_homo_dyn", 1.47, "chromium"),
            rr("shape_dispatch_mixed_static", 1.36, "chromium"), rr("shape_dispatch_mixed_dyn", 1.99, "chromium"),
            js("shape_dispatch_homo_dyn", 1.55, "node"), js("shape_dispatch_mixed_static", 1.60, "node"),
            js("shape_dispatch_mixed_dyn", 2.10, "node"),
            js("shape_dispatch_homo_dyn", 1.62, "chromium"), js("shape_dispatch_mixed_static", 1.66, "chromium"),
            js("shape_dispatch_mixed_dyn", 2.18, "chromium"),
        ]));
        // shape_dispatch is not a normal small-multiples workload
        expect(m.workloads.some((w) => w.id.startsWith("shape_dispatch"))).toBe(false);
        expect(m.shapeDispatch).not.toBeNull();

        const section = m.shapeDispatch!.find((s) => s.size === "L" && s.profile === "speed")!;
        expect(section).toBeDefined();
        expect(section.envs).toEqual(["node", "chromium"]);

        // impls ordered rust/raw before js? No — js/idiomatic ranks first in IMPL_ORDER.
        const rustRow = section.rows.find((r) => r.impl === "rust/raw")!;
        const jsRow = section.rows.find((r) => r.impl === "js/idiomatic")!;
        expect(rustRow).toBeDefined();
        expect(jsRow).toBeDefined();

        // rust/raw: all 4 node cells numeric, in SHAPE_DISPATCH_GRID order.
        expect(rustRow.byEnv["node"]).toHaveLength(4);
        expect(rustRow.byEnv["node"]!.every((c) => c.warmMedian != null)).toBe(true);
        const rrHomoStatic = rustRow.byEnv["node"]!.find((c) => c.layout === "homo" && c.dispatch === "static")!;
        expect(rrHomoStatic.warmMedian).toBeCloseTo(1.20);

        // js: 4 cells, homo·static is null (no impl); homo·dynamic numeric.
        expect(jsRow.byEnv["node"]).toHaveLength(4);
        const jsHomoStatic = jsRow.byEnv["node"]!.find((c) => c.layout === "homo" && c.dispatch === "static")!;
        const jsHomoDyn = jsRow.byEnv["node"]!.find((c) => c.layout === "homo" && c.dispatch === "dynamic")!;
        expect(jsHomoStatic.warmMedian).toBeNull();
        expect(jsHomoDyn.warmMedian).toBeCloseTo(1.55);

        // 4 combo detail slices, each with PerfDetailRow[].
        expect(section.detail).toHaveLength(4);
        const homoStatic = section.detail.find((d) => d.layout === "homo" && d.dispatch === "static")!;
        expect(homoStatic.benchId).toBe("shape_dispatch_homo_static");
        // homo_static has rust/raw (node+chromium) but no js row.
        expect(homoStatic.rows.some((r) => r.impl === "rust/raw")).toBe(true);
        expect(homoStatic.rows.some((r) => r.impl === "js/idiomatic")).toBe(false);
        const homoDyn = section.detail.find((d) => d.layout === "homo" && d.dispatch === "dynamic")!;
        expect(homoDyn.rows.some((r) => r.impl === "js/idiomatic" && r.env === "node")).toBe(true);
        // detail rows carry the full PerfDetailRow shape (relSem present).
        expect(typeof homoDyn.rows[0]!.relSem).toBe("number");
    });
    it("emits a shape section per (size, profile) present in shape data + flows into control unions", () => {
        const mk = (id: string, size: "S" | "M" | "L", wm: number) =>
            fakeResult({ id, language: "rust", toolchain: "raw", profile: "speed", inputSize: size }, wm, "node");
        const m = buildPerfModel(aggregate([
            mk("shape_dispatch_homo_static", "L", 0.58), mk("shape_dispatch_mixed_dyn", "L", 1.31),
            mk("shape_dispatch_homo_static", "S", 0.20), mk("shape_dispatch_mixed_dyn", "S", 0.41),
        ]));
        expect(m.shapeDispatch!.map((s) => s.size).sort()).toEqual(["L", "S"]);
        // shape sizes/profiles flow into the control unions
        expect(m.sizes).toContain("L");
        expect(m.sizes).toContain("S");
        expect(m.profiles).toContain("speed");
    });
    it("builds detail rows per (impl, env) present in a slice", () => {
        const results = [
            fakeResult({ id: "hashmap_int", language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, 0.051, "node"),
            fakeResult({ id: "hashmap_int", language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, 0.072, "chromium"),
        ];
        const m = buildPerfModel(aggregate(results));
        const wl = m.workloads.find((w) => w.id === "hashmap_int")!;
        const slice = wl.slices.find((s) => s.size === "L" && s.profile === "speed")!;
        expect(slice.detail.some((r) => r.env === "node")).toBe(true);
        expect(slice.detail.some((r) => r.env === "chromium")).toBe(true);
        expect(slice.detail).toHaveLength(2);
    });
    it("treats JS as profile-agnostic: shows it in every profile slice, label without profile", () => {
        // hashmap_int has a wasm impl at both size+speed and a JS impl tagged only speed.
        const results = [
            fakeResult({ id: "hashmap_int", language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, 0.05, "node"),
            fakeResult({ id: "hashmap_int", language: "rust", toolchain: "raw", profile: "size", inputSize: "L" }, 0.06, "node"),
            fakeResult({ id: "hashmap_int", language: "js", toolchain: "idiomatic", profile: "speed", inputSize: "L" }, 0.10, "node"),
        ];
        const wl = buildPerfModel(aggregate(results)).workloads.find((w) => w.id === "hashmap_int")!;
        const speed = wl.slices.find((s) => s.size === "L" && s.profile === "speed")!;
        const size = wl.slices.find((s) => s.size === "L" && s.profile === "size")!;
        // JS appears in BOTH profile slices, labeled `js/idiomatic` (no profile suffix):
        expect(speed.multiples.some((m) => m.impl === "js/idiomatic")).toBe(true);
        expect(size.multiples.some((m) => m.impl === "js/idiomatic")).toBe(true);
        expect(wl.slices.some((s) => s.multiples.some((m) => m.impl === "js/idiomatic/speed"))).toBe(false);
    });
    it("orders impls canonically (js, rust, cpp) regardless of speed", () => {
        // Input deliberately scrambled + slower js than rust: order must NOT follow warmMedian.
        const results = [
            fakeResult({ id: "matmul", language: "cpp", toolchain: "wasi-sdk", profile: "speed", inputSize: "L" }, 0.10, "node"),
            fakeResult({ id: "matmul", language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, 0.30, "node"),
            fakeResult({ id: "matmul", language: "cpp", toolchain: "emscripten", profile: "speed", inputSize: "L" }, 0.20, "node"),
        ];
        const wl = buildPerfModel(aggregate(results)).workloads.find((w) => w.id === "matmul")!;
        const slice = wl.slices.find((s) => s.size === "L" && s.profile === "speed")!;
        expect(slice.multiples.map((m) => m.impl)).toEqual([
            "rust/raw/speed", "cpp/emscripten/speed", "cpp/wasi-sdk/speed",
        ]);
    });
});
