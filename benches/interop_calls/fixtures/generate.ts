// interop_calls is fixture-less: each size writes a 0-byte file. The file
// exists so generic build/run code can copy/read without special-casing.
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
    const here = dirname(fileURLToPath(import.meta.url));
    await mkdir(here, { recursive: true });
    for (const sz of ["s", "m", "l"]) {
        await writeFile(join(here, `${sz}.bin`), new Uint8Array(0));
    }
    console.log("interop_calls fixtures: wrote 3 empty files");
}

main().catch((e) => { console.error(e); process.exit(1); });
