// TypedArray-backed variant: counter and accumulators live in single-element
// TypedArrays, forcing the JIT through typed-array store/load shapes. The hot
// loop accumulates into a local `let` and writes back once at the end (matches
// raw-wasm/bindgen/emscripten loaders, which also use a local accumulator).

interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

export default function create(entry: string): BenchModule {
    const counter = new Int32Array(1);
    const accI32 = new Int32Array(1);
    const accF64 = new Float64Array(1);

    function noopFn(): void { counter[0] = (counter[0] as number) + 1; }
    function addI32Fn(a: number, b: number): number { return (a + b) | 0; }
    function addF64Fn(a: number, b: number): number { return a + b; }

    function reset(): void {
        counter[0] = 0;
        accI32[0] = 0;
        accF64[0] = 0;
    }

    function runEntry(iters: number): { checksum: number } {
        switch (entry) {
            case "interop_calls_noop": {
                for (let i = 0; i < iters; i++) {
                    noopFn();
                }
                return { checksum: counter[0] as number };
            }
            case "interop_calls_add_i32": {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    acc = (acc + addI32Fn(i, i * 2)) | 0;
                }
                accI32[0] = acc;
                return { checksum: accI32[0] as number };
            }
            case "interop_calls_add_f64": {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    acc += addF64Fn(i, i * 2);
                }
                accF64[0] = acc;
                return { checksum: accF64[0] as number };
            }
            default:
                throw new Error(`interop_calls/js-typed-array: unknown entry "${entry}"`);
        }
    }

    return {
        loadInput(_input: Uint8Array) { reset(); },
        run: runEntry,
        reset,
    };
}
