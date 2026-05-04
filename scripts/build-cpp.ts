import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { run } from "./lib/exec.js";
import { ALL_COMBINATIONS, distDir, type Combination } from "./lib/matrix.js";
import { statArtifact, writeMeta, type ArtifactMeta } from "./lib/meta.js";
import { detectActual } from "./lib/tool-versions.js";

async function buildEmscripten(c: Combination): Promise<void> {
    const out = distDir(c);
    await mkdir(out, { recursive: true });
    const script = resolve(`benches/${c.benchmarkId}/cpp/build-emscripten.sh`);
    await run("bash", [script, c.profile, resolve(out)]);

    // Emscripten emits glue.mjs + glue.wasm side-by-side; glue.mjs hardcodes
    // the wasm filename, so we don't rename.
    const wasmStat = await statArtifact(join(out, "glue.wasm"));
    const glueStat = await statArtifact(join(out, "glue.mjs"));
    const meta: ArtifactMeta = {
        combination: c,
        wasm: wasmStat,
        jsGlue: glueStat,
        jsModule: null,
        totalTransferGzipBytes: wasmStat.gzipBytes + glueStat.gzipBytes,
        toolchainVersions: await detectActual(),
    };
    await writeMeta(out, meta);
    console.log(`built emscripten (${c.profile}) -> ${out} (${wasmStat.rawBytes} B + ${glueStat.rawBytes} B glue)`);
}

async function buildWasiSdk(c: Combination): Promise<void> {
    const out = distDir(c);
    await mkdir(out, { recursive: true });
    const script = resolve(`benches/${c.benchmarkId}/cpp/build-wasi-sdk.sh`);
    await run("bash", [script, c.profile, resolve(out)]);

    const wasmStat = await statArtifact(join(out, "module.wasm"));
    const meta: ArtifactMeta = {
        combination: c,
        wasm: wasmStat,
        jsGlue: null,
        jsModule: null,
        totalTransferGzipBytes: wasmStat.gzipBytes,
        toolchainVersions: await detectActual(),
    };
    await writeMeta(out, meta);
    console.log(`built wasi-sdk (${c.profile}) -> ${out} (${wasmStat.rawBytes} B)`);
}

async function main() {
    for (const c of ALL_COMBINATIONS.filter((c) => c.language === "cpp")) {
        if (c.toolchain === "emscripten") {
            await buildEmscripten(c);
        } else if (c.toolchain === "wasi-sdk") {
            await buildWasiSdk(c);
        }
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e); process.exit(1);
    });
}
