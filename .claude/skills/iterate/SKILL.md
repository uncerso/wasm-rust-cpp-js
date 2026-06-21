---
name: iterate
description: Use when starting OR continuing an iteration / phase of work in this repo. Triggers on "новая итерация", "new iteration", "next phase", "start phase X", "продолжаем", "давай дальше", "continue the work", or an explicit /iterate. Drives the docs/workflow.md pipeline (phases 0–7) and routes between resuming in-flight work and starting fresh.
---

# Iterate — drive the repo's workflow pipeline

The executable form of `docs/workflow.md`. Read that doc for full phase detail; this skill adds the routing + per-phase actions. Announce: "Using the iterate skill to drive the workflow pipeline."

## Phase 0 — Orient + route (do this FIRST, always)

Read three durable signals:
1. Newest `docs/superpowers/session-states/session-state-*.md` (narrative handoff: open-loops, "what next session needs").
2. The in-flight plan in `docs/superpowers/plans/` (latest dated): are there unchecked `- [ ]` tasks?
3. `git branch --show-current` + `git branch --merged master` (unmerged `feature/*` with an open plan? merged branches to offer deleting?).

Then route:
- **CONTINUE** — if open loops + unchecked `[ ]` on a feature branch: resume from the next unchecked task via that plan's Execution Protocol. Skip Phases 1–4.
- **START FRESH** — if last work is closed/merged: go to Phase 1.

State which branch you took and why, in one line, before proceeding.

## Phases 1–7 (fresh work)

Follow `docs/workflow.md` exactly:

1. **Select** — scan `docs/roadmap.md` + `docs/tech_debt/`; if backlog stale → `/backlog-review`; propose a slice; confirm with the user.
2. **Branch** — `feature/<phase>-<slug>` from master.
3. **Design** — invoke `/brainstorming` → spec; commit spec to branch.
4. **Plan** — invoke `/writing-plans` → plan WITH the mandatory Execution Protocol section; commit plan to branch.
   - Break: recommend `/finish-session` (user decides).
5. **Orient** — (fresh session) re-read the session-state.
6. **Execute** — Wave-0 baseline gate; route each task by the plan's `[I]`/`[S]` tags (do NOT re-ask the harness — all-`[I]` ⇒ inline); per-task break-check; commit code per wave. Use `executing-plans` or `subagent-driven-development`.
7. **Close** — gates green → push → PR (user reviews on GitHub) → recommend `/finish-session`. Before declaring a phase closed:
   - **Visual deliverable check** — if the phase ships a UI / report / rendered artifact, OPEN it and eyeball it. Gates (typecheck/lint/test) do NOT catch render/UX regressions (bar scaling, stale strings, missing controls). See `docs/pitfalls/2026-06-22-phase-1-3-close-out-visual-deliverable.md`.
   - **Spec-coverage diff** — explicitly name any spec § items NOT implemented this phase and surface them to the user; never let a plan's "relocate without redesign" / "v1 only" silently drop a spec item.

## Rules

- Scale phases to task size (trivial = Design/Plan collapse to a sentence — `docs/workflow.md`).
- NEVER auto-invoke `/finish-session`; only recommend at break-points.
- Push + PR are user actions (CLAUDE.md § Commits).
