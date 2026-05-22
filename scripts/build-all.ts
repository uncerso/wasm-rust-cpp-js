import { mkdir, copyFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./lib/exec.js";

async function fileExists(p: string): Promise<boolean> {
    try { await access(p); return true; } catch { return false; }
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
    console.log(`=== discovered benches: ${benches.join(", ")} ===`);

    console.log("=== generating fixtures ===");
    for (const id of benches) {
        const gen = `benches/${id}/fixtures/generate.ts`;
        if (await fileExists(gen)) {
            await run("tsx", [gen]);
        }
    }

    console.log("=== copying fixtures + spec into dist/ ===");
    for (const id of benches) {
        await mkdir(`dist/${id}`, { recursive: true });
        await copyFile(`benches/${id}/spec.json`, `dist/${id}/spec.json`);
        await copyFixtures(id);
    }

    console.log("=== building JS ===");
    await run("tsx", ["scripts/build-js.ts", ...benches]);

    console.log("=== building Rust ===");
    await run("tsx", ["scripts/build-rust.ts", ...benches]);

    console.log("=== building C++ ===");
    await run("tsx", ["scripts/build-cpp.ts", ...benches]);
}

main().catch((e) => {
    console.error(e); process.exit(1);
});
