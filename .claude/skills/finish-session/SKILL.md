---
name: finish-session
description: >
  Use ONLY when the user explicitly types /finish-session. Do not trigger on
  natural-language end-of-work phrases. Scans the transcript for `› capture:`
  markers and batch-writes them by type; audits this session's changes against
  project CLAUDE.md, README.md, docs/guidelines.md, the on-demand docs it
  touched, and project memory; surfaces drift for per-item approval; routes
  pitfalls through a 5-branch taxonomy; optionally writes a lean session-state
  snapshot. NEVER auto-applies edits, NEVER commits, NEVER auto-invokes.
---

# /finish-session

Close a working session cleanly: collect the in-session capture markers, detect
drift in living docs, route pitfalls, and optionally write a lean session-state
snapshot. The user approves each change — the skill never auto-applies.

## Why this exists

Living artifacts (CLAUDE.md, README.md, docs/guidelines.md) and project memory
drift silently between sessions: a file is renamed, a command changes shape, a
convention is introduced — but the doc describing it isn't updated in the same
commit. Session close is the cadence that catches drift while the change is
fresh. An explicit `/finish-session` (not a Stop hook) gives a clean signal
without nag fatigue: a trivial Q&A turn never warrants a doc audit.

## NEVER

- **NEVER** auto-edit any doc or memory file — surface findings, the user
  approves each.
- **NEVER** commit, push, or amend git state.
- **NEVER** auto-invoke this skill. It is *recommended* at workflow break-points;
  the decision to run it is always the user's.
- **NEVER** write a session-state snapshot or a pitfall doc unless the user agrees.
- **NEVER** audit user-level config (`~/.claude/settings.json`, hooks, global
  skills, user CLAUDE.md) — project scope only.

| Thought | Reality |
|---|---|
| "This drift is obvious, I'll just fix it" | Every edit goes through per-item approval. No exceptions. |
| "The session clearly ended, I should offer this proactively" | Phase exit ≠ session exit. Wait for the explicit command. |
| "I already staged the docs, one commit won't hurt" | Git state is untouched. The user commits. |

## Trigger semantics

Triggers **only** on an explicit `/finish-session`. Does **not** activate on
end-of-work phrases ("на сегодня всё", "wrap up", "let's close out") and is not
proactively offered. Once invoked, infer scope from any phrasing in the same
message:

- "snapshot only" (e.g. "просто напиши session-state") → skip the audit, write
  the snapshot, exit.
- "audit only" (e.g. "только проверь docs") → skip the session-state offer.
- otherwise → full flow below.

## Workflow

Execute in order. Surface progress between major steps; don't batch them into one
mega-message. Efficiency: if CLAUDE.md (or any audit target) is already in
context, do **not** re-read it wholesale — diff against what you already hold.

### 0. Establish scope

```bash
git status
git diff --stat HEAD
git log --oneline -10
```

Check `~/.claude/projects/<slug-for-cwd>/memory/` for files with mtime newer than
the first user message of this transcript (`<slug-for-cwd>` = cwd with every `/`
replaced by `-`). If the start time is unavailable, fall back to the last few
hours.

Record **which surfaces this session touched** — it drives the conditional audit
scope in step 2. A **substantive session** = ≥1 tracked file modified OR a memory
entry added/modified. Pure Q&A → apply the skip rule (Edge cases).

### 1. Scan + triage capture markers

Run the marker scanner over this session's transcript:

```bash
node scripts/scan-markers.mjs
```

It prints `{ transcript, count, byType }` for every `› capture: <type> — <slug>:
<note>` line emitted this session (convention: `docs/capture-protocol.md`).
Do **one** triage pass over all markers, then **batch-write** by type:

