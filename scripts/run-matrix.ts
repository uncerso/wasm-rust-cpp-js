import { mkdir, readdir, readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { execa, type ResultPromise } from "execa";
import { SpecSchema, type Spec } from "@bench/result-schema";
import { enumerateBinaries } from "./lib/matrix.js";
import { run } from "./lib/exec.js";

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
    return {
        envs: parseList(get("envs", "node,chromium,firefox"), ALL_ENVS, "env"),
        sizes: parseList(get("sizes", "S,M"), ALL_SIZES, "size"),
        mode,
        out: get("out", `results/raw/${new Date().toISOString().replace(/[:.]/g, "-")}`),
        benchmarks,
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
    try {
        for (const spec of filteredSpecs) {
            for (const c of enumerateBinaries(spec)) {
                for (const entry of spec.entries) {
                    for (const sz of args.sizes) {
                        for (const env of args.envs) {
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
                            // JS: speed profile only (esbuild produces identical output for both).
                            if (c.language === "js" && c.profile !== "speed") {
                                continue;
                            }
                            if (env === "node") {
                                await run("tsx", ["apps/runner-node/src/main.ts", ...common]);
                            } else {
                                await run("tsx", ["apps/runner-web/src/driver.ts", ...common, `--browser=${env}`]);
                            }
                        }
                    }
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

    console.log(`results in ${args.out}${ranOK ? "" : " (partial — some cases failed)"}`);
}

main().catch((e) => {
    console.error(e); process.exit(1);
});
