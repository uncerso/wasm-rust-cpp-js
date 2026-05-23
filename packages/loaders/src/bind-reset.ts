/**
 * Resolves the reset function for a BenchModule. Lookup order:
 *   1. `exports[<entry>_reset]` — per-entry companion (Phase 1.1.2+ workloads
 *      with entry-specific reset semantics, e.g. hashmap_string_insert_reset).
 *   2. `exports.reset` — generic reset (matmul/interop_calls precedent).
 * First match wins. Returns undefined if neither is a function.
 *
 * `exports` is wasm-module/glue-shaped: in raw-wasm it's `instance.exports`,
 * in rust-bindgen the glue module namespace, in emscripten the EmModule with
 * `_`-prefixed C-style exports. Callers pass the correctly-keyed object.
 */
export function bindReset(
    exports: Record<string, unknown>,
    entry: string,
): (() => void) | undefined {
    const perEntry = exports[`${entry}_reset`];
    if (typeof perEntry === "function") {
        return perEntry as () => void;
    }
    const generic = exports["reset"];
    if (typeof generic === "function") {
        return generic as () => void;
    }
    return undefined;
}
