import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const TOOLS_BIN = resolve(".tools", "bin");

function resolveDirOnPath(bin: string): string {
    const path = process.env["PATH"] ?? "";
    for (const dir of path.split(delimiter)) {
        if (dir !== "" && existsSync(join(dir, bin))) {
            return dir;
        }
    }
    throw new Error(`build-env: '${bin}' not found on PATH`);
}

/**
 * PATH for cargo / wasm-pack. cargo (rustup shim) resolves rustc via
 * RUSTUP_HOME (env, not PATH); we add only its own dir plus .tools/bin for
 * the pinned wasm-pack. Nothing else from the user's ambient PATH leaks in.
 */
export function rustBuildPath(): string {
    return `${resolveDirOnPath("cargo")}${delimiter}${TOOLS_BIN}`;
}

/**
 * PATH for the wasi-sdk clang invocation. clang is called by absolute path
 * and finds wasm-ld relative to itself; an empty PATH guarantees the -flto
 * driver cannot auto-discover any wasm-opt (verified: builds with PATH="").
 */
export function wasiSdkBuildPath(): string {
    return "";
}
