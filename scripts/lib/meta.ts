import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { join } from "node:path";
import type { ArtifactMeta, ArtifactStat } from "@bench/result-schema";

export type { ArtifactMeta, ArtifactStat } from "@bench/result-schema";

export async function statArtifact(path: string): Promise<ArtifactStat> {
    const buf = await readFile(path);
    return {
        rawBytes: buf.byteLength,
        gzipBytes: gzipSync(buf, { level: 9 }).byteLength,
        brotliBytes: brotliCompressSync(buf).byteLength,
        hashSha256: createHash("sha256").update(buf).digest("hex"),
    };
}

export async function writeMeta(distPath: string, meta: ArtifactMeta): Promise<void> {
    await writeFile(join(distPath, "meta.json"), JSON.stringify(meta, null, 2));
}
