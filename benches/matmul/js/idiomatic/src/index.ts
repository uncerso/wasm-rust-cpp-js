// Idiomatic JS: native arrays of numbers, no TypedArray. This is the "honest"
// JS baseline for code that didn't pre-optimize for SIMD-style memory access.

interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

export default function create(entry: string): BenchModule {
    if (entry !== "matmul") {
        throw new Error(`matmul/js-idiomatic: unknown entry "${entry}"`);
    }
    let n = 0;
    let A: number[][] = [];
    let B: number[][] = [];
    let C: number[][] = [];

    return {
        loadInput(input: Uint8Array) {
            const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
            const totalF64 = input.byteLength / 8;
            const half = totalF64 / 2;
            n = Math.round(Math.sqrt(half));
            if (n * n !== half) {
                throw new Error(`matmul: half=${half} not a perfect square`);
            }
            A = []; B = []; C = [];
            let off = 0;
            for (let i = 0; i < n; i++) {
                const row = new Array<number>(n);
                for (let j = 0; j < n; j++) {
                    row[j] = view.getFloat64(off, true); off += 8;
                }
                A.push(row);
            }
            for (let i = 0; i < n; i++) {
                const row = new Array<number>(n);
                for (let j = 0; j < n; j++) {
                    row[j] = view.getFloat64(off, true); off += 8;
                }
                B.push(row);
            }
            for (let i = 0; i < n; i++) {
                C.push(new Array<number>(n).fill(0));
            }
        },

        run(iterations: number): { checksum: number } {
            let last = 0;
            for (let it = 0; it < iterations; it++) {
                for (let i = 0; i < n; i++) {
                    const Ci = C[i];
                    for (let j = 0; j < n; j++) {
                        Ci[j] = 0;
                    }
                }
                for (let i = 0; i < n; i++) {
                    const Ai = A[i];
                    const Ci = C[i];
                    for (let k = 0; k < n; k++) {
                        const a = Ai[k];
                        const Bk = B[k];
                        for (let j = 0; j < n; j++) {
                            Ci[j] += a * Bk[j];
                        }
                    }
                }
                last = 0;
                for (let i = 0; i < n; i++) {
                    const Ci = C[i];
                    for (let j = 0; j < n; j++) {
                        last += Math.abs(Ci[j]);
                    }
                }
            }
            return { checksum: last };
        },

        reset() {
            for (let i = 0; i < n; i++) {
                const Ci = C[i];
                for (let j = 0; j < n; j++) {
                    Ci[j] = 0;
                }
            }
        },
    };
}
