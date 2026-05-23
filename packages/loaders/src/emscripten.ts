import type { BenchModule, RunResult } from "@bench/harness";
import type { Loader, LoaderInput, LoadedModule } from "./types.js";
import { TimingRecorder, timed } from "./timings.js";
import { bindReset } from "./bind-reset.js";

/**
 * Emscripten with -s MODULARIZE=1 -s ENVIRONMENT=web,worker,node exports a
 * factory function as default. The bench's Emscripten build MUST surface via
 * `EXPORTED_FUNCTIONS` plain C functions with `_` prefix:
 *   _alloc, _load_input, _reset, plus one `_<entry>` per spec.entry,
 *   plus `_<entry>_counter` for void entries.
 * and via EXPORTED_RUNTIME_METHODS: HEAPU8, HEAPF64, wasmMemory.
 */
interface EmModuleBase {
    HEAPU8: Uint8Array;
    _alloc(sz: number): number;
    _load_input(ptr: number, len: number): void;
    _reset?(): void;
    wasmMemory: WebAssembly.Memory;
}
type EmModule = EmModuleBase & Record<string, unknown>;

interface EmFactory { default: (opts?: object) => Promise<EmModule>; }

function buildRunFor(
    entry: string,
    inst: EmModule,
): (iters: number) => RunResult {
    const entryFn = inst[`_${entry}`];
    if (typeof entryFn !== "function") {
        throw new Error(`emscripten: export "_${entry}" not found in module`);
    }
    const arity = entryFn.length;

    if (arity === 1) {
        const fn = entryFn as (iters: number) => number;
        return (iters) => ({ checksum: fn(iters) });
    }

    if (arity === 0) {
        const counterFn = inst[`_${entry}_counter`];
        if (typeof counterFn !== "function") {
            throw new Error(
                `emscripten: void entry "_${entry}" requires companion "_${entry}_counter" export`,
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

    throw new Error(`emscripten: cannot dispatch entry "_${entry}" (arity ${arity})`);
}

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
        const run = buildRunFor(input.entry, inst);
        // Emscripten C exports are underscore-prefixed; bindReset uses unprefixed
        // names, so look up with explicit C-style keys.
        const reshaped: Record<string, unknown> = {
            [`${input.entry}_reset`]: (inst as Record<string, unknown>)[`_${input.entry}_reset`],
            reset: inst._reset?.bind(inst),
        };
        const resetFn = bindReset(reshaped, input.entry);

        const module: BenchModule = {
            loadInput(buf: Uint8Array) {
                let ptr = 0;
                if (buf.byteLength > 0) {
                    ptr = inst._alloc(buf.byteLength);
                    inst.HEAPU8.set(buf, ptr);
                }
                inst._load_input(ptr, buf.byteLength);
            },
            run,
            ...(resetFn ? { reset: resetFn } : {}),
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
