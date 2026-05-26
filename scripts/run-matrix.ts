import { mkdir, readdir, readFile, access, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execa, type ResultPromise } from "execa";
import { SpecSchema, type Spec } from "@bench/result-schema";
import { enumerateBinaries } from "./lib/matrix.js";
import { run } from "./lib/exec.js";
import { createDriverSession, type CaseInput, type DriverSession } from "../apps/runner-web/src/driver.js";
import { runCaseWithRetry, type RetryFailure } from "../apps/runner-web/src/run-case-with-retry.js";

type Env = "node" | "chromium" | "firefox";
type Size = "S" | "M" | "L";

const ALL_ENVS: readonly Env[] = ["node", "chromium", "firefox"];
const ALL_SIZES: readonly Size[] = ["S", "M", "L"];

interface CliArgs {
    envs: Env[];
    sizes: Size[];
    mode: "quick" | "eval";
    out: string;
    benchmarks: string[];
    restartEvery: number;
}

function parseList<T extends string>(raw: string, allowed: readonly T[], label: string): T[] {
    const items = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    for (const item of items) {
        if (!(allowed as readonly string[]).includes(item)) {
            throw new Error(`unknown ${label}: ${item} (allowed: ${allowed.join(", ")})`);
        }
    }
    return items as T[];
}

function parseArgs(argv: string[]): CliArgs {
    const get = (name: string, def: string): string => {
        const v = argv.find((a) => a.startsWith(`--${name}=`));
        return v ? v.slice(name.length + 3) : def;
    };
    const mode = get("mode", "eval");
    if (mode !== "quick" && mode !== "eval") {
        throw new Error(`unknown mode: ${mode} (allowed: quick, eval)`);
    }
    const benchmarksRaw = get("benchmarks", "");
    const benchmarks = benchmarksRaw === ""
        ? []
        : benchmarksRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    const restartEveryRaw = parseInt(get("restart-every", "0"), 10);
    if (!Number.isFinite(restartEveryRaw) || restartEveryRaw < 0) {
        throw new Error(`--restart-every must be a non-negative integer; got "${get("restart-every", "0")}"`);
    }
    return {
        envs: parseList(get("envs", "node,chromium,firefox"), ALL_ENVS, "env"),
        sizes: parseList(get("sizes", "S,M"), ALL_SIZES, "size"),
        mode,
        out: get("out", `results/raw/${new Date().toISOString().replace(/[:.]/g, "-")}`),
        benchmarks,
        restartEvery: restartEveryRaw,
    };
}

async function fileExists(p: string): Promise<boolean> {
    try {
        await access(p); return true;
    } catch {
        return false;
    }
}

