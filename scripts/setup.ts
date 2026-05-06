import { readFile } from "node:fs/promises";
import {
    type TarballSpec,
    ensureTarball,
    ensureEmsdk,
    ensureWasmPackViaCargo,
    ensureRustTarget,
    ensurePlaywrightBrowsers,
    createSymlinks,
} from "./lib/setup-tools.js";

interface TarballEntry {
    version: string;
    url: string;
    sha256: string;
    extractedDir: string;
    renameTo: string;
}

interface EmsdkEntry {
    version: string;
}

interface WasmPackEntry {
    version: string;
}

interface VersionsManifest {
    tools: {
        "wasi-sdk": TarballEntry;
        binaryen: TarballEntry;
        emsdk: EmsdkEntry;
        "wasm-pack": WasmPackEntry;
    };
}

async function main(): Promise<void> {
    const raw = await readFile("tool-versions.json", "utf8");
    const manifest = JSON.parse(raw) as VersionsManifest;

    const wasiSdk: TarballSpec = {
        name: "wasi-sdk",
        ...manifest.tools["wasi-sdk"],
    };

    const binaryen: TarballSpec = {
        name: "binaryen",
        ...manifest.tools.binaryen,
    };

    await ensureTarball(wasiSdk);
    await ensureTarball(binaryen);
    await ensureEmsdk(manifest.tools.emsdk.version);
    await ensureWasmPackViaCargo(manifest.tools["wasm-pack"].version);
    await createSymlinks();
    await ensureRustTarget("wasm32-unknown-unknown");
    await ensurePlaywrightBrowsers();
    console.log("[setup] all tools ready");
}

main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
});
