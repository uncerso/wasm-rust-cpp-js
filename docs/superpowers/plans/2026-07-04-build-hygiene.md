# build-hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make wasm artifacts reproducible + PATH-independent by calling `wasm-opt` explicitly (all profiles, Option B) and assembling a controlled PATH per build; fold in two tech-debt items.

**Architecture:** Extract one `optimizeWasm()` helper used by both the rust and cpp orchestrators. cpp `build-wasi-sdk.sh` scripts become link-only; `build-cpp.ts` runs the explicit wasm-opt with a minimal PATH so the `-flto` driver can't auto-run its own. Each toolchain build gets a PATH assembled from only the dirs it needs. Full size+perf re-baseline follows.

**Tech Stack:** TypeScript (tsx orchestrators, ESM), bash build scripts, wasi-sdk-25 clang, binaryen-129 `wasm-opt`, rust (cargo + wasm-pack), vitest.

## Global Constraints

- Every `wasm-opt` invocation MUST include `--enable-bulk-memory --enable-nontrapping-float-to-int` (else strip'd wasm fails validation — measured; CLAUDE.md rule).
- `wasm-opt` binary = pinned binaryen-129 via `wasmOptPath()` (`.tools/bin/wasm-opt`); never a bare `wasm-opt`.
- TS: 4-space indent, double quotes, semicolons, trailing comma (multiline), `curly: all`, `verbatimModuleSyntax`, strict. Enforced by ESLint flat config.
- Never edit auto-generated `**/glue.mjs` / `**/glue.js`.
- Cargo workspace: read rust artifacts from workspace-root `target/`, not per-crate.
- `pnpm build:all` / `bench` / `smoke` / `tsx` bind a Unix socket → run with `dangerouslyDisableSandbox: true`. Pure `typecheck` / `test` / `lint:*` run in the sandbox.
- Agent commits use `git commit --no-gpg-sign`. Push + PR are user actions.
- `SCHEMA_VERSION` is NOT changed (postprocess is a data value, not a schema change).

---

### Task 1: W0 baseline gate + size snapshot

**Files:**
- Create: `docs/superpowers/plans/.build-hygiene-baseline.txt` (scratch; deleted at close — NOT committed)

**Interfaces:**
- Produces: a recorded pre-change size table for the close-phase delta.

- [ ] **Step 1: Confirm green gates on the branch**

Run (sandbox OK): `pnpm typecheck && pnpm lint:all && pnpm test`
Expected: all pass (no code changed yet). If red, STOP — the branch base is dirty.

- [ ] **Step 2: Build all + snapshot current wasm sizes**

Run (`dangerouslyDisableSandbox`): `pnpm build:all`
Then capture the current production wasm sizes for the toolchains this plan changes:

```bash
for d in dist/*/rust-raw-speed dist/*/rust-bindgen-speed dist/*/cpp-wasi-sdk-speed dist/*/cpp-wasi-sdk-size; do
  [ -f "$d/module.wasm" ] && echo "$d $(wc -c < "$d/module.wasm")B"
done | sort > "$TMPDIR/build-hygiene-baseline.txt"
cat "$TMPDIR/build-hygiene-baseline.txt"
```
Expected: a sorted list of `<dir> <bytes>B` lines. Keep this file for Task 7's delta. Do NOT commit it.

- [ ] **Step 3: No commit** — verification/capture only.

---

### Task 2: `optimizeWasm` helper + rust adoption (speed + size) + rust PATH

**Files:**
- Create: `scripts/lib/wasm-opt.ts`
- Create: `scripts/lib/build-env.ts`
- Modify: `scripts/build-rust.ts` (lines 36, 71, 89 region)

**Interfaces:**
- Produces: `optimizeWasm(wasmPath: string, level: "O3" | "Oz"): Promise<void>` (in `wasm-opt.ts`); `rustBuildPath(): string` (in `build-env.ts`).
- Consumes: `run` (`./lib/exec.js`), `wasmOptPath` (`./lib/tool-paths.js`).

- [ ] **Step 1: Write `scripts/lib/wasm-opt.ts`**

```typescript
import { run } from "./exec.js";
import { wasmOptPath } from "./tool-paths.js";

/**
 * Run the pinned wasm-opt over `wasmPath` in place. The enable flags are
 * mandatory: `--strip-all`'d wasm drops the target_features section, so
 * wasm-opt would otherwise reject bulk-memory / nontrapping ops.
 */
export async function optimizeWasm(wasmPath: string, level: "O3" | "Oz"): Promise<void> {
    await run(wasmOptPath(), [
        `-${level}`,
        "--enable-bulk-memory",
        "--enable-nontrapping-float-to-int",
        wasmPath,
        "-o",
        wasmPath,
    ]);
}
```

- [ ] **Step 2: Write `scripts/lib/build-env.ts`**

```typescript
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const TOOLS_BIN = resolve(".tools", "bin");

function resolveDirOnPath(bin: string): string {
    const path = process.env["PATH"] ?? "";
    for (const dir of path.split(delimiter)) {
        if (dir !== "" && existsSync(join(dir, bin))) {
            return dir;
        }
    }
    throw new Error(`build-env: '${bin}' not found on PATH`);
}

/**
 * PATH for cargo / wasm-pack. cargo (rustup shim) resolves rustc via
 * RUSTUP_HOME (env, not PATH); we add only its own dir plus .tools/bin for
 * the pinned wasm-pack. Nothing else from the user's ambient PATH leaks in.
 */
export function rustBuildPath(): string {
    return `${resolveDirOnPath("cargo")}${delimiter}${TOOLS_BIN}`;
}

/**
 * PATH for the wasi-sdk clang invocation. clang is called by absolute path
 * and finds wasm-ld relative to itself; an empty PATH guarantees the -flto
 * driver cannot auto-discover any wasm-opt (verified: builds with PATH="").
 */
export function wasiSdkBuildPath(): string {
    return "";
}
```

- [ ] **Step 3: Rewire `build-rust.ts` — import + use helper, add speed wasm-opt, set PATH**

Replace the import line `import { wasmOptPath, wasmPackPath } from "./lib/tool-paths.js";` with:

```typescript
import { wasmPackPath } from "./lib/tool-paths.js";
import { optimizeWasm } from "./lib/wasm-opt.js";
import { rustBuildPath } from "./lib/build-env.js";
```

In `buildRaw`, replace the cargo call + size wasm-opt block:

```typescript
    await run("cargo", ["build", `--profile=${profile}`, "--target=wasm32-unknown-unknown"], {
        cwd: crateDir,
        env: { PATH: rustBuildPath() },
    });
    // Cargo workspace puts artifacts at workspace root target/, not per-crate.
    const wasmName = `${c.sourceBench}_rust_raw.wasm`;
    const src = join("target", "wasm32-unknown-unknown", profile, wasmName);
    const dst = join(out, "module.wasm");
    await copyFile(src, dst);

    await optimizeWasm(dst, c.profile === "size" ? "Oz" : "O3");
```

In `buildBindgen`, set the wasm-pack PATH and replace the size-only wasm-opt with all-profile:

```typescript
    await run(wasmPackPath(), ["build", "--target=web", "--release", "--out-dir=pkg-tmp"], {
        cwd: crateDir,
        env: { PATH: rustBuildPath() },
    });
```
…and replace the `if (c.profile === "size") { await run(wasmOptPath(), [...]) }` block (near line 88) with:

```typescript
    await optimizeWasm(wasmDst, c.profile === "size" ? "Oz" : "O3");
```

- [ ] **Step 4: Typecheck + lint**

Run (sandbox OK): `pnpm typecheck && pnpm lint:ts`
Expected: pass. (`scripts/` typecheck gap is known debt — also run `pnpm exec tsc --noEmit scripts/lib/wasm-opt.ts scripts/lib/build-env.ts` to catch obvious errors.)

- [ ] **Step 5: Integration-verify — rust speed now wasm-opt'd + still valid**

Run (`dangerouslyDisableSandbox`): `pnpm exec tsx scripts/build-rust.ts matmul hashmap_int`
Then assert the speed artifacts shrank vs the Task 1 snapshot (wasm-opt ran):

```bash
echo "rust-speed now:"; for d in dist/matmul/rust-raw-speed dist/hashmap_int/rust-raw-speed dist/matmul/rust-bindgen-speed; do echo "$d $(wc -c < "$d/module.wasm")B"; done
grep -E "rust-(raw|bindgen)-speed" "$TMPDIR/build-hygiene-baseline.txt"
```
Expected: hashmap_int rust-raw-speed drops from ~22697B toward ~18556B (measured); matmul rust-raw-speed ~1917B → ~1806B. Then correctness:
Run (`dangerouslyDisableSandbox`): `pnpm bench --envs=node --benchmarks=matmul,hashmap_int --mode=quick --out="$TMPDIR/bh-t2"`
Expected: 0 validation failures (all results `validated`).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/wasm-opt.ts scripts/lib/build-env.ts scripts/build-rust.ts
git commit --no-gpg-sign -m "feat(build): shared optimizeWasm helper + rust speed wasm-opt + PATH isolation"
```

---

### Task 3: cpp explicit wasm-opt + PATH hygiene (wasi-sdk link-only + emscripten PATH)

**Files:**
- Modify: `benches/*/cpp/build-wasi-sdk.sh` (×8 — matmul, interop_calls, hashmap_string, hashmap_int, shape_dispatch_{homo,mixed}_{static,dyn})
- Modify: `scripts/build-cpp.ts` (`buildWasiSdk`, `buildEmscripten`)

**Interfaces:**
- Consumes: `optimizeWasm` (Task 2), `wasiSdkBuildPath` (Task 2), `wasiSdkPath` / `wasmOptPath` (existing).
- Produces: `module.wasm` (production, wasm-opt'd) + `module.attr.wasm` (name-bearing, never wasm-opt'd) per wasi-sdk build.

- [ ] **Step 1: Make each `build-wasi-sdk.sh` link-only (×8)**

In EVERY `benches/*/cpp/build-wasi-sdk.sh`, apply two identical edits.

(a) On the production clang++ invocation, drop the `PROD_PATH` prefix. Change:
```bash
PATH="${PROD_PATH:+$PROD_PATH:}$PATH" "$WASI_SDK_PATH/bin/clang++" \
```
to:
```bash
"$WASI_SDK_PATH/bin/clang++" \
```
and delete the 3 preceding comment lines about PROD_PATH ("# Production: prepend PROD_PATH …", "# wasm-opt and runs it …", "# The SIZE_ATTR clang++ below …").

(b) Delete the explicit size wasm-opt block:
```bash
if [[ "$PROFILE" == "size" ]]; then
  "${WASM_OPT:-wasm-opt}" -Oz "$OUT_DIR/module.wasm" -o "$OUT_DIR/module.wasm"
fi
```
and update the attr-build comment that references PATH/wasm-opt (it now simply states the attr build never runs wasm-opt).

Verify the block is identical everywhere before editing:
```bash
for f in benches/*/cpp/build-wasi-sdk.sh; do echo "== $f =="; grep -n "PROD_PATH\|WASM_OPT" "$f"; done
```

- [ ] **Step 2: Rewire `buildWasiSdk` in `build-cpp.ts`**

Add imports:
```typescript
import { optimizeWasm } from "./lib/wasm-opt.js";
import { wasiSdkBuildPath } from "./lib/build-env.js";
```
Replace the `run("bash", [script, ...], { env: {...} })` env block (remove `WASM_OPT` + `PROD_PATH`, add `PATH`) and add the explicit wasm-opt after the build:

```typescript
    await run("bash", [script, c.profile, resolve(out)], {
        env: {
            PATH: wasiSdkBuildPath(),
            WASI_SDK_PATH: wasiSdkPath(),
            SIZE_ATTR: "1",
            ATTR_OUT: attrDir,
        },
    });
    // Explicit, deterministic wasm-opt (Option B: all profiles). The shell script
    // links only; the -flto driver cannot auto-run wasm-opt (empty PATH above).
    await optimizeWasm(join(out, "module.wasm"), c.profile === "speed" ? "O3" : "Oz");
```
Remove the now-unused `wasmOptPath` import if it is no longer referenced elsewhere in the file (grep first).

- [ ] **Step 3: Set emscripten PATH to emsdk-only in `buildEmscripten`**

Replace:
```typescript
    const toolsBin = resolve(".tools/bin");
    const mergedPath = `${toolsBin}:${emsdk["PATH"] ?? process.env["PATH"] ?? ""}`;
```
with:
```typescript
    // emcc runs its own bundled binaryen internally; it needs only the emsdk
    // environment. Dropping .tools/bin keeps emcc from ever shadowing its wasm-opt.
    const emsdkPath = emsdk["PATH"] ?? process.env["PATH"] ?? "";
```
and in the `run` env change `PATH: mergedPath` to `PATH: emsdkPath`.

- [ ] **Step 4: Typecheck + lint**

Run (sandbox OK): `pnpm typecheck && pnpm lint:ts`
Expected: pass.

- [ ] **Step 5: Integration-verify — cpp builds, wasm-opt ran, name-section survives, valid**

Run (`dangerouslyDisableSandbox`): `pnpm exec tsx scripts/build-cpp.ts matmul hashmap_int`
Expected: builds succeed for both wasi-sdk profiles + emscripten. Then:

```bash
# size profile shrank vs baseline; speed profile still wasm-opt'd
for d in dist/matmul/cpp-wasi-sdk-speed dist/matmul/cpp-wasi-sdk-size dist/hashmap_int/cpp-wasi-sdk-speed dist/hashmap_int/cpp-wasi-sdk-size; do echo "$d $(wc -c < "$d/module.wasm")B"; done
# attr wasm keeps names (twiggy needs them) — expect a 'name' custom section present
ls -la target/attr-cpp/*matmul*/module.attr.wasm
```
Expected: hashmap_int cpp-wasi-sdk-speed ≈ 15000B (wasm-opt still applied — matches current), attr.wasm exists. Then correctness + name-section:
Run (`dangerouslyDisableSandbox`): `pnpm bench --envs=node --benchmarks=matmul,hashmap_int --mode=quick --out="$TMPDIR/bh-t3"` → 0 failures.
Run (`dangerouslyDisableSandbox`): `pnpm smoke` → passes (build:all + node/browser smoke).

- [ ] **Step 6: Commit**

```bash
git add benches/*/cpp/build-wasi-sdk.sh scripts/build-cpp.ts
git commit --no-gpg-sign -m "feat(build): explicit cpp wasm-opt + per-toolchain PATH isolation, drop PROD_PATH"
```

---

### Task 4: postprocess `ranWasmOpt` — reflect all-profile wasm-opt (both runners)

**Files:**
- Modify: `apps/runner-node/src/run-case.ts:138-140`
- Modify: `apps/runner-web/src/worker.ts` (the `ranWasmOpt` derivation, ~line 185)

**Interfaces:**
- Produces: `BenchResult.benchmark.postprocess = ["wasm-opt"]` for all rust/cpp profiles (speed + size).

- [ ] **Step 1: Update `run-case.ts` derivation**

Replace:
```typescript
    // Whether wasm-opt actually ran: only for size profile of rust/cpp.
    const ranWasmOpt =
        input.profile === "size" && (input.language === "rust" || input.language === "cpp");
```
with:
```typescript
    // wasm-opt runs for every rust/cpp profile now (Option B): rust/cpp speed +
    // size get an explicit pass; emscripten runs binaryen internally via emcc.
    const ranWasmOpt = input.language === "rust" || input.language === "cpp";
```

- [ ] **Step 2: Update `worker.ts` identically**

Find the matching `ranWasmOpt` line in `apps/runner-web/src/worker.ts` (guarded by NOTE A comment) and apply the exact same change (drop the `profile === "size"` clause, keep the rust/cpp language test).

- [ ] **Step 3: Typecheck + lint + affected tests**

Run (sandbox OK): `pnpm typecheck && pnpm lint:ts && pnpm test`
Expected: pass. If a reporter/schema test hard-codes `postprocess: []` for a rust/cpp speed fixture, that is a test expectation, not product code — leave product code correct; only touch a test if it asserts on the derivation itself (none currently do).

- [ ] **Step 4: Integration-verify — speed results now carry the marker**

Run (`dangerouslyDisableSandbox`): `pnpm bench --envs=node --benchmarks=matmul --mode=quick --out="$TMPDIR/bh-t4"`
```bash
node -e 'const j=require(process.env.F);console.log(j.benchmark.postprocess)' F="$TMPDIR/bh-t4/matmul__rust-raw-speed__S__node.json"
```
Expected: `[ 'wasm-opt' ]` (was `[]`).

- [ ] **Step 5: Commit**

```bash
git add apps/runner-node/src/run-case.ts apps/runner-web/src/worker.ts
git commit --no-gpg-sign -m "fix(runner): postprocess reflects wasm-opt on all rust/cpp profiles"
```

---

### Task 5: Folded-in tech-debt — `wasmDisasmPath` resolver + close two debts

**Files:**
- Modify: `scripts/lib/tool-paths.ts`
- Modify: any doc/plan/spec referencing `wasm-objdump` (grep-driven)
- Delete: `docs/tech_debt/r1-devirt-objdump-tooling.md`
- Delete: `docs/tech_debt/dead-ts-output-fields.md`

**Interfaces:**
- Produces: `wasmDisasmPath(): string` — absolute path to a present disassembler, or throws.

- [ ] **Step 1: Add `wasmDisasmPath` to `tool-paths.ts`**

Append:
```typescript
export function wasmDisasmPath(): string {
    // Canonical disassembler for devirt / codegen inspection (R1 checks). Hard-error
    // if absent so a missing tool never silently yields a false "0 call_indirect".
    const llvmObjdump = resolve(".tools", `wasi-sdk-${wasiSdkVersion()}`, "bin", "llvm-objdump");
    if (existsSync(llvmObjdump)) {
        return llvmObjdump;
    }
    const wasmDis = toolsBinPath("wasm-dis");
    if (existsSync(wasmDis)) {
        return wasmDis;
    }
    throw new Error("wasm disassembler not found (.tools/wasi-sdk-*/bin/llvm-objdump or .tools/bin/wasm-dis)");
}
```
Refactor the version lookup in `wasiSdkPath()` into a small `wasiSdkVersion(): string` helper (reads `tool-versions.json`) so both functions share it — avoids duplicating the JSON read.

- [ ] **Step 2: Replace `wasm-objdump` references in docs/spec/plan**

```bash
grep -rn "wasm-objdump" docs/ | grep -v tech_debt/r1-devirt
```
For each hit (plan/spec devirt-check commands), replace the `wasm-objdump -d` invocation with a note to use the `wasmDisasmPath()` resolver's tool (i.e. `llvm-objdump -d`), matching the fix already used in Phase 1.1.3 execution. If a hit is inside a historical/closed session-state, leave it (history), but fix any live plan/spec conventions.

- [ ] **Step 3: Verify dead-ts-output-fields is already resolved, then close both debts**

```bash
grep -rn "output_ptr\|output_len\|_output_ptr\|_output_len" packages/loaders/src/
```
Expected: no matches (fields already removed in commits `af475be`/`0a727db`/`7fb4572`). Then:
```bash
git rm docs/tech_debt/r1-devirt-objdump-tooling.md docs/tech_debt/dead-ts-output-fields.md
```

- [ ] **Step 4: Typecheck + lint**

Run (sandbox OK): `pnpm typecheck && pnpm lint:ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/tool-paths.ts docs/
git commit --no-gpg-sign -m "chore(tooling): wasmDisasmPath resolver (r1-devirt); close resolved tech-debt"
```

---

### Task 6: Build-determinism invariant guard

**Files:**
- Create: `scripts/check-determinism.sh`

**Interfaces:**
- Produces: a script that fails (exit 1) if a cpp/wasi-sdk production wasm changes when a decoy `wasm-opt` sits on the ambient PATH.

- [ ] **Step 1: Write `scripts/check-determinism.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
# Build one wasi-sdk workload twice — once clean, once with a decoy `wasm-opt`
# earlier on PATH — and assert the production wasm is byte-identical. This proves
# the ambient PATH no longer influences artifacts (the heisenbug that motivated
# build-hygiene). Run with the sandbox disabled (tsx binds a socket).
W="${1:-matmul}"
ART="dist/$W/cpp-wasi-sdk-speed/module.wasm"
DECOY="$(mktemp -d)"
printf '#!/bin/sh\necho "decoy wasm-opt should never run" >&2\nexit 3\n' > "$DECOY/wasm-opt"
chmod +x "$DECOY/wasm-opt"

