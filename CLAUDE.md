# CLAUDE.md

Repo-local guidance for AI assistants working in this project. Keep this file to what is needed almost every turn; situational content lives in on-demand docs linked below.

## Project overview

A benchmark suite comparing C++, Rust, and JS on wasm along two axes: **artifact size** (raw/gzip/brotli) and **runtime performance** (init phases, first call, warm samples). One workload runs in Node and in browsers (Chromium, Firefox) through one `BenchModule` abstraction.

North star — three goals:
1. Accumulate an **evidence base** comparing the toolchains under product-realistic wasm use.
2. Extract **product guidelines** from it (`docs/guidelines.md`) — a first-class output, not a byproduct of the numbers.
3. Improve **how we work with the agent** itself — capture, workflow, writing discipline (`docs/workflow.md`).

Every phase produces numbers AND, when a finding is confirmed, updates `docs/guidelines.md`.

## Canonical context sources

- `README.md` — user-facing manual (requirements, install, build, run, report, limits). **Commands live here.**
- `docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md` — design spec: `BenchModule` / `Loader` contracts, `BenchResult` format, workload rationale. Read before changing core abstractions.
- `docs/superpowers/plans/` — phase plans (dated; latest = current focus).
- `docs/roadmap.md` — live index of deferred work.
- `docs/tech_debt/` — small-item backlog (one file per debt).
- `docs/pitfalls/` — execution lessons (format in `docs/pitfalls/README.md`).
- `docs/superpowers/bug-reports/` — root-cause notes with deterministic repro.
- `docs/superpowers/session-states/session-state-*.md` — progress snapshots for long multi-session work.
- `docs/guidelines.md` — actionable recommendations for product teams; format convention in the file header (consult when editing guidelines).
- `docs/capture-protocol.md` — how to capture tech-debt / roadmap / guideline / pitfall / agent-lesson findings.
- `docs/workflow.md` — the iteration pipeline (phases 0–7), the Execution-Protocol convention, and spec/plan discipline.
- `docs/writing-standard.md` — anti-fluff standard for all prose.

## Workflow

**To start or continue an iteration/phase, invoke the `/iterate` skill** — it Orients from the newest session-state + in-flight plan and routes between resuming and starting fresh. The pipeline (phases 0–7), break thresholds, and spec/plan discipline (pre-flight gate, Wave-0/Wave-2 gates, ephemeral-path audit, mechanism-check, landing audit) live in `docs/workflow.md`. Every plan written via `/writing-plans` MUST embed an "Execution Protocol" section (hybrid inline/subagent routing + static break-points + per-task break-check) — NEVER skip it.

## High-level architecture

Workspace = pnpm + cargo. Everything flows through `BenchResult`: each run of one (binary × entry × size × env) emits JSON that `BenchResultSchema.parse` validates; the reporter aggregates these. Reference checksums per (entry, size) are pinned in `benches/<workload>/spec.json` (v2: `entries: string[]` + `expectedChecksums`); a correctness failure halts the case immediately.

- **`benches/<workload>/`** — one workload per dir, discovered by `scripts/build-all.ts` via `glob("benches/*/spec.json")`. Current: `matmul`, `interop_calls`, `hashmap_string`, `hashmap_int`, `shape_dispatch_{homo,mixed}_{static,dyn}`. Per-workload toolchain coverage varies — defined by `spec.json.supported`.
  - `js/{idiomatic,typed-array}` — TS (ESM, bundled via esbuild).
  - `rust/{raw,bindgen}` — cargo crates × {speed,size}. `raw` = manual `extern "C"` exports, no glue (no_std where the workload allows; std when needed, e.g. hashmap pulls `std::collections::HashMap`); `bindgen` = wasm-bindgen.
  - `cpp/` — shared `.cpp` + per-bench `build-{emscripten,wasi-sdk}.sh` × {speed,size}.
  - `validate/` — reference TS computing expected checksums per (entry, size); fixtures under `fixtures/` (gitignored `*.bin`).
- **`benches/common/`** — shared fixture generators (`fixtures.ts`): `mulberry32`, `genF64Array`, `genAsciiHexKeys`, `genIntPairs53`. Add a generator here when ≥2 workloads need it.
- **`packages/`** — host libs: `result-schema` (zod `BenchResultSchema`, single source of truth — **any schema change goes through this file**), `harness` (measure loop + stats + validation), `loaders` (`plain-js` / `raw-wasm` / `rust-bindgen` / `emscripten`, each returning a unified `BenchModule`; per-entry reset via `bind-reset.ts`), `reporter` (aggregate JSON → static HTML).
- **`apps/`** — `runner-node` (one case in Node) and `runner-web` (Vite + Worker + selenium-webdriver; dev server on port 5174; COOP+COEP for cross-origin isolation).
- **`scripts/`** — tsx orchestrators; `lib/` has `matrix.ts`, `exec.ts`, `meta.ts`, `tool-paths.ts`, `tool-versions.ts`.

