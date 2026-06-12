# Workflow Trigger & Landing Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the iteration pipeline (`docs/workflow.md`) actually fire each session via a `/iterate` skill, and close the landing-layer holes (H1–H7) from the workflow-cost-redesign work.

**Architecture:** Skill + settings + doc/CLAUDE.md changes. Add a repo-local `/iterate` skill (thin driver over `docs/workflow.md`, phases 0–7, with continue-vs-fresh routing); land the dropped decisions on firing surfaces (T1 → new global `~/.claude/CLAUDE.md`; T2 → repo CLAUDE.md; landing-audit → `workflow.md` + finish-session); fix the broken tsx sandbox setting. No production code (`benches/`, `packages/`, `apps/`) is touched — gates exist only to prove nothing broke.

**Tech Stack:** Markdown docs, Claude Code skills (`.claude/skills/*/SKILL.md`), `.claude/settings.json`, the `/sandbox` command.

**Source of truth:** `docs/superpowers/specs/2026-06-12-workflow-trigger-landing-design.md` (decisions D1–D7, hole-audit, firing-surface table). Where this plan quotes the spec, the spec wins on intent.

---

## Execution Protocol

This plan carries the mandatory Execution Protocol section (the convention this very iteration enforces — D5).

### Hybrid routing map (inline `[I]` vs subagent `[S]`)

| Task | Route | Reason |
|---|---|---|
| 1 — sandbox debug + fix | **[I]** | Interactive systematic-debugging against the live sandbox; needs the `/sandbox` command + iterative re-verify in main context. |
| 2 — global `~/.claude/CLAUDE.md` | **[I]** | Tiny authorial; touches the user's global file (outside repo) — wants explicit confirmation, not a fire-and-forget subagent. |
| 3 — `/iterate` skill | **[I]** | Highest-judgment authorial task; the driver must stay consistent with `workflow.md` phases + repo conventions held in main context. |
| 4 — `workflow.md` landing-audit | **[I]** | Authorial; small edit needing cross-file judgment (discipline section ↔ coverage convention). |
| 5 — repo `CLAUDE.md` (pointer + T2 + gotcha rewrite) | **[I]** | Highest-judgment; every line is per-turn load-bearing; depends on Task 1's verified fix. |
| 6 — `finish-session` skill (landing-audit + open-loops) | **[I]** | Authorial; integrates into an existing 374-line skill without breaking its guarantees. |
| 7 — `roadmap.md` + close tech-debt | **[I]** | Small authorial; depends on Task 1 outcome. |

