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

## Break thresholds

- `< ~1/4` window — continue; do not break.
- `~1/3` window (soft) — propose a break at the next independent task boundary.
- `~1/2` window (hard ceiling) — wrap now: commit, recommend `/finish-session`, stop.
- After auto-compaction fires — pause at the next task boundary regardless.

Only break on a boundary whose next task is independent (no half-finished file).
