import type { BenchModule, RunResult } from "@bench/harness";
import type { Loader, LoaderInput, LoadedModule } from "./types.js";
import { TimingRecorder, timed } from "./timings.js";
import { fetchBytes } from "./fetch-bytes.js";

/**
 * wasm-bindgen glue exports: an `init(url)` async function plus named exports
 * matching #[wasm_bindgen] attributes on the Rust side. The bench's bindgen
 * implementation MUST expose: init(), load_input(Uint8Array), run(iters)->number,
 * output_view()->Uint8Array, memory()->WebAssembly.Memory, reset().
 */
interface BindgenGlue {
  default: (input?: { module_or_path?: string | BufferSource | WebAssembly.Module }) => Promise<unknown>;
  load_input: (buf: Uint8Array) => void;
  run: (iters: number) => number;
  output_view: () => Uint8Array;
  // wasm-bindgen auto-exports WebAssembly.Memory under the name `memory`; using
  // a Rust fn `memory()` would collide with it. We expose it as `wasm_memory()`.
  wasm_memory: () => WebAssembly.Memory;
  reset: () => void;
  __wasm_byte_length?: () => number;
}

export const rustBindgenLoader: Loader = {
  async load(input: LoaderInput): Promise<LoadedModule> {
    if (!input.glueUrl) throw new Error("rust-bindgen: glueUrl required");
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

    const module: BenchModule = {
      loadInput: (buf: Uint8Array) => glue.load_input(buf),
      run: (iters: number): RunResult => ({ checksum: glue.run(iters) }),
      readOutput: () => glue.output_view().slice(),
      reset: () => glue.reset(),
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
