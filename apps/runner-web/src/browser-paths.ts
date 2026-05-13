import { readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

interface FirefoxEntry {
    version: string;
    url: string;
    sha256: string;
    appPath: string;
    binaryInApp: string;
}

interface GeckodriverEntry {
    version: string;
    url: string;
    sha256: string;
}

interface ChromeForTestingEntry {
    version: string;
    chromeUrl: string;
    chromeSha256: string;
    chromedriverUrl: string;
    chromedriverSha256: string;
    appPath: string;
    binaryInApp: string;
    chromedriverBinaryPath: string;
}

interface VersionsFile {
    browsers: {
        firefox: FirefoxEntry;
        geckodriver: GeckodriverEntry;
        "chrome-for-testing": ChromeForTestingEntry;
    };
}

export interface BrowserPaths {
    firefoxBinary: string;
    geckodriver: string;
    chromeBinary: string;
    chromedriver: string;
}

async function pathExists(p: string): Promise<boolean> {
    try {
        await access(p);
        return true;
    } catch {
        return false;
    }
}

export async function getBrowserPaths(): Promise<BrowserPaths> {
    const raw = await readFile(join(REPO_ROOT, "tool-versions.json"), "utf8");
    const tv = JSON.parse(raw) as VersionsFile;
    const b = tv.browsers;

    const firefoxBinary = join(
        REPO_ROOT, ".tools", `firefox-${b.firefox.version}`,
        b.firefox.appPath, b.firefox.binaryInApp,
    );
    const geckodriver = join(
        REPO_ROOT, ".tools", `geckodriver-${b.geckodriver.version}`, "geckodriver",
    );
    const chromeBinary = join(
        REPO_ROOT, ".tools", `chrome-${b["chrome-for-testing"].version}`,
        b["chrome-for-testing"].appPath, b["chrome-for-testing"].binaryInApp,
    );
    const chromedriver = join(
        REPO_ROOT, ".tools", `chrome-${b["chrome-for-testing"].version}`,
        b["chrome-for-testing"].chromedriverBinaryPath,
    );

    for (const [name, path] of [
        ["firefox", firefoxBinary],
        ["geckodriver", geckodriver],
        ["chrome", chromeBinary],
        ["chromedriver", chromedriver],
    ] as const) {
        if (!await pathExists(path)) {
            throw new Error(
                `${name} binary not found at ${path}. Run 'pnpm setup-tools' from repo root.`,
            );
        }
    }

    return { firefoxBinary, geckodriver, chromeBinary, chromedriver };
}
