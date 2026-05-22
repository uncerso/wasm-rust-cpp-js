// Reference: computes expected checksums for (entry, size) combinations.
// Determinism contract:
//   - noop(iters):       counter starts at 0; one inc per call -> result = iters.
//   - add_i32(iters):    acc = 0; for i in [0..iters): acc = (acc + (i + 2*i)) | 0
//                        (signed i32 wrap matching wasm i32.add semantics).
//   - add_f64(iters):    acc = 0; for i in [0..iters): acc += i + 2*i
//                        (f64 exact for sums up to ~2^53; L iters keeps sum < 2^53).

const SIZES: ReadonlyArray<["S" | "M" | "L", number]> = [
    ["S", 100_000],
    ["M", 1_000_000],
    ["L", 10_000_000],
];

function computeNoop(iters: number): number {
    return iters;
}

function computeAddI32(iters: number): number {
    let acc = 0;
    for (let i = 0; i < iters; i++) {
        acc = (acc + (i + 2 * i)) | 0;
    }
    return acc;
}

function computeAddF64(iters: number): number {
    let acc = 0;
    for (let i = 0; i < iters; i++) {
        acc += i + 2 * i;
    }
    return acc;
}

function main(): void {
    const report: Record<string, Record<string, number>> = {
        interop_calls_noop: {},
        interop_calls_add_i32: {},
        interop_calls_add_f64: {},
    };
    for (const [sz, iters] of SIZES) {
        report["interop_calls_noop"]![sz] = computeNoop(iters);
        report["interop_calls_add_i32"]![sz] = computeAddI32(iters);
        report["interop_calls_add_f64"]![sz] = computeAddF64(iters);
    }
    console.log(JSON.stringify(report, null, 2));
}

main();