pnpm exec tsx scripts/build-cpp.ts "$W" >/dev/null
CLEAN="$(mktemp)"; cp "$ART" "$CLEAN"

PATH="$DECOY:$PATH" pnpm exec tsx scripts/build-cpp.ts "$W" >/dev/null

if cmp -s "$CLEAN" "$ART"; then
  echo "determinism OK: $W production wasm unaffected by decoy wasm-opt on PATH"
else
  echo "DETERMINISM FAIL: $W production wasm changed with decoy wasm-opt on PATH" >&2
  exit 1
fi
```

- [ ] **Step 2: Run it**

Run (`dangerouslyDisableSandbox`): `bash scripts/check-determinism.sh matmul && bash scripts/check-determinism.sh hashmap_int`
Expected: both print "determinism OK". If FAIL, the driver is still auto-running a PATH-found wasm-opt — STOP and re-check Task 3's empty-PATH env.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-determinism.sh
git commit --no-gpg-sign -m "test(build): determinism guard — ambient PATH must not affect wasm bytes"
```

---

### Task 7: Spec methodology update + full re-baseline + guidelines + roadmap close

**Files:**
- Modify: `docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md` (methodology table, lines ~163-165)
- Modify: `docs/guidelines.md` (size + perf numbers)
- Modify: `docs/roadmap.md` (remove completed TBD entries)

