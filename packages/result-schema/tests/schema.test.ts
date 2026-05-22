import { describe, expect, it } from "vitest";
import { BenchResultSchema, EnvSchema, SCHEMA_VERSION, SpecSchema } from "../src/index.js";

describe("BenchResultSchema", () => {
    it("accepts a fully-populated valid result", () => {
        const sample = {
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
                wasmRawBytes: 12345,
                wasmGzipBytes: 4567,
                wasmBrotliBytes: 4000,
                jsGlueRawBytes: 0,
                jsGlueGzipBytes: 0,
                totalTransferGzipBytes: 4567,
                artifactHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            },
            timingsMs: {
                fetch: 1.2, compile: 3.4, instantiate: 0.5, initTotal: 5.1,
                firstCall: 1.0,
                warmMedian: 0.8, warmP95: 1.0, warmP99: 1.1,
                warmStddev: 0.05, warmMin: 0.7, warmMax: 1.2,
                endToEndMedian: 6.5,
            },
            memory: { wasmMemoryBytesPeak: 65536, wasmMemoryDeltaBytes: 0, jsHeapUsedAfter: null },
            stats: { nSamples: 30, cv: 0.02, noisy: false },
            quality: { checksum: "abc123", validated: true, correctnessFailed: false },
            notes: { streamingInstantiation: false, worker: true, wasmFeatures: ["bulk-memory"] },
        };
        const parsed = BenchResultSchema.parse(sample);
        expect(parsed.schemaVersion).toBe(1);
    });

    it("rejects unknown env.kind", () => {
        expect(() => EnvSchema.parse({
            kind: "other", name: "X", version: "1", engine: "V8",
        })).toThrow();
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
