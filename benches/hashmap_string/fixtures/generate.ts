import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { genAsciiHexKeys } from "../../common/fixtures.js";

const SIZES = { S: 1000, M: 10000, L: 100000 } as const;
const SEEDS = { S: 0xDEAD_0001, M: 0xDEAD_0002, L: 0xDEAD_0003 } as const;

async function main() {
    const here = dirname(fileURLToPath(import.meta.url));
    await mkdir(here, { recursive: true });

    const result: Record<string, { bytes: number; sha256: string }> = {};
    for (const [size, n] of Object.entries(SIZES) as [keyof typeof SIZES, number][]) {
        const buf = genAsciiHexKeys(n, SEEDS[size]);
        const path = join(here, `${size.toLowerCase()}.bin`);
        await writeFile(path, buf);
        const sha = createHash("sha256").update(buf).digest("hex");
        result[size] = { bytes: buf.byteLength, sha256: sha };
        console.log(`${size}: n=${n} bytes=${buf.byteLength} sha256=${sha}`);
    }
    console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
