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
 * PATH for the wasi-sdk build (a `bash` script that invokes clang by absolute
 * path). Must be non-empty so `bash` + coreutils resolve, but must exclude any
 * wasm-opt so the clang -flto driver can't auto-run one — the explicit pass in
 * build-cpp.ts owns optimization. `/usr/bin:/bin` holds bash/mkdir/etc. and no
 * wasm-opt (homebrew installs to /opt/homebrew/bin or /usr/local/bin, excluded).
 */
export function wasiSdkBuildPath(): string {
    return "/usr/bin:/bin";
}
