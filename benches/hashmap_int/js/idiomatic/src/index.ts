interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

const PAIR_BYTES = 16;

export default function create(entry: string): BenchModule {
    let pairs: Array<readonly [number, number]> = [];
    const map = new Map<number, number>();

    function parsePairs(buf: Uint8Array): void {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const n = buf.byteLength / PAIR_BYTES;
        const next: Array<readonly [number, number]> = [];
        for (let i = 0; i < n; i++) {
            const base = i * PAIR_BYTES;
            const key = Number(dv.getBigUint64(base, true));
            const value = Number(dv.getBigUint64(base + 8, true));
            next.push([key, value]);
        }
        pairs = next;
    }

    function refillMap(): void {
        map.clear();
        for (const [k, v] of pairs) {
            map.set(k, v);
        }
    }

    function reset(): void {
        switch (entry) {
            case "hashmap_int_insert": map.clear(); break;
            case "hashmap_int_lookup": break;
            case "hashmap_int_delete": refillMap(); break;
        }
    }

    function run(iters: number): { checksum: number } {
        switch (entry) {
            case "hashmap_int_insert": {
                for (let i = 0; i < iters; i++) {
                    const [k, v] = pairs[i];
                    map.set(k, v);
                }
                return { checksum: map.size };
            }
            case "hashmap_int_lookup": {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    acc += map.get(pairs[i][0]) ?? 0;
                }
                return { checksum: acc };
            }
            case "hashmap_int_delete": {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    const k = pairs[i][0];
                    const v = map.get(k);
                    if (v !== undefined) {
                        acc += v;
                        map.delete(k);
                    }
                }
                return { checksum: acc };
            }
            default:
                throw new Error(`hashmap_int/js-idiomatic: unknown entry "${entry}"`);
        }
    }

    return {
        loadInput(buf) {
            parsePairs(buf);
            refillMap();
        },
        run,
        reset,
    };
}
