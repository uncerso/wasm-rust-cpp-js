import { mkdir, copyFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./lib/exec.js";
import { ALL_COMBINATIONS, distDir, type Combination } from "./lib/matrix.js";
import { statArtifact, writeMeta, type ArtifactMeta } from "./lib/meta.js";
import { detectActual } from "./lib/tool-versions.js";
import { wasmOptPath, wasmPackPath } from "./lib/tool-paths.js";

async function buildRaw(c: Combination): Promise<void> {
    const crateDir = `benches/${c.benchmarkId}/rust/raw`;
    const profile = c.profile === "speed" ? "release" : "release-size";
    const out = distDir(c);
    await mkdir(out, { recursive: true });

    await run("cargo", ["build", `--profile=${profile}`, "--target=wasm32-unknown-unknown"], { cwd: crateDir });
    const wasmName = "matmul_rust_raw.wasm";
    const src = join(crateDir, "target", "wasm32-unknown-unknown", profile, wasmName);
    const dst = join(out, "module.wasm");
    await copyFile(src, dst);

    if (c.profile === "size") {
        await run(wasmOptPath(), ["-Oz", "--enable-bulk-memory", "--enable-nontrapping-float-to-int", dst, "-o", dst]);
    }

    const wasmStat = await statArtifact(dst);
    const meta: ArtifactMeta = {
        combination: c,
        wasm: wasmStat,
        jsGlue: null,
        jsModule: null,
        totalTransferGzipBytes: wasmStat.gzipBytes,
        toolchainVersions: await detectActual(),
    };
    await writeMeta(out, meta);
    console.log(`built ${crateDir} (${profile}) -> ${dst} (${wasmStat.rawBytes} B)`);
}

async function buildBindgen(c: Combination): Promise<void> {
    const crateDir = `benches/${c.benchmarkId}/rust/bindgen`;
    const out = distDir(c);
    await mkdir(out, { recursive: true });

    // wasm-pack has its internal wasm-opt disabled via Cargo metadata; we run
    // wasm-opt -Oz manually for the size profile after copying artifacts.
    // Both speed and size variants share --release; size differs only via
    // post-processing with wasm-opt.
    const pkgDir = join(crateDir, "pkg-tmp");
    await rm(pkgDir, { recursive: true, force: true });
    await run(wasmPackPath(), ["build", "--target=web", "--release", "--out-dir=pkg-tmp"], { cwd: crateDir });

    const files = await readdir(pkgDir);
    const wasmFile = files.find((f) => f.endsWith("_bg.wasm"));
    const jsFile = files.find((f) => f.endsWith(".js"));
    if (!wasmFile) {
        throw new Error(`wasm-pack output missing _bg.wasm in ${pkgDir}`);
    }
    if (!jsFile) {
        throw new Error(`wasm-pack output missing glue .js in ${pkgDir}`);
    }

    const wasmDst = join(out, "module.wasm");
    const glueDst = join(out, "glue.js");
    await copyFile(join(pkgDir, wasmFile), wasmDst);
    await copyFile(join(pkgDir, jsFile), glueDst);

    if (c.profile === "size") {
        await run(wasmOptPath(), ["-Oz", "--enable-bulk-memory", "--enable-nontrapping-float-to-int", wasmDst, "-o", wasmDst]);
    }

    const wasmStat = await statArtifact(wasmDst);
    const glueStat = await statArtifact(glueDst);
    const meta: ArtifactMeta = {
        combination: c,
        wasm: wasmStat,
        jsGlue: glueStat,
        jsModule: null,
        totalTransferGzipBytes: wasmStat.gzipBytes + glueStat.gzipBytes,
        toolchainVersions: await detectActual(),
    };
    await writeMeta(out, meta);
    console.log(`built ${crateDir} (${c.profile}) -> ${wasmDst} (${wasmStat.rawBytes} B + ${glueStat.rawBytes} B glue)`);
}

async function main() {
    for (const c of ALL_COMBINATIONS.filter((c) => c.language === "rust")) {
        if (c.toolchain === "raw") {
            await buildRaw(c);
        } else if (c.toolchain === "bindgen") {
            await buildBindgen(c);
        }
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e); process.exit(1);
    });
}
