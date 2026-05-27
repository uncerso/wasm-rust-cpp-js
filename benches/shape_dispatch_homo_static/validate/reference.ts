import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseShapes, checksumQuantized } from "../../common/shape-reference.js";

const SIZES = ["S", "M", "L"] as const;
const ENTRY = "shape_dispatch_homo_static";

async function main(): Promise<void> {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixturesDir = join(here, "..", "fixtures");
    const out: Record<string, Record<string, string>> = { [ENTRY]: {} };
    for (const size of SIZES) {
        const buf = await readFile(join(fixturesDir, `${size.toLowerCase()}.bin`));
        const shapes = parseShapes(new Uint8Array(buf));
        out[ENTRY]![size] = checksumQuantized(shapes).toString();
    }
    console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
    console.error(e); process.exit(1);
});
