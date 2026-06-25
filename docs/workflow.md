# Workflow

The iteration pipeline for this repo: a single adaptive lane. Phases auto-scale to task size — a trivial change collapses Design and Plan to a sentence; a multi-wave phase uses all of them.

## Phases

| # | Phase | What |
|---|---|---|
| 0 | Orient | read the lean session-state; `git branch --merged master` → offer to delete merged `feature/*`; remembering-conversations only as fallback |
| 1 | Select | scan roadmap + tech_debt; if backlog stale → `/backlog-review`; propose a slice (importance × deps × grouping); tech-debt enters as batch-iteration or stitched as the first task; confirm |
| 2 | Branch | `feature/<phase>-<slug>` from master |
| 3 | Design | `/brainstorming` (scales: trivial = a couple of sentences) → spec; **commit spec to branch** |
| 4 | Plan | `/writing-plans` → plan **with an embedded Execution Protocol**; **commit plan to branch** |
| → | Break | **recommend** `/finish-session` (user decides) |
| 5 | Orient | read the session-state |
| 6 | Execute | Wave-0 baseline gate; hybrid routing from plan tags (kickoff confirm); **per-task break-check**; code commits to branch |
| 7 | Close | gates green → push → PR (user reviews on GitHub); **recommend** `/finish-session` (marker-scan → triage → batch capture; drift audit; lean session-state) |

## Execution-Protocol convention

Every plan written via `/writing-plans` MUST contain an "Execution Protocol" section. NEVER skip it. Three parts:
- **Hybrid routing map** — inline `[I]` vs subagent `[S]` per task, with the reason.
- **Static break-points** — the session-groups where you recommend `/finish-session` (short sessions are the #1 cost lever).
- **Per-task break-check** — the standing rule in Break thresholds below.

(Homed here because the `writing-plans` skill lives in the plugin cache and is not reliably editable; this doc + the CLAUDE.md pointer are its durable home.)

## Ownership

| Concern | Home |
|---|---|
| capture protocol + markers | `docs/capture-protocol.md` |
| writing standard | `docs/writing-standard.md` |
| backlog / tech-debt triage | `/backlog-review` |
| session close | `finish-session` skill |
| product guidelines | `docs/guidelines.md` |
| execution pitfalls | `docs/pitfalls/` |

## Spec & plan discipline

Phase-local rules for the spec → plan → execute loop (forensics → the linked pitfalls in `docs/pitfalls/`):
- **Pre-flight gate** — before writing exit criteria, verify master is green on all gates (`pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke`). Red → fix first.
- **Wave-0 baseline** — every execution session re-runs the baseline gate before touching code. Red → STOP, surface to the user; NEVER mask it with an out-of-scope fix.
- **Wave-2 eval gate** — `pnpm smoke` (quick, size S) does NOT close an implementation wave; JIT tier-up bugs surface only in eval mode. Run ≥1 representative case per workload in `--mode=eval` first.
- **Spike completion** — a Wave-0 feasibility spike is NOT closed by a static property (links, zero wasm imports, instantiates); it must be validated by **execution** on a representative case (run it, match the pinned checksum). A static-only "pass" hid a wasm trap (unrun C++ ctors) that fired only at scale. Forensics: `docs/pitfalls/2026-06-13-phase-1-2-hashmap-no-glue-w0.md`.
- **Probe integration-fidelity** — a W0/probe must exercise the mechanism through the **real integration path** it will ship in (the actual build script / orchestrator call), not a standalone approximation. For build-tooling especially, output can depend on flags, ordering, or process context — a standalone `clang` that demangles names ≠ the same `clang` run inside a build script that silently drops the name section. The probe's blind spot propagates into the plan. Forensics: `docs/pitfalls/2026-06-21-phase-1-3-size-attr-w1.md`.
- **Integration-seam test when a feature is split across tasks** — when separate tasks own separate pieces of ONE rendered/assembled artifact (a CSS export, a JS export, the markup that uses them), each task's unit test covers only its piece; the wiring that joins them in the assembled output is owned by no task, so no per-task test asserts it. The controller MUST add a test on the **assembled output** that a sentinel from each piece reaches the final artifact. An all-green per-task suite is necessary, not sufficient — the final whole-branch review is load-bearing precisely because it sees the whole that units never exercise. Forensics: `docs/pitfalls/2026-06-26-perf-css-unwired-integration-seam.md` (a redesign shipped the entire Perf tab unstyled under 42 green tests).
- **Ephemeral-path audit** — before committing scripts/docs that read external paths, confirm each path is tracked or self-generated (`git check-ignore`). `dist/`, `target/`, `.tools/`, `results/`, `fixtures/*.bin` are gitignored — red flags on a fresh checkout.
- **Mechanism-check** — for each mitigation in a spec's risk section, state in one sentence the mechanism by which it addresses that exact risk. Can't → drop or verify the candidate.
- **Portable commands** — shell snippets in a plan MUST use flags that work on the repo's toolchain (macOS/BSD + this git): `git grep -lz` (not GNU `-Z`), a `for`-loop over matches instead of `grep -lZ | xargs -0`. A non-portable flag fails silently (no-op transform). Verify before committing the plan.
- **Verify a plan's factual assertions before acting** — a plan that asserts a file location, a failure mechanism, or a config knob may be wrong. Check it cheaply first (`ls`/`find` the path; reproduce the error and read the actual errno/syscall) before a task acts on it. A one-command check turns a silent no-op into a correct fix. Forensics: `docs/pitfalls/2026-06-11-workflow-cost-redesign-execution.md`.
- **Landing audit** — every decision in a spec MUST name the firing surface that makes it load or trigger: global/project `CLAUDE.md` (always-loaded), a skill (auto-trigger/explicit), or a hook (deterministic). A decision with no firing surface will NOT fire — it lives only in an on-demand doc nothing loads. Verify each names a surface before plan hand-off; a plan's coverage map maps **decision → firing-surface**, not just change-list → task. Forensics: the workflow-cost-redesign T1/T2 drop (`docs/superpowers/specs/2026-06-12-workflow-trigger-landing-design.md` § Hole-audit).

## Break thresholds

- `< ~1/4` window — continue; do not break.
- `~1/3` window (soft) — propose a break at the next independent task boundary.
- `~1/2` window (hard ceiling) — wrap now: commit, recommend `/finish-session`, stop.
- After auto-compaction fires — pause at the next task boundary regardless.

Only break on a boundary whose next task is independent (no half-finished file).
