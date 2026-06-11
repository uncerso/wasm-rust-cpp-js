---
name: backlog-review
description: Triage the deferred-work backlog — both docs/roadmap.md and docs/tech_debt/. Use when the user types /backlog-review or asks "разобрать backlog", "разобрать tech debt", "пройдись по roadmap", or "пройдись по tech debt". Runs two passes (roadmap, then tech-debt) plus one cross-check, batches decisions to the user, and NEVER edits or deletes without explicit confirmation.
---

# Backlog review

Triage the two separate stores of deferred work: `docs/roadmap.md` (feature-level live index) and `docs/tech_debt/` (small-fix backlog, one item per file). Keep them separate — NEVER merge the two stores into one file. Run Pass 1 over roadmap, Pass 2 over tech-debt, and the cross-check once between them. Where items originate is defined in `docs/capture-protocol.md`.

## Pass 1 — `docs/roadmap.md`

### 1. Read roadmap.md

`Read` the file `docs/roadmap.md`. Parse buckets: `## Phase X.Y`, `## TBD`, `## Won't do`. Inside each bucket parse cluster sub-headers (`### <name>`) and items (`- **<name>** — <desc> ([→ <source>](path))`).

### 2. Format audit (drift defense)

Check compliance against the conventions:

| Rule | What to check |
|---|---|
| Item prefix | Each item line starts with `- **` |
| Bold name | Between `**...**` — a kebab-case name |
| Separator | Followed by ` — ` (space + em-dash + space) |
| Source link format | If a link exists — wrapped as `([→ <text>](path))` |
| Phase headers | `## Phase X.Y` or `## TBD` or `## Won't do` (any other H2 is a violation) |
| Cluster headers | An H3 inside a Phase bucket is a cluster `### <name>` |
| Won't do entries | MUST carry `**Decided <YYYY-MM-DD>:** <rationale>` |
| Conventions section | `## Conventions` present, listing the rules |
| Dangling links | For each link `(path)` — verify `path` exists (relative to `docs/`) |

If violations are found:
- Show the user each violation with its location (line number / item name).
- For **each**, ask via `AskUserQuestion`: fix as proposed / fix differently (custom) / skip (leave the violation).
- Apply the decisions as edits.
- Move to step 3 **only after** format compliance.

If no violations — print "Format OK" and continue.

### 3. Compact display of buckets

Print a summary of each bucket:
- `## Phase X.Y`: N items (per cluster — counts).
- `## TBD`: N items.
- `## Won't do`: N items.

### 4. Triage prompt

Via `AskUserQuestion` (single or multiSelect, depending on bucket size), offer per item:

| Option | Action |
|---|---|
| promote | Move to an earlier bucket (e.g. Phase 1.2 → 1.1). |
| defer | Move to a later bucket (e.g. Phase 1.1 → 1.2, or TBD → Phase 1.2). |
| remove (done/spec'd) | Item finished, implemented, or graduated to a spec. Delete the line. If it references a tech-debt slug, ask whether to delete the tech-debt file (per the resolved → delete policy). |
| move to Won't do | Explicit rejection. Ask for a rationale plus today's date; move the entry to `## Won't do` as `- **<name>** — <desc>; **Decided <YYYY-MM-DD>:** <rationale>`. |
| skip | No change. |

With many items (>16), batch by bucket or cluster — NEVER more than 4 questions at once. Run several rounds for a large backlog.

### 5. Apply edits

Apply the user's decisions to roadmap.md. Preserve the file shape (Conventions, Phase headers, emptied sections with the placeholder `<!-- empty -->`).

When moving items between buckets, preserve clusters where possible. If a cluster becomes empty, delete its sub-header. When removing tech-debt links from roadmap.md, also consider deleting the tech-debt file (per the resolved → delete policy, `docs/tech_debt/README.md` § Status machine).

## Cross-check (roadmap ↔ tech_debt, runs once)

This bridges both passes; run it after Pass 1 edits and before Pass 2.

a. Find tech-debt items carrying a `roadmap: <phase>-candidate` frontmatter marker:
   ```
   grep -l "^roadmap:" docs/tech_debt/*.md
   ```
   For each, verify the slug is linked from at least one roadmap.md bucket. If not — **flag**: "orphan candidate: `<slug>` has a roadmap marker but is absent from roadmap.md".

b. For each `tech_debt/<slug>.md` link inside roadmap.md, verify:
   - The file exists.
   - Its frontmatter status is NOT `resolved` / `wontfix` (if it is, the item should already have been removed from roadmap.md per convention).

Show each inconsistency to the user. Via `AskUserQuestion`, propose a fix: add the link to roadmap.md (orphan candidate) / remove the link from roadmap.md (tech-debt resolved or wontfix) / skip (leave the inconsistency, usually for non-standard cases). The cross-check only **flags** — it NEVER auto-fixes.

## Pass 2 — `docs/tech_debt/`

### 6. List and group

`ls docs/tech_debt/*.md` — list items (excluding `README.md`). Resolved items are already deleted from disk (history via git log). Read the frontmatter of each file (`id`, `title`, `category`, `priority`, `status`). Skip files with `status: wontfix` — those are settled decisions and need no triage.

Group by `priority` (high → medium → low), then by `category`. Print a compact list — each item as `[category/priority] title (id)` plus 1-2 lines from its `## What` or `## Why it matters`.

### 7. Triage prompt

Ask the user in a batch via `AskUserQuestion` (multiSelect=true) which items to close or move:

| Option | Action |
|---|---|
| resolved | Item fixed. Ask for a short note (1-2 lines), then **delete the file** (history via `git log --all --full-history -- docs/tech_debt/<slug>.md`). If linked from roadmap.md, also remove that line. |
| wontfix | Item will not be fixed. Ask for a rationale, change frontmatter `status` to `wontfix`, add a `## Decision` section. The file **stays** in `docs/tech_debt/`. NEVER duplicate it into roadmap.md § Won't do — that section is for feature-level rejections only. |
| moved-to-roadmap | Item folded into the next phase plan. Delete the file; note it in the commit message as `tech_debt: <slug> moved to <plan-file>`. If linked from roadmap.md, also remove the link. |
| skip | Leave as is. |

If all items are `status: open` and the user wants to batch-resolve by type, allow multiSelect.

### 8. Apply edits

Apply the user's decisions: file deletions / status edits / roadmap.md link updates.

## Summary

Final report:
- How many items existed before review (roadmap by bucket; tech-debt count).
- Roadmap: X promoted, Y deferred, Z removed, W moved to Won't do, V skipped.
- Tech-debt: Y resolved, Z wontfix, W moved-to-roadmap, V skipped.
- How many cross-check inconsistencies were fixed.
- What remains in each store.

## Important

- NEVER make file edits or deletions without explicit confirmation via `AskUserQuestion`.
- Pass 1 format audit (step 2) MUST run before any triage. Fix formatting first.
- Keep the two stores separate — NEVER merge roadmap.md and tech_debt/ into one file.
- `wontfix` tech-debt stays in `docs/tech_debt/`; it does NOT graduate to roadmap § Won't do.
- NEVER write specs for items — graduate-to-spec is a different workflow (`superpowers:brainstorming` → `superpowers:writing-plans`).
- NEVER propose new items here — capture is the job of `docs/capture-protocol.md` during the working session.

## Cross-references

- Roadmap.md format conventions — `docs/roadmap.md` § Conventions (source of truth).
- Tech-debt format and status flow (including resolved → delete) — `docs/tech_debt/README.md` § Format and § Status machine.
- Where backlog items originate — `docs/capture-protocol.md`.
