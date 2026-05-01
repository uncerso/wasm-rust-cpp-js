import { readFile } from "node:fs/promises";
import type { BenchModule, RunResult } from "@bench/harness";
import type { Loader, LoaderInput, LoadedModule } from "./types.js";
import { TimingRecorder, timed } from "./timings.js";

interface RawExports {
  memory: WebAssembly.Memory;
  alloc(sz: number): number;
  load_input(ptr: number, len: number): void;
  run(iters: number): number;
  output_ptr(): number;
  output_len(): number;
  reset?(): void;
}

async function fetchBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`raw-wasm: fetch ${url} -> ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  const path = url.startsWith("file://") ? new URL(url).pathname : url;
  const buf = await readFile(path);
  // Copy into a fresh ArrayBuffer so the result is Uint8Array<ArrayBuffer>,
  // not Uint8Array<ArrayBufferLike> (which can be SharedArrayBuffer).
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
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
