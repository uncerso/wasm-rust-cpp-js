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
import { SpecSchema } from "@bench/result-schema";
import type { WorkerInput } from "./worker.js";
import { getBrowserPaths } from "./browser-paths.js";

export interface CaseInput {
    benchmark: string;
    entry: string;
    language: Language;
    toolchain: Toolchain;
    profile: Profile;
    size: InputSize;
    mode: "quick" | "eval";
}

export interface CaseResult {
    result: import("@bench/result-schema").BenchResult;
    fileName: string;
}

export interface DriverSession {
    runCase(input: CaseInput): Promise<CaseResult>;
    quit(): Promise<void>;
}

export interface CreateDriverSessionOptions {
    port?: number;
}

const QUIT_TIMEOUT_MS = 5_000;

/** Exported for testing only. Races `quitFn` against a fixed timeout. */
export async function quitWithTimeout(
    quitFn: () => Promise<void>,
    timeoutMs: number = QUIT_TIMEOUT_MS,
): Promise<void> {
    await Promise.race([
        quitFn().catch(() => { /* swallowed by intent */ }),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
}

export async function createDriverSession(
    env: "chromium" | "firefox",
    options: CreateDriverSessionOptions = {},
): Promise<DriverSession> {
    const port = options.port ?? 5174;
    const baseUrl = `http://localhost:${port}`;
    const driver = await launchBrowser(env);

    async function runCase(input: CaseInput): Promise<CaseResult> {
        const baseMeasureConfig = input.mode === "quick"
            ? { warmupIterations: 3, innerIterations: 1, minSamples: 5, maxSamples: 20, semThreshold: 0.10, wallBudgetMs: 300 }
            : { warmupIterations: 10, innerIterations: 1, minSamples: 30, maxSamples: 512, semThreshold: 0.03, wallBudgetMs: 2000 };

        const specPath = join(REPO_ROOT, `dist/${input.benchmark}/spec.json`);
        const spec = SpecSchema.parse(JSON.parse(await readFile(specPath, "utf8")));
        const sizeSpec = spec.inputSizes[input.size];
        if (!sizeSpec) {
            throw new Error(`spec missing inputSize ${input.size}`);
        }
        const perEntry = spec.expectedChecksums[input.entry];
        if (!perEntry) {
            throw new Error(`spec missing expectedChecksums for entry "${input.entry}"`);
        }
        const expectedChecksum = perEntry[input.size];
        if (expectedChecksum === undefined) {
            throw new Error(`spec missing expectedChecksum for entry "${input.entry}" size "${input.size}"`);
        }

        const measureConfig = sizeSpec.innerIterations !== undefined
            ? { ...baseMeasureConfig, innerIterations: sizeSpec.innerIterations }
            : baseMeasureConfig;

        const workerInput: WorkerInput = {
            benchmarkId: input.benchmark,
            entry: input.entry,
            language: input.language,
            toolchain: input.toolchain,
            profile: input.profile,
            inputSize: input.size,
            fixtureSha256: sizeSpec.fixtureSha256,
            expectedChecksum,
            measureConfig,
            baseUrl,
        };

        const caseParam = btoa(JSON.stringify(workerInput));
        const debug = process.env["BENCH_DEBUG_TIMINGS"] === "1" ? "&debug=1" : "";
        const url = `${baseUrl}/?case=${encodeURIComponent(caseParam)}${debug}`;

        console.log(`navigating to ${url}`);
        await driver.get(url);

        const timeoutMs = 5 * 60 * 1000;
        try {
            await driver.wait(async () => {
                return await driver.executeScript<boolean>(
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
            for (const log of logs) {
                console.error("[browser]", log);
            }
            throw new Error(`timed out waiting for result. Page status: ${status}`);
        }

        const raw = await driver.executeScript<unknown>("return (window).__BENCH_RESULT;");

        const logs = await driver.executeScript<unknown[]>(
            "return (window).__BENCH_LOGS || [];",
        ).catch(() => []);
        for (const log of logs) {
            console.log("[browser]", log);
        }

        if (
            raw !== null
            && typeof raw === "object"
            && "error" in raw
            && typeof raw.error === "string"
        ) {
            throw new Error(`benchmark failed: ${raw.error}`);
        }

        const result = BenchResultSchema.parse(raw);
        const machineCpu = process.env["MACHINE_CPU"] ?? "unknown";
        const patched = BenchResultSchema.parse({
            ...result,
            machine: {
                os: `${process.platform} ${process.arch}`,
                cpu: machineCpu,
                memoryGb: Math.max(1, Math.round(totalmem() / (1024 ** 3))),
            },
        });

        const fileName = `${input.entry}__${input.language}-${input.toolchain}-${input.profile}__${input.size}__${env}.json`;
        return { result: patched, fileName };
    }

    async function quit(): Promise<void> {
        await quitWithTimeout(() => driver.quit());
    }

    return { runCase, quit };
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

interface CliArgs {
    benchmark: string;
    entry: string;
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
        entry: get("entry"),
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
    const session = await createDriverSession(a.browser, { port: a.port });
    try {
        const { result, fileName } = await session.runCase({
            benchmark: a.benchmark,
            entry: a.entry,
            language: a.language,
            toolchain: a.toolchain,
            profile: a.profile,
            size: a.size,
            mode: a.mode,
        });
        const resolvedOutDir = resolve(REPO_ROOT, a.outDir);
        await mkdir(resolvedOutDir, { recursive: true });
        const outPath = join(resolvedOutDir, fileName);
        await writeFile(outPath, JSON.stringify(result, null, 2));
        console.log(`wrote ${outPath}`);
        console.log(`checksum: ${String(result.quality.checksum)}`);
        console.log(`validated: ${String(result.quality.validated)}`);
    } finally {
        await session.quit();
    }
}

const __filename = fileURLToPath(import.meta.url);
if (argv[1] === __filename) {
    main().catch((e: unknown) => {
        console.error(e); exit(1);
    });
}
