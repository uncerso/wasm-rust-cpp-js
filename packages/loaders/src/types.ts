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
    /** Benchmark entry id (e.g. "matmul", "interop_calls_noop"). Loader binds
     * `BenchModule.run` to the wasm/JS export named by this id. For
     * single-entry binaries, equals the binary id. */
    entry: string;
}

/**
 * Loader implementations bind `BenchModule.reset` via `bindReset`:
 *   - Per-entry companion (`<entry>_reset`) if present — Phase 1.1.2+ workloads.
 *   - Generic `reset` if present — matmul/interop_calls precedent.
 *   - Otherwise omit `BenchModule.reset` — harness uses optional chain.
 * Emscripten exports are underscore-prefixed; that loader reshapes the lookup
 * keys before calling bindReset.
 */
export interface Loader {
    load(input: LoaderInput): Promise<LoadedModule>;
}