async function loadSpecs(): Promise<Spec[]> {
    const entries = await readdir("benches", { withFileTypes: true });
    const out: Spec[] = [];
    for (const e of entries) {
        if (e.isDirectory() && await fileExists(`benches/${e.name}/spec.json`)) {
            const raw = await readFile(`benches/${e.name}/spec.json`, "utf8");
            out.push(SpecSchema.parse(JSON.parse(raw)));
        }
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
}

async function waitForServer(url: string, attempts = 30, delayMs = 500): Promise<void> {
    for (let i = 0; i < attempts; i++) {
        try {
            const r = await fetch(url);
            if (r.ok) {
                return;
            }
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, delayMs));
    }
    throw new Error(`dev server at ${url} did not come up after ${attempts * delayMs}ms`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    await mkdir(args.out, { recursive: true });
    const specs = await loadSpecs();

    const filteredSpecs = args.benchmarks.length === 0
        ? specs
        : specs.filter((s) => args.benchmarks.includes(s.id));
    if (args.benchmarks.length > 0 && filteredSpecs.length !== args.benchmarks.length) {
        const found = new Set(filteredSpecs.map((s) => s.id));
        const missing = args.benchmarks.filter((b) => !found.has(b));
        throw new Error(`--benchmarks: unknown benchmark id(s): ${missing.join(", ")}`);
    }

    const needWebServer = args.envs.some((e) => e !== "node");
    let serverProc: ResultPromise | null = null;
    if (needWebServer) {
        const viteBin = resolve("apps/runner-web/node_modules/.bin/vite");
        // Wave 1 Phase 1.0.6: prod-bundle. Build synchronously, then launch preview.
        console.log("[run-matrix] building runner-web for preview...");
        await execa(viteBin, ["build"], {
            cwd: "apps/runner-web",
            stdio: "inherit",
        });
        console.log("[run-matrix] launching vite preview...");
        serverProc = execa(viteBin, ["preview", "--port=5174", "--strictPort"], {
            cwd: "apps/runner-web",
            stdio: "inherit",
            detached: true,
        });
        // Detach the unhandled rejection: when we SIGTERM the process the promise
        // rejects, but we want to swallow that and only surface real failures.
        serverProc.catch(() => { /* expected on shutdown */ });
        await waitForServer("http://localhost:5174/");
    }

    let ranOK = true;
    const accumulateFailures: Array<RetryFailure & { env: Env }> = [];
    try {
        // ── Node loop: per-case subprocess (unchanged behaviour) ─────────────
        if (args.envs.includes("node")) {
            for (const spec of filteredSpecs) {
                for (const c of enumerateBinaries(spec)) {
                    if (c.language === "js" && c.profile !== "speed") {
                        continue;
                    }
                    for (const entry of spec.entries) {
                        for (const sz of args.sizes) {
                            const common = [
                                `--benchmark=${c.sourceBench}`,
                                `--entry=${entry}`,
                                `--language=${c.language}`,
                                `--toolchain=${c.toolchain}`,
                                `--profile=${c.profile}`,
                                `--size=${sz}`,
                                `--out=${args.out}`,
                                `--mode=${args.mode}`,
                            ];
                            await run("tsx", ["apps/runner-node/src/main.ts", ...common]);
                        }
                    }
                }
            }
        }

        // ── Browser loops: long-lived session per env ───────────────────────
        for (const env of args.envs) {
            if (env === "node") {
                continue;
            }
            const cases: CaseInput[] = [];
            for (const spec of filteredSpecs) {
                for (const c of enumerateBinaries(spec)) {
                    if (c.language === "js" && c.profile !== "speed") {
                        continue;
                    }
                    for (const entry of spec.entries) {
                        for (const sz of args.sizes) {
                            cases.push({
                                benchmark: c.sourceBench,
                                entry,
                                language: c.language,
                                toolchain: c.toolchain,
                                profile: c.profile,
                                size: sz,
                                mode: args.mode,
                            });
                        }
                    }
                }
            }
            if (cases.length === 0) {
                continue;
            }

            const create = (): Promise<DriverSession> => createDriverSession(env, { port: 5174 });
            let session: DriverSession;
            try {
                session = await create();
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`[env-skip] env=${env}: initial session create failed: ${msg}`);
                accumulateFailures.push({ env, caseId: "(env-init)", error: msg });
                ranOK = false;
                continue;
            }
            const sessionRef = { current: session };
            const envFailures: RetryFailure[] = [];
            let consecutiveFailures = 0;

            for (let i = 0; i < cases.length; i++) {
                if (args.restartEvery > 0 && i > 0 && i % args.restartEvery === 0) {
                    console.log(`[restart-every] env=${env}: restarting session at case ${i}`);
                    await sessionRef.current.quit().catch(() => { /* best-effort */ });
                    sessionRef.current = await create();
                }
                const result = await runCaseWithRetry(sessionRef, cases[i]!, envFailures, create);
                if (result === null) {
                    consecutiveFailures++;
                    if (consecutiveFailures >= 3) {
                        const remaining = cases.length - i - 1;
                        console.error(`[abort] env=${env}: 3 consecutive failures, skipping ${remaining} remaining cases`);
                        break;
                    }
                } else {
                    consecutiveFailures = 0;
                    const outPath = join(args.out, result.fileName);
                    await writeFile(outPath, JSON.stringify(result.result, null, 2));
                    console.log(`wrote ${outPath}`);
                }
            }

            await sessionRef.current.quit().catch(() => { /* best-effort */ });

            if (envFailures.length > 0) {
                ranOK = false;
                for (const f of envFailures) {
                    accumulateFailures.push({ env, ...f });
                }
            }
        }
    } catch (e) {
        ranOK = false;
        throw e;
    } finally {
        if (serverProc?.pid) {
            try {
                // negative PID = signal to entire process group
                process.kill(-serverProc.pid, "SIGTERM");
            } catch (e: unknown) {
                // ESRCH means the group already exited — ignore.
                if ((e as NodeJS.ErrnoException).code !== "ESRCH") {
                    throw e;
                }
            }
            // Wait for the process to actually terminate.
            try {
                await serverProc;
            } catch { /* expected on SIGTERM */ }
        }
    }

    if (accumulateFailures.length > 0) {
        const summary = accumulateFailures
            .map((f) => `[${f.env}] ${f.caseId}: ${f.error}`)
            .join("\n");
        await writeFile(join(args.out, "failures.txt"), summary + "\n");
        console.error(`${accumulateFailures.length} case(s) failed; see ${args.out}/failures.txt`);
        process.exit(1);
    }

    console.log(`results in ${args.out}${ranOK ? "" : " (partial — some cases failed)"}`);
}

main().catch((e) => {
    console.error(e); process.exit(1);
});
