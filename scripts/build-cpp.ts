import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SpecSchema, type Spec } from "@bench/result-schema";
import { run } from "./lib/exec.js";
import {
    enumerateBinaries, distDirFor, type BinaryCombination,
} from "./lib/matrix.js";
import { statArtifact, writeMeta, type ArtifactMeta } from "./lib/meta.js";
import { detectActual } from "./lib/tool-versions.js";
import { wasiSdkPath, wasmOptPath } from "./lib/tool-paths.js";
import { emsdkEnv } from "./lib/emsdk-env.js";
import { optimizeWasm } from "./lib/wasm-opt.js";
import { wasiSdkBuildPath } from "./lib/build-env.js";
import { attributeWasiSdk, attributeEmscripten } from "./lib/size-attr-build.js";

function metaFromBinary(c: BinaryCombination): ArtifactMeta["combination"] {
    return {
        benchmarkId: c.sourceBench,
        language: c.language,
        toolchain: c.toolchain,
        profile: c.profile,
    };
}

async function buildEmscripten(c: BinaryCombination): Promise<void> {
    const out = distDirFor(c);
    await mkdir(out, { recursive: true });
    const script = resolve(`benches/${c.sourceBench}/cpp/build-emscripten.sh`);
    // Fall back to system emsdk on PATH when .tools/emsdk is absent (dev convenience;
    // pnpm setup populates the dir, after which emsdkEnv() is the source of truth).
    const emsdk = existsSync(resolve(".tools/emsdk")) ? await emsdkEnv() : {};
    // emcc runs its own bundled binaryen internally; it needs only the emsdk environment.
    // Dropping .tools/bin keeps emcc from ever shadowing its wasm-opt with the pinned one.
    const emsdkPath = emsdk["PATH"] ?? process.env["PATH"] ?? "";
    const attrDir = resolve("target/attr-cpp", `${c.sourceBench}-${c.toolchain}-${c.profile}`);
    await mkdir(attrDir, { recursive: true });
    await run("bash", [script, c.profile, resolve(out)], {
        env: { ...emsdk, PATH: emsdkPath, WASM_OPT: wasmOptPath(), SIZE_ATTR: "1", ATTR_OUT: attrDir },
    });

    // Emscripten emits glue.mjs + glue.wasm side-by-side; glue.mjs hardcodes
    // the wasm filename, so we don't rename.
    const wasmStat = await statArtifact(join(out, "glue.wasm"));
    const glueStat = await statArtifact(join(out, "glue.mjs"));
    const composition = await attributeEmscripten(c, attrDir, {
        rawBytes: wasmStat.rawBytes, gzipBytes: wasmStat.gzipBytes, brotliBytes: wasmStat.brotliBytes,
    });
    const meta: ArtifactMeta = {
        combination: metaFromBinary(c),
        wasm: wasmStat,
        jsGlue: glueStat,
        jsModule: null,
        totalTransferGzipBytes: wasmStat.gzipBytes + glueStat.gzipBytes,
        toolchainVersions: await detectActual(),
        composition,
    };
    await writeMeta(out, meta);
    console.log(`built emscripten ${c.sourceBench} (${c.profile}) -> ${out} (${wasmStat.rawBytes} B + ${glueStat.rawBytes} B glue)`);
}

async function buildWasiSdk(c: BinaryCombination): Promise<void> {
    const out = distDirFor(c);
    await mkdir(out, { recursive: true });
    const script = resolve(`benches/${c.sourceBench}/cpp/build-wasi-sdk.sh`);
    const attrDir = resolve("target/attr-cpp", `${c.sourceBench}-${c.toolchain}-${c.profile}`);
    await mkdir(attrDir, { recursive: true });
    // Empty PATH: the wasi-sdk clang -flto driver cannot auto-discover any wasm-opt, so the
    // build is deterministic regardless of the user's machine. The shell only links (module.wasm
    // stripped, module.attr.wasm name-bearing); the explicit wasm-opt pass below owns optimization.
    await run("bash", [script, c.profile, resolve(out)], {
        env: {
            PATH: wasiSdkBuildPath(),
            WASI_SDK_PATH: wasiSdkPath(),
            SIZE_ATTR: "1",
            ATTR_OUT: attrDir, // name-bearing attr.wasm goes here, not dist
        },
    });
    // Explicit, deterministic wasm-opt (Option B: all profiles — speed -O3, size -Oz).
    await optimizeWasm(join(out, "module.wasm"), c.profile === "speed" ? "O3" : "Oz");

    const wasmStat = await statArtifact(join(out, "module.wasm"));
    const composition = await attributeWasiSdk(c, attrDir, {
        rawBytes: wasmStat.rawBytes, gzipBytes: wasmStat.gzipBytes, brotliBytes: wasmStat.brotliBytes,
    });
    const meta: ArtifactMeta = {
        combination: metaFromBinary(c),
        wasm: wasmStat,
        jsGlue: null,
        jsModule: null,
        totalTransferGzipBytes: wasmStat.gzipBytes,
        toolchainVersions: await detectActual(),
        composition,
    };
    await writeMeta(out, meta);
    console.log(`built wasi-sdk ${c.sourceBench} (${c.profile}) -> ${out} (${wasmStat.rawBytes} B)`);
}

async function loadSpec(benchId: string): Promise<Spec> {
    const raw = await readFile(`benches/${benchId}/spec.json`, "utf8");
    return SpecSchema.parse(JSON.parse(raw));
}

async function main() {
    const benches = process.argv.slice(2);
    if (benches.length === 0) {
        throw new Error("usage: tsx scripts/build-cpp.ts <bench-id> [<bench-id>...]");
    }
    for (const benchId of benches) {
        const spec = await loadSpec(benchId);
        const combos = enumerateBinaries(spec).filter((b) => b.language === "cpp");
        for (const c of combos) {
            if (c.toolchain === "emscripten") {
                await buildEmscripten(c);
            } else if (c.toolchain === "wasi-sdk") {
                await buildWasiSdk(c);
            }
        }
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e); process.exit(1);
    });
}
