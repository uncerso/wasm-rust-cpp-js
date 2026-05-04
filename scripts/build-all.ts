import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./lib/exec.js";

async function main() {
    console.log("=== generating fixtures ===");
    await run("tsx", ["benches/matmul/fixtures/generate.ts"]);

    console.log("=== copying fixtures + spec into dist/ for browser serving ===");
    const benches = ["matmul"];
    for (const id of benches) {
        const fxDst = `dist/${id}/fixtures`;
        await mkdir(fxDst, { recursive: true });
        for (const sz of ["s", "m", "l"]) {
            await copyFile(join(`benches/${id}/fixtures`, `${sz}.bin`), join(fxDst, `${sz}.bin`));
        }
        await copyFile(`benches/${id}/spec.json`, `dist/${id}/spec.json`);
    }

    console.log("=== building JS ===");
    await run("tsx", ["scripts/build-js.ts"]);

    console.log("=== building Rust ===");
    await run("tsx", ["scripts/build-rust.ts"]);

    console.log("=== building C++ ===");
    await run("tsx", ["scripts/build-cpp.ts"]);
}

main().catch((e) => {
    console.error(e); process.exit(1);
});
