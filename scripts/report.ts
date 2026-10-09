import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { aggregate, renderHtml, buildSizeData } from "@bench/reporter";
import { BenchResultSchema, type BenchResult, type ArtifactMeta } from "@bench/result-schema";

function collectArtifactMetas(results: readonly BenchResult[]): ArtifactMeta[] {
    const metas = new Map<string, ArtifactMeta>();
    for (const { artifacts: meta } of results) {
        const { benchmarkId, language, toolchain, profile } = meta.combination;
        const key = JSON.stringify([benchmarkId, language, toolchain, profile]);
        const previous = metas.get(key);
        if (previous && !isDeepStrictEqual(previous, meta)) {
            throw new Error(`conflicting artifact metadata for ${benchmarkId}/${language}-${toolchain}-${profile}`);
        }
        metas.set(key, meta);
    }
    return [...metas.values()];
}

async function newestSubdir(dir: string): Promise<string> {
    const entries = await readdir(dir);
    let best: { name: string; mtimeMs: number } | null = null;
    for (const e of entries) {
        const s = await stat(join(dir, e));
        if (s.isDirectory() && (!best || s.mtimeMs > best.mtimeMs)) {
            best = { name: e, mtimeMs: s.mtimeMs };
        }
    }
    if (!best) {
        throw new Error(`no result dirs in ${dir}`);
    }
    return join(dir, best.name);
}

function getArg(name: string): string | undefined {
    const v = process.argv.find((a) => a.startsWith(`--${name}=`));
    return v ? v.slice(name.length + 3) : undefined;
}

async function main() {
    if (process.argv.some((a) => a === "--dist" || a.startsWith("--dist="))) {
        throw new Error("--dist is no longer supported; report sizes come from result metadata");
    }
    const inDir = getArg("in") ?? await newestSubdir("results/raw");
    const outDir = getArg("out") ?? `results/summarized/${new Date().toISOString().replace(/[:.]/g, "-")}`;

    const files = (await readdir(inDir)).filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
        throw new Error(`no JSON results in ${inDir}`);
    }
    const results = await Promise.all(files.map(async (f) => {
        const buf = await readFile(join(inDir, f), "utf8");
        return BenchResultSchema.parse(JSON.parse(buf));
    }));
    const sizeData = buildSizeData(collectArtifactMetas(results));
    const html = renderHtml(aggregate(results), sizeData);
    const outFile = join(outDir, "index.html");
    await mkdir(outDir, { recursive: true });
    await writeFile(outFile, html);
    console.log(`report -> ${outFile} (${results.length} results)`);
}

main().catch((e) => {
    console.error(e); process.exit(1);
});
