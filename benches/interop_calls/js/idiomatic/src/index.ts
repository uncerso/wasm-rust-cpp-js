// Idiomatic JS: counter and accumulators are plain `let` numbers. No
// TypedArray-backed storage. Inner loop calls a local helper per iteration,
// matching the wasm side's "one JS->wasm call per iter" structure.

interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

export default function create(entry: string): BenchModule {
    let counter = 0;

    function noopFn(): void { counter += 1; }
    function addI32Fn(a: number, b: number): number { return (a + b) | 0; }
    function addF64Fn(a: number, b: number): number { return a + b; }

    function reset(): void {
        counter = 0;
    }

    function runEntry(iters: number): { checksum: number } {
        switch (entry) {
            case "interop_calls_noop": {
                for (let i = 0; i < iters; i++) {
                    noopFn();
                }
                return { checksum: counter };
            }
            case "interop_calls_add_i32": {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    acc = (acc + addI32Fn(i, i * 2)) | 0;
                }
                return { checksum: acc };
            }
            case "interop_calls_add_f64": {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    acc += addF64Fn(i, i * 2);
                }
                return { checksum: acc };
            }
            default:
                throw new Error(`interop_calls/js-idiomatic: unknown entry "${entry}"`);
        }
    }

    return {
        loadInput(_input: Uint8Array) { reset(); },
        run: runEntry,
        reset,
    };
}
