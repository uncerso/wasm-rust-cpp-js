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

export function emccPath(): string {
    return preferLocal("emcc");
}

export function wasiSdkPath(): string {
    const raw = readFileSync("tool-versions.json", "utf8");
    const tv = JSON.parse(raw) as ToolVersionsFile;
    const version = tv.tools["wasi-sdk"].version;
    const local = resolve(".tools", `wasi-sdk-${version}`);
    if (existsSync(local)) {
        return local;
    }
    const envPath = process.env["WASI_SDK_PATH"];
    if (envPath !== undefined) {
        return envPath;
    }
    throw new Error("wasi-sdk not found in .tools/ and WASI_SDK_PATH not set");
}
