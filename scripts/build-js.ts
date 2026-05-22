import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { build as esbuild } from "esbuild";
import { SpecSchema, type Spec } from "@bench/result-schema";
import {
    enumerateBinaries, distDirFor, type BinaryCombination,
} from "./lib/matrix.js";
import { statArtifact, writeMeta, type ArtifactMeta } from "./lib/meta.js";
import { detectActual } from "./lib/tool-versions.js";

async function buildOne(c: BinaryCombination): Promise<void> {
    const out = distDirFor(c);
    await mkdir(out, { recursive: true });

    const entry = `benches/${c.sourceBench}/js/${c.toolchain}/src/index.ts`;
    const outFile = join(out, "module.js");

    await esbuild({
        entryPoints: [entry],
        bundle: true,
        format: "esm",
        target: "es2022",
        minify: true,
        outfile: outFile,
        platform: "neutral",
        treeShaking: true,
    });

    const stat = await statArtifact(outFile);
    const versions = await detectActual();
    const meta: ArtifactMeta = {
        combination: {
            benchmarkId: c.sourceBench,
            language: c.language,
            toolchain: c.toolchain,
            profile: c.profile,
        },
        wasm: null,
        jsGlue: null,
        jsModule: stat,
        totalTransferGzipBytes: stat.gzipBytes,
        toolchainVersions: versions,
    };
    await writeMeta(out, meta);
    console.log(`built ${entry} -> ${outFile} (${stat.rawBytes} B raw, ${stat.gzipBytes} B gz)`);
}

async function loadSpec(benchId: string): Promise<Spec> {
    const raw = await readFile(`benches/${benchId}/spec.json`, "utf8");
    return SpecSchema.parse(JSON.parse(raw));
}

async function main() {
    const benches = process.argv.slice(2);
    if (benches.length === 0) {
        throw new Error("usage: tsx scripts/build-js.ts <bench-id> [<bench-id>...]");
    }
    for (const benchId of benches) {
        const spec = await loadSpec(benchId);
        // JS: speed profile only — esbuild produces identical output for both.
        const combos = enumerateBinaries(spec).filter(
            (b) => b.language === "js" && b.profile === "speed",
        );
        for (const c of combos) {
            await buildOne(c);
        }
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e); process.exit(1);
    });
}
