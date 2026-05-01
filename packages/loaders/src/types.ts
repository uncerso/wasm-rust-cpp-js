import type { BenchModule, InitTimings } from "@bench/harness";

export interface LoadedModule {
  module: BenchModule;
  timings: InitTimings;
  memoryRef: WebAssembly.Memory | null;
  wasmRawBytes: number | null;
  jsGlueRawBytes: number | null;
}

export interface LoaderInput {
  artifactUrl: string;
  glueUrl?: string | undefined;
}

export interface Loader {
  load(input: LoaderInput): Promise<LoadedModule>;
}
