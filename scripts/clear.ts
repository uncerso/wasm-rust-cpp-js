import { rm, stat } from "node:fs/promises";

async function assertRepoRoot(): Promise<void> {
    try {
        const s = await stat("pnpm-workspace.yaml");
        if (!s.isFile()) {
            throw new Error("not a file");
        }
    } catch {
        throw new Error(
            `clear.ts must run from repo root (cwd=${process.cwd()}); pnpm-workspace.yaml not found`,
        );
    }
}

const ALWAYS_PATHS = [
    "dist",
    "results",
    "target",
    "benches/matmul/rust/bindgen/pkg-tmp",
    "apps/runner-web/.vite",
];

const ALL_EXTRA_PATHS = [
    ".tools",
    "node_modules",
    "apps/runner-node/node_modules",
    "apps/runner-web/node_modules",
    "packages/harness/node_modules",
    "packages/loaders/node_modules",
    "packages/reporter/node_modules",
    "packages/result-schema/node_modules",
];

async function removeAll(paths: readonly string[]): Promise<void> {
    for (const p of paths) {
        await rm(p, { recursive: true, force: true });
        console.log(`removed ${p}`);
    }
}

async function main(): Promise<void> {
    await assertRepoRoot();
    const all = process.argv.includes("--all");
    await removeAll(ALWAYS_PATHS);
    if (all) {
        await removeAll(ALL_EXTRA_PATHS);
    }
    console.log(all ? "clear:all done" : "clear done");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
