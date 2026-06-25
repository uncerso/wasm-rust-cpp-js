import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregate.js";
import { buildPerfModel } from "../src/perf-view-model.js";
import type { BenchResult } from "@bench/result-schema";

function fakeResult(
    over: Partial<BenchResult["benchmark"]> & { id?: string } = {},
    warmMedian = 1.234,
    envName = "node",
): BenchResult {
    return {
        schemaVersion: 1,
        timestamp: "2026-05-01T00:00:00.000Z",
        machine: { os: "linux", cpu: "x", memoryGb: 32 },
        env: { kind: "node", name: envName, version: "v22.0.0", engine: "V8" },
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
    it("isolates shape_dispatch into per-(size,profile) 2x2 grids", () => {
        const mk = (id: string, wm: number) => fakeResult({ id, language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, wm, "node");
        const m = buildPerfModel(aggregate([
            mk("shape_dispatch_homo_static", 0.58), mk("shape_dispatch_homo_dyn", 0.74),
            mk("shape_dispatch_mixed_static", 0.61), mk("shape_dispatch_mixed_dyn", 1.31),
        ]));
        expect(m.workloads.some((w) => w.id.startsWith("shape_dispatch"))).toBe(false);
        expect(m.shapeDispatch).not.toBeNull();
        const slice = m.shapeDispatch!.find((s) => s.size === "L" && s.profile === "speed")!;
        expect(slice).toBeDefined();
        expect(slice.cells).toHaveLength(4);
        expect(slice.cells.find((c) => c.layout === "mixed" && c.dispatch === "dynamic")!.warmMedian).toBeCloseTo(1.31);
    });
    it("emits a shape slice per (size, profile) present in shape data", () => {
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
});
