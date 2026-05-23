import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = ["S", "M", "L"] as const;
const PAIR_BYTES = 24;

interface Pair { key: string; value: number; }

function parsePairs(buf: Uint8Array): Pair[] {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const n = buf.byteLength / PAIR_BYTES;
    const pairs: Pair[] = [];
    const decoder = new TextDecoder("ascii");
    for (let i = 0; i < n; i++) {
        const base = i * PAIR_BYTES;
        const key = decoder.decode(buf.subarray(base, base + 16));
        const value = Number(dv.getBigUint64(base + 16, true));
        pairs.push({ key, value });
    }
    return pairs;
}

function computeInsert(pairs: Pair[]): number {
    const map = new Map<string, number>();
    for (const { key, value } of pairs) {
        map.set(key, value);
    }
    return map.size;
}

function computeLookup(pairs: Pair[]): number {
    const map = new Map<string, number>();
    for (const { key, value } of pairs) { map.set(key, value); }
    let acc = 0;
    for (const { key } of pairs) {
        acc += map.get(key) ?? 0;
    }
    return acc;
}

function computeDelete(pairs: Pair[]): number {
    const map = new Map<string, number>();
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
        hashmap_string_insert: {},
        hashmap_string_lookup: {},
        hashmap_string_delete: {},
    };
    for (const size of SIZES) {
        const buf = await readFile(join(fixturesDir, `${size.toLowerCase()}.bin`));
        const pairs = parsePairs(new Uint8Array(buf));
        report["hashmap_string_insert"]![size] = computeInsert(pairs);
        report["hashmap_string_lookup"]![size] = computeLookup(pairs);
        report["hashmap_string_delete"]![size] = computeDelete(pairs);
    }
    console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
