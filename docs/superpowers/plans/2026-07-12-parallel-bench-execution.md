# parallel-bench-execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Speed up `bench:all` by using all cores where it does NOT corrupt measurements — parallel builds (always), node per-case startup elimination (always), and opt-in cross-env parallelism (default off).

**Architecture:** Three independent mechanisms. (A1) A bounded worker-pool (`scripts/lib/pool.ts`) runs build-units (bench × lang × toolchain × profile) concurrently in `build-all.ts`. (A2) The node branch of `run-matrix.ts` imports `runCase` and loops in-process instead of spawning one `tsx` subprocess per case; measurements stay sequential. (A3) A `--parallel-envs` flag runs node/chromium/firefox measurement streams concurrently; results carry an additive `env.parallel` flag so parallel numbers are never silently mixed with sequential guideline-grade numbers.

**Tech Stack:** TS (tsx/esbuild), `execa`, zod `BenchResultSchema`, selenium-webdriver (browser envs), vitest.

**Spec:** `docs/superpowers/specs/2026-07-12-parallel-bench-and-mandelbrot-design.md` (Slice A).

## Global Constraints

- **Slice A of the combined spec.** Default `bench:all` stays **sequential** (guideline-grade). `--parallel-envs` is opt-in.
- **Concurrency cap:** `os.cpus().length` (14 on the dev machine). Applies to the build pool.
- **Determinism (build):** parallel-built artifacts MUST be **bit-identical** to sequential-built ones (per-combo dist/attr dirs already isolate outputs; wasm-opt is deterministic per build-hygiene PR #12). This is a hard Wave-0 gate.
- **Measurement fidelity (non-negotiable):** perf-eval measurements stay **sequential within each env**. A2 removes process startup, NOT measurement serialization. A3's concurrency is opt-in and flagged. Never overlap the build phase with the measurement phase.
- **Schema change:** add `parallel: z.boolean().default(false)` to `EnvSchema` — **additive + optional**, so old `results/raw/` still parse. **Do NOT bump `SCHEMA_VERSION`** (no breaking change; verified against CLAUDE.md § BenchResult schema).
- **Measured premises (from spec, this machine, 14 cores):** build:all warm = 106s @ ≈0.85 core; node per-case tsx startup ≈ 0.27s × 477 ≈ 130s; contention under 3× concurrency: compute-bound +2.3%, memory-latency-bound +7–9%, call-bound ~0%.
- **TS:** 4-space indent, double quotes, semicolons, trailing comma (multiline), `curly: all`, `verbatimModuleSyntax` + strict. `_`-prefixed unused args tolerated only where eslint config allows.
- **Commits:** `--no-gpg-sign`. Push/PR are user actions.
- **Sandbox:** `pnpm build:all` / `bench` / `fixtures` / `smoke` / any `tsx` that binds the IPC pipe → `dangerouslyDisableSandbox: true`. `pnpm typecheck` / `test` / `lint:*` and `npx vitest run` → sandboxed OK. Read producer exit via `${pipestatus[1]}` (zsh), never a piped `$?`.
- **All-gates pre-flight:** `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke`.

---

## Execution Protocol

**Routing (hybrid inline/subagent).** Each task is tagged `[I]` (inline — this session) or `[S]` (subagent). All-`[I]` waves execute inline without re-asking. Subagent dispatches get the **full** gate set (`build:all` + typecheck + lint:all + test + smoke as applicable), never a subset.

| Task | Route | Why |
|---|---|---|
| 1 Wave-0 baseline + artifact-hash snapshot | `[I]` | measurement + snapshot; mechanical |
| 2 `pool.ts` + test | `[I]` | small standard primitive, self-contained test |
| 3 build refactor + pool **(DETERMINISM GATE)** | `[S]` | multi-file refactor; bit-identical reasoning |
| 4 node in-process loop **(PARITY GATE)** | `[S]` | measurement-fidelity risk (shared VM vs pristine) |
| 5 schema `parallel` + threading | `[I]` | additive, mechanical (2 call-sites) |
| 6 `--parallel-envs` + concurrent env streams | `[S]` | `run-matrix` control-flow restructure |
| 7 reporter parallel badge | `[I]` | presenter-only; pattern already exists |
| 8 guidelines finding + README | `[I]` | prose |
| 9 all-gates + close | `[I]` | run + user handoff (heavy bench) |

**Static break-points (recommend `/finish-session`, user decides):**
- After **Task 3** — build-parallel landed + determinism gate green. Natural Wave-0 boundary.
- After **Task 4** — node parity decided. If parity FAILS (>~3% drift): STOP, surface A2b (prebuilt-JS subprocess) to the user with the measured drift — do NOT balloon this task into the A2b build change silently.
- After **Task 6** — cross-env works; run a small parallel sanity check.
- After **Task 9** — all gates green.

**Per-task break-check:** after each task — retry budget ≤2 at the same approach; if a spec risk materializes (determinism drift, parity drift), STOP and surface to the user with alternatives (do not silently re-scope). Commit per task.

---

## File Structure

```
scripts/
├── lib/pool.ts                 # Task 2 (new) — bounded concurrency helper
├── lib/pool.test.ts            # Task 2 (new) — via `npx vitest run` (not in pnpm test)
├── build-all.ts                # Task 3 — pool orchestration
├── build-js.ts                 # Task 3 — export collectJsUnits()
├── build-rust.ts               # Task 3 — export collectRustUnits()
├── build-cpp.ts                # Task 3 — export collectCppUnits()
└── run-matrix.ts               # Task 4 (node in-process) + Task 6 (--parallel-envs)

apps/
├── runner-node/src/run-case.ts # Task 5 — +parallel param
└── runner-web/src/driver.ts    # Task 5 (+parallel in CaseInput/patch) + Task 6 (uses port; unchanged API)

packages/
├── result-schema/src/schema.ts # Task 5 — EnvSchema +parallel
├── result-schema/tests/*        # Task 5 — default + explicit coverage
├── reporter/src/perf-view-model.ts  # Task 7 — +parallel field
├── reporter/src/render-perf.ts       # Task 7 — badge + CSS + legend
└── reporter/tests/*                  # Task 7 — badge render

docs/guidelines.md               # Task 8 — contention finding
README.md                        # Task 8 — --parallel-envs
```

Build-unit collectors keep each `build-*.ts` runnable standalone (their `main()` loops the collected units sequentially); `build-all.ts` collects across all three and pools them.

---

## Task 1: Wave-0 baseline + artifact-hash snapshot `[I]`

**Files:** none (measurement; writes to `$TMPDIR`).

**Interfaces:**
- Produces: recorded baseline wall-times (build:all, node-phase) + `$TMPDIR/dist-hashes-baseline.txt` (sequential-build artifact hashes) consumed by Task 3's determinism gate.

- [ ] **Step 1: Clean sequential build + time it**

Run (dangerouslyDisableSandbox): `pnpm clear && /usr/bin/time -p pnpm build:all`. Record `real`/`user`/`sys`. Expected order: ~106s warm / larger clean. This is the **baseline** the parallel build is compared against for speed.

- [ ] **Step 2: Snapshot artifact hashes (determinism baseline)**

Run: hash every built artifact deterministically —
```bash
find dist -type f \( -name '*.wasm' -o -name 'module.js' -o -name 'glue.mjs' -o -name 'glue.js' \) | sort | xargs shasum -a 256 > "$TMPDIR/dist-hashes-baseline.txt"
wc -l "$TMPDIR/dist-hashes-baseline.txt"
```
Expected: one line per artifact (all built binaries). Keep this file for Task 3.

- [ ] **Step 3: Time the node phase (baseline)**

Run (dangerouslyDisableSandbox): `/usr/bin/time -p pnpm bench --mode=eval --sizes=S,M,L --envs=node --out=results/raw/_baseline_node`. Record `real`. This is the node-phase baseline (startup + measurement). Delete the output: `rm -rf results/raw/_baseline_node`.

- [ ] **Step 4: Record baseline in a scratch note** (not committed) — write the three numbers to the session notes / this task's checkbox comment for the closing comparison in Task 9. No commit (measurement only).

**⏸ Note:** no commit; this task produces reference numbers + the hash-baseline file only.

---

## Task 2: Bounded concurrency pool `scripts/lib/pool.ts` `[I]`

**Files:**
- Create: `scripts/lib/pool.ts`
- Create: `scripts/lib/pool.test.ts`

**Interfaces:**
- Produces: `runPool<T>(tasks: ReadonlyArray<() => Promise<T>>, limit: number): Promise<T[]>` — runs ≤`limit` task-thunks concurrently, preserves result order, rejects on first task rejection. Consumed by `build-all.ts` (Task 3).

- [ ] **Step 1: Write the failing test** `scripts/lib/pool.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { runPool } from "./pool.js";

describe("runPool", () => {
    it("caps concurrency at limit", async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const make = () => async (): Promise<number> => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight--;
            return 1;
        };
        const tasks = Array.from({ length: 20 }, make);
        await runPool(tasks, 4);
        expect(maxInFlight).toBeLessThanOrEqual(4);
        expect(maxInFlight).toBeGreaterThan(1);
    });

    it("preserves result order regardless of finish order", async () => {
        const tasks = [3, 1, 2].map((n) => async (): Promise<number> => {
            await new Promise((r) => setTimeout(r, n * 5));
            return n;
        });
        expect(await runPool(tasks, 3)).toEqual([3, 1, 2]);
    });

    it("rejects on the first task error", async () => {
        const tasks = [
            async (): Promise<number> => 1,
            async (): Promise<number> => { throw new Error("boom"); },
            async (): Promise<number> => 3,
        ];
        await expect(runPool(tasks, 2)).rejects.toThrow("boom");
    });

    it("returns [] for empty input", async () => {
        expect(await runPool([], 4)).toEqual([]);
    });

    it("throws on limit < 1", async () => {
        await expect(runPool([async (): Promise<number> => 1], 0)).rejects.toThrow(/limit/);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (sandboxed OK): `npx vitest run scripts/lib/pool.test.ts`
Expected: FAIL — `runPool` not found / module missing.

- [ ] **Step 3: Write `scripts/lib/pool.ts`**

```ts
/**
 * Run `tasks` with at most `limit` in flight at once. Preserves result order
 * (result[i] is tasks[i]'s value). Rejects with the FIRST task rejection — build
 * failures must halt the run, not be swallowed. In-flight tasks are allowed to
 * settle; no new task starts once an error is seen.
 */
export async function runPool<T>(
    tasks: ReadonlyArray<() => Promise<T>>,
    limit: number,
): Promise<T[]> {
    if (limit < 1) {
        throw new Error(`runPool: limit must be >= 1, got ${limit}`);
    }
    const results = Array.from({ length: tasks.length }) as T[];
    let next = 0;
    let firstError: unknown;
    let errored = false;

    async function worker(): Promise<void> {
        while (true) {
            const i = next++;
            if (i >= tasks.length || errored) {
                return;
            }
            try {
                results[i] = await tasks[i]!();
            } catch (e) {
                if (!errored) {
                    errored = true;
                    firstError = e;
                }
                return;
            }
        }
    }

    const workers = Math.min(limit, tasks.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    if (errored) {
        throw firstError;
    }
    return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (sandboxed OK): `npx vitest run scripts/lib/pool.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pool.ts scripts/lib/pool.test.ts
git commit --no-gpg-sign -m "feat(scripts): bounded concurrency pool helper"
```

---

## Task 3: Parallelize builds via the pool (DETERMINISM GATE) `[S]`

**Files:**
- Modify: `scripts/build-js.ts` (export `collectJsUnits`)
- Modify: `scripts/build-rust.ts` (export `collectRustUnits`)
- Modify: `scripts/build-cpp.ts` (export `collectCppUnits`)
- Modify: `scripts/build-all.ts` (pool orchestration)

**Interfaces:**
- Consumes: `runPool` (Task 2).
- Produces: `collectJsUnits(benches: string[]): Promise<Array<() => Promise<void>>>` (and `collectRustUnits`, `collectCppUnits`) — each returns per-combo build thunks. `build-all.ts` pools them.

- [ ] **Step 1: `build-js.ts` — export `collectJsUnits`, keep `main()` sequential**

Add after `loadSpec` (the `buildOne`/`loadSpec` fns stay unchanged):

```ts
export async function collectJsUnits(benches: string[]): Promise<Array<() => Promise<void>>> {
    const units: Array<() => Promise<void>> = [];
    for (const benchId of benches) {
        const spec = await loadSpec(benchId);
        const combos = enumerateBinaries(spec).filter(
            (b) => b.language === "js" && b.profile === "speed",
        );
        for (const c of combos) {
            units.push(() => buildOne(c));
        }
    }
    return units;
}
```

Replace the body of `main()` with:

```ts
async function main() {
    const benches = process.argv.slice(2);
    if (benches.length === 0) {
        throw new Error("usage: tsx scripts/build-js.ts <bench-id> [<bench-id>...]");
    }
    for (const unit of await collectJsUnits(benches)) {
        await unit();
    }
}
```

- [ ] **Step 2: `build-rust.ts` — export `collectRustUnits`, keep `main()` sequential**

Add after `loadSpec`:

```ts
export async function collectRustUnits(benches: string[]): Promise<Array<() => Promise<void>>> {
    const units: Array<() => Promise<void>> = [];
    for (const benchId of benches) {
        const spec = await loadSpec(benchId);
        const combos = enumerateBinaries(spec).filter((b) => b.language === "rust");
        for (const c of combos) {
            if (c.toolchain === "raw") {
                units.push(() => buildRaw(c));
            } else if (c.toolchain === "bindgen") {
                units.push(() => buildBindgen(c));
            }
        }
    }
    return units;
}
```

Replace `main()` body:

```ts
async function main() {
    const benches = process.argv.slice(2);
    if (benches.length === 0) {
        throw new Error("usage: tsx scripts/build-rust.ts <bench-id> [<bench-id>...]");
    }
    for (const unit of await collectRustUnits(benches)) {
        await unit();
    }
}
```

**NOTE (do not "fix"):** rust-raw units serialize on cargo's workspace `target/` build-lock when pooled — cargo blocks gracefully (safe, no corruption). This is expected and accepted; do NOT try to bypass the lock.

- [ ] **Step 3: `build-cpp.ts` — export `collectCppUnits`, keep `main()` sequential**

Add after `loadSpec`:

```ts
export async function collectCppUnits(benches: string[]): Promise<Array<() => Promise<void>>> {
    const units: Array<() => Promise<void>> = [];
    for (const benchId of benches) {
        const spec = await loadSpec(benchId);
        const combos = enumerateBinaries(spec).filter((b) => b.language === "cpp");
        for (const c of combos) {
            if (c.toolchain === "emscripten") {
                units.push(() => buildEmscripten(c));
            } else if (c.toolchain === "wasi-sdk") {
                units.push(() => buildWasiSdk(c));
            }
        }
    }
    return units;
}
```

Replace `main()` body:

```ts
async function main() {
    const benches = process.argv.slice(2);
    if (benches.length === 0) {
        throw new Error("usage: tsx scripts/build-cpp.ts <bench-id> [<bench-id>...]");
    }
    for (const unit of await collectCppUnits(benches)) {
        await unit();
    }
}
```

- [ ] **Step 4: `build-all.ts` — pool fixtures + all build units**

Rewrite `main()` (keep `fileExists`, `listBenches`, `copyFixtures` helpers):

```ts
import { mkdir, copyFile, readdir, access } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import { run } from "./lib/exec.js";
import { runPool } from "./lib/pool.js";
import { collectJsUnits } from "./build-js.js";
import { collectRustUnits } from "./build-rust.js";
import { collectCppUnits } from "./build-cpp.js";

// ... fileExists / listBenches / copyFixtures unchanged ...

async function main() {
    const benches = await listBenches();
    if (benches.length === 0) {
        throw new Error("no benches discovered under benches/*/spec.json");
    }
    const limit = cpus().length;
    console.log(`=== discovered benches: ${benches.join(", ")} (pool limit ${limit}) ===`);

    console.log("=== generating fixtures (parallel) ===");
    const fixtureUnits: Array<() => Promise<void>> = [];
    for (const id of benches) {
        const gen = `benches/${id}/fixtures/generate.ts`;
        if (await fileExists(gen)) {
            fixtureUnits.push(() => run("tsx", [gen]));
        }
    }
    await runPool(fixtureUnits, limit);

    console.log("=== copying fixtures + spec into dist/ ===");
    for (const id of benches) {
        await mkdir(`dist/${id}`, { recursive: true });
        await copyFile(`benches/${id}/spec.json`, `dist/${id}/spec.json`);
        await copyFixtures(id);
    }

    console.log("=== building all toolchains (parallel) ===");
    const units = [
        ...await collectJsUnits(benches),
        ...await collectRustUnits(benches),
        ...await collectCppUnits(benches),
    ];
    await runPool(units, limit);
}

main().catch((e) => {
    console.error(e); process.exit(1);
});
```

Remove the now-unused `run("tsx", ["scripts/build-js.ts", ...])` sequential invocations (replaced by in-process `collect*Units`).

- [ ] **Step 5: Typecheck**

Run (sandboxed OK): `pnpm typecheck`. Expected: clean. (If `scripts/` is not covered by typecheck — tech-debt `pnpm-typecheck-skips-scripts` — additionally run `npx tsc --noEmit` against the scripts tsconfig if one exists, or eyeball; note the gap.)

- [ ] **Step 6: Parallel build + DETERMINISM GATE**

Run (dangerouslyDisableSandbox): `pnpm clear && pnpm build:all`. Then re-hash and diff against Task 1's baseline:
```bash
find dist -type f \( -name '*.wasm' -o -name 'module.js' -o -name 'glue.mjs' -o -name 'glue.js' \) | sort | xargs shasum -a 256 > "$TMPDIR/dist-hashes-parallel.txt"
diff "$TMPDIR/dist-hashes-baseline.txt" "$TMPDIR/dist-hashes-parallel.txt" && echo "DETERMINISM OK" || echo "DETERMINISM FAIL"
```
Expected: `DETERMINISM OK` (bit-identical). Also record the new `real` wall-time (compare to Task 1 baseline — expect a marked drop). **If DETERMINISM FAIL:** a build race exists (shared-dir write or nondeterministic tool) — STOP, identify the racing units, and surface to the user (do NOT ship nondeterministic builds). Retry budget ≤2.

- [ ] **Step 7: Lint + commit**

Run (sandboxed OK): `pnpm lint:ts`. Expected: clean.

```bash
git add scripts/build-all.ts scripts/build-js.ts scripts/build-rust.ts scripts/build-cpp.ts
git commit --no-gpg-sign -m "feat(scripts): parallelize build:all via worker pool (determinism-gated)"
```

**⏸ BREAK-POINT (Wave-0 gate):** build-parallel landed + determinism green + speedup recorded. Recommend `/finish-session` (user decides).

---

## Task 4: node in-process loop (A2a) + PARITY GATE `[S]`

**Files:**
- Modify: `scripts/run-matrix.ts` (node branch only)

**Interfaces:**
- Consumes: `runCase` from `apps/runner-node/src/run-case.js`; `isCorrectnessFailure` (already imported).
- Produces: node results identical in shape to the subprocess path; measurements sequential in one process.

- [ ] **Step 1: Import `runCase` + add the eval/quick config**

At the top of `run-matrix.ts`, add:
```ts
import { runCase } from "../apps/runner-node/src/run-case.js";
```

Inside `main()`, before the node loop, define the measure config (copied verbatim from `apps/runner-node/src/main.ts` — the single source of these values):
```ts
    const nodeConfig = args.mode === "quick"
        ? { warmupIterations: 3, innerIterations: 1, minSamples: 5, maxSamples: 20, semThreshold: 0.10, wallBudgetMs: 200 }
        : { warmupIterations: 10, innerIterations: 1, minSamples: 30, maxSamples: 200, semThreshold: 0.03, wallBudgetMs: 1000 };
```

- [ ] **Step 2: Replace the node subprocess loop with an in-process loop**

Replace the current node block (the `if (args.envs.includes("node")) { for (const spec ...) { ... await run("tsx", ["apps/runner-node/src/main.ts", ...common]) ... } }`) with:

```ts
        if (args.envs.includes("node")) {
            for (const spec of filteredSpecs) {
                for (const c of enumerateBinaries(spec)) {
                    if (c.language === "js" && c.profile !== "speed") {
                        continue;
                    }
                    for (const entry of spec.entries) {
                        for (const sz of args.sizes) {
                            const caseId = `${entry}__${c.language}-${c.toolchain}-${c.profile}__${sz}`;
                            try {
                                const r = await runCase({
                                    benchmarkId: c.sourceBench,
                                    entry,
                                    language: c.language,
                                    toolchain: c.toolchain,
                                    profile: c.profile,
                                    inputSize: sz,
                                    measureConfig: nodeConfig,
                                    parallel: false, // set true only under --parallel-envs (Task 6)
                                });
                                const fname = `${entry}__${c.language}-${c.toolchain}-${c.profile}__${sz}__node.json`;
                                await writeFile(join(args.out, fname), JSON.stringify(r, null, 2));
                                console.log(`wrote ${join(args.out, fname)}`);
                                if (isCorrectnessFailure(r)) {
                                    console.error(`[fail] node ${caseId}: correctness fail (validated=${String(r.quality.validated)})`);
                                    accumulateFailures.push({ env: "node", caseId, error: "correctness fail (validated=false)" });
                                    ranOK = false;
                                }
                            } catch (e) {
                                const msg = e instanceof Error ? e.message : String(e);
                                console.error(`[fail] node ${caseId}: ${msg}`);
                                accumulateFailures.push({ env: "node", caseId, error: msg });
                                ranOK = false;
                            }
                        }
                    }
                }
            }
        }
```

(`parallel: false` requires the Task 5 schema/param; if executing Task 4 before Task 5, temporarily omit the `parallel` key — `runCase` treats it as optional — and add it in Task 5. Prefer executing Task 5 first if convenient.)

`apps/runner-node/src/main.ts` stays as the standalone single-case entry (unchanged) for debugging.

- [ ] **Step 3: Typecheck + build (artifacts already present)**

Run (sandboxed OK): `pnpm typecheck`. Expected: clean (if `parallel` key added, needs Task 5 first — see note).

- [ ] **Step 4: PARITY GATE — in-process vs subprocess means**

Run (dangerouslyDisableSandbox) a representative node set BOTH ways and compare `warmMedian`:
- **Subprocess (baseline):** for each of `{matmul js-idiomatic L, matmul rust-raw L, hashmap_int hashmap_int_lookup rust-raw L, sorted_map_int sorted_map_int_range rust-raw L}` run `tsx apps/runner-node/src/main.ts ...` (the old path, still valid) into `$TMPDIR/parity-sub/`.
- **In-process (new):** run `pnpm bench --mode=eval --sizes=L --envs=node --benchmarks=matmul,hashmap_int,sorted_map_int --out=$TMPDIR/parity-inproc` (dangerouslyDisableSandbox).
- Compare `timingsMs.warmMedian` per case: `|inproc - sub| / sub`.

Expected: max deviation ≤ ~3% → **keep A2a**. Record the deltas. **If any case > ~3%:** the shared VM is biasing node measurements. STOP and surface to the user: report the deltas + the A2b fallback (build `runner-node` to `dist/` JS, spawn `node dist/…main.js` per case — pristine VM, ~0.08s startup). Do NOT implement A2b silently. Retry budget ≤2 (e.g., add `restartEvery` for node to bound VM accumulation, then re-measure).

- [ ] **Step 5: Commit**

```bash
git add scripts/run-matrix.ts
git commit --no-gpg-sign -m "perf(bench): node in-process loop (drop per-case tsx startup)"
```

**⏸ BREAK-POINT (parity gate):** A2a kept (or A2b surfaced to user). Recommend `/finish-session` (user decides).

---

## Task 5: Schema `parallel` field + threading `[I]`

**Files:**
- Modify: `packages/result-schema/src/schema.ts` (`EnvSchema`)
- Modify: `apps/runner-node/src/run-case.ts` (param + env)
- Modify: `apps/runner-web/src/driver.ts` (CaseInput + patch)
- Modify: `packages/result-schema/tests/schema.test.ts` (coverage)

**Interfaces:**
- Produces: `BenchResult.env.parallel: boolean` (default false). Consumers: reporter (Task 7); set true by `--parallel-envs` (Task 6).

- [ ] **Step 1: Add the field to `EnvSchema`**

In `packages/result-schema/src/schema.ts`, extend `EnvSchema`:
```ts
export const EnvSchema = z.object({
    kind: z.enum(["browser", "node"]),
    name: z.string(),
    version: z.string(),
    engine: z.string(),
    parallel: z.boolean().default(false),
});
```

- [ ] **Step 2: Thread through node (`run-case.ts`)**

Add `parallel?: boolean;` to `RunCaseInput`. In the result object, change the `env` line:
```ts
        env: { kind: "node", name: "node", version: process.version, engine: "V8", parallel: input.parallel ?? false },
```

- [ ] **Step 3: Thread through browser (`driver.ts`)**

Add `parallel?: boolean;` to `CaseInput`. In the machine-patch step (the `BenchResultSchema.parse({ ...result, machine: {...} })` block), also patch env:
```ts
        const patched = BenchResultSchema.parse({
            ...result,
            env: { ...result.env, parallel: input.parallel ?? false },
            machine: {
                os: `${process.platform} ${process.arch}`,
                cpu: machineCpu,
                memoryGb: Math.max(1, Math.round(totalmem() / (1024 ** 3))),
            },
        });
```
(The worker's raw result omits `parallel`; `.default(false)` fills it on the first `BenchResultSchema.parse(raw)`, then this patch sets the real value.)

- [ ] **Step 4: Add schema test**

In `packages/result-schema/tests/schema.test.ts`, add (adapt the existing valid-result fixture in that file — reuse its helper if present):
```ts
it("env.parallel defaults to false when omitted", () => {
    const base = validBenchResult(); // existing helper in this test file
    delete (base.env as { parallel?: boolean }).parallel;
    const parsed = BenchResultSchema.parse(base);
    expect(parsed.env.parallel).toBe(false);
});

it("env.parallel round-trips when true", () => {
    const base = validBenchResult();
    base.env.parallel = true;
    expect(BenchResultSchema.parse(base).env.parallel).toBe(true);
});
```
(If no `validBenchResult()` helper exists, construct the fixture inline from the existing test's example object.)

- [ ] **Step 5: Typecheck + test**

Run (sandboxed OK): `pnpm typecheck && pnpm --filter @bench/result-schema test`. Expected: clean + new tests pass. Old `results/raw/` still parse (additive optional field).

- [ ] **Step 6: Commit**

```bash
git add packages/result-schema/src/schema.ts packages/result-schema/tests/ apps/runner-node/src/run-case.ts apps/runner-web/src/driver.ts
git commit --no-gpg-sign -m "feat(schema): additive env.parallel flag (no version bump)"
```

---

## Task 6: `--parallel-envs` flag + concurrent env streams `[S]`

**Files:**
- Modify: `scripts/run-matrix.ts` (CLI + control flow)

**Interfaces:**
- Consumes: Task 5's `parallel` param on `runCase` + `CaseInput`.
- Produces: `--parallel-envs` CLI flag; when set, node + browser env streams run concurrently and every result has `env.parallel = true`.

- [ ] **Step 1: Parse the flag**

Add `parallelEnvs: boolean;` to `CliArgs`. In `parseArgs`, add:
```ts
    const parallelEnvs = argv.includes("--parallel-envs");
```
and include `parallelEnvs` in the returned object.

- [ ] **Step 2: Extract the node stream into a function**

Wrap the node block (from Task 4) in `async function runNodeStream(): Promise<void> { ... }`, and pass `parallel: args.parallelEnvs` into the `runCase({ ... })` call (replacing the hardcoded `parallel: false`).

- [ ] **Step 3: Extract each browser env into a function**

Wrap the per-env browser block (the body of the existing `for (const env of args.envs) { if (env === "node") continue; ... }`) into `async function runBrowserStream(env: Env): Promise<void> { ... }`. Inside, when building each `CaseInput` (the `cases.push({...})`), add `parallel: args.parallelEnvs`.

- [ ] **Step 4: Dispatch sequential vs parallel**

Replace the top-level env execution (previously: node block, then the `for env` browser loop) with:
```ts
        const browserEnvs = args.envs.filter((e): e is Exclude<Env, "node"> => e !== "node");
        if (args.parallelEnvs) {
            console.log("[run-matrix] --parallel-envs: node + browsers concurrently (results flagged parallel=true)");
            const streams: Array<Promise<void>> = [];
            if (args.envs.includes("node")) {
                streams.push(runNodeStream());
            }
            for (const env of browserEnvs) {
                streams.push(runBrowserStream(env));
            }
            await Promise.all(streams);
        } else {
            if (args.envs.includes("node")) {
                await runNodeStream();
            }
            for (const env of browserEnvs) {
                await runBrowserStream(env);
            }
        }
```
(`accumulateFailures.push` from concurrent streams is safe — JS is single-threaded, no lock needed. The shared vite `preview` server already serves both browsers.)

- [ ] **Step 5: Typecheck + lint**

Run (sandboxed OK): `pnpm typecheck && pnpm lint:ts`. Expected: clean.

- [ ] **Step 6: Sanity — sequential default unchanged + parallel flag works**

Run (dangerouslyDisableSandbox):
- Default (no flag): `pnpm bench --mode=quick --sizes=S --envs=node --benchmarks=matmul --out=$TMPDIR/seq` → results have `env.parallel === false`. Verify: `node -e "const fs=require('fs');for(const f of fs.readdirSync(process.argv[1])){const r=JSON.parse(fs.readFileSync(process.argv[1]+'/'+f));if(r.env.parallel!==false)throw new Error('expected false')}" $TMPDIR/seq`.
- Parallel: `pnpm bench --mode=quick --sizes=S --envs=node,chromium,firefox --benchmarks=matmul --parallel-envs --out=$TMPDIR/par` → results have `env.parallel === true`; run completes; no correctness fails. (quick/S keeps it fast.)

- [ ] **Step 7: Commit**

```bash
git add scripts/run-matrix.ts
git commit --no-gpg-sign -m "feat(bench): opt-in --parallel-envs (concurrent env streams, flagged)"
```

**⏸ BREAK-POINT:** cross-env parallelism works; results flagged. Recommend `/finish-session` (user decides).

---

## Task 7: Reporter parallel badge `[I]`

**Files:**
- Modify: `packages/reporter/src/perf-view-model.ts`
- Modify: `packages/reporter/src/render-perf.ts`
- Modify: `packages/reporter/tests/*` (the perf-render test)

**Interfaces:**
- Consumes: `BenchResult.env.parallel`. Produces: a `∥` badge on perf-detail rows measured under `--parallel-envs` + a legend entry.

- [ ] **Step 1: Add `parallel` to the perf-detail row model**

In `perf-view-model.ts`, add to the `PerfDetailRow` interface (near `meanImprecise`/`subResolution`, ~line 23):
```ts
    parallel: boolean;
```
and populate it where the row is built (near `meanImprecise: r.stats.meanImprecise`, ~line 127):
```ts
        parallel: r.env.parallel,
```
(`r` is the source `BenchResult`; confirm the variable name at that site.)

- [ ] **Step 2: Render the badge + CSS + legend (`render-perf.ts`)**

Add a CSS rule near the `.subres` / `.pl-badge` rules (~line 87):
```css
.par{font:600 8px ui-monospace,monospace;color:#5b6b8a;border:1px solid #b9c4dd;border-radius:3px;padding:0 3px;margin-left:3px}
```
In the row renderer (near `const badge = row.subResolution ? ... : "";`, ~line 204), add:
```ts
    const parBadge = row.parallel ? '<span class="par">&#8741;</span>' : "";
```
and append `${parBadge}` to the impl cell in the returned `<tr>` (after the existing `${badge}` in the first `<td>`).
Add a legend entry near the `<res` legend line (~line 234):
```ts
  <span class="pl-key"><span class="par">&#8741;</span>measured under --parallel-envs (host concurrency; ±~2–9% bias)</span>
```

- [ ] **Step 3: Update the reporter test**

In the perf-render test, add a case: a `BenchResult` with `env.parallel = true` renders `class="par"` in its row; with `false`, it does not. Follow the existing subResolution-badge test pattern in that file.

- [ ] **Step 4: Typecheck + test + build a report**

Run (sandboxed OK): `pnpm typecheck && pnpm --filter @bench/reporter test`. Expected: clean + tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/reporter/src/perf-view-model.ts packages/reporter/src/render-perf.ts packages/reporter/tests/
git commit --no-gpg-sign -m "feat(reporter): parallel-envs badge on perf rows"
```

---

## Task 8: Guidelines contention finding + README `[I]`

**Files:**
- Modify: `docs/guidelines.md`
- Modify: `README.md`

- [ ] **Step 1: Add the contention finding to `docs/guidelines.md`**

Consult the file header for the claim format (B-1). Add a claim under the measurement/methodology section:
> **Host concurrency biases wasm perf measurement, workload-dependent.** Running measurement streams concurrently on one host inflates per-op time: compute/bandwidth-bound ~+2% (matmul L), memory-latency-bound ~+7–9% (sorted-map range L, cache-sensitive), call-overhead-bound ~0% (14-core Apple Silicon, 3× concurrency). The inflation is ~uniform across simultaneous streams but varies with overlap over a run. **Take guideline-grade numbers sequentially;** `--parallel-envs` is for fast iteration only, and its results are flagged.

- [ ] **Step 2: Document `--parallel-envs` in `README.md`**

In § Запуск бенчмарков, add a line for the flag (match the section's existing style/language):
> `--parallel-envs` — гонять node/chromium/firefox параллельно (быстрее, но host-контенция даёт ~2–9% bias на memory-bound; результаты помечаются `env.parallel`, в отчёте — бэйдж `∥`). По умолчанию **выключено**; canonical `bench:all` — sequential.

- [ ] **Step 3: Commit**

```bash
git add docs/guidelines.md README.md
git commit --no-gpg-sign -m "docs: host-concurrency contention finding + --parallel-envs"
```

---

## Task 9: All-gates + close `[I]`

**Files:** none (verification + handoff).

- [ ] **Step 1: All-gates pre-flight**

Run: `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke` (build:all + smoke with `dangerouslyDisableSandbox: true`; typecheck/lint/test sandboxed). Read producer status via `${pipestatus[1]}` (zsh). Also run the pool test: `npx vitest run scripts/lib/pool.test.ts`. Expected: all green.

- [ ] **Step 2: Speedup summary**

Compare to Task 1 baseline: record build:all wall (parallel) vs baseline (expect marked drop) + node-phase wall (in-process vs baseline). Put the before/after numbers in the PR body.

- [ ] **Step 3: Heavy re-bench sanity (USER ACTION for the full run)**

`bench:all` is heavy + machine-quiet. Hand off: **user** runs `pnpm bench:all` (sequential default) to confirm end-to-end + regenerate `results/`. Agent may run a scoped quick sanity earlier (Task 6 Step 6). NOTE: adding `env.parallel` is additive — old raw results still parse; a full re-bench is NOT forced by this slice.

- [ ] **Step 4: Roadmap update**

In `docs/roadmap.md`, remove `parallel-bench-execution` from § TBD (delete the item; git log preserves history). If the parity gate chose A2b or deferred anything, capture the residual as a new tech-debt/roadmap item.

- [ ] **Step 5: Commit + PR prep**

```bash
git add docs/roadmap.md
git commit --no-gpg-sign -m "docs(roadmap): close parallel-bench-execution"
```

Hand off to user: `git push -u origin feature/phase-1.2-parallel-bench` + GitHub compare link. Recommend `/finish-session`. After merge, Slice B (`feature/phase-1.2-mandelbrot`) forks from master.

**⏸ BREAK-POINT:** gates green. Recommend `/finish-session` (user decides).

---

## Self-Review (author)

- **Spec coverage:** A1 build-parallel (Tasks 2–3), A2 node startup (Task 4 + parity gate), A3 cross-env opt-in (Tasks 5–6), schema additive flag (Task 5), reporter badge (Task 7), contention→guidelines (Task 8), Wave-0 gates (Task 1 baseline, Task 3 determinism, Task 4 parity). All spec § Slice A items mapped. Out-of-scope items (pipelining, CPU-pinning, cargo-lock bypass) explicitly NOT tasked — consistent with spec § Out of scope.
- **Placeholder scan:** no TBD/TODO. Task 4's `parallel` key ordering vs Task 5 is called out with a concrete resolution (execute Task 5 first, or omit optional key). Guidelines/README exact prose provided.
- **Type consistency:** `runPool<T>(tasks, limit)` signature consistent (Task 2 def ↔ Task 3 use). `collectJsUnits`/`collectRustUnits`/`collectCppUnits` return `Array<() => Promise<void>>` consistently. `parallel?: boolean` on `RunCaseInput` + `CaseInput`; `env.parallel: z.boolean().default(false)` in schema; `PerfDetailRow.parallel: boolean` in reporter. `--parallel-envs` → `args.parallelEnvs` consistent.
- **Risk surfacing:** determinism-fail (Task 3) and parity-fail (Task 4) both STOP + surface to user rather than auto-rescope — matches CLAUDE.md surface-planned-risks convention.
