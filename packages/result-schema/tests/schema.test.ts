import { describe, expect, it } from "vitest";
import { BenchResultSchema, EnvSchema, SCHEMA_VERSION } from "../src/index.js";

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
