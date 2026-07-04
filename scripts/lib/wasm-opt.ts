import { run } from "./exec.js";
import { wasmOptPath } from "./tool-paths.js";

/**
 * Run the pinned wasm-opt over `wasmPath` in place. The enable flags are
 * mandatory: `--strip-all`'d wasm drops the target_features section, so
 * wasm-opt would otherwise reject bulk-memory / nontrapping ops.
 */
export async function optimizeWasm(wasmPath: string, level: "O3" | "Oz"): Promise<void> {
    await run(wasmOptPath(), [
        `-${level}`,
        "--enable-bulk-memory",
        "--enable-nontrapping-float-to-int",
        wasmPath,
        "-o",
        wasmPath,
    ]);
}
