import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface Params {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    dimsX: number;
    dimsY: number;
    maxIter: number;
}

const REGION = { minX: -2.5, maxX: 1.0, minY: -1.25, maxY: 1.25 } as const;

const SIZES: Record<"S" | "M" | "L", Params> = {
    S: { ...REGION, dimsX: 280, dimsY: 200, maxIter: 200 },
    M: { ...REGION, dimsX: 700, dimsY: 500, maxIter: 500 },
    L: { ...REGION, dimsX: 1400, dimsY: 1000, maxIter: 1000 },
};

function encode(p: Params): Uint8Array {
    const buf = new Uint8Array(7 * 8);
    const dv = new DataView(buf.buffer);
    const vals = [p.minX, p.maxX, p.minY, p.maxY, p.dimsX, p.dimsY, p.maxIter];
    for (let i = 0; i < vals.length; i++) {
        dv.setFloat64(i * 8, vals[i]!, true);
    }
    return buf;
}

async function main() {
    const here = dirname(fileURLToPath(import.meta.url));
    await mkdir(here, { recursive: true });

    const result: Record<string, { bytes: number; sha256: string }> = {};
    for (const [size, p] of Object.entries(SIZES) as [keyof typeof SIZES, Params][]) {
        const buf = encode(p);
        const path = join(here, `${size.toLowerCase()}.bin`);
        await writeFile(path, buf);
        const sha = createHash("sha256").update(buf).digest("hex");
        result[size] = { bytes: buf.byteLength, sha256: sha };
        console.log(`${size}: dims=${p.dimsX}x${p.dimsY} maxIter=${p.maxIter} bytes=${buf.byteLength} sha256=${sha}`);
    }
    console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
