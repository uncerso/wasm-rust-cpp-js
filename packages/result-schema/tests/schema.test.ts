import { describe, expect, it } from "vitest";
import { BenchResultSchema, EnvSchema, SCHEMA_VERSION, SpecSchema } from "../src/index.js";

/** A fresh fully-populated valid BenchResult fixture (env omits `parallel`). */
function validBenchResult(): Record<string, unknown> {
    return {
        schemaVersion: SCHEMA_VERSION,
        timestamp: "2026-05-01T00:00:00.000Z",
        machine: { os: "macOS 15.4", cpu: "Apple M3 Pro", memoryGb: 36 },
        env: { kind: "browser", name: "Chrome", version: "136.0.0", engine: "V8" },
        benchmark: {
            id: "matmul",
            inputSize: "M",
            fixtureBytes: 524288,
            fixtureSha256: "0000000000000000000000000000000000000000000000000000000000000000",
            language: "rust",
            toolchain: "raw",
            profile: "size",
            postprocess: ["wasm-opt -Oz"],
        },
        artifacts: {
            combination: { benchmarkId: "matmul", language: "rust", toolchain: "raw", profile: "size" },
            wasm: { rawBytes: 12345, gzipBytes: 4567, brotliBytes: 4000, hashSha256: "0".repeat(64) },
            jsGlue: null,
            jsModule: null,
            totalTransferGzipBytes: 4567,
            toolchainVersions: { rustc: "1.95.0" },
            composition: null,
        },
        timingsMs: {
            fetch: 1.2, compile: 3.4, instantiate: 0.5, initTotal: 5.1,
            firstCall: 1.0,
            warmMedian: 0.8, warmP95: 1.0, warmP99: 1.1,
            warmStddev: 0.05, warmMin: 0.7, warmMax: 1.2, warmMad: 0.04,
            endToEndMedian: 6.5,
        },
        memory: { wasmMemoryBytesPeak: 65536, wasmMemoryDeltaBytes: 0, jsHeapUsedAfter: null },
        stats: { nSamples: 30, cv: 0.02, relSem: 0.004, meanImprecise: false, subResolution: false },
        quality: { checksum: "abc123", validated: true, correctnessFailed: false },
        notes: { streamingInstantiation: false, worker: true, wasmFeatures: ["bulk-memory"] },
    };
}

describe("BenchResultSchema", () => {
    it("accepts a fully-populated valid result", () => {
        const parsed = BenchResultSchema.parse(validBenchResult());
        expect(parsed.schemaVersion).toBe(3);
        expect(parsed.artifacts).toEqual(validBenchResult().artifacts);
    });

    it("rejects old results instead of guessing build metadata", () => {
        expect(() => BenchResultSchema.parse({ ...validBenchResult(), schemaVersion: 2 })).toThrow();
    });

    it("requires complete artifact metadata", () => {
        const result = validBenchResult();
        delete result.artifacts;
        expect(() => BenchResultSchema.parse(result)).toThrow();
    });

    it("rejects an invalid artifact hash", () => {
        const result = validBenchResult();
        const meta = result.artifacts as { wasm: { hashSha256: string } };
        meta.wasm.hashSha256 = "invalid";
        expect(() => BenchResultSchema.parse(result)).toThrow();
    });

    it("requires the primary artifact for the measured language", () => {
        const result = validBenchResult();
        (result.artifacts as { wasm: unknown }).wasm = null;
        expect(() => BenchResultSchema.parse(result)).toThrow();
    });

    it.each([
        ["language", "cpp"],
        ["toolchain", "bindgen"],
        ["profile", "speed"],
    ] as const)("rejects metadata with a different %s", (field, value) => {
        const result = validBenchResult();
        const meta = result.artifacts as { combination: Record<string, string> };
        meta.combination[field] = value;
        expect(() => BenchResultSchema.parse(result)).toThrow();
    });

    it("keeps the source binary id distinct from the entry id", () => {
        const result = validBenchResult();
        (result.benchmark as { id: string }).id = "matmul_entry";
        const parsed = BenchResultSchema.parse(result);
        expect(parsed.benchmark.id).toBe("matmul_entry");
        expect(parsed.artifacts).toMatchObject({ combination: { benchmarkId: "matmul" } });
    });

    it("rejects unknown env.kind", () => {
        expect(() => EnvSchema.parse({
            kind: "other", name: "X", version: "1", engine: "V8",
        })).toThrow();
    });

    it("env.parallel defaults to false when omitted", () => {
        const base = validBenchResult();
        delete (base.env as { parallel?: boolean }).parallel;
        const parsed = BenchResultSchema.parse(base);
        expect(parsed.env.parallel).toBe(false);
    });

    it("env.parallel round-trips when true", () => {
        const base = validBenchResult();
        (base.env as { parallel?: boolean }).parallel = true;
        expect(BenchResultSchema.parse(base).env.parallel).toBe(true);
    });
});

describe("SpecSchema", () => {
    const validSpec = {
        id: "demo",
        version: 2,
        entries: ["demo"],
        inputSizes: {
            S: { fixtureBytes: 0, fixtureSha256: "e".repeat(64), innerIterations: 100 },
        },
        expectedChecksums: { demo: { S: 42 } },
    };

    it("accepts a minimal multi-entry spec", () => {
        const parsed = SpecSchema.parse({
            ...validSpec,
            entries: ["a", "b"],
            expectedChecksums: { a: { S: 1 }, b: { S: 2 } },
        });
        expect(parsed.entries).toEqual(["a", "b"]);
    });

    it("accepts workload-specific size params via passthrough", () => {
        const parsed = SpecSchema.parse({
            ...validSpec,
            inputSizes: {
                S: { fixtureBytes: 65536, fixtureSha256: "a".repeat(64), n: 64 },
            },
        });
        expect((parsed.inputSizes.S as unknown as { n: number }).n).toBe(64);
    });

    it("rejects empty entries", () => {
        expect(() => SpecSchema.parse({ ...validSpec, entries: [] })).toThrow();
    });

    it("rejects bad fixtureSha256 length", () => {
        expect(() =>
            SpecSchema.parse({
                ...validSpec,
                inputSizes: { S: { fixtureBytes: 0, fixtureSha256: "abc" } },
            }),
        ).toThrow();
    });

    it("rejects wrong spec version", () => {
        expect(() => SpecSchema.parse({ ...validSpec, version: 1 })).toThrow();
    });

    it("rejects expectedChecksums for unknown size", () => {
        // zod's z.record(InputSizeSchema, ...) rejects keys outside the enum.
        expect(() =>
            SpecSchema.parse({
                ...validSpec,
                expectedChecksums: { demo: { XX: 1 } },
            }),
        ).toThrow();
    });
});
