import { readFile, writeFile, mkdir, rename, rm, symlink, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { run } from "./exec.js";

const TOOLS_DIR = ".tools";
const STATE_FILE = ".tools/state.json";

export interface TarballSpec {
    name: string;
    version: string;
    url: string;
    sha256: string;
    extractedDir: string;
    renameTo: string;
}

export async function readState(): Promise<Record<string, string>> {
    try {
        const buf = await readFile(STATE_FILE, "utf8");
        return JSON.parse(buf) as Record<string, string>;
    } catch {
        return {};
    }
}

export async function writeState(state: Record<string, string>): Promise<void> {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

async function pathExists(p: string): Promise<boolean> {
    try {
        await access(p);
        return true;
    } catch {
        return false;
    }
}

export async function ensureTarball(spec: TarballSpec): Promise<void> {
    const state = await readState();
    const targetPath = join(TOOLS_DIR, spec.renameTo);

    if (state[spec.name] === spec.version && await pathExists(targetPath)) {
        console.log(`[setup] ${spec.name} ${spec.version} already installed, skipping`);
        return;
    }

    console.log(`[setup] installing ${spec.name} ${spec.version}`);
    await mkdir(TOOLS_DIR, { recursive: true });

    const tmpFile = join(TOOLS_DIR, `${spec.name}.download.tar.gz`);
    console.log(`[setup] downloading ${spec.url}`);
    await run("curl", [
        "-fsSL",
        "--fail-with-body",
        "--retry", "5",
        "--retry-all-errors",
        "--retry-delay", "2",
        spec.url,
        "-o", tmpFile,
    ]);

    console.log(`[setup] verifying sha256 for ${spec.name}`);
    const buf = await readFile(tmpFile);
    const actual = createHash("sha256").update(buf).digest("hex");
    if (actual !== spec.sha256) {
        await rm(tmpFile, { force: true });
        throw new Error(
            `sha256 mismatch for ${spec.name}: expected ${spec.sha256}, got ${actual}`,
        );
    }

    console.log(`[setup] extracting ${spec.name}`);
    await run("tar", ["-xzf", tmpFile, "-C", TOOLS_DIR]);
    await rm(tmpFile, { force: true });

    if (spec.extractedDir !== spec.renameTo) {
        const extractedPath = join(TOOLS_DIR, spec.extractedDir);
        await rm(targetPath, { recursive: true, force: true });
        await rename(extractedPath, targetPath);
    }

    state[spec.name] = spec.version;
    await writeState(state);
    console.log(`[setup] ${spec.name} ${spec.version} installed`);
}

export async function ensureEmsdk(version: string): Promise<void> {
    console.log(`[setup] checking emsdk ${version}`);
    await mkdir(TOOLS_DIR, { recursive: true });

    const emsdkDir = join(TOOLS_DIR, "emsdk");
    if (!await pathExists(emsdkDir)) {
        console.log("[setup] cloning emsdk");
        await run("git", ["clone", "https://github.com/emscripten-core/emsdk.git", emsdkDir]);
    }

    const state = await readState();
    if (state["emsdk"] !== version) {
        console.log(`[setup] installing emsdk ${version}`);
        await run("./emsdk", ["install", version], { cwd: emsdkDir });
        console.log(`[setup] activating emsdk ${version}`);
        await run("./emsdk", ["activate", version], { cwd: emsdkDir });
        state["emsdk"] = version;
        await writeState(state);
        console.log(`[setup] emsdk ${version} installed and activated`);
    } else {
        console.log(`[setup] emsdk ${version} already active, skipping`);
    }
}

export async function ensureWasmPackViaCargo(version: string): Promise<void> {
    const state = await readState();
    const installRoot = join(TOOLS_DIR, `wasm-pack-${version}`);
    const binary = join(installRoot, "bin", "wasm-pack");

    if (state["wasm-pack"] === version && await pathExists(binary)) {
        console.log(`[setup] wasm-pack ${version} already installed, skipping`);
        return;
    }

    console.log(`[setup] installing wasm-pack ${version} via cargo`);
    await mkdir(TOOLS_DIR, { recursive: true });
    await run("cargo", [
        "install",
        "--locked",
        "--version", version,
        "--root", resolve(installRoot),
        "wasm-pack",
    ]);

    state["wasm-pack"] = version;
    await writeState(state);
    console.log(`[setup] wasm-pack ${version} installed`);
}

export async function ensureRustTarget(target: string): Promise<void> {
    console.log(`[setup] adding rust target ${target}`);
    await run("rustup", ["target", "add", target]);
}

export async function ensurePlaywrightBrowsers(): Promise<void> {
    console.log("[setup] installing playwright browsers");
    await run("pnpm", ["exec", "playwright", "install", "chromium", "firefox"]);
}

interface ToolVersionsTools {
    binaryen: { version: string };
    "wasm-pack": { version: string };
}

interface ToolVersionsFile {
    tools: ToolVersionsTools;
}

export async function createSymlinks(): Promise<void> {
    const raw = await readFile("tool-versions.json", "utf8");
    const tv = JSON.parse(raw) as ToolVersionsFile;

    const binaryenVersion = tv.tools.binaryen.version;
    const wasmPackVersion = tv.tools["wasm-pack"].version;

    const binDir = join(TOOLS_DIR, "bin");
    await mkdir(binDir, { recursive: true });

    const links: Array<[string, string]> = [
        ["emcc",      "../emsdk/upstream/emscripten/emcc"],
        ["wasm-opt",  `../binaryen-${binaryenVersion}/bin/wasm-opt`],
        ["wasm-pack", `../wasm-pack-${wasmPackVersion}/bin/wasm-pack`],
    ];

    for (const [linkName, target] of links) {
        const linkPath = join(binDir, linkName);
        await rm(linkPath, { force: true });
        await symlink(target, linkPath);
        console.log(`[setup] symlink ${linkName} -> ${target}`);
    }
}
