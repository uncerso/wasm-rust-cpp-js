interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

const PAIR_BYTES = 16;
const TWO_53 = 0x20000000000000;
const MAX_KEY = TWO_53 - 1;
const WINDOW_KEYS = 16;

// Factory-time dispatch on `entry`: create() returns specialized run/reset
// closures rather than a per-call switch in the hot loop — workaround for a V8
// JIT deopt (switch-over-closure-const falls to the default branch under
// turbofan tier-up). See docs/superpowers/bug-reports/2026-05-23-v8-deopt-switch-over-closure-const.md.
export default function create(entry: string): BenchModule {
    let pairs: Array<readonly [number, number]> = [];
    let keys = new Float64Array(0);
    let vals = new Float64Array(0);

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

    function buildSorted(iters: number): void {
        const m = new Map<number, number>();
        for (let i = 0; i < iters; i++) {
            m.set(pairs[i][0], pairs[i][1]);
        }
        const ks = [...m.keys()].sort((a, b) => a - b);
        keys = Float64Array.from(ks);
        vals = Float64Array.from(ks, (k) => m.get(k) as number);
    }

    function lowerBound(target: number): number {
        let lo = 0;
        let hi = keys.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (keys[mid] < target) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    let runFn: (iters: number) => { checksum: number };
    let resetFn: () => void;

    switch (entry) {
        case "sorted_map_int_build":
            resetFn = () => {
                keys = new Float64Array(0);
                vals = new Float64Array(0);
            };
            runFn = (iters) => {
                buildSorted(iters);
                return { checksum: keys.length };
            };
            break;
        case "sorted_map_int_lookup":
            resetFn = () => {};
            runFn = (iters) => {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    const k = pairs[i][0];
                    const idx = lowerBound(k);
                    if (idx < keys.length && keys[idx] === k) {
                        acc += vals[idx];
                    }
                }
                return { checksum: acc };
            };
            break;
        case "sorted_map_int_range":
            resetFn = () => {};
            runFn = (iters) => {
                const n = pairs.length;
                const span = Math.floor(TWO_53 / n) * WINDOW_KEYS;
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    const lo = pairs[i][0];
                    const hi = Math.min(lo + span, MAX_KEY);
                    let idx = lowerBound(lo);
                    while (idx < keys.length && keys[idx] <= hi) {
                        acc += vals[idx];
                        idx++;
                    }
                }
                return { checksum: acc };
            };
            break;
        default:
            throw new Error(`sorted_map_int/js-typed-array: unknown entry "${entry}"`);
    }

    return {
        loadInput(buf) {
            parsePairs(buf);
            buildSorted(pairs.length);
        },
        run: runFn,
        reset: resetFn,
    };
}