**Interfaces:**
- Consumes: everything above (final integrated build).

- [ ] **Step 1: Update the design-spec methodology table**

In `docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md`, amend the SPEED column of the toolchain table so each row that emits wasm explicitly notes `wasm-opt -O3` (rust both, cpp wasi-sdk). Add a one-line note under the table: "**Ревизия (build-hygiene, 2026-07-04):** wasm-opt применяется к обоим профилям (speed `-O3`, size `-Oz`); emscripten — binaryen внутренний у emcc. Обоснование: `specs/2026-07-04-build-hygiene-design.md` finding 5."

- [ ] **Step 2: Full re-baseline build + bench**

Run (`dangerouslyDisableSandbox`): `pnpm build:all`
Then compare sizes to the Task 1 snapshot:
```bash
for d in dist/*/rust-raw-speed dist/*/rust-bindgen-speed dist/*/cpp-wasi-sdk-speed dist/*/cpp-wasi-sdk-size; do
  [ -f "$d/module.wasm" ] && echo "$d $(wc -c < "$d/module.wasm")B"
done | sort > "$TMPDIR/build-hygiene-after.txt"
diff "$TMPDIR/build-hygiene-baseline.txt" "$TMPDIR/build-hygiene-after.txt" || true
```
Then the perf run (full — needs machine quiescence; **confirm with the user who runs the browser envs** at execution time):
Run (`dangerouslyDisableSandbox`): `pnpm bench:all` (or `pnpm bench --envs=node,chromium,firefox --mode=eval --out=results/raw/<ts>` + `pnpm report`).
Compare cpp/wasi-sdk-speed vs `results/raw/2026-07-04T12-06-07-626Z`: expect hashmap ~−11..−14% (faster), rust-speed perf ~±1%, matmul ~0; inspect the hashmap-lookup anomaly. `results/raw/` is gitignored — do not commit it.

