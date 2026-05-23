import type { BenchModule, RunResult } from "@bench/harness";
import type { Loader, LoaderInput, LoadedModule } from "./types.js";
import { TimingRecorder, timed } from "./timings.js";
import { fetchBytes } from "./fetch-bytes.js";
import { bindReset } from "./bind-reset.js";

interface RawExportsBase {
    memory: WebAssembly.Memory;
    alloc(sz: number): number;
    load_input(ptr: number, len: number): void;
    reset?(): void;
}
type RawExports = RawExportsBase & Record<string, WebAssembly.ExportValue>;

/**
 * Per-entry dispatch by Function.length (wasm export arity):
 *   - arity 1 → matmul-style: entryFn(iters) returns the checksum directly.
 *   - arity 0 + companion `<entry>_counter()` → noop-style: JS-side inner loop
 *     calls entryFn iters times; checksum is read from the counter export.
 *   - arity 2 → add-style: JS-side accumulator over iters; each iteration calls
 *     entryFn(i, i*2). Entries whose id ends with `_add_i32` use signed-i32
 *     wrap semantics (`(acc + v) | 0`) to match wasm i32.add behavior.
 */
function buildRunFor(
    entry: string,
    exports: RawExports,
): (iters: number) => RunResult {
    const entryFn = exports[entry];
    if (typeof entryFn !== "function") {
        throw new Error(`raw-wasm: export "${entry}" not found in module`);
    }
    const arity = entryFn.length;

    if (arity === 1) {
        const fn = entryFn as (iters: number) => number;
        return (iters) => ({ checksum: fn(iters) });
    }

    if (arity === 0) {
        const counterFn = exports[`${entry}_counter`];
        if (typeof counterFn !== "function") {
            throw new Error(
                `raw-wasm: void entry "${entry}" requires companion "${entry}_counter" export for checksum`,
            );
        }
        const fn = entryFn as () => void;
        const counter = counterFn as () => number;
        // Counter delta — wasm-side counter is cumulative across all `run`
        // calls (no reset wired up); per-call delta gives iter-only checksum.
        return (iters) => {
            const before = counter();
            for (let i = 0; i < iters; i++) {
                fn();
            }
            return { checksum: counter() - before };
        };
    }

    if (arity === 2) {
        const fn = entryFn as (a: number, b: number) => number;
        const wrap = entry.endsWith("_add_i32");
        return (iters) => {
            let acc = 0;
            for (let i = 0; i < iters; i++) {
                const v = fn(i, i * 2);
                acc = wrap ? (acc + v) | 0 : acc + v;
            }
            return { checksum: acc };
        };
    }

    throw new Error(`raw-wasm: cannot dispatch entry "${entry}" (arity ${arity})`);
}

export const rawWasmLoader: Loader = {
    async load(input: LoaderInput): Promise<LoadedModule> {
        const tr = new TimingRecorder();

        const fetched = await timed(() => fetchBytes(input.artifactUrl));
        tr.recordFetch(fetched.ms);
        const wasmRawBytes = fetched.value.byteLength;

        const compiled = await timed(() => WebAssembly.compile(fetched.value));
        tr.recordCompile(compiled.ms);

        const instantiated = await timed(() => WebAssembly.instantiate(compiled.value, {}));
        tr.recordInstantiate(instantiated.ms);

        const exports = instantiated.value.exports as unknown as RawExports;
        if (!exports.memory) {
            throw new Error("raw-wasm: module missing 'memory' export");
        }

        const memBuffer = exports.memory.buffer;
        const run = buildRunFor(input.entry, exports);
        const resetFn = bindReset(exports, input.entry);
        const module: BenchModule = {
            loadInput(buf: Uint8Array) {
                let ptr = 0;
                if (buf.byteLength > 0) {
                    ptr = exports.alloc(buf.byteLength);
                    new Uint8Array(memBuffer).set(buf, ptr);
                }
                exports.load_input(ptr, buf.byteLength);
            },
            run,
            ...(resetFn ? { reset: resetFn } : {}),
        };

        return {
            module,
            timings: tr.finalize(),
            memoryRef: exports.memory,
            wasmRawBytes,
            jsGlueRawBytes: 0,
        };
    },
};