## Commands

Build, test, typecheck, lint, bench, and report commands live in `README.md` (§ Сборка, § Запуск бенчмарков, § Отчёт). The all-gates pre-flight is `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke`.

## Conventions

- **TS** — 4-space indent, double quotes, semicolons, trailing comma (multiline), `curly: all`; `verbatimModuleSyntax` + strict. Enforced by ESLint flat config (`eslint.config.js`).
- **Rust** — edition 2024, `warnings = "deny"`, `clippy::all = "deny"`, pedantic + nursery warn, `unsafe_code` warn (only in the `raw` crate for wasm exports). See workspace `Cargo.toml` lints.
- **Never edit** auto-generated files: `**/glue.mjs`, `**/glue.js` (Emscripten output; ESLint-ignored).
- **Tool versions** — all pins (sha256 + URL) in `tool-versions.json`. `wasm-opt` MUST run with `--enable-bulk-memory --enable-nontrapping-float-to-int` (modern rustc/emcc output won't parse otherwise). A version change updates the `meta.json` writer + downstream docs.
- **`BenchResult` schema** — change only via `packages/result-schema`. Old `results/raw/` JSON may stop parsing at a phase boundary (bump `meta.schemaVersion` if the phase is live).

## Cost discipline

- **Retry budget** — ≤2 attempts at the same approach; then STOP and rethink, don't keep hammering.
- **Subagent fan-out is not free** — dispatch a subagent only for heavy/large work, NOT "subagent everything".
- **Read before edit / grep callers** — keep edit:read close to ~4:1; understand before changing.

## Capture

When you notice tech-debt, a roadmap-scale idea, a confirmed guideline, an agent-lesson, or a pitfall — stop once and emit one inline marker, then keep working. This is NOT a round-trip:

```
› capture: <type> — <slug>: <one-line note>
```

`<type>` ∈ `{tech-debt, roadmap, guideline-candidate, agent-lesson, pitfall}`. Markers are collected and triaged at `/finish-session`. Full protocol — types, trigger phrases, what-NOT-to-capture: `docs/capture-protocol.md`. Periodic backlog triage: `/backlog-review`.

## Tooling gotchas

- **Cargo workspace target** — when build scripts orchestrate per-crate `cargo build`, read artifacts from the **workspace-root** `target/`, not `<crateDir>/target/` (stale pre-workspace binaries can copy silently). See `docs/pitfalls/2026-05-22-phase-1-1-1-w1.md`.
- **tsx + sandbox** — `pnpm smoke` / `build:*` / `fixtures` / `tsx -e` bind a Unix IPC pipe; the sandbox blocks the bind, and neither `allowUnixSockets` (connect-only; upstream [#41817](https://github.com/anthropics/claude-code/issues/41817)) nor `allowAllUnixSockets: true` grants it — both **verified to FAIL in a fresh session** (2026-06-13: regular-file write into the tsx-pipe dir succeeds, the socket bind still `EPERM`s). So run these with `dangerouslyDisableSandbox: true` (no sandbox knob fixes it — `wontfix`). Pure `pnpm typecheck` / `test` / `lint:*` work in the sandbox.
- **Pipe exit codes** — a pipeline's `$?` is the rightmost command's, hiding an earlier failure. Use `set -o pipefail` (bash + zsh), or read the producer's status: `${pipestatus[1]}` in zsh (the repo's shell), `${PIPESTATUS[0]}` in bash. Write logs to `$TMPDIR`, not `/tmp` (sandbox-blocked).
- **`git stash`** — unreliable under sandbox here (partial stash, silent pop failures). Prefer `git diff <commit> -- <file>` / `git show <commit>:<file>`, or copy files to `$TMPDIR/`.
- **Subagent-divergence check** — before reverting a subagent's divergence "for consistency," run the gate it might satisfy (lint/typecheck/test) on both versions; if the "consistent" version fails a gate the divergent one passed, keep + document why.

## Commits

Agent commits use `--no-gpg-sign` (authorized by the user).

**Push / PR — user action.** The agent commits + prepares the PR body; **the user** runs `git push` and opens the PR. Origin SSH is Yubikey-backed (a physical touch a non-interactive shell can't give) and `gh` is not installed → the agent cannot push. Hand off via `! git push -u origin <branch>` + the GitHub compare link. Forensics: `docs/pitfalls/2026-06-11-workflow-cost-redesign-execution.md`.
