import type { BenchModule, RunResult } from "@bench/harness";
import type { Loader, LoaderInput, LoadedModule } from "./types.js";
import { TimingRecorder, timed } from "./timings.js";

/**
 * Emscripten with -s MODULARIZE=1 -s ENVIRONMENT=web,worker,node exports a
 * factory function as default. The bench's Emscripten build MUST expose via
 * `EXPORTED_FUNCTIONS` plain C functions with `_` prefix:
 *   _alloc, _load_input, _run, _output_ptr, _output_len, _reset
 * and via EXPORTED_RUNTIME_METHODS: HEAPU8, HEAPF64.
 */
interface EmModule {
    HEAPU8: Uint8Array;
    _alloc(sz: number): number;
    _load_input(ptr: number, len: number): void;
    _run(iters: number): number;
    _output_ptr(): number;
    _output_len(): number;
    _reset(): void;
    wasmMemory: WebAssembly.Memory;
}

interface EmFactory { default: (opts?: object) => Promise<EmModule>; }

export const emscriptenLoader: Loader = {
    async load(input: LoaderInput): Promise<LoadedModule> {
        if (!input.glueUrl) {
            throw new Error("emscripten: glueUrl required");
        }
        const glueUrl = input.glueUrl;
        const tr = new TimingRecorder();

        const importTimed = await timed(() => import(glueUrl));
        tr.recordFetch(importTimed.ms);
        const factory = importTimed.value as EmFactory;

        const initTimed = await timed(() => factory.default({}));
        tr.recordCompile(0);
        tr.recordInstantiate(initTimed.ms);

        const inst = initTimed.value;

        const module: BenchModule = {
            loadInput(buf: Uint8Array) {
                const ptr = inst._alloc(buf.byteLength);
                inst.HEAPU8.set(buf, ptr);
                inst._load_input(ptr, buf.byteLength);
            },
            run(iters: number): RunResult {
                return { checksum: inst._run(iters) };
            },
            reset() {
                inst._reset();
            },
        };

        return {
            module,
            timings: tr.finalize(),
            memoryRef: inst.wasmMemory,
            wasmRawBytes: null,
            jsGlueRawBytes: null,
        };
    },
};
