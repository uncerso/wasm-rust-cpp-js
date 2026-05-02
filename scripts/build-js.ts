import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { build as esbuild } from "esbuild";
import { ALL_COMBINATIONS, distDir, type Combination } from "./lib/matrix.js";
import { statArtifact, writeMeta, type ArtifactMeta } from "./lib/meta.js";
import { detectActual } from "./lib/tool-versions.js";

async function buildOne(c: Combination): Promise<void> {
  const out = distDir(c);
  await mkdir(out, { recursive: true });

  const entry = `benches/${c.benchmarkId}/js/${c.toolchain}/src/index.ts`;
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
    combination: c,
    wasm: null,
    jsGlue: null,
    jsModule: stat,
    totalTransferGzipBytes: stat.gzipBytes,
    toolchainVersions: versions,
  };
  await writeMeta(out, meta);
  console.log(`built ${entry} -> ${outFile} (${stat.rawBytes} B raw, ${stat.gzipBytes} B gz)`);
}

async function main() {
  const jsCombos = ALL_COMBINATIONS.filter((c) => c.language === "js");
  for (const c of jsCombos) await buildOne(c);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
