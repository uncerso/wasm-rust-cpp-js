import { run } from "./lib/exec.js";

async function main() {
    const out = "results/raw/_smoke";

    // Full S × all combos × node (existing breadth — regression coverage for non-matmul workloads).
    await run("tsx", ["scripts/run-matrix.ts", "--envs=node", "--sizes=S", "--mode=quick", `--out=${out}`]);

    // matmul × all combos × S × all browser envs (new sanity for long-lived session).
    await run("tsx", [
        "scripts/run-matrix.ts",
        "--envs=chromium,firefox",
        "--benchmarks=matmul",
        "--sizes=S",
        "--mode=quick",
        `--out=${out}`,
    ]);

    await run("tsx", ["scripts/report.ts", `--in=${out}`, "--out=results/summarized/_smoke"]);
    console.log("smoke OK");
}

main().catch((e) => {
    console.error("smoke FAILED:", e); process.exit(1);
});
