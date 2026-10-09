# Session state — parallel-bench-execution executed (Phase 1.2, Slice A)

## TL;DR
- Branch `feature/phase-1.2-parallel-bench`, HEAD `4a61dea`, **14 commits, NOT pushed**. Working tree clean (untracked `.agents/` + `AGENTS.md` predate this session).
- Slice A executed end-to-end. **A1 shipped** (build:all 115.86 s → 54.63 s, 2.12×, artifacts bit-identical), **A3 shipped** (`--parallel-envs` + `env.parallel` + `∥` badge), **A2 reverted** (node in-process loop broke the init/memory axis).
- All gates green after the revert: `build:all` + `typecheck` + `lint:all` (0 err) + `test` (149) + `smoke` (179 results) + pool 5.
- Bonus fix `4efed1c`: `rustBuildPath` lacked `/usr/bin:/bin`, so every clean rust build failed on host linker `cc`.

## What the next session needs
- **User pushes + opens the PR** — agent cannot (Yubikey SSH, no `gh`). Command + compare link in Resume; PR body drafted in the prior turn of this session's transcript.
- After merge → Slice B: fork `feature/phase-1.2-mandelbrot` from master, plan `docs/superpowers/plans/2026-07-12-mandelbrot-workload.md` (10 tasks, untouched).
- SDD ledger with the full execution trail: `.superpowers/sdd/progress.md` (git-ignored scratch — read before assuming anything about A2).

## Deferred / open-loops
- **push + PR** — user action, not done.
- **Slice B (mandelbrot)** — not started; starts on a fresh branch after Slice A merges.
- **A2 (node in-process loop)** — deliberately NOT shipped. Reverted in `4a61dea`; the ~48 s stays on the table. Findings + three routes forward (cache-buster + RSS measurement, engine pre-warm, `worker_threads`) recorded in roadmap `in-process-node-runner`. Do not retry without a full re-bench: in-process init numbers are not comparable to the existing `results/raw/` history.
- **Browser `fetch` understated on repeat URLs** — `fetchBytes` uses a plain `fetch(url)` with no `cache: "no-store"`; 2nd+ case of one artifact reads from HTTP cache (bindgen 1.60 → 0.99 → 0.82 ms). Pre-existing (also on master), `compile`/`instantiate`/`memory` unaffected. Captured in the same roadmap item, not fixed.
- **Two MINOR review findings, not fixed** — (1) in `--parallel-envs`, an unexpected throw inside a browser stream orphans the other concurrent sessions and skips writing `failures.txt`; (2) `build-all`'s `Promise.all` doesn't stop the rust stream when the pool fails (and vice-versa). Both largely pre-existing patterns; no tech-debt note written yet.
- **`project_wasm_benchmarks.md` memory is stale** — last touched 2026-07-07, predates the `sorted_map_int` merge (#17) and all of this slice. Authorial refresh, still owed (was already deferred by the previous session-state).
- **`.superpowers/sdd/progress.md` is git-ignored** — dies with `git clean -fdx`; the durable record is git log + this file + the roadmap item.

## Resume
```
# hand off the branch (user runs this):
! git push -u origin feature/phase-1.2-parallel-bench
# https://github.com/uncerso/wasm-rust-cpp-js/compare/master...feature/phase-1.2-parallel-bench

# after the PR merges:
git checkout master && git pull && git checkout -b feature/phase-1.2-mandelbrot
/iterate     # plan: docs/superpowers/plans/2026-07-12-mandelbrot-workload.md
```

## Stop point
Slice A complete and gate-green at `4a61dea`, awaiting user push/PR. `/finish-session` applied: CLAUDE.md (+`pool.ts` in the `scripts/lib` list, +1 isolation gotcha), README (build:all is no longer strictly ordered), `scripts/scan-markers.mjs` (tolerates markers wrapped in backticks — it had silently missed 3/3 this session), pitfall `docs/pitfalls/2026-08-24-parallel-bench-execution.md`, one rule added to the `/iterate` skill (a gate must cover what the change can break). All 3 capture markers triaged; the guideline-candidate had already landed in `docs/guidelines.md` § Measurement during Task 8. Nothing committed by the agent this close-out — the doc edits above are uncommitted in the working tree.
