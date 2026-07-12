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
 * RUSTUP_HOME (env, not PATH); we add its own dir, .tools/bin for the pinned
 * wasm-pack, and /usr/bin:/bin for the host C toolchain (`cc`). cargo links
 * host-side proc-macros / build scripts (proc-macro2, quote, syn,
 * wasm-bindgen-macro) with `cc` as the default linker driver, which a clean
 * build (empty target/) needs; warm builds cache those host artifacts and never
 * invoke cc, hiding the gap until `pnpm clear` wiped target/. /usr/bin holds no
 * wasm-opt (homebrew installs elsewhere), so wasm determinism is preserved —
 * same rationale as wasiSdkBuildPath(). No other ambient PATH entry leaks in.
 */
export function rustBuildPath(): string {
    return `${resolveDirOnPath("cargo")}${delimiter}${TOOLS_BIN}${delimiter}/usr/bin${delimiter}/bin`;
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
