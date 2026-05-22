import { readdir, access } from "node:fs/promises";
import { run } from "./lib/exec.js";

async function fileExists(p: string): Promise<boolean> {
    try {
        await access(p); return true;
    } catch {
        return false;
    }
}

async function listBenches(): Promise<string[]> {
    const entries = await readdir("benches", { withFileTypes: true });
    const out: string[] = [];
    for (const e of entries) {
        if (e.isDirectory() && await fileExists(`benches/${e.name}/spec.json`)) {
            out.push(e.name);
        }
    }
    return out.sort();
}

interface Args { bench?: string }

function parseArgs(argv: string[]): Args {
    const v = argv.find((a) => a.startsWith("--bench="));
    return v ? { bench: v.slice("--bench=".length) } : {};
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const benches = args.bench ? [args.bench] : await listBenches();
    for (const b of benches) {
        const gen = `benches/${b}/fixtures/generate.ts`;
        if (!(await fileExists(gen))) {
            console.log(`[fixtures] ${b}: no generator at ${gen}, skipping`);
            continue;
        }
        await run("tsx", [gen]);
    }
}

main().catch((e) => {
    console.error(e); process.exit(1);
});
