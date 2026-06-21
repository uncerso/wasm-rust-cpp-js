import { ArtifactMetaSchema, type ArtifactMeta } from "@bench/result-schema";

export interface SizeBinary {
    id: string;
    language: string;
    toolchain: string;
    profile: string;
    label: string; // `${language}/${toolchain}/${profile}`
    totals: { rawBytes: number; gzipBytes: number; brotliBytes: number };
    composition: ArtifactMeta["composition"];
    isJs: boolean;
}

export interface SizeData {
    binaries: SizeBinary[];
}

export function parseArtifactMeta(json: string): ArtifactMeta {
    return ArtifactMetaSchema.parse(JSON.parse(json));
}

export function buildSizeData(metas: readonly ArtifactMeta[]): SizeData {
    const binaries: SizeBinary[] = [];
    for (const m of metas) {
        const stat = m.wasm ?? m.jsModule;
        if (!stat) {
            continue; // nothing shippable to size
        }
        const { benchmarkId, language, toolchain, profile } = m.combination;
        binaries.push({
            id: benchmarkId,
            language,
            toolchain,
            profile,
            label: `${language}/${toolchain}/${profile}`,
            totals: { rawBytes: stat.rawBytes, gzipBytes: stat.gzipBytes, brotliBytes: stat.brotliBytes },
            composition: m.composition,
            isJs: language === "js",
        });
    }
    binaries.sort((a, b) => a.id.localeCompare(b.id) || a.label.localeCompare(b.label));
    return { binaries };
}
