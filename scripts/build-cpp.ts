import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { run } from "./lib/exec.js";
import { ALL_COMBINATIONS, distDir, type Combination } from "./lib/matrix.js";
import { statArtifact, writeMeta, type ArtifactMeta } from "./lib/meta.js";
import { detectActual } from "./lib/tool-versions.js";
import { wasiSdkPath } from "./lib/tool-paths.js";
import { emsdkEnv } from "./lib/emsdk-env.js";

async function buildEmscripten(c: Combination): Promise<void> {
    const out = distDir(c);
    await mkdir(out, { recursive: true });
    const script = resolve(`benches/${c.benchmarkId}/cpp/build-emscripten.sh`);
    // Fall back to system emsdk on PATH when .tools/emsdk is absent (dev convenience;
    // pnpm setup populates the dir, after which emsdkEnv() is the source of truth).
    const emsdk = existsSync(resolve(".tools/emsdk")) ? await emsdkEnv() : {};
    const toolsBin = resolve(".tools/bin");
    const mergedPath = `${toolsBin}:${emsdk["PATH"] ?? process.env["PATH"] ?? ""}`;
    await run("bash", [script, c.profile, resolve(out)], {
        env: { ...emsdk, PATH: mergedPath },
    });

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
    const toolsBin = resolve(".tools/bin");
    const mergedPath = `${toolsBin}:${process.env["PATH"] ?? ""}`;
    await run("bash", [script, c.profile, resolve(out)], {
        env: { WASI_SDK_PATH: wasiSdkPath(), PATH: mergedPath },
    });

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
