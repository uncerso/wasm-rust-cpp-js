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

export interface FirefoxSpec {
    version: string;
    url: string;
    sha256: string;
    appPath: string;       // e.g. "Firefox.app"
    binaryInApp: string;   // e.g. "Contents/MacOS/firefox"
}

export interface GeckodriverSpec {
    version: string;
    url: string;
    sha256: string;
}

export interface ChromeForTestingSpec {
    version: string;
    chromeUrl: string;
    chromeSha256: string;
    chromedriverUrl: string;
    chromedriverSha256: string;
    appPath: string;                 // e.g. "chrome-mac-arm64/Google Chrome for Testing.app"
    binaryInApp: string;             // e.g. "Contents/MacOS/Google Chrome for Testing"
    chromedriverBinaryPath: string;  // e.g. "chromedriver-mac-arm64/chromedriver"
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
    await mkdir(TOOLS_DIR, { recursive: true });
    const tmp = STATE_FILE + ".tmp";
    await writeFile(tmp, JSON.stringify(state, null, 2) + "\n");
    await rename(tmp, STATE_FILE);
}

async function pathExists(p: string): Promise<boolean> {
    try {
        await access(p);
        return true;
    } catch {
        return false;
    }
}

async function downloadAndVerify(url: string, expectedSha256: string, destPath: string): Promise<void> {
    console.log(`[setup] downloading ${url}`);
    await run("curl", [
        "-fsSL",
        "--retry", "5",
        "--retry-all-errors",
        "--retry-delay", "2",
        url,
        "-o", destPath,
    ]);
    const buf = await readFile(destPath);
    const actual = createHash("sha256").update(buf).digest("hex");
    if (actual !== expectedSha256) {
        await rm(destPath, { force: true });
        throw new Error(`sha256 mismatch for ${url}: expected ${expectedSha256}, got ${actual}`);
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
    // --fail-with-body and -f are mutually exclusive in curl. We use -f (fail on HTTP errors)
    // and rely on inherited stdio to surface any error body.
    await run("curl", [
        "-fsSL",
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
    const extractedPath = join(TOOLS_DIR, spec.extractedDir);
    if (extractedPath !== targetPath) {
        await rm(extractedPath, { recursive: true, force: true });
    }
    await rm(targetPath, { recursive: true, force: true });
    await run("tar", ["-xzf", tmpFile, "-C", TOOLS_DIR]);
    await rm(tmpFile, { force: true });

    if (spec.extractedDir !== spec.renameTo) {
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
    const emsdkScript = join(emsdkDir, "emsdk");
    if (!await pathExists(emsdkScript)) {
        if (await pathExists(emsdkDir)) {
            console.log("[setup] emsdk directory exists but is incomplete — wiping and re-cloning");
            await rm(emsdkDir, { recursive: true, force: true });
        }
        console.log("[setup] cloning emsdk");
        // Bypass user's global git config (e.g. url.ssh://git@github.com/.insteadOf=https://github.com/)
        // so we always clone over HTTPS. /dev/null silences the global/system gitconfig for this command only.
        await run("git", ["clone", "https://github.com/emscripten-core/emsdk.git", emsdkDir], {
            env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
        });
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

export async function ensureFirefox(spec: FirefoxSpec): Promise<void> {
    const state = await readState();
    const targetDir = join(TOOLS_DIR, `firefox-${spec.version}`);
    const appPath = join(targetDir, spec.appPath);
    const binaryPath = join(appPath, spec.binaryInApp);

    if (state["firefox"] === spec.version && await pathExists(binaryPath)) {
        console.log(`[setup] firefox ${spec.version} already installed, skipping`);
        return;
    }

    console.log(`[setup] installing firefox ${spec.version}`);
    await mkdir(TOOLS_DIR, { recursive: true });

    const tmpDmg = join(TOOLS_DIR, "firefox.download.dmg");
    await downloadAndVerify(spec.url, spec.sha256, tmpDmg);

    const mountPoint = join(TOOLS_DIR, "firefox.mount");
    await mkdir(mountPoint, { recursive: true });
    console.log(`[setup] mounting firefox dmg`);
    await run("hdiutil", ["attach", "-nobrowse", "-mountpoint", mountPoint, tmpDmg]);

    try {
        await rm(targetDir, { recursive: true, force: true });
        await mkdir(targetDir, { recursive: true });
        console.log(`[setup] copying ${spec.appPath} from dmg`);
        await run("cp", ["-R", join(mountPoint, spec.appPath), targetDir]);
    } finally {
        await run("hdiutil", ["detach", mountPoint]).catch(() => { /* best effort */ });
        await rm(mountPoint, { recursive: true, force: true });
    }

    await rm(tmpDmg, { force: true });

    console.log(`[setup] clearing quarantine attr`);
    await run("xattr", ["-d", "-r", "com.apple.quarantine", appPath]).catch(() => { /* not all builds have it */ });

    if (!await pathExists(binaryPath)) {
        throw new Error(`firefox binary not found at expected path: ${binaryPath}`);
    }

    state["firefox"] = spec.version;
    await writeState(state);
    console.log(`[setup] firefox ${spec.version} installed`);
}

export async function ensureGeckodriver(spec: GeckodriverSpec): Promise<void> {
    const state = await readState();
    const targetDir = join(TOOLS_DIR, `geckodriver-${spec.version}`);
    const binaryPath = join(targetDir, "geckodriver");

    if (state["geckodriver"] === spec.version && await pathExists(binaryPath)) {
        console.log(`[setup] geckodriver ${spec.version} already installed, skipping`);
        return;
    }

    console.log(`[setup] installing geckodriver ${spec.version}`);
    await mkdir(TOOLS_DIR, { recursive: true });

    const tmpFile = join(TOOLS_DIR, "geckodriver.download.tar.gz");
    await downloadAndVerify(spec.url, spec.sha256, tmpFile);

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });
    await run("tar", ["-xzf", tmpFile, "-C", targetDir]);
    await rm(tmpFile, { force: true });

    if (!await pathExists(binaryPath)) {
        throw new Error(`geckodriver binary not found at expected path: ${binaryPath}`);
    }

    state["geckodriver"] = spec.version;
    await writeState(state);
    console.log(`[setup] geckodriver ${spec.version} installed`);
}

export async function ensureChromeForTesting(spec: ChromeForTestingSpec): Promise<void> {
    const state = await readState();
    const targetDir = join(TOOLS_DIR, `chrome-${spec.version}`);
    const chromeBinaryPath = join(targetDir, spec.appPath, spec.binaryInApp);
    const chromedriverBinaryPath = join(targetDir, spec.chromedriverBinaryPath);

    if (
        state["chrome-for-testing"] === spec.version
        && await pathExists(chromeBinaryPath)
        && await pathExists(chromedriverBinaryPath)
    ) {
        console.log(`[setup] chrome-for-testing ${spec.version} already installed, skipping`);
        return;
    }

    console.log(`[setup] installing chrome-for-testing ${spec.version}`);
    await mkdir(TOOLS_DIR, { recursive: true });

    const chromeZip = join(TOOLS_DIR, "chrome.download.zip");
    const cdZip = join(TOOLS_DIR, "chromedriver.download.zip");
    await downloadAndVerify(spec.chromeUrl, spec.chromeSha256, chromeZip);
    await downloadAndVerify(spec.chromedriverUrl, spec.chromedriverSha256, cdZip);

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });
    console.log(`[setup] extracting chrome.zip`);
    await run("unzip", ["-q", chromeZip, "-d", targetDir]);
    console.log(`[setup] extracting chromedriver.zip`);
    await run("unzip", ["-q", cdZip, "-d", targetDir]);
    await rm(chromeZip, { force: true });
    await rm(cdZip, { force: true });

    const appPath = join(targetDir, spec.appPath);
    await run("xattr", ["-d", "-r", "com.apple.quarantine", appPath]).catch(() => { /* not all builds have it */ });
    await run("xattr", ["-d", "-r", "com.apple.quarantine", chromedriverBinaryPath]).catch(() => { /* not all builds have it */ });

    if (!await pathExists(chromeBinaryPath)) {
        throw new Error(`chrome binary not found: ${chromeBinaryPath}`);
    }
    if (!await pathExists(chromedriverBinaryPath)) {
        throw new Error(`chromedriver binary not found: ${chromedriverBinaryPath}`);
    }

    state["chrome-for-testing"] = spec.version;
    await writeState(state);
    console.log(`[setup] chrome-for-testing ${spec.version} installed`);
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
    // Wipe and recreate so stale links (e.g. emcc from older versions of this script) are removed.
    await rm(binDir, { recursive: true, force: true });
    await mkdir(binDir, { recursive: true });

    // No emcc symlink: emcc is a bash wrapper that locates emcc.py via BASH_SOURCE[0]
    // without resolving symlinks, so a `.tools/bin/emcc` symlink makes it look for
    // `.tools/bin/emcc.py` which doesn't exist. We rely on emsdk PATH (via emsdkEnv())
    // adding `.tools/emsdk/upstream/emscripten/` so plain `emcc` resolves correctly.
    const links: Array<[string, string]> = [
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
