import { describe, expect, it } from "vitest";
import { ArtifactMetaSchema } from "../src/index.js";

const base = {
    combination: { benchmarkId: "matmul", language: "rust", toolchain: "raw", profile: "size" },
    wasm: { rawBytes: 1639, gzipBytes: 1098, brotliBytes: 1003, hashSha256: "a".repeat(64) },
    jsGlue: null,
    jsModule: null,
    totalTransferGzipBytes: 1098,
    toolchainVersions: { rustc: "1.95.0", node: "v22" },
};

describe("ArtifactMetaSchema", () => {
    it("accepts meta with null composition", () => {
        expect(() => ArtifactMetaSchema.parse({ ...base, composition: null })).not.toThrow();
    });

    it("accepts meta with a valid composition", () => {
        const composition = {
            source: "pre-opt-twiggy",
            productionTotal: { rawBytes: 1639, gzipBytes: 1098, brotliBytes: 1003 },
            preOptTotalBytes: 1750,
            calibrationFactor: 0.936,
            unattributedShare: 0.02,
            facilities: [{ facility: "observed", scaling: "observed", share: 0.59, approxBytes: 964 }],
        };
        expect(() => ArtifactMetaSchema.parse({ ...base, composition })).not.toThrow();
    });

    it("rejects an unknown language enum", () => {
        expect(() => ArtifactMetaSchema.parse({ ...base, combination: { ...base.combination, language: "go" }, composition: null })).toThrow();
    });
});