| Marker type | Destination |
|---|---|
| `tech-debt` | `docs/tech_debt/<slug>.md` (format: `docs/tech_debt/README.md`) |
| `roadmap` | one line in the right `docs/roadmap.md` bucket |
| `guideline-candidate` | `docs/guidelines.md` — only if it passes PG2 (changes a product engineer's decision AND is reproducible) |
| `agent-lesson` | `docs/pitfalls/` (forensics) + the actionable bit into `docs/workflow.md` |
| `pitfall` | write the forensic doc (step 4), route the prevention via the 5-branch taxonomy |

Present the batch as one approval (multiSelect). `count: 0` is normal — skip to
step 2.

### 2. Audit living docs for drift

Always audit: **CLAUDE.md**, **README.md**, **docs/guidelines.md** (if present),
**memory**. Conditionally — **only if step 0 shows the session touched the
adjacent surface** — also audit `docs/capture-protocol.md`, `docs/workflow.md`,
`docs/writing-standard.md`, and CONTRIBUTING (if it ever exists).

For each target cross-check against this session's changes:

- File paths mentioned that were moved / renamed / deleted.
- Commands whose shape changed (flags, scripts, package names).
- Conventions this session altered; architectural notes new code contradicts.
- README only: commands that no longer work, resolved/accepted limitations,
  broken links.
- Memory only: entries pointing at renamed/deleted files or invalidated claims.
  Do **not** propose *adding* memory here — that's authorial work, not drift.

**DO NOT propose phase-status updates** ("Phase X закрыт, Phase Y следующий") for
CLAUDE.md / README.md. Phase history lives in git tags, `docs/roadmap.md`, and
`docs/superpowers/plans/`. If a phase-status line is found in current text,
propose its **deletion**, not an update.

For each finding prepare a concrete diff: path, line range (or section anchor),
and exactly what changes.

### 3. Surface findings, approve, apply

Display in this canonical format (emit `- (none)` per target with no findings so
absence is visible):

```
## Audit findings

### CLAUDE.md
- [path:line] <staleness> → Proposed: <one-line diff sketch>

### README.md
- (none)

### docs/guidelines.md
- (none)

### Memory
- <file>: <staleness> → <proposed fix>
```

If all targets show `(none)`, say so and go to step 5.

Approval: ≤4 findings → one `AskUserQuestion` (multiSelect, each finding a
checkbox). >4 → per-doc walk-through (CLAUDE.md fully, then README, then
guidelines, then memory). Apply approved items (`Edit` for docs, `Write` for
memory) one at a time, showing the diff first. Declined/deferred → drop silently;
do not re-propose this session.

### 4. Route pitfalls (5-branch taxonomy)

Offer pitfall collection only if the session was substantive AND shows a
**friction signal**:

- Tool failure outside the task's scope (lint/typecheck/test fail in unrelated files).
- Plan deviation — rollback or fix-on-fix commits in one session.
- AI used a tech-debt trigger phrase ("не блокирующее", "TODO", "follow-up",
  "skipped for now", "investigation needed").
- User corrected the approach ("no, не так", "stop doing X").
- A sandbox bypass (`dangerouslyDisableSandbox: true`) was used.

No friction signals → skip silently.

For each accepted pitfall, write the forensic doc to `docs/pitfalls/YYYY-MM-DD-<slug>.md`
(format: `docs/pitfalls/README.md`), then route the **prevention mechanism**
through exactly one branch:

| # | Branch | Use when | Cost |
|---|---|---|---|
| 1 | **eliminate** | the root cause is fixable now | delete the note after the fix |
| 2 | **hook** | action-triggered + command-detectable | `PreToolUse` reminder, 0 per-turn tax, opt-in per item |
| 3 | **one-liner in CLAUDE.md** | broad recognition/process rule, not command-detectable | one line: trigger + symptom + action; forensics → link to the pitfall doc |
| 4 | **skill-checklist** | a procedure rule for one skill/phase | add it to that skill's checklist |
| 5 | **link-only** | prevention already lives in code/test/gate | no new prose; link to where it lives |

Route pitfall dispatch as **one batched question** (`AskUserQuestion`,
multiSelect for acceptance, then per-item branch). Branch 3 is the only one that
grows CLAUDE.md — prefer 1/2/4/5 when they fit; this bounds CLAUDE.md growth.
Write no pitfall doc if every candidate was discarded.

### 5. Offer a lean session-state snapshot

If substantive, offer to write:

```
docs/superpowers/session-states/session-state-YYYY-MM-DD-HHMM-slug.md
```

(note the `session-states/` dir and the `HHMM` time component; existing names are
unchanged). **Lean shape — these sections only:**

- **TL;DR** — HEAD / tag / branch / status.
- **What the next session needs.**
- **Deferred / open-loops.**
- **Resume** — the exact commands to pick up.
- **Stop point.**

**Drop:** a detailed Done list (git log has it), result numbers (the reporter has
them), brainstorm dialogue (the spec has it), and drift/pitfall/memory recaps.
When citing a regression, name the commit as `<short-sha>: <subject>`, never a
wave/session name — forensics degrade when attribution is wave-level.

If the user declines → skip.

### 6. One-sentence summary

E.g. "Wrote 1 tech-debt note, updated CLAUDE.md (2 lines), wrote
session-state-2026-06-11-2300-redesign.md." Don't ask "anything else?" — let the
user steer.

## Edge cases & skip rules

- **Pure Q&A** (no file changes, no memory mtime shifts): skip steps 1–4; offer a
  snapshot only if the user wants continuity; else exit.
- **"snapshot only"**: skip steps 1–4; do step 5; exit.
- **"audit only"**: do steps 0–4; skip step 5.
- **Multi-repo session** (cwd changed mid-session): audit only the active repo
  (cwd at invocation).
- **Plan mode active**: read-only steps and the approval UI work; writes (apply,
  snapshot) are blocked — ask the user to exit plan mode before applying.

## Recall hierarchy

When recovering prior context, search in order: **project memory → session-state
→ `remembering-conversations`**. The conversation search is a fallback, not a
routine step.

## Composition

- **`/research`**: if a finding is a design question (not a simple diff), suggest
  `/research` for a separate brainstorm — suggest only, don't pivot into it.
- **`/backlog-review`**: out of scope. This skill does not invoke it, check its
  cadence, or recommend running it. The user runs it when they wish.
- **`/finishing-a-development-branch`**: orthogonal (in-repo branch closure) —
  don't chain.

## Tone

Terse. The user is winding down. Each proposal is 1–2 sentences; no
re-explanation of why a finding matters unless asked.

## Validation

Before the step 6 summary, confirm:

- □ Marker scan ran; every marker was triaged (or `count: 0`)?
- □ Every edit went through explicit per-item approval (no auto-apply)?
- □ Git state untouched — no commit, push, or amend?
- □ Only project-scope targets audited (no user-level config)?
- □ No phase-status updates proposed for CLAUDE.md / README.md?
- □ Each accepted pitfall routed through exactly one taxonomy branch?
- □ Pitfall / session-state files written only if the user accepted them?
