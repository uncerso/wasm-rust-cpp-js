interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

const PAIR_BYTES = 24;

// Factory-time dispatch on `entry`: each create() returns specialized run/reset
// closures rather than a single function with a per-call switch. Workaround for a
// V8 JIT deopt bug where switch-over-closure-const in a hot loop body falls into
// the default branch under turbofan tier-up. See
// docs/superpowers/bug-reports/2026-05-23-v8-deopt-switch-over-closure-const.md
// for reproduction details.
export default function create(entry: string): BenchModule {
    let pairs: Array<readonly [string, number]> = [];
    const map = new Map<string, number>();

    function parsePairs(buf: Uint8Array): void {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const n = buf.byteLength / PAIR_BYTES;
        const decoder = new TextDecoder("ascii");
        const next: Array<readonly [string, number]> = [];
        for (let i = 0; i < n; i++) {
            const base = i * PAIR_BYTES;
            const key = decoder.decode(buf.subarray(base, base + 16));
            const value = Number(dv.getBigUint64(base + 16, true));
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

    let runFn: (iters: number) => { checksum: number };
    let resetFn: () => void;

    switch (entry) {
        case "hashmap_string_insert":
            resetFn = () => {
                map.clear();
            };
            runFn = (iters) => {
                for (let i = 0; i < iters; i++) {
                    const [k, v] = pairs[i];
                    map.set(k, v);
                }
                return { checksum: map.size };
            };
            break;
        case "hashmap_string_lookup":
            resetFn = () => {};
            runFn = (iters) => {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    acc += map.get(pairs[i][0]) ?? 0;
                }
                return { checksum: acc };
            };
            break;
        case "hashmap_string_delete":
            resetFn = () => {
                refillMap();
            };
            runFn = (iters) => {
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
            };
            break;
        default:
            throw new Error(`hashmap_string/js-idiomatic: unknown entry "${entry}"`);
    }

    return {
        loadInput(buf) {
            parsePairs(buf);
            refillMap();
        },
        run: runFn,
        reset: resetFn,
    };
}