- [ ] **Step 3: Update guidelines with the re-baselined numbers**

Edit `docs/guidelines.md`: refresh any size/perf figures that moved (cpp/wasi-sdk both profiles, rust-speed sizes). If the hashmap-lookup anomaly reproduces materially, add it as a finding (per the guidelines format B-1). Keep claims qualitative where the change is within the measured run-to-run noise (~1-3% at L).

- [ ] **Step 4: Prune completed roadmap entries**

In `docs/roadmap.md` § TBD, remove `cpp-wasm-opt-explicit` and `path-hygiene-build-isolation` (completed this phase). Leave `bindgen-size-opt-level`, `size-attr-math-table`, `size-attr-raw-host-glue`.

- [ ] **Step 5: Full gate set + visual/spec-coverage close checks**

Run: `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke` (build:all/smoke with `dangerouslyDisableSandbox`).
Expected: all green. Confirm the report renders (open `results/report/index.html`), size bars reflect new totals, size-attribution intact (composition non-null for cpp/wasi-sdk).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md docs/guidelines.md docs/roadmap.md
git commit --no-gpg-sign -m "docs(build-hygiene): spec methodology revision + re-baselined guidelines + roadmap prune"
```

- [ ] **Step 7: Hand off push + PR** (user action)

Provide: `git push -u origin feature/build-hygiene` + the compare link `https://github.com/uncerso/wasm-rust-cpp-js/compare/master...feature/build-hygiene`. Then recommend `/finish-session`.

