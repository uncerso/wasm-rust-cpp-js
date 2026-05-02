import { run } from "./lib/exec.js";

async function main() {
  console.log("=== generating fixtures ===");
  await run("tsx", ["benches/matmul/fixtures/generate.ts"]);

  console.log("=== building JS ===");
  await run("tsx", ["scripts/build-js.ts"]);

  console.log("=== building Rust ===");
  await run("tsx", ["scripts/build-rust.ts"]);

  console.log("=== building C++ ===");
  await run("tsx", ["scripts/build-cpp.ts"]);
}

main().catch((e) => { console.error(e); process.exit(1); });
