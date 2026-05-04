import { argv, exit } from "node:process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { totalmem } from "node:os"; // NOTE H: ESM import, not require()
import { chromium, firefox, type Browser } from "@playwright/test"; // NOTE G: @playwright/test not playwright
import { BenchResultSchema } from "@bench/result-schema";
import type { Language, Toolchain, Profile, InputSize } from "@bench/result-schema";
import type { WorkerInput } from "./worker.js";

// Repo root = two directories up from apps/runner-web/src/driver.ts
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

// NOTE J: rename parameter to avoid shadowing imported argv
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

async function main() {
    const a = parseCli(argv.slice(2));

    const measureConfig = a.mode === "quick"
        ? { warmupIterations: 3, innerIterations: 1, minSamples: 5, maxSamples: 10, cvThreshold: 0.05 }
        : { warmupIterations: 10, innerIterations: 1, minSamples: 30, maxSamples: 100, cvThreshold: 0.05 };

    // Pre-read spec.json so driver passes everything to the page (NOTE L)
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
    const url = `${baseUrl}/?case=${encodeURIComponent(caseParam)}`;

    let browser: Browser | undefined;
    let raw: unknown;
    try {
        browser = a.browser === "firefox"
            ? await firefox.launch({ headless: true })
            : await chromium.launch({ headless: true });
        const page = await browser.newPage();

        // Capture console output from the page for debugging
        page.on("console", (msg) => console.log(`[browser ${msg.type()}] ${msg.text()}`));
        page.on("pageerror", (err) => console.error("[browser error]", err));

        console.log(`navigating to ${url}`);
        await page.goto(url);

        // Wait up to 5 minutes for the result
        const timeoutMs = 5 * 60 * 1000;
        try {
            // NOTE I: pass function to waitForFunction, not a string
            await page.waitForFunction(
                () => (window as unknown as { __BENCH_RESULT?: unknown }).__BENCH_RESULT !== undefined,
                { timeout: timeoutMs },
            );
        } catch {
            const status = await page.textContent("#status");
            throw new Error(`timed out waiting for result. Page status: ${status ?? "(none)"}`);
        }

        // NOTE I: pass function to evaluate
        raw = await page.evaluate(
            () => (window as unknown as { __BENCH_RESULT?: unknown }).__BENCH_RESULT,
        );
    } finally {
        await browser?.close();
    }

    if (
        raw !== null &&
    typeof raw === "object" &&
    "error" in raw &&
    typeof (raw).error === "string"
    ) {
        throw new Error(`benchmark failed: ${(raw as { error: string }).error}`);
    }

    const result = BenchResultSchema.parse(raw);

    // Patch machine info from host. The browser-reported machine.os
    // (navigator.platform) is deprecated and unreliable (empty on FF 110+);
    // use Node's process.platform/arch like runner-node does.
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
