# Session state — parallel-bench + mandelbrot plans (Phase 1.2)

## TL;DR
- Branch `feature/phase-1.2-parallel-bench` (from master `bc5da96`), **3 commits, NOT pushed**: spec + Plan A + Plan B.
- **Planning-only session** — no code yet. Designed a two-slice sequence and wrote both implementation plans (user chose break at the Phase-4 gate; execution starts fresh next session).
- **Slice A — parallel-bench-execution** (`docs/superpowers/plans/2026-07-12-parallel-bench-execution.md`, 9 tasks): parallel builds (worker-pool, always), node in-process loop (always, A2a with a parity gate → A2b fallback), opt-in `--parallel-envs` (default off) with an additive `env.parallel` schema flag (no SCHEMA_VERSION bump). Measured premises baked in.
- **Slice B — mandelbrot** (`docs/superpowers/plans/2026-07-12-mandelbrot-workload.md`, 10 tasks): first academic-algo, single-entry compute workload modeled on matmul; rust/raw `no_std`; **js idiomatic-only** (no array-shaped I/O → no typed-array axis); cross-toolchain checksum-parity handled (verbatim op-order + no fast-math; wasm has no scalar FMA).
- One combined spec (`docs/superpowers/specs/2026-07-12-parallel-bench-and-mandelbrot-design.md`); both plans committed to branch A (land on master via PR A; branch B inherits).
- **Uncommitted:** a CLAUDE.md § Tooling-gotchas one-liner (zsh word-split + verify-measurement-success) written by finish-session — **user commits it**.

## What the next session needs
- **Execute Slice A** on `feature/phase-1.2-parallel-bench` via `/iterate` (Phase-0 will route CONTINUE off this snapshot + the plan's unchecked `[ ]`). Follow the plan's Execution Protocol ([I] inline / [S] subagent; full gate-set to subagents).
- Slice A's three hard gates in order: **determinism** (Task 3 — parallel build bit-identical to sequential; Task 1 snapshots the baseline hashes to `$TMPDIR`), **node parity** (Task 4 — in-process vs subprocess means ≤~3%, else STOP + surface A2b), **`--parallel-envs` sanity** (Task 6).
- After Slice A merges → fork `feature/phase-1.2-mandelbrot` from master → execute Slice B. Its gates: cpp feasibility (Task 4, zero wasm imports), checksum-parity (Tasks 5–9), js parity (Task 8).

## Deferred / open-loops
- **Execute Plan A** — deferred by design (user chose break). Not started.
- **Execute Plan B** — deferred; starts only after Slice A merges (new branch).
- **user push + PR (both slices)** — user action (Yubikey SSH, `gh` absent — agent can't push). Slice A first.
- **Commit the CLAUDE.md one-liner** — uncommitted working-tree change from this finish-session; user commits (or folds into Slice A's first commit).
- **A2a vs A2b decision** — unresolved until Task 4's parity gate runs live (measurement can't be faked here; do NOT treat A2a as chosen until the gate passes).
- **project_wasm_benchmarks.md memory is stale** — predates sorted_map #17 merge + this planning; authorial refresh (out of finish-session scope), left for the user.

## Resume
```
# commit the finish-session CLAUDE.md edit (or fold into Slice A wave-0):
git -C /Users/uncerso/src/wasm-rust-cpp-js add CLAUDE.md
git -C /Users/uncerso/src/wasm-rust-cpp-js commit --no-gpg-sign -m "docs(claude): zsh word-split + verify-measurement gotcha"

# start execution (fresh session):
/iterate            # Phase-0 → CONTINUE on feature/phase-1.2-parallel-bench
# plan: docs/superpowers/plans/2026-07-12-parallel-bench-execution.md

# after Slice A merges:
git checkout master && git pull && git checkout -b feature/phase-1.2-mandelbrot
# plan: docs/superpowers/plans/2026-07-12-mandelbrot-workload.md
```

## Stop point
Two-slice sequence fully planned + committed (spec + Plan A + Plan B) on `feature/phase-1.2-parallel-bench`; gates green n/a (no code). finish-session applied: CLAUDE.md gotcha one-liner (uncommitted, user commits); 0 capture markers; no living-doc drift. Measured design premises (all this machine, 14 cores): build:all warm 106s @ 0.85 core; node per-case tsx startup ~0.27s ×477 ≈130s; contention under 3× concurrency — compute +2.3%, memory-latency +7–9%, call-bound ~0%; mandelbrot L≈536ms/sample prototype. Next: execute Slice A.
