import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { genF64Array } from "../../common/fixtures.js";

const SIZES = { S: 64, M: 256, L: 1024 } as const;
const SEEDS = { S: 0xC0FFEE_01, M: 0xC0FFEE_02, L: 0xC0FFEE_03 } as const;

async function main() {
    const here = dirname(fileURLToPath(import.meta.url));
    await mkdir(here, { recursive: true });

    const result: Record<string, { bytes: number; sha256: string }> = {};
    for (const [size, n] of Object.entries(SIZES) as [keyof typeof SIZES, number][]) {
        const buf = genF64Array(n, SEEDS[size]);
        const path = join(here, `${size.toLowerCase()}.bin`);
        await writeFile(path, buf);
        const sha = createHash("sha256").update(buf).digest("hex");
        result[size] = { bytes: buf.byteLength, sha256: sha };
        console.log(`${size}: n=${n} bytes=${buf.byteLength} sha256=${sha}`);
    }
    console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
