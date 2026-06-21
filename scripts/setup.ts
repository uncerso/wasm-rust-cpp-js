import { readFile } from "node:fs/promises";
import {
    type TarballSpec,
    type FirefoxSpec,
    type GeckodriverSpec,
    type ChromeForTestingSpec,
    ensureTarball,
    ensureEmsdk,
    ensureWasmPackViaCargo,
    ensureTwiggyViaCargo,
    ensureRustTarget,
    ensureFirefox,
    ensureGeckodriver,
    ensureChromeForTesting,
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

interface TwiggyEntry {
    version: string;
}

interface BrowsersManifest {
    firefox: FirefoxSpec;
    geckodriver: GeckodriverSpec;
    "chrome-for-testing": ChromeForTestingSpec;
}

interface VersionsManifest {
    tools: {
        "wasi-sdk": TarballEntry;
        binaryen: TarballEntry;
        emsdk: EmsdkEntry;
        "wasm-pack": WasmPackEntry;
        twiggy: TwiggyEntry;
    };
    browsers: BrowsersManifest;
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
    await ensureTwiggyViaCargo(manifest.tools.twiggy.version);
    await createSymlinks();
    await ensureRustTarget("wasm32-unknown-unknown");
    await ensureFirefox(manifest.browsers.firefox);
    await ensureGeckodriver(manifest.browsers.geckodriver);
    await ensureChromeForTesting(manifest.browsers["chrome-for-testing"]);
    console.log("[setup] all tools ready");
}

main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
});
