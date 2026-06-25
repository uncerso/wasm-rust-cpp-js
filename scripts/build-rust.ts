import { mkdir, copyFile, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { SpecSchema, type Spec } from "@bench/result-schema";
import { run } from "./lib/exec.js";
import {
    enumerateBinaries, distDirFor, type BinaryCombination,
} from "./lib/matrix.js";
import { statArtifact, writeMeta, type ArtifactMeta } from "./lib/meta.js";
import { detectActual } from "./lib/tool-versions.js";
import { wasmOptPath, wasmPackPath } from "./lib/tool-paths.js";
import { attributeRustRaw, attributeRustBindgen } from "./lib/size-attr-build.js";

function metaFromBinary(c: BinaryCombination): ArtifactMeta["combination"] {
    return {
        benchmarkId: c.sourceBench,
        language: c.language,
        toolchain: c.toolchain,
        profile: c.profile,
    };
}

async function buildRaw(c: BinaryCombination): Promise<void> {
    const crateDir = `benches/${c.sourceBench}/rust/raw`;
    const profile = c.profile === "speed" ? "release" : "release-size";
    const out = distDirFor(c);
    await mkdir(out, { recursive: true });

    await run("cargo", ["build", `--profile=${profile}`, "--target=wasm32-unknown-unknown"], { cwd: crateDir });
    // Cargo workspace puts artifacts at workspace root target/, not per-crate.
    const wasmName = `${c.sourceBench}_rust_raw.wasm`;
    const src = join("target", "wasm32-unknown-unknown", profile, wasmName);
    const dst = join(out, "module.wasm");
    await copyFile(src, dst);

    if (c.profile === "size") {
        await run(wasmOptPath(), ["-Oz", "--enable-bulk-memory", "--enable-nontrapping-float-to-int", dst, "-o", dst]);
    }

    const wasmStat = await statArtifact(dst);
    const composition = await attributeRustRaw(c, {
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
    console.log(`built ${crateDir} (${profile}) -> ${dst} (${wasmStat.rawBytes} B)`);
}

async function buildBindgen(c: BinaryCombination): Promise<void> {
    const crateDir = `benches/${c.sourceBench}/rust/bindgen`;
    const out = distDirFor(c);
    await mkdir(out, { recursive: true });

    // wasm-pack has its internal wasm-opt disabled via Cargo metadata; we run
    // wasm-opt -Oz manually for the size profile after copying artifacts.
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
    const composition = await attributeRustBindgen(c, {
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
    console.log(`built ${crateDir} (${c.profile}) -> ${wasmDst} (${wasmStat.rawBytes} B + ${glueStat.rawBytes} B glue)`);
}

async function loadSpec(benchId: string): Promise<Spec> {
    const raw = await readFile(`benches/${benchId}/spec.json`, "utf8");
    return SpecSchema.parse(JSON.parse(raw));
}

async function main() {
    const benches = process.argv.slice(2);
    if (benches.length === 0) {
        throw new Error("usage: tsx scripts/build-rust.ts <bench-id> [<bench-id>...]");
    }
    for (const benchId of benches) {
        const spec = await loadSpec(benchId);
        const combos = enumerateBinaries(spec).filter((b) => b.language === "rust");
        for (const c of combos) {
            if (c.toolchain === "raw") {
                await buildRaw(c);
            } else if (c.toolchain === "bindgen") {
                await buildBindgen(c);
            }
        }
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e); process.exit(1);
    });
}
