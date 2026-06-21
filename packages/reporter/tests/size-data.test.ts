import { describe, expect, it } from "vitest";
import { buildSizeData, parseArtifactMeta } from "../src/size-data.js";
import type { ArtifactMeta } from "@bench/result-schema";

function meta(over: Partial<ArtifactMeta> = {}): ArtifactMeta {
    return {
        combination: { benchmarkId: "matmul", language: "rust", toolchain: "raw", profile: "size" },
        wasm: { rawBytes: 1639, gzipBytes: 1098, brotliBytes: 1003, hashSha256: "a".repeat(64) },
        jsGlue: null,
        jsModule: null,
        totalTransferGzipBytes: 1098,
        toolchainVersions: {},
        composition: null,
        ...over,
    };
}

describe("parseArtifactMeta", () => {
    it("parses + validates a meta.json string", () => {
        const m = parseArtifactMeta(JSON.stringify(meta()));
        expect(m.combination.benchmarkId).toBe("matmul");
    });
});

describe("buildSizeData", () => {
    it("takes wasm totals for wasm binaries", () => {
        const d = buildSizeData([meta()]);
        expect(d.binaries).toHaveLength(1);
        expect(d.binaries[0]!.totals).toEqual({ rawBytes: 1639, gzipBytes: 1098, brotliBytes: 1003 });
        expect(d.binaries[0]!.label).toBe("rust/raw/size");
        expect(d.binaries[0]!.isJs).toBe(false);
    });

    it("takes jsModule totals for JS binaries", () => {
        const js = meta({
            combination: { benchmarkId: "matmul", language: "js", toolchain: "idiomatic", profile: "speed" },
            wasm: null,
            jsModule: { rawBytes: 969, gzipBytes: 485, brotliBytes: 416, hashSha256: "b".repeat(64) },
        });
        const d = buildSizeData([js]);
        expect(d.binaries[0]!.isJs).toBe(true);
        expect(d.binaries[0]!.totals).toEqual({ rawBytes: 969, gzipBytes: 485, brotliBytes: 416 });
    });

    it("sorts binaries deterministically by id then label", () => {
        const a = meta({ combination: { benchmarkId: "b", language: "rust", toolchain: "raw", profile: "size" } });
        const b = meta({ combination: { benchmarkId: "a", language: "rust", toolchain: "raw", profile: "speed" } });
        const d = buildSizeData([a, b]);
        expect(d.binaries.map((x) => `${x.id}|${x.label}`)).toEqual(["a|rust/raw/speed", "b|rust/raw/size"]);
    });

    it("skips binaries with neither wasm nor jsModule", () => {
        const d = buildSizeData([meta({ wasm: null, jsModule: null })]);
        expect(d.binaries).toHaveLength(0);
    });
});