---

## Execution Protocol

### Hybrid routing map

| Task | Route | Reason |
|---|---|---|
| 1 — W0 baseline gate | `[I]` inline | Gate + size capture; needs in-session build output. |
| 2 — wasm-opt helper + rust | `[I]` inline | Two small new files + focused `build-rust.ts` edits; verified by build. High context locality. |
| 3 — cpp wasm-opt + PATH | `[I]` inline | Highest-risk (8 identical shell edits + `build-cpp.ts` + production bytes) but fully specified + verified by build/smoke in-session; no research needed. **Mandatory checkpoint after Step 5.** |
| 4 — postprocess ranWasmOpt | `[I]` inline | Two one-line derivation edits. |
| 5 — folded-in tech-debt | `[I]` inline | Resolver + grep-driven doc edits + debt deletion. |
| 6 — determinism guard | `[I]` inline | One script + run. |
| 7 — spec + re-baseline + close | `[I]` inline | Docs + build/bench + gates; browser bench may be user-run (Step 2). |

All-`[I]` ⇒ execute inline (per `docs/workflow.md`, do NOT re-ask the harness). Use `superpowers:executing-plans` (batch with checkpoints). Rationale: every task is a focused edit to build scripts fully understood in the design phase, verified by builds + gates in-session — no fresh research or parallelizable heavy work that would justify subagent fan-out (cost discipline). Task 3 is the heaviest; treat its post-build verification as a hard checkpoint.

