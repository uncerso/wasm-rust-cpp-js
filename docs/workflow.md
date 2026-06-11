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
- **Ephemeral-path audit** — before committing scripts/docs that read external paths, confirm each path is tracked or self-generated (`git check-ignore`). `dist/`, `target/`, `.tools/`, `results/`, `fixtures/*.bin` are gitignored — red flags on a fresh checkout.
- **Mechanism-check** — for each mitigation in a spec's risk section, state in one sentence the mechanism by which it addresses that exact risk. Can't → drop or verify the candidate.
- **Portable commands** — shell snippets in a plan MUST use flags that work on the repo's toolchain (macOS/BSD + this git): `git grep -lz` (not GNU `-Z`), a `for`-loop over matches instead of `grep -lZ | xargs -0`. A non-portable flag fails silently (no-op transform). Verify before committing the plan.

## Break thresholds

- `< ~1/4` window — continue; do not break.
- `~1/3` window (soft) — propose a break at the next independent task boundary.
- `~1/2` window (hard ceiling) — wrap now: commit, recommend `/finish-session`, stop.
- After auto-compaction fires — pause at the next task boundary regardless.

Only break on a boundary whose next task is independent (no half-finished file).
