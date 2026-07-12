import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = ["S", "M", "L"] as const;
const PAIR_BYTES = 16;
export const TWO_53 = 0x20000000000000; // 2^53
export const MAX_KEY = TWO_53 - 1;
export const WINDOW_KEYS = 16;

export interface Pair { key: number; value: number; }

export function parsePairs(buf: Uint8Array): Pair[] {
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

// Build the deduped (last-wins) sorted structure from the first `iters` pairs.
function buildSorted(pairs: Pair[], iters: number): { keys: number[]; vals: number[] } {
    const map = new Map<number, number>();
    for (let i = 0; i < iters; i++) {
        map.set(pairs[i]!.key, pairs[i]!.value);
    }
    const keys = [...map.keys()].sort((a, b) => a - b);
    const vals = keys.map((k) => map.get(k)!);
    return { keys, vals };
}

// First index i with keys[i] >= target.
function lowerBound(keys: number[], target: number): number {
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (keys[mid]! < target) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

export function computeBuild(pairs: Pair[], iters: number): number {
    return buildSorted(pairs, iters).keys.length;
}

export function computeLookup(pairs: Pair[], iters: number): number {
    const { keys, vals } = buildSorted(pairs, pairs.length);
    let acc = 0;
    for (let i = 0; i < iters; i++) {
        const k = pairs[i]!.key;
        const idx = lowerBound(keys, k);
        if (idx < keys.length && keys[idx] === k) {
            acc += vals[idx]!;
        }
    }
    return acc;
}

export function computeRange(pairs: Pair[], iters: number): number {
    const { keys, vals } = buildSorted(pairs, pairs.length);
    const n = pairs.length;
    const span = Math.floor(TWO_53 / n) * WINDOW_KEYS;
    let acc = 0;
    for (let i = 0; i < iters; i++) {
        const lo = pairs[i]!.key;
        const hi = Math.min(lo + span, MAX_KEY);
        let idx = lowerBound(keys, lo);
        while (idx < keys.length && keys[idx]! <= hi) {
            acc += vals[idx]!;
            idx++;
        }
    }
    return acc;
}

async function main(): Promise<void> {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixturesDir = join(here, "..", "fixtures");
    const iters: Record<string, number> = { S: 1000, M: 10000, L: 100000 };
    const report: Record<string, Record<string, number>> = {
        sorted_map_int_build: {},
        sorted_map_int_lookup: {},
        sorted_map_int_range: {},
    };
    for (const size of SIZES) {
        const buf = await readFile(join(fixturesDir, `${size.toLowerCase()}.bin`));
        const pairs = parsePairs(new Uint8Array(buf));
        const it = iters[size]!;
        report["sorted_map_int_build"]![size] = computeBuild(pairs, it);
        report["sorted_map_int_lookup"]![size] = computeLookup(pairs, it);
        report["sorted_map_int_range"]![size] = computeRange(pairs, it);
    }
    console.log(JSON.stringify(report, null, 2));
}

// Only run main() when invoked directly (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((e) => {
        console.error(e); process.exit(1);
    });
}
