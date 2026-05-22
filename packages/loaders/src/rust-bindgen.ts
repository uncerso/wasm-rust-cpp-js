import type { BenchModule, RunResult } from "@bench/harness";
import type { Loader, LoaderInput, LoadedModule } from "./types.js";
import { TimingRecorder, timed } from "./timings.js";
import { fetchBytes } from "./fetch-bytes.js";

/**
 * wasm-bindgen glue exports: an `init(url)` async function plus named exports
 * matching #[wasm_bindgen] attributes on the Rust side. The bench's bindgen
 * implementation MUST expose: init(), load_input(Uint8Array),
 * wasm_memory()->WebAssembly.Memory, plus one named export per spec.entry.
 * `reset()` is optional. Per-entry arity dispatch mirrors raw-wasm loader.
 */
interface BindgenGlueBase {
    default: (input?: { module_or_path?: string | BufferSource | WebAssembly.Module }) => Promise<unknown>;
    load_input: (buf: Uint8Array) => void;
    reset?: () => void;
    // wasm-bindgen auto-exports WebAssembly.Memory under the name `memory`; using
    // a Rust fn `memory()` would collide with it. We expose it as `wasm_memory()`.
    wasm_memory: () => WebAssembly.Memory;
    __wasm_byte_length?: () => number;
}
type BindgenGlue = BindgenGlueBase & Record<string, unknown>;

function buildRunFor(
    entry: string,
    glue: BindgenGlue,
): (iters: number) => RunResult {
    const entryFn = glue[entry];
    if (typeof entryFn !== "function") {
        throw new Error(`bindgen: entry "${entry}" not exported from glue`);
    }
    const arity = entryFn.length;

    if (arity === 1) {
        const fn = entryFn as (iters: number) => number;
        return (iters) => ({ checksum: fn(iters) });
    }

    if (arity === 0) {
        const counterFn = glue[`${entry}_counter`];
        if (typeof counterFn !== "function") {
            throw new Error(
                `bindgen: void entry "${entry}" requires companion "${entry}_counter" export`,
            );
        }
        const fn = entryFn as () => void;
        const counter = counterFn as () => number;
        return (iters) => {
            for (let i = 0; i < iters; i++) {
                fn();
            }
            return { checksum: counter() };
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

    throw new Error(`bindgen: cannot dispatch entry "${entry}" (arity ${arity})`);
}

export const rustBindgenLoader: Loader = {
    async load(input: LoaderInput): Promise<LoadedModule> {
        if (!input.glueUrl) {
            throw new Error("rust-bindgen: glueUrl required");
        }
        const glueUrl = input.glueUrl;
        const tr = new TimingRecorder();

        const importTimed = await timed(() => import(glueUrl));
        const glue = importTimed.value as BindgenGlue;

        // wasm-bindgen --target=web glue calls fetch(url) when given a URL string.
        // Node's undici fetch doesn't support file://, so we pre-read bytes
        // ourselves and hand them to init(). wasm-bindgen accepts BufferSource.
        const fetched = await timed(() => fetchBytes(input.artifactUrl));
        tr.recordFetch(importTimed.ms + fetched.ms);

        const initTimed = await timed(() =>
            glue.default({ module_or_path: fetched.value }),
        );
        tr.recordCompile(0);
        tr.recordInstantiate(initTimed.ms);

        const memory = glue.wasm_memory();
        const run = buildRunFor(input.entry, glue);

        const resetFn = glue.reset;
        const module: BenchModule = {
            loadInput: (buf: Uint8Array) => glue.load_input(buf),
            run,
            ...(resetFn ? { reset: () => resetFn() } : {}),
        };

        return {
            module,
            timings: tr.finalize(),
            memoryRef: memory,
            wasmRawBytes: glue.__wasm_byte_length?.() ?? null,
            jsGlueRawBytes: null,
        };
    },
};
