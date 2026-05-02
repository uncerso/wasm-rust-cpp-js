import type { BenchModule, RunResult } from "@bench/harness";
import type { Loader, LoaderInput, LoadedModule } from "./types.js";
import { TimingRecorder, timed } from "./timings.js";
import { fetchBytes } from "./fetch-bytes.js";

interface RawExports {
  memory: WebAssembly.Memory;
  alloc(sz: number): number;
  load_input(ptr: number, len: number): void;
  run(iters: number): number;
  output_ptr(): number;
  output_len(): number;
  reset?(): void;
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

    const memBuffer = exports.memory.buffer as ArrayBuffer;
    const module: BenchModule = {
      loadInput(buf: Uint8Array) {
        const ptr = exports.alloc(buf.byteLength);
        new Uint8Array(memBuffer).set(buf, ptr);
        exports.load_input(ptr, buf.byteLength);
      },
      run(iters: number): RunResult {
        return { checksum: exports.run(iters) };
      },
      readOutput(): Uint8Array {
        const ptr = exports.output_ptr();
        const len = exports.output_len();
        return new Uint8Array(memBuffer, ptr, len).slice();
      },
      reset() { exports.reset?.(); },
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
