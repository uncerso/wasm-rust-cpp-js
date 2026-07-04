import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface ToolVersionsTools {
    "wasi-sdk": { version: string };
}

interface ToolVersionsFile {
    tools: ToolVersionsTools;
}

function toolsBinPath(name: string): string {
    return resolve(".tools", "bin", name);
}

function preferLocal(name: string): string {
    const local = toolsBinPath(name);
    return existsSync(local) ? local : name;
}

export function wasmOptPath(): string {
    return preferLocal("wasm-opt");
}

export function wasmPackPath(): string {
    return preferLocal("wasm-pack");
}

export function twiggyPath(): string {
    return preferLocal("twiggy");
}

export function emccPath(): string {
    return preferLocal("emcc");
}

function wasiSdkVersion(): string {
    const raw = readFileSync("tool-versions.json", "utf8");
    const tv = JSON.parse(raw) as ToolVersionsFile;
    return tv.tools["wasi-sdk"].version;
}

export function wasiSdkPath(): string {
    const local = resolve(".tools", `wasi-sdk-${wasiSdkVersion()}`);
    if (existsSync(local)) {
        return local;
    }
    const envPath = process.env["WASI_SDK_PATH"];
    if (envPath !== undefined) {
        return envPath;
    }
    throw new Error("wasi-sdk not found in .tools/ and WASI_SDK_PATH not set");
}

/**
 * Canonical wasm disassembler for devirt / codegen inspection (R1 checks).
 * Hard-errors if absent so a missing tool never silently yields a false
 * "0 call_indirect" reading (see tech-debt r1-devirt-objdump-tooling).
 */
export function wasmDisasmPath(): string {
    const llvmObjdump = resolve(".tools", `wasi-sdk-${wasiSdkVersion()}`, "bin", "llvm-objdump");
    if (existsSync(llvmObjdump)) {
        return llvmObjdump;
    }
    const wasmDis = toolsBinPath("wasm-dis");
    if (existsSync(wasmDis)) {
        return wasmDis;
    }
    throw new Error("wasm disassembler not found (.tools/wasi-sdk-*/bin/llvm-objdump or .tools/bin/wasm-dis)");
}