**No `[S]` tasks** — this iteration is all high-judgment authorial + one interactive debug; nothing is mechanical/high-volume (contrast the prior plan's 23-file move). Per the T2 rule being landed in Task 5 ("subagent only for heavy/large"), none here qualifies.

### Static break-points (recommend `/finish-session`, user decides)

Per spec Evidence (prior redesign): **the #1 cost lever is splitting multi-wave work into fresh sessions.** At each `‖` recommend a break + `/finish-session`, then resume from a fresh context via `/iterate` (which reads this plan's checkboxes — dogfooding D1).

- **Session A** (this one): write + commit this plan. `‖`
- **Session B — Sandbox + foundations:** Task 1 (sandbox) + Task 2 (global CLAUDE.md) + Task 3 (`/iterate` skill). `‖`
- **Session C — Doc/skill landing + close:** Tasks 4–7 → gates → push → PR → recommend `/finish-session`.

### Per-task break-check (standing rule)

At the **end of every task**, before the next, estimate context pressure:

| Context used | Action |
|---|---|
| < ~1/4 window | Continue; do not break. |
| ~1/3 window (soft) | Propose a break at the **next independent task boundary**. |
| ~1/2 window (hard ceiling) | Wrap now: commit current task, recommend `/finish-session`, stop. |
| auto-compaction fired | Pause at the next task boundary regardless. |

Only break on a boundary whose **next** task is independent (no half-finished file).

### Dependency order (must hold across sessions)

```
Task 1 (sandbox fix) ─┬─→ Task 5 (CLAUDE.md gotcha rewrite needs the verified fix)
                      └─→ Task 7 (close tech-debt claude-md-tsx-sandbox-gotcha)
Task 3 (/iterate skill) ─→ Task 5 (CLAUDE.md pointer references /iterate)
Tasks 2, 4, 6 — independent.
```

---

## File Structure

**Create:**
- `.claude/skills/iterate/SKILL.md` — driver over the phases 0–7 pipeline; continue-vs-fresh routing.
- `~/.claude/CLAUDE.md` (outside repo, NOT committed) — global cross-project guidance; home for the T1 confidence-schema.

**Modify:**
- `.claude/settings.json` — sandbox filesystem write-allow for the tsx IPC-pipe dir (Task 1).
- `CLAUDE.md` — actionable workflow pointer → `/iterate`; T2 cost-discipline block; rewritten "tsx + sandbox" gotcha.
- `docs/workflow.md` — landing-audit bullet + decision→surface coverage convention.
- `.claude/skills/finish-session/SKILL.md` — landing-audit step in drift-audit; open-loops-before-close rule.
- `docs/roadmap.md` — SessionStart-hook insurance line.
- `docs/tech_debt/claude-md-tsx-sandbox-gotcha.md` — status resolved (after Task 1).

---

## Wave 0: Baseline gate

- [ ] **Step 1: Confirm tree is green before starting any wave**

This plan is doc/skill/settings-only, but a wave must never start on a red baseline.

```bash
pnpm typecheck && pnpm lint:all && pnpm test 2>&1 | tee "$TMPDIR/wave0.log"; rc=${pipestatus[1]}; echo "exit=$rc"
```
Expected: `exit=0`. (zsh: `${pipestatus[1]}` is the producer's status — CLAUDE.md pipe-exit-code pitfall. Logs to `$TMPDIR`, not `/tmp`.) `build:all`/`smoke` are NOT required (no artifact-affecting changes).

- [ ] **Step 2: Confirm branch**

```bash
git branch --show-current
```
Expected: `feature/workflow-cost-redesign` (spec: continue on this branch; master lacks the redesign docs/skills).

---

## Task 1: Diagnose + fix the tsx sandbox block (D6, H3)  `[I]`

**Files:**
- Modify: `.claude/settings.json` (the `sandbox` object).

**Context:** `pnpm exec tsx -e "..."` fails with `listen EPERM ... /tmp/claude-501/tsx-501/<pid>.pipe` even though `settings.json` has `sandbox.allowUnixSockets: ["/tmp/claude-*/tsx-*/*.pipe"]`. Spec hypotheses: (a) wrong knob — `listen`/bind creates a socket *file* = a filesystem **write**, and the sandbox filesystem write-allowlist covers `/tmp/claude` but NOT `/tmp/claude-501/tsx-501/`; (b) macOS `/tmp` → `/private/tmp` canonicalization (the write-allowlist lists both forms; our glob has only `/tmp/claude-*`). REQUIRED SUB-SKILL for this task: `superpowers:systematic-debugging`.

- [ ] **Step 1: Reproduce (confirm the failure is still live)**

```bash
pnpm exec tsx -e "console.log('tsx-ok')"
```
Expected: `Error: listen EPERM ... /tmp/claude-501/tsx-501/<pid>.pipe`. Record the exact path printed (the uid may differ from 501 on re-run — read it).

- [ ] **Step 2: Resolve the concrete path + both macOS forms**

```bash
echo "/tmp/claude-$(id -u)/tsx-$(id -u)"
echo "/private/tmp/claude-$(id -u)/tsx-$(id -u)"
```
Expected: two concrete dirs, e.g. `/tmp/claude-501/tsx-501` and `/private/tmp/claude-501/tsx-501`. These are the dirs tsx writes its `*.pipe` socket into.

- [ ] **Step 3: Apply the fix via the `/sandbox` command (filesystem write-allow)**

The leading fix is a **filesystem write-allow** for the tsx-pipe dir (not a socket-permission glob). Use the `/sandbox` command to add write access for both path forms:
- `/tmp/claude-*/tsx-*/` and `/private/tmp/claude-*/tsx-*/`

If `/sandbox` writes to `.claude/settings.json`, confirm the resulting `sandbox` object contains the write-allow entries (the exact key is whatever `/sandbox` emits — do NOT hand-fabricate a key name). Keep the existing `allowUnixSockets` entry only if removing it regresses Step 4; otherwise drop it as dead.

- [ ] **Step 4: Re-verify with NO bypass (the gate that was skipped before — H7)**

```bash
pnpm exec tsx -e "console.log('tsx-ok')"
```
Expected: prints `tsx-ok`, **no `EPERM`**. If it still fails: the write-allow path/form is wrong — inspect the errno path again and adjust (try the `/private/tmp` form explicitly; confirm the glob actually covers the printed pid-file path). Do NOT declare done until this prints clean. If after honest debugging no fix is found, STOP and document the exact root cause in `docs/pitfalls/` — do NOT mark the gotcha resolved (H7 lesson: never ship broken silently).

- [ ] **Step 5: Confirm a real tsx-spawning command also clears**

```bash
pnpm smoke 2>&1 | tail -5
```
Expected: runs without `Operation not permitted` on the pipe (smoke spawns tsx). (If smoke has unwanted side effects, substitute any tsx-spawning `pnpm` script.)

- [ ] **Step 6: Commit**

```bash
git add .claude/settings.json
git commit --no-gpg-sign -m "config(sandbox): write-allow tsx IPC pipe dir (fix listen EPERM)"
```

---

## Task 2: Create global `~/.claude/CLAUDE.md` with the confidence-schema (D3, H1, T1)  `[I]`

**Files:**
- Create: `/Users/uncerso/.claude/CLAUDE.md` (outside repo — NOT committed; verify with `ls` that it does not pre-exist before writing).

**Content (exact):**

```markdown
# Global guidance (cross-project)

Personal cross-project preferences. Project-local CLAUDE.md and direct user instructions take precedence.

## Choice questions — confidence annotation

On every choice or decision I put to you — including every `AskUserQuestion` option — annotate each option with `confidence ~X%` (= P(this is the option you'll be glad I picked)) plus one short reason ("why"). Scale: 85–95 almost certain · 65–80 leaning · 50–60 close-call · <50 leaning against. Put the top pick first, labeled `(Recommended)`. Match the percentage label to the conversation's language (e.g. `уверенность ~X%` in Russian).
```

- [ ] **Step 1: Confirm the file does not already exist**

```bash
ls -la ~/.claude/CLAUDE.md 2>&1 || echo "absent — safe to create"
```
Expected: `absent` (verified 2026-06-12). If it exists, STOP and merge rather than overwrite.

- [ ] **Step 2: Write the file** with the exact content above (Write tool, absolute path `/Users/uncerso/.claude/CLAUDE.md`).

- [ ] **Step 3: Verify**

```bash
test -f ~/.claude/CLAUDE.md && grep -qi 'confidence' ~/.claude/CLAUDE.md && grep -q 'Recommended' ~/.claude/CLAUDE.md && echo "ok"
```
Expected: `ok`. (No commit — outside the repo.)

---

## Task 3: Create the `/iterate` skill (D1, H4, H5)  `[I]`

**Files:**
- Create: `.claude/skills/iterate/SKILL.md`

**Design:** a thin driver over `docs/workflow.md` — it does NOT duplicate the phase table; it reads the doc, adds Phase-0 continue-vs-fresh routing, and a per-phase action checklist. It orchestrates existing skills (`/brainstorming`, `/writing-plans`, `executing-plans`/`subagent-driven-development`, `/finish-session`) at the right phases.

**Content (exact `SKILL.md`):**

````markdown
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
6. **Execute** — Wave-0 baseline gate; hybrid routing from the plan's tags; per-task break-check; commit code per wave. Use `executing-plans` or `subagent-driven-development`.
7. **Close** — gates green → push → PR (user reviews on GitHub) → recommend `/finish-session`.

## Rules

- Scale phases to task size (trivial = Design/Plan collapse to a sentence — `docs/workflow.md`).
- NEVER auto-invoke `/finish-session`; only recommend at break-points.
- Push + PR are user actions (CLAUDE.md § Commits).
````

- [ ] **Step 1: Create the directory and write the skill**

```bash
mkdir -p .claude/skills/iterate
```
Then Write `.claude/skills/iterate/SKILL.md` with the exact content above.

- [ ] **Step 2: Verify structure + triggers**

```bash
test -f .claude/skills/iterate/SKILL.md && echo "file ok"
grep -q 'name: iterate' .claude/skills/iterate/SKILL.md && echo "name ok"
grep -qi 'новая итерация' .claude/skills/iterate/SKILL.md && echo "ru trigger ok"
grep -q 'Phase 0' .claude/skills/iterate/SKILL.md && grep -qi 'CONTINUE' .claude/skills/iterate/SKILL.md && echo "routing ok"
grep -q 'workflow.md' .claude/skills/iterate/SKILL.md && echo "points to doc ok"
```
Expected: 5 `ok` lines.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/iterate/SKILL.md
git commit --no-gpg-sign -m "skills(iterate): driver for the workflow pipeline (phases 0–7) with continue-vs-fresh routing"
```

**Break-point ‖ — recommend `/finish-session`, resume in Session C.**

---

## Task 4: `docs/workflow.md` — landing-audit + coverage convention (D5, H6)  `[I]`

**Files:**
- Modify: `docs/workflow.md` (§ Spec & plan discipline — add one bullet; the Execution-Protocol convention note — add the coverage line).

**Add to § Spec & plan discipline (after the "Verify a plan's factual assertions" bullet):**

```markdown
- **Landing audit** — every decision in a spec MUST name the firing surface that makes it load or trigger: global/project `CLAUDE.md` (always-loaded), a skill (auto-trigger/explicit), or a hook (deterministic). A decision with no firing surface will NOT fire — it lives only in an on-demand doc nothing loads. Verify each decision names a surface before plan hand-off; a plan's coverage map maps **decision → firing-surface**, not just change-list → task. Forensics: the workflow-cost-redesign T1/T2 drop (`docs/superpowers/specs/2026-06-12-workflow-trigger-landing-design.md` § Hole-audit).
```

- [ ] **Step 1: Edit `docs/workflow.md`** — add the bullet above to § Spec & plan discipline.

- [ ] **Step 2: Verify**

```bash
grep -qi 'Landing audit' docs/workflow.md && echo "audit bullet ok"
grep -qi 'decision → firing-surface\|decision → surface\|firing surface' docs/workflow.md && echo "coverage convention ok"
wc -l docs/workflow.md
```
Expected: 2 `ok` lines; line count still small (≤ ~70).

- [ ] **Step 3: Commit**

```bash
git add docs/workflow.md
git commit --no-gpg-sign -m "docs(workflow): landing-audit — every decision names its firing surface"
```

---

## Task 5: repo `CLAUDE.md` — actionable pointer + T2 + rewritten gotcha (D2, D4, D6)  `[I]`

**Files:**
- Modify: `CLAUDE.md` (§ Workflow, § Conventions or a new § Cost discipline, § Tooling gotchas).

> Depends on Task 1 (gotcha rewrite needs the verified fix) and Task 3 (pointer references `/iterate`).

**Change 5a — actionable workflow pointer (D2):** in § Workflow, change the passive "the iteration pipeline … live in `docs/workflow.md`" into an imperative that names the skill. Add a sentence:

```markdown
**To start or continue an iteration/phase, invoke the `/iterate` skill** — it Orients from the newest session-state + the in-flight plan and routes between resuming and starting fresh. The pipeline (phases 0–7), break thresholds, and spec/plan discipline live in `docs/workflow.md`.
```

**Change 5b — T2 cost-discipline block (D4):** add a short block (in § Conventions or a new `## Cost discipline` section):

```markdown
## Cost discipline

- **Retry budget** — ≤2 attempts at the same approach; then STOP and rethink, don't keep hammering.
- **Subagent fan-out is not free** — dispatch a subagent only for heavy/large work, NOT "subagent everything" ([[feedback_execution_strategy]]).
- **Read before edit / grep callers** — keep edit:read close to ~4:1; understand before changing.
```
(Drop the `[[...]]` memory-link syntax if it reads oddly in CLAUDE.md; that linking is a memory-file convention, not a CLAUDE.md one — use plain prose.)

**Change 5c — rewrite the "tsx + sandbox" gotcha (D6 result):** replace the current bullet (which says `tsx` needs `dangerouslyDisableSandbox: true`) with the post-fix reality from Task 1. If Task 1 made tsx run in-sandbox, the new bullet states that `pnpm smoke`/`build:*`/`fixtures`/`tsx -e` now run **without** bypass (sandbox write-allows the tsx IPC-pipe dir), and drops the bypass advice. If Task 1 could NOT fix it, keep the bypass advice and update it with the confirmed root cause.

- [ ] **Step 1: Apply 5a, 5b, 5c** to `CLAUDE.md`. Apply `docs/writing-standard.md` (no preamble, MUST/NEVER modals). Keep CLAUDE.md per-turn-lean.

- [ ] **Step 2: Verify**

```bash
grep -q '/iterate' CLAUDE.md && echo "pointer ok"
grep -qi 'Retry budget' CLAUDE.md && grep -qi 'Subagent fan-out' CLAUDE.md && echo "T2 ok"
grep -qi 'tsx' CLAUDE.md && echo "gotcha present"
wc -l CLAUDE.md   # expect still < 200
```
Expected: 3 `ok` lines; CLAUDE.md < 200 lines.

- [ ] **Step 3: Confirm gotcha matches Task 1 reality** — if Task 1 fixed tsx, confirm `dangerouslyDisableSandbox` advice for tsx is gone:
```bash
grep -n 'dangerouslyDisableSandbox' CLAUDE.md
```
Expected: no tsx-bypass line (only present if Task 1 failed to fix).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit --no-gpg-sign -m "docs(claude-md): actionable /iterate pointer + cost-discipline block + rewrite tsx-sandbox gotcha"
```

---

## Task 6: `finish-session` skill — landing-audit step + open-loops rule (D5, D7, H7)  `[I]`

**Files:**
- Modify: `.claude/skills/finish-session/SKILL.md` (374 lines).

**Change 6a — landing-audit in the drift-audit (D5):** add a check to the drift-audit step: "For decisions made or changed this session, confirm each landed on a firing surface (global/project CLAUDE.md, a skill, or a hook). A decision that lives only in an on-demand doc or in memory will not reliably fire — flag it."

**Change 6b — open-loops-before-close (D7, H7):** add a rule near the session-state-writing step: "Before recommending close, every open-loop MUST be either closed this session or explicitly re-deferred with a reason in the session-state. A deferred verification (e.g. a sandbox check) MUST NOT be silently treated as done — that is how the tsx fix shipped broken (forensics: spec 2026-06-12 § Hole-audit H7)."

- [ ] **Step 1: Read the current skill** — `cat .claude/skills/finish-session/SKILL.md`.

- [ ] **Step 2: Apply 6a + 6b**, preserving the skill's existing per-item-approval / never-auto-edit / never-auto-invoke guarantees. Apply `docs/writing-standard.md`.

- [ ] **Step 3: Verify**

```bash
grep -qi 'firing surface' .claude/skills/finish-session/SKILL.md && echo "landing-audit step ok"
grep -qi 'open-loop' .claude/skills/finish-session/SKILL.md && grep -qi 're-defer\|silently' .claude/skills/finish-session/SKILL.md && echo "open-loops rule ok"
```
Expected: 2 `ok` lines.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/finish-session/SKILL.md
git commit --no-gpg-sign -m "skills(finish-session): landing-audit check + open-loops-before-close rule"
```

---

## Task 7: `docs/roadmap.md` hook-insurance line + close tech-debt (D2, H3)  `[I]`

**Files:**
- Modify: `docs/roadmap.md` (add one line under a fitting Phase 1.2 / TBD cluster).
- Modify: `docs/tech_debt/claude-md-tsx-sandbox-gotcha.md` (set status resolved — only if Task 1 fixed it).

> Depends on Task 1.

**Change 7a — roadmap line (D2):** add under an appropriate cluster (e.g. a new `### Agent workflow` cluster in Phase 1.2, or TBD):
```markdown
- **sessionstart-hook-insurance** — deterministic SessionStart hook that bootstraps `/iterate`; add only if `/iterate`-invocation drift recurs (deferred 2026-06-12, [→ spec § D2](superpowers/specs/2026-06-12-workflow-trigger-landing-design.md))
```

**Change 7b — close the tech-debt:** if Task 1 fixed the sandbox, set `docs/tech_debt/claude-md-tsx-sandbox-gotcha.md` frontmatter `status: resolved` (or remove the file if the repo convention is removal-on-resolve — check `docs/tech_debt/README.md`). Record the fix commit hash in the note. If Task 1 did NOT fix it, leave the tech-debt open and update it with the confirmed root cause.

- [ ] **Step 1: Read `docs/tech_debt/README.md`** for the resolve convention (status flip vs file removal).

- [ ] **Step 2: Apply 7a + 7b** per that convention.

- [ ] **Step 3: Verify**

```bash
grep -qi 'sessionstart-hook-insurance\|hook insurance' docs/roadmap.md && echo "roadmap line ok"
# tech-debt: either resolved status or removed file
( grep -qi 'resolved' docs/tech_debt/claude-md-tsx-sandbox-gotcha.md 2>/dev/null || test ! -f docs/tech_debt/claude-md-tsx-sandbox-gotcha.md ) && echo "tech-debt closed ok"
```
Expected: 2 `ok` lines (the tech-debt line only if Task 1 succeeded).

- [ ] **Step 4: Commit**

```bash
git add docs/roadmap.md docs/tech_debt/claude-md-tsx-sandbox-gotcha.md
git commit --no-gpg-sign -m "docs(roadmap): defer SessionStart-hook insurance; close tsx-sandbox tech-debt"
```

---

## Wave Close

- [ ] **Step 1: Full gate**

```bash
pnpm typecheck && pnpm lint:all && pnpm test 2>&1 | tee "$TMPDIR/close.log"; rc=${pipestatus[1]}; echo "exit=$rc"
```
Expected: `exit=0` (docs/skills/settings changes shouldn't affect TS/Rust).

- [ ] **Step 2: Reference + firing-surface sweep**

```bash
test -f .claude/skills/iterate/SKILL.md && echo "iterate skill present"
test -f ~/.claude/CLAUDE.md && echo "global CLAUDE.md present"
grep -q '/iterate' CLAUDE.md && echo "actionable pointer present"
grep -qi 'Retry budget' CLAUDE.md && echo "T2 landed"
grep -qi 'Landing audit' docs/workflow.md && echo "landing-audit landed"
pnpm exec tsx -e "console.log('tsx-ok')"   # expect tsx-ok, no EPERM (if Task 1 succeeded)
```
Expected: 5 `present/landed` lines + `tsx-ok`.

- [ ] **Step 3: Push + open PR (user actions — agent prepares, user runs)**

Agent hands off (CLAUDE.md § Commits — SSH is Yubikey-backed, `gh` not installed):
```
! git push -u origin feature/workflow-cost-redesign
```
+ the GitHub compare link `master...feature/workflow-cost-redesign`. PR body: "Implements docs/superpowers/specs/2026-06-12-workflow-trigger-landing-design.md (workflow trigger + landing layer) on top of the workflow-cost-redesign work; spec + plan + changes on one branch."

- [ ] **Step 4: Recommend `/finish-session`** (do NOT auto-invoke — CLAUDE.md / memory `feedback_no_auto_finish_session`). The close runs the rewritten finish-session (marker-scan + new landing-audit + open-loops check).

---

## Self-Review (plan vs spec)

**Decision coverage (D1–D7):**

| Decision | Task |
|---|---|
| D1 `/iterate` skill | Task 3 |
| D2 no-hook + actionable pointer + roadmap line | Task 5 (5a) + Task 7 (7a) |
| D3 T1 → global CLAUDE.md | Task 2 |
| D4 T2 → repo CLAUDE.md | Task 5 (5b) |
| D5 landing-audit | Task 4 (workflow.md) + Task 6 (6a, finish-session) |
| D6 sandbox fix + gotcha rewrite | Task 1 + Task 5 (5c) |
| D7 open-loops-before-close + H8 | Task 6 (6b); H8 no-action (live docs already 0–7) |

**No placeholders:** every doc/skill task ships exact content (the `/iterate` SKILL.md and global CLAUDE.md are written in full); the sandbox task gives concrete hypotheses + an ordered debug procedure + a hard "don't ship broken" stop; all verifies are exact commands with expected output.

**Decisions/risks recorded:**
- Task 1 settings key is intentionally resolved via the `/sandbox` command rather than a hand-fabricated key name (the exact `sandbox` schema for filesystem write-allow is not assumed — workflow.md "verify factual assertions" discipline).
- Global CLAUDE.md language: rule written in English (cross-project) with a note to match the percentage label to the conversation language.
- Several tasks (5c, 7b) are conditional on Task 1's outcome and carry an explicit "if the fix failed" branch — honoring the H7 lesson (never ship broken silently).
```
