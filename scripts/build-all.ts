import { mkdir, copyFile, readdir, access } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import { run } from "./lib/exec.js";
import { runPool } from "./lib/pool.js";
import { collectJsUnits } from "./build-js.js";
import { collectRustUnits } from "./build-rust.js";
import { collectCppUnits } from "./build-cpp.js";

async function fileExists(p: string): Promise<boolean> {
    try {
        await access(p); return true;
    } catch {
        return false;
    }
}

/** Bench discovery: a directory under `benches/` with a `spec.json` is a bench. */
async function listBenches(): Promise<string[]> {
    const entries = await readdir("benches", { withFileTypes: true });
    const out: string[] = [];
    for (const e of entries) {
        if (e.isDirectory() && await fileExists(`benches/${e.name}/spec.json`)) {
            out.push(e.name);
        }
    }
    return out.sort();
}

async function copyFixtures(benchId: string): Promise<void> {
    const fxSrc = `benches/${benchId}/fixtures`;
    const fxDst = `dist/${benchId}/fixtures`;
    await mkdir(fxDst, { recursive: true });
    for (const sz of ["s", "m", "l"]) {
        const src = join(fxSrc, `${sz}.bin`);
        if (await fileExists(src)) {
            await copyFile(src, join(fxDst, `${sz}.bin`));
        }
    }
}

async function main() {
    const benches = await listBenches();
    if (benches.length === 0) {
        throw new Error("no benches discovered under benches/*/spec.json");
    }
    const limit = cpus().length;
    console.log(`=== discovered benches: ${benches.join(", ")} (pool limit ${limit}) ===`);

    console.log("=== generating fixtures (parallel) ===");
    const fixtureUnits: Array<() => Promise<void>> = [];
    for (const id of benches) {
        const gen = `benches/${id}/fixtures/generate.ts`;
        if (await fileExists(gen)) {
            fixtureUnits.push(() => run("tsx", [gen]));
        }
    }
    await runPool(fixtureUnits, limit);

    console.log("=== copying fixtures + spec into dist/ ===");
    for (const id of benches) {
        await mkdir(`dist/${id}`, { recursive: true });
        await copyFile(`benches/${id}/spec.json`, `dist/${id}/spec.json`);
        await copyFixtures(id);
    }

    // Rust runs as ONE serial stream. cargo already serializes on the workspace target/
    // lock, and wasm-pack (bindgen builds it twice per crate — production + size-attr)
    // races on its shared "Installing wasm-bindgen" step when run concurrently, corrupting
    // a shared file (`invalid type: sequence`). JS (esbuild) and C++ (emscripten/wasi-sdk,
    // absolute-path toolchains) share no such lock, so they pool safely. The serial rust
    // stream runs CONCURRENTLY with the JS+C++ pool — disjoint resources (cargo target/ vs
    // dist + emsdk/wasi dirs) — overlapping wall-time without reintroducing the race.
    // Do NOT fold rust back into the pool.
    console.log("=== building: rust serial || (JS + C++) pooled ===");
    const rustUnits = await collectRustUnits(benches);
    const pooledUnits = [
        ...await collectJsUnits(benches),
        ...await collectCppUnits(benches),
    ];
    await Promise.all([
        (async (): Promise<void> => {
            for (const unit of rustUnits) {
                await unit();
            }
        })(),
        runPool(pooledUnits, limit),
    ]);
}

main().catch((e) => {
    console.error(e); process.exit(1);
});