### Static break-points

- **After Task 3** (production build path changed + smoke green): natural checkpoint — the risky build-pipeline change is landed and verified; good spot to pause if needed.
- **After Task 7 Step 6** (all code + docs committed, before push): recommend `/finish-session` (Phase 7 close-out). The full browser re-bench (Step 2) may span this boundary as a user action.

### Per-task break-check

After each task's commit, apply the standing Break-thresholds rule from `docs/workflow.md`: if the gate set is red twice on the same approach, or a task uncovers spec drift (e.g. wasi-sdk clang fails to link with `PATH=""` for some workload, or the determinism guard fails, or the hashmap-lookup anomaly proves large + real), STOP and surface to the user with options rather than improvising. Surface pre-identified risks (§Риски in the spec) explicitly if they fire.

## Self-Review

- **Spec coverage:** shared helper (spec §Per-toolchain `wasm-opt.ts`) → Task 2 Step 1; rust speed+size wasm-opt + PATH (spec §rust) → Task 2; cpp explicit wasm-opt + link-only shells + minimal PATH + drop PROD_PATH (spec §cpp/wasi-sdk) → Task 3; emscripten emsdk-only PATH (spec §cpp/emscripten) → Task 3 Step 3; postprocess `ranWasmOpt` edit (spec §Спека) → Task 4; `wasmDisasmPath` + close r1-devirt (spec §Folded-in) → Task 5; dead-ts-output-fields close (spec §Folded-in; already resolved) → Task 5 Step 3; determinism invariant (spec §Валидация) → Task 6; methodology-table revision (spec §Спека) → Task 7 Step 1; full re-baseline size+perf + guidelines (spec §Re-baseline) → Task 7 Steps 2-3; roadmap prune → Task 7 Step 4; gates + report render (spec §Валидация) → Task 7 Step 5. No gaps.
- **Placeholder scan:** none — all code steps carry real content; the only deferred decision (who runs the browser bench) is an explicit user-confirmation point, not a code placeholder.
- **Type consistency:** `optimizeWasm(path, "O3" | "Oz")` used identically in Tasks 2 (rust) + 3 (cpp); `rustBuildPath()` / `wasiSdkBuildPath()` signatures match between `build-env.ts` (Task 2) and consumers (Tasks 2-3); `wasmDisasmPath()` returns `string` and is defined once (Task 5); `ranWasmOpt` edit is identical in both runners (Task 4).
