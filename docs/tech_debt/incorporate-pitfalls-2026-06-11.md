---
id: incorporate-pitfalls-2026-06-11
title: Stale CLAUDE.md § refs after workflow-cost-redesign doc split
created: 2026-06-11
source: docs/superpowers/plans/2026-06-11-workflow-cost-redesign.md
category: docs
status: open
priority: low
---

## What

The workflow-cost-redesign split situational content out of `CLAUDE.md` into
on-demand docs. Several **open** tech-debt files still reference CLAUDE.md
sections that no longer exist, so their `## Possible fix` instructions point at
the wrong file.

### Item 1: Re-target moved CLAUDE.md § references in incorporate-pitfalls files

`docs/tech_debt/incorporate-pitfalls-2026-05-22.md`, `-2026-05-27.md`, and
`-2026-05-28.md` reference now-moved CLAUDE.md sections:
- `CLAUDE.md § Spec & plan conventions` → moved to `docs/workflow.md § Spec & plan discipline`.
- `CLAUDE.md § Guidelines artifact` → moved to `docs/guidelines.md § Format`.
- `CLAUDE.md § Tech-debt capture` / `§ Roadmap capture` → moved to `docs/capture-protocol.md`.

**Suggested dispatch:** at the next `/backlog-review`, for each of those three
files either re-target the section refs to the new homes or close the item if
its pitfall is already incorporated. These files are partly obsolete — the doc
structure they targeted changed substantially — so re-targeting is triage, not a
mechanical sweep.

**Why low priority:** instructions, not broken links; a human triaging the
backlog will see the content moved. No gate or build depends on it.

## Why it matters

A reader following a stale `## Possible fix` would edit a section that no longer
exists. Without review at `/backlog-review` the drift sits silently.

## Suggested workflow для review

Run `/backlog-review` (Pass 2 — tech_debt); for this item:
- Re-target the three files' section refs → close this item.
- Or, if those pitfalls are already incorporated, mark them resolved and close.
