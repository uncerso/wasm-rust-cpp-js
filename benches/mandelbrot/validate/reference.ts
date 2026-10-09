import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = ["S", "M", "L"] as const;

export interface Params {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    dimsX: number;
    dimsY: number;
    maxIter: number;
}

export function parseParams(buf: Uint8Array): Params {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    return {
        minX: dv.getFloat64(0, true),
        maxX: dv.getFloat64(8, true),
        minY: dv.getFloat64(16, true),
        maxY: dv.getFloat64(24, true),
        dimsX: dv.getFloat64(32, true),
        dimsY: dv.getFloat64(40, true),
        maxIter: dv.getFloat64(48, true),
    };
}

// Canonical escape-time iteration count. Keep this expression order identical
// in each toolchain implementation; no reassociation or floating-point tolerance.
export function escape(cx: number, cy: number, maxIter: number): number {
    let zx = 0.0;
    let zy = 0.0;
    let iter = 0;
    while (iter < maxIter) {
        const zx2 = zx * zx;
        const zy2 = zy * zy;
        if (zx2 + zy2 > 4.0) {
            break;
        }
        zy = 2.0 * zx * zy + cy;
        zx = zx2 - zy2 + cx;
        iter++;
    }
    return iter;
}

export function render(p: Params): number {
    const stepX = (p.maxX - p.minX) / p.dimsX;
    const stepY = (p.maxY - p.minY) / p.dimsY;
    let acc = 0;
    for (let py = 0; py < p.dimsY; py++) {
        const cy = p.minY + py * stepY;
        for (let px = 0; px < p.dimsX; px++) {
            const cx = p.minX + px * stepX;
            acc += escape(cx, cy, p.maxIter);
        }
    }
    return acc;
}

async function main(): Promise<void> {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixturesDir = join(here, "..", "fixtures");
    const out: Record<string, number> = {};
    for (const size of SIZES) {
        const buf = await readFile(join(fixturesDir, `${size.toLowerCase()}.bin`));
        out[size] = render(parseParams(new Uint8Array(buf)));
    }
    console.log(JSON.stringify(out, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
