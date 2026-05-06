import { run } from "./lib/exec.js";

async function main() {
    const out = "results/raw/_smoke";
    await run("tsx", ["scripts/run-matrix.ts", "--envs=node", "--sizes=S", "--mode=quick", `--out=${out}`]);
    await run("tsx", ["scripts/report.ts", `--in=${out}`, "--out=results/summarized/_smoke"]);
    console.log("smoke OK");
}

main().catch((e) => {
    console.error("smoke FAILED:", e); process.exit(1);
});
