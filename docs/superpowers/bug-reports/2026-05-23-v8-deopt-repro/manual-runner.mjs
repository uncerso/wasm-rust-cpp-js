// Manual reproducer for the V8 JIT-deopt bug captured in
// docs/superpowers/bug-reports/2026-05-23-v8-deopt-switch-over-closure-const.md.
//
// This script directly drives the JS bundle outside the bench harness with the
// same call sequence eval mode uses (run(1) + 10x run(1000) + 30x reset+run(1000)).
//
// Result on Node v22.22.3 / V8 12.4 (2026-05-23):
//   This manual repro SUCCEEDS — the bug requires the harness/runner-node context.
//   That's a clue: the bug is sensitive to harness particulars, not just call sequence.
//
// Run with:
//   node docs/superpowers/bug-reports/2026-05-23-v8-deopt-repro/manual-runner.mjs
//
// To make it fail (i.e., reproduce the *harness-mediated* bug), use the runner-node
// invocation instead:
//   pnpm exec tsx apps/runner-node/src/main.ts \
//     --benchmark=hashmap_int --entry=hashmap_int_lookup \
//     --language=js --toolchain=idiomatic --profile=speed \
//     --size=S --out=/tmp/_debug --mode=eval

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", "..");

const moduleUrl = "file://" + resolve(repoRoot, "dist/hashmap_int/js-idiomatic-speed/module.js");
const fixturePath = resolve(repoRoot, "benches/hashmap_int/fixtures/s.bin");

const m = await import(moduleUrl);
const mod = m.default("hashmap_int_lookup");

const buf = new Uint8Array(await readFile(fixturePath));
mod.loadInput(buf);

console.log("first call:", mod.run(1));
for (let i = 0; i < 10; i++) mod.run(1000); // warmup
console.log("after warmup");

const EXPECTED = 2078117175396;
for (let i = 0; i < 30; i++) {
    mod.reset();
    const r = mod.run(1000);
    if (r.checksum !== EXPECTED) {
        console.log(`sample ${i} wrong:`, r);
        process.exit(1);
    }
}
console.log("DONE");
