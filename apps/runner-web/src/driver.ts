import { argv, exit } from "node:process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { totalmem } from "node:os";
import { Builder, type WebDriver } from "selenium-webdriver";
import * as firefox from "selenium-webdriver/firefox";
import * as chrome from "selenium-webdriver/chrome";
import { BenchResultSchema } from "@bench/result-schema";
import type { Language, Toolchain, Profile, InputSize } from "@bench/result-schema";
import type { WorkerInput } from "./worker.js";
import { getBrowserPaths } from "./browser-paths.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

interface CliArgs {
    benchmark: string;
    language: Language;
    toolchain: Toolchain;
    profile: Profile;
    size: InputSize;
    outDir: string;
    mode: "quick" | "eval";
    browser: "chromium" | "firefox";
    port: number;
}

function parseCli(args: string[]): CliArgs {
    const get = (name: string): string => {
        const v = args.find((a) => a.startsWith(`--${name}=`));
        if (!v) {
            throw new Error(`missing --${name}`);
        }
        return v.slice(name.length + 3);
    };
    const getOpt = (name: string, fallback: string): string => {
        const v = args.find((a) => a.startsWith(`--${name}=`));
        return v ? v.slice(name.length + 3) : fallback;
    };
    return {
        benchmark: get("benchmark"),
        language: get("language") as Language,
        toolchain: get("toolchain") as Toolchain,
        profile: get("profile") as Profile,
        size: get("size") as InputSize,
        outDir: get("out"),
        mode: get("mode") as "quick" | "eval",
        browser: getOpt("browser", "chromium") as "chromium" | "firefox",
        port: parseInt(getOpt("port", "5174"), 10),
    };
}

interface SpecSizeEntry {
    fixtureSha256: string;
    expectedChecksum: number | string;
}

interface SpecFile {
    inputSizes: Record<InputSize, SpecSizeEntry>;
}

async function launchBrowser(env: "chromium" | "firefox"): Promise<WebDriver> {
    const paths = await getBrowserPaths();
    if (env === "firefox") {
        const opts = new firefox.Options();
        opts.setBinary(paths.firefoxBinary);
        opts.addArguments("--headless");
        // Suppress auto-update, telemetry, first-run UI
        opts.setPreference("app.update.auto", false);
        opts.setPreference("app.update.enabled", false);
        opts.setPreference("app.update.staging.enabled", false);
        opts.setPreference("toolkit.telemetry.reportingpolicy.firstRun", false);
        opts.setPreference("datareporting.policy.firstRunURL", "");
        opts.setPreference("browser.shell.checkDefaultBrowser", false);
        return new Builder()
            .forBrowser("firefox")
            .setFirefoxOptions(opts)
            .setFirefoxService(new firefox.ServiceBuilder(paths.geckodriver))
            .build();
    }
    const opts = new chrome.Options();
    opts.setChromeBinaryPath(paths.chromeBinary);
    opts.addArguments(
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-default-apps",
        "--disable-features=Translate",
    );
    return new Builder()
        .forBrowser("chrome")
        .setChromeOptions(opts)
        .setChromeService(new chrome.ServiceBuilder(paths.chromedriver))
        .build();
}

async function main() {
    const a = parseCli(argv.slice(2));

    const measureConfig = a.mode === "quick"
        ? { warmupIterations: 3, innerIterations: 1, minSamples: 5, maxSamples: 10, cvThreshold: 0.05 }
        : { warmupIterations: 10, innerIterations: 1, minSamples: 30, maxSamples: 100, cvThreshold: 0.05 };

    const specPath = join(REPO_ROOT, `dist/${a.benchmark}/spec.json`);
    const spec = JSON.parse(await readFile(specPath, "utf8")) as SpecFile;
    const sizeSpec = spec.inputSizes[a.size];
    if (!sizeSpec) {
        throw new Error(`spec missing inputSize ${a.size}`);
    }

    const baseUrl = `http://localhost:${a.port}`;

    const workerInput: WorkerInput = {
        benchmarkId: a.benchmark,
        language: a.language,
        toolchain: a.toolchain,
        profile: a.profile,
        inputSize: a.size,
        fixtureSha256: sizeSpec.fixtureSha256,
        expectedChecksum: sizeSpec.expectedChecksum,
        measureConfig,
        baseUrl,
    };

    const caseParam = btoa(JSON.stringify(workerInput));
    const debug = process.env["BENCH_DEBUG_TIMINGS"] === "1" ? "&debug=1" : "";
    const url = `${baseUrl}/?case=${encodeURIComponent(caseParam)}${debug}`;

    let driver: WebDriver | undefined;
    let raw: unknown;
    try {
        driver = await launchBrowser(a.browser);
        console.log(`navigating to ${url}`);
        await driver.get(url);

        const timeoutMs = 5 * 60 * 1000;
        try {
            await driver.wait(async () => {
                return await driver!.executeScript<boolean>(
                    "return (window).__BENCH_RESULT !== undefined;",
                );
            }, timeoutMs);
        } catch {
            const status = await driver.executeScript<string>(
                "return document.getElementById('status')?.textContent || '(no status)';",
            ).catch(() => "(eval failed)");
            const logs = await driver.executeScript<unknown[]>(
                "return (window).__BENCH_LOGS || [];",
            ).catch(() => []);
            for (const log of logs) console.error("[browser]", log);
            throw new Error(`timed out waiting for result. Page status: ${status}`);
        }

        raw = await driver.executeScript<unknown>(
            "return (window).__BENCH_RESULT;",
        );

        // Forward any captured logs even on success
        const logs = await driver.executeScript<unknown[]>(
            "return (window).__BENCH_LOGS || [];",
        ).catch(() => []);
        for (const log of logs) console.log("[browser]", log);
    } finally {
        await driver?.quit().catch(() => { /* best effort */ });
    }

    if (
        raw !== null
        && typeof raw === "object"
        && "error" in raw
        && typeof (raw).error === "string"
    ) {
        throw new Error(`benchmark failed: ${(raw as { error: string }).error}`);
    }

    const result = BenchResultSchema.parse(raw);

    const machineCpu = process.env["MACHINE_CPU"] ?? "unknown";
    const patched = {
        ...result,
        machine: {
            os: `${process.platform} ${process.arch}`,
            cpu: machineCpu,
            memoryGb: Math.max(1, Math.round(totalmem() / (1024 ** 3))),
        },
    };
    const final = BenchResultSchema.parse(patched);

    const resolvedOutDir = resolve(REPO_ROOT, a.outDir);
    await mkdir(resolvedOutDir, { recursive: true });
    const fname = `${a.benchmark}__${a.language}-${a.toolchain}-${a.profile}__${a.size}__${a.browser}.json`;
    const outPath = join(resolvedOutDir, fname);
    await writeFile(outPath, JSON.stringify(final, null, 2));
    console.log(`wrote ${outPath}`);
    console.log(`checksum: ${String(final.quality.checksum)}`);
    console.log(`validated: ${String(final.quality.validated)}`);
}

main().catch((e) => {
    console.error(e); exit(1);
});
