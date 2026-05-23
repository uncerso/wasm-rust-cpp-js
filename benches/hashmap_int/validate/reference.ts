import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = ["S", "M", "L"] as const;
const PAIR_BYTES = 16;

interface Pair { key: number; value: number; }

function parsePairs(buf: Uint8Array): Pair[] {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const n = buf.byteLength / PAIR_BYTES;
    const pairs: Pair[] = [];
    for (let i = 0; i < n; i++) {
        const base = i * PAIR_BYTES;
        const key = Number(dv.getBigUint64(base, true));
        const value = Number(dv.getBigUint64(base + 8, true));
        pairs.push({ key, value });
    }
    return pairs;
}

function computeInsert(pairs: Pair[]): number {
    const map = new Map<number, number>();
    for (const { key, value } of pairs) {
        map.set(key, value);
    }
    return map.size;
}

function computeLookup(pairs: Pair[]): number {
    const map = new Map<number, number>();
    for (const { key, value } of pairs) { map.set(key, value); }
    let acc = 0;
    for (const { key } of pairs) {
        acc += map.get(key) ?? 0;
    }
    return acc;
}

function computeDelete(pairs: Pair[]): number {
    const map = new Map<number, number>();
    for (const { key, value } of pairs) { map.set(key, value); }
    let acc = 0;
    for (const { key } of pairs) {
        const v = map.get(key);
        if (v !== undefined) { acc += v; map.delete(key); }
    }
    return acc;
}

async function main(): Promise<void> {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixturesDir = join(here, "..", "fixtures");
    const report: Record<string, Record<string, number>> = {
        hashmap_int_insert: {},
        hashmap_int_lookup: {},
        hashmap_int_delete: {},
    };
    for (const size of SIZES) {
        const buf = await readFile(join(fixturesDir, `${size.toLowerCase()}.bin`));
        const pairs = parsePairs(new Uint8Array(buf));
        report["hashmap_int_insert"]![size] = computeInsert(pairs);
        report["hashmap_int_lookup"]![size] = computeLookup(pairs);
        report["hashmap_int_delete"]![size] = computeDelete(pairs);
    }
    console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
