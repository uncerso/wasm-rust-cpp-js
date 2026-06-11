# Workflow & Cost Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure *how* we work with the AI agent in this repo — cut token cost (short sessions + lean per-turn docs), make the iteration pipeline explicit, and make knowledge capture cheap + reliable.

**Architecture:** Doc-only + skill + settings changes. Move situational content out of the per-turn-loaded `CLAUDE.md` into on-demand docs (`docs/capture-protocol.md`, `docs/workflow.md`, `docs/writing-standard.md`); relocate 23 session-state snapshots into `docs/superpowers/session-states/` with a single mechanical reference transform; merge two review skills into one; rewrite `finish-session` around a transcript marker-scan and a 5-branch pitfall-routing taxonomy; add a tiny marker-scanner script and sandbox/permission settings. No production code (`benches/`, `packages/`, `apps/`) is touched — gates exist only to prove nothing broke.

**Tech Stack:** Markdown docs, Claude Code skills (`.claude/skills/*/SKILL.md`), `.claude/settings*.json`, one Node ESM script (`scripts/scan-markers.mjs`).

**Source of truth:** `docs/superpowers/specs/2026-06-11-workflow-cost-redesign-design.md` (decisions T1–T6, change-list, coverage map). Where this plan quotes the spec, the spec wins on intent.

---

## Execution Protocol

This plan introduces the convention that *every* plan carries this section (change-list item 10). It is also the operative protocol for executing this plan.

### Hybrid routing map (inline `[I]` vs subagent `[S]`)

| Task | Route | Reason |
|---|---|---|
| 1 — move session-states + ref transform | **[S]** | Mechanical, high-volume (23 moves + repo-wide `sed`), zero judgment. Ideal subagent: keeps a verifiable grep contract, never touches main context with file dumps. |
| 2 — `docs/capture-protocol.md` | **[I]** | Authorial; must stay internally consistent with spec T4 + the trigger stub left in CLAUDE.md. |
| 3 — `docs/workflow.md` | **[I]** | Authorial; tiny index, needs cross-file judgment (phase table ↔ skill ownership). |
| 4 — `docs/writing-standard.md` | **[I]** | Authorial; PB5 checklist is the writing standard the rest of the work is held to. |
| 5 — rewrite CLAUDE.md | **[I]** | Highest-judgment task; every cut must preserve a per-turn-load-bearing fact or route it to a taxonomy branch. |
| 6 — merge skills → `/backlog-review` | **[S]** | Spec-tagged [S]. Delicate but well-scoped: detailed merge spec below makes it mechanical-enough for a subagent. Two-stage review on return. |
| 7 — rewrite finish-session | **[I]** | Highest-judgment; integrates marker-scan + taxonomy + lean shape; must wire to Tasks 1/2/6 outputs. |
| 8 — `scripts/scan-markers.mjs` | **[I]** | Small but exact; verified by running against the live transcript. |
| 9 — PB8 sandbox + permission settings | **[I]** | Uses `/fewer-permission-prompts` + `/update-config` skills interactively; needs main-session context. |
| 10 — README trim | **[I]** | Authorial anti-fluff judgment. |
| 11 — memory + tech-debt convention updates | **[I]** | Authorial; touches the user's memory dir (outside repo). |

When a subagent task returns, apply two-stage review (subagent-driven-development): (1) verify the grep/line-count contract; (2) read the diff for intent drift.

### Static break-points (recommend `/finish-session`, user decides)

Per spec Evidence: **the #1 cost lever is splitting multi-wave work into fresh sessions.** Execute in these session-groups; at each `‖` recommend a break + `/finish-session`, then resume from a fresh context reading this plan:

- **Session A** (this one): write + commit this plan. `‖`
- **Session B — Foundation:** Wave 1 (Task 1) + Wave 2 (Tasks 2–4). `‖`
- **Session C — Core rewrites:** Wave 3 (Task 5) + Wave 4 (Task 6). `‖`
- **Session D — Close:** Wave 5 (Tasks 7–8) + Wave 6 (Tasks 9–11) → gates → push → PR → recommend `/finish-session`.

### Per-task break-check (standing rule)

At the **end of every task**, before starting the next, estimate context pressure:

| Context used | Action |
|---|---|
| < ~1/4 window | Continue; do not break. |
| ~1/3 window (soft) | Propose a break at the **next independent task boundary**. |
| ~1/2 window (hard ceiling) | Wrap now: commit current task, recommend `/finish-session`, stop. |
| auto-compaction fired | Pause at the next task boundary regardless of estimate. |

Only break on a task boundary whose **next** task is independent (no half-finished file). Dependencies (below) define which boundaries are safe.

### Dependency order (must hold across sessions)

```
Task 1 (move) ─┐
Task 2 (capture-protocol) ─┬─→ Task 5 (CLAUDE.md)
Task 3 (workflow.md) ──────┘
Task 4 (writing-standard) ─→ Task 5
Task 2 ─→ Task 6 (backlog-review merge)  [skill references capture-protocol.md]
Task 1 + Task 2 + Task 6 ─→ Task 7 (finish-session)  [needs new dir + protocol + merged skill name]
Task 8 (scanner) ─→ Task 7  [finish-session calls the scanner]
Task 1 ─→ Task 11 (memory)  [path transform precedes convention rewrite]
```

---

## File Structure

**Create:**
- `docs/superpowers/session-states/` (dir) — new home for all session-state snapshots.
- `docs/capture-protocol.md` — full capture protocol + marker convention + 5 marker types (incl. `agent-lesson`).
- `docs/workflow.md` — tiny phase index (0–8) + ownership table + Execution-Protocol convention note. English, ~40 lines.
- `docs/writing-standard.md` — PB5 anti-fluff checklist (8 rules). English.
- `docs/tech_debt/docs-language-consistency.md` — tech-debt note.
- `scripts/scan-markers.mjs` — transcript marker scanner.

**Modify:**
- `CLAUDE.md` — trim situational content → pointers; translate to English; target < 200 lines.
- `README.md` — strip `file:line` internals from Debug-timings; anti-fluff pass.
- `.claude/skills/backlog-review/SKILL.md` — absorb tech-debt triage; English; reference `docs/capture-protocol.md`.
- `.claude/skills/finish-session/SKILL.md` — marker-scan, 5-branch pitfall routing, lean session-state shape, new dir + HHMM, conditional audit-scope, `/backlog-review` refs.
- `.claude/settings.json` and/or `.claude/settings.local.json` — sandbox write-allow + permission allowlist.
- 23 session-state files + their path-bearing references repo-wide (Task 1).
- Memory files (`~/.claude/projects/-Users-uncerso-src-wasm-rust-cpp-js/memory/`): `reference_session_state.md`, `project_wasm_benchmarks.md`, `MEMORY.md`, `feedback_no_auto_finish_session.md`.

**Delete:**
- `.claude/skills/tech-debt-review/` — retired after merge into `/backlog-review`.

---

## Wave 0: Baseline gate

- [ ] **Step 1: Confirm tree is green before starting any wave**

This plan is doc/skill-only, but a wave must never start on a red baseline (CLAUDE.md "Plan executor protocol", Wave 0).

Run (sandbox bypass required for `tsx`/build/smoke per CLAUDE.md):
```bash
pnpm typecheck && pnpm lint:all && pnpm test 2>&1 | tee /tmp/wave0.log; rc=${PIPESTATUS[0]}; echo "exit=$rc"
```
Expected: `exit=0`. (Use `${PIPESTATUS[0]}`, not the pipe's exit code — CLAUDE.md pipe-exit-code pitfall.)

`pnpm build:all && pnpm smoke` is **not** required for this plan (no artifact-affecting changes) — skip to save cost. If a later task unexpectedly touches buildable code, STOP and re-scope.

- [ ] **Step 2: Confirm branch**

Run: `git branch --show-current`
Expected: `feature/workflow-cost-redesign`. All commits land here; master changes only via the final PR merge (spec SC-branch, model A).

---

## Wave 1 — Relocate session-states + transform references  `[S]`

### Task 1: Move 23 session-state files into `session-states/` and fix path references

**Files:**
- Move: `docs/superpowers/session-states/session-state-*.md` (23 files) → `docs/superpowers/session-states/`
- Modify (path transform): every repo file containing the substring `superpowers/session-states/session-state-` or `../session-states/session-state-`, plus memory files under `~/.claude/projects/-Users-uncerso-src-wasm-rust-cpp-js/memory/`.

**Transform rule (the entire judgment, pre-decided):**
- Path-prefixed refs `superpowers/session-states/session-state-` → `superpowers/session-states/session-state-`. This catches absolute paths (`docs/superpowers/session-states/session-state-X.md`) AND globs (`docs/superpowers/session-states/session-state-*.md`). It is idempotent: `session-states/` does **not** contain the substring `session-state-` (after `session-state` comes `s`, not `-`), so already-correct refs (e.g. in the 2026-06-11 spec) are untouched.
- Relative refs `../session-states/session-state-` → `../session-states/session-state-` (cross-links in `docs/superpowers/specs/*.md`).
- **Leave alone:** bare-filename refs with no path prefix (`session-state-X.md` inside prose, or co-located sibling refs between two session-state files) — these self-heal because both files end up in the same `session-states/` dir; and narrative mentions of the phrase "session-state" with no `.md` path.

> Subagent dispatch prompt (paste verbatim into the [S] task):
>
> "In /Users/uncerso/src/wasm-rust-cpp-js perform a mechanical file move + reference transform. Do NOT exercise judgment beyond the rule; report a grep contract at the end.
> 1. `mkdir -p docs/superpowers/session-states`
> 2. `git mv` each `docs/superpowers/session-states/session-state-*.md` into `docs/superpowers/session-states/` (preserve history; 23 files).
> 3. Repo-wide, in every tracked text file, replace substring `superpowers/session-states/session-state-` → `superpowers/session-states/session-state-` and `../session-states/session-state-` → `../session-states/session-state-`. Apply to `.md`, `CLAUDE.md`, and `.claude/skills/**/SKILL.md`. Do NOT alter bare filenames lacking a path prefix.
> 4. Also apply the same two substring replacements to the user's memory files at `/Users/uncerso/.claude/projects/-Users-uncerso-src-wasm-rust-cpp-js/memory/*.md` (path-prefix only — do NOT rewrite convention prose there; that is a separate later task).
> 5. Report: output of `ls docs/superpowers/session-states/session-state-*.md` (must be empty/no-match), `ls docs/superpowers/session-states/ | wc -l` (must be 23), `git grep -n 'superpowers/session-states/session-state-'` (must be 0 matches), `git grep -n '\.\./session-state-'` (must be 0 matches), and `git status --short`."

- [ ] **Step 1: Create the directory and move the files**

```bash
mkdir -p docs/superpowers/session-states
git mv docs/superpowers/session-states/session-state-*.md docs/superpowers/session-states/
```
Expected: 23 files staged as renames.

- [ ] **Step 2: Apply the path transform repo-wide**

```bash
# tracked files containing a path-prefixed session-state reference:
git grep -lZ -e 'superpowers/session-states/session-state-' -e '\.\./session-state-' \
  | xargs -0 sed -i '' \
      -e 's#superpowers/session-states/session-state-#superpowers/session-states/session-state-#g' \
      -e 's#\.\./session-state-#../session-states/session-state-#g'
```
(macOS `sed -i ''`. The moved files themselves are now under `session-states/`; their internal self-refs get fixed by the same transform — intended, per spec "immutable specs — правки чисто механические".)

- [ ] **Step 3: Transform the memory files (path-prefix only)**

```bash
MEM=/Users/uncerso/.claude/projects/-Users-uncerso-src-wasm-rust-cpp-js/memory
grep -lZ -e 'superpowers/session-states/session-state-' "$MEM"/*.md \
  | xargs -0 sed -i '' -e 's#superpowers/session-states/session-state-#superpowers/session-states/session-state-#g'
```
Leave convention prose (HHMM naming, lean shape) for Task 11.

- [ ] **Step 4: Verify the grep contract**

```bash
ls docs/superpowers/session-states/session-state-*.md 2>&1            # expect: no matches
ls docs/superpowers/session-states/*.md | wc -l         # expect: 23
git grep -n 'superpowers/session-states/session-state-'                # expect: (no output)
git grep -n '\.\./session-state-'                       # expect: (no output)
```
All four must hold. If `git grep` finds a straggler, it is a path-prefixed ref the transform missed — inspect and fix.

- [ ] **Step 5: Spot-check a relative cross-link resolves**

Confirm one spec's `../session-states/session-state-...md` target exists:
```bash
test -f docs/superpowers/session-states/session-state-2026-05-23-phase-1-1-1-closed.md && echo OK
```
Expected: `OK` (this is the target of the relative link in `specs/2026-05-23-phase-1-1-2-hashmap-design.md:460`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit --no-gpg-sign -m "docs(session-states): relocate snapshots to session-states/ + fix path refs"
```

---

## Wave 2 — New canonical docs  `[I]`

### Task 2: Create `docs/capture-protocol.md`

**Files:**
- Create: `docs/capture-protocol.md`
- Source material: current `CLAUDE.md` § "Tech-debt capture" (lines ~228–256) and § "Roadmap capture" (lines ~257–288). These move here; CLAUDE.md keeps only a trigger stub (Task 5).

**Required content (sections):**
1. **In-session marker convention (PB6).** Exact line format the agent emits inline (0 round-trips, persists in transcript):
   ```
   › capture: <type> — <slug>: <one-line note>
   ```
   `<type>` ∈ `{tech-debt, roadmap, guideline-candidate, agent-lesson, pitfall}`. Markers are collected at `/finish-session` by `scripts/scan-markers.mjs` (Task 8) → one triage → batch write. Document that emitting a marker is *not* a round-trip and never blocks the current task.
2. **Marker types** — one paragraph each:
   - `tech-debt` — small fix < 1 day, single file/function → `docs/tech_debt/<slug>.md` (format: `docs/tech_debt/README.md`).
   - `roadmap` — feature/runtime-axis/infra epic needing a spec → one line in `docs/roadmap.md` bucket (format: `docs/roadmap.md` Conventions).
   - `guideline-candidate` — confirmed reproducible product-relevant finding → `docs/guidelines.md` (PG2 test: "does it change a product engineer's decision — language/toolchain/flag/pattern — and is it reproducible?"; no → literature, not a guideline).
   - `agent-lesson` — how-to-work-with-the-agent lesson (PG3) → lives in `docs/pitfalls/` with actionable bits in `docs/workflow.md`; graduates to `docs/agent-guidelines.md` (format-B claims) at an evidence threshold.
   - `pitfall` — execution lesson → routed by the 5-branch taxonomy at `/finish-session` (see `finish-session` skill).
3. **Tech-debt vs roadmap boundary** — port the existing CLAUDE.md boundary text (tech-debt = small/single-file; roadmap = feature/axis/epic).
4. **What NOT to capture** — port the existing "Что НЕ предлагать" lists for both tech-debt and roadmap.
5. **Trigger phrases** — port both phrase lists (tech-debt: "process gap, latent bug, should fix later, open review ticket, investigation needed, не блокирующее, TODO, follow-up, skipped for now, нужно разобраться позже"; roadmap: "new workload, new axis, browser support, runtime profile, future phase, big feature, requires spec, after Phase X.Y, separate effort needed, отдельная фаза, требует дизайна").
6. **Periodic triage pointer** — `/backlog-review` triages both `docs/roadmap.md` and `docs/tech_debt/` (post-merge, Task 6).

- [ ] **Step 1: Read the source sections** — `CLAUDE.md` lines 228–288 (already in plan context; re-confirm with `sed -n '228,295p' CLAUDE.md` if needed).
- [ ] **Step 2: Write `docs/capture-protocol.md`** with sections 1–6 above. English. Apply the writing-standard (Task 4): no preamble, NEVER/MUST modals, tables for the type list if it reads cleaner.
- [ ] **Step 3: Verify** — `test -f docs/capture-protocol.md && grep -c '› capture:' docs/capture-protocol.md` (expect ≥1). Confirm all 5 types present: `for t in tech-debt roadmap guideline-candidate agent-lesson pitfall; do grep -q "$t" docs/capture-protocol.md && echo "$t ok"; done` (expect 5 lines).
- [ ] **Step 4: Commit** — `git add docs/capture-protocol.md && git commit --no-gpg-sign -m "docs(capture): full capture protocol + marker convention"`

### Task 3: Create `docs/workflow.md`

**Files:**
- Create: `docs/workflow.md` (target ~40 lines, English; split into 2 skills only if it exceeds ~60 lines — spec T6).

**Required content:**
1. One-line purpose: the iteration pipeline (single adaptive lane; phases auto-scale to task size).
2. **Phase table 0–8** — port spec T5 table verbatim (intent), English, columns `# | Phase | What | Owner/details`:

   | # | Phase | What |
   |---|---|---|
   | 0 | Orient | read lean session-state; `git branch --merged master` → offer to delete merged `feature/*`; remembering-conversations only as fallback |
   | 1 | Select | roadmap + tech_debt; if backlog stale → `/backlog-review`; propose a slice (importance × deps × grouping); tech-debt enters as batch-iteration or stitched as first task; confirm |
   | 2 | Branch | `feature/<phase>-<slug>` from master |
   | 3 | Design | `/brainstorming` (scales: trivial = a couple of sentences) → spec; **commit spec to branch** |
   | 4 | Plan | `/writing-plans` → plan **with embedded Execution Protocol**; **commit plan to branch** |
   | → | Break | **recommend** `/finish-session` (user decides) |
   | 5 | Orient | read session-state |
   | 6 | Execute | Wave-0 baseline gate; hybrid routing from plan tags (kickoff confirm); **per-task break-check**; code commits to branch |
   | 7 | Close | gates green → push → PR (user reviews on GitHub); **recommend** `/finish-session` (marker-scan → triage → batch capture; drift audit; lean session-state) |

3. **Execution-Protocol convention (change-list item 10):** every plan written via `/writing-plans` MUST contain an "Execution Protocol" section = hybrid map (inline/subagent per task) + static break-points + standing per-task break-check rule. State this as a NEVER-skip convention. (Enforced here because the `writing-plans` plugin skill is in the plugin cache and not reliably editable; this doc + the CLAUDE.md pointer are the durable home.)
4. **Ownership table** — one line each mapping concern → home: capture → `docs/capture-protocol.md`; writing standard → `docs/writing-standard.md`; backlog/tech-debt triage → `/backlog-review`; session close → `finish-session` skill; guidelines → `docs/guidelines.md`; pitfalls → `docs/pitfalls/`.
5. **Break thresholds:** ~1/3 window soft, ~1/2 hard ceiling, < ~1/4 don't break; after auto-compaction pause at next boundary. Only break on boundaries with an independent next task.

- [ ] **Step 1: Write `docs/workflow.md`** with sections 1–5. English, ≤ ~60 lines.
- [ ] **Step 2: Verify** — `test -f docs/workflow.md && wc -l docs/workflow.md` (expect ≤ ~60); `grep -q 'Execution Protocol' docs/workflow.md && echo OK`.
- [ ] **Step 3: Commit** — `git add docs/workflow.md && git commit --no-gpg-sign -m "docs(workflow): tiny pipeline index + Execution-Protocol convention"`

### Task 4: Create `docs/writing-standard.md`

**Files:**
- Create: `docs/writing-standard.md` (English).

**Required content — PB5 anti-fluff checklist (writing-standard, spec T3), all 8 rules:**
1. No preamble / no restating the question — start with the action.
2. Soft modals → `NEVER`/`MUST` by severity.
3. Comparison of 3+ proposals → table.
4. For discipline rules — add a rationalization table.
5. Red-flags before decisions.
6. One working example, not multi-language.
7. For output-generating docs — state a density target.
8. Validation checklist at the end (recency).

State this is the default inline writing standard for all prose humans read in this repo. Note: the full `writing-clearly-and-concisely` skill is loaded **only via a subagent on a polish pass** (read + persistence is costly — spec GM2); the distilled cheat-sheet lives in tech-debt `writing-clearly-distillation` (already created).

- [ ] **Step 1: Write `docs/writing-standard.md`** with the 8 rules + the subagent-polish note.
- [ ] **Step 2: Verify** — `test -f docs/writing-standard.md && grep -c '^[0-9]' docs/writing-standard.md` (expect ≥8 numbered rules, adjust if formatted as a table).
- [ ] **Step 3: Commit** — `git add docs/writing-standard.md && git commit --no-gpg-sign -m "docs(writing-standard): PB5 anti-fluff checklist"`

**Break-point ‖ — recommend `/finish-session`, resume in Session C.**

---

## Wave 3 — Trim CLAUDE.md  `[I]`

### Task 5: Rewrite `CLAUDE.md` — English, < 200 lines, situational content → pointers

**Files:**
- Modify: `CLAUDE.md` (currently ~295 lines, mixed RU/EN → target ~130, < 200, English).

**Doc-role model (spec T3):** CLAUDE.md keeps only what is needed **almost every turn**. Everything situational routes to an on-demand doc or a pitfall-taxonomy branch.

**Keep in CLAUDE.md (per-turn load-bearing):**
- Project overview (≤ 6 lines) + north-star (3 goals incl. PG3 agent best-practices).
- Canonical context sources (the bulleted list of where to read what) — but update `docs/superpowers/session-states/session-state-*.md` → `session-states/...` (already done by Task 1) and add `docs/capture-protocol.md`, `docs/workflow.md`, `docs/writing-standard.md`.
- A **3-line workflow pointer** → `docs/workflow.md` (phases 0–8; Execution-Protocol convention is mandatory in every plan).
- Conventions (TS style, Rust style) — relevant on every edit. Keep.
- A **capture trigger stub** (~8 lines): the trigger sentence ("when you notice X, stop once and offer to capture") + the marker line format `› capture: <type> — <slug>: <note>` + a pointer to `docs/capture-protocol.md` for the full protocol, types, and phrase lists. Do NOT keep the full phrase lists or the "what NOT to capture" lists here.
- Tooling-environment gotchas — compress each of the 5 bullets to a **one-liner** (taxonomy branch 3: trigger + symptom + action; forensics → link to the pitfall doc). Keep these one-liners (they fire per-turn): cargo workspace-root `target/`; tsx + sandbox needs `dangerouslyDisableSandbox`; pipe exit-code (`${PIPESTATUS[0]}`); `git stash` unreliable under sandbox; subagent-divergence load-bearing check.
- Commits: `--no-gpg-sign` authorized (1 line).

**Move OUT of CLAUDE.md:**
- Full "Tech-debt capture" + "Roadmap capture" protocols → `docs/capture-protocol.md` (Task 2). Leave only the trigger stub.
- "Common commands" build/test/bench blocks → replace with a 2-line pointer to `README.md` (commands live there).
- "Spec & plan conventions" (pre-flight gate, plan-executor protocol, Wave-2 eval gate, ephemeral-path audit, mechanism-check) → these are phase-local (spec/plan/execute only). Move to `docs/workflow.md` and/or the relevant skill checklists (taxonomy branch 4); keep a 1-line pointer.
- "Guidelines artifact" full format spec → keep a 2-line pointer to `docs/guidelines.md` (the format convention is consulted only when editing guidelines, not per-turn).

- [ ] **Step 1: Confirm current length** — `wc -l CLAUDE.md` (record baseline).
- [ ] **Step 2: Rewrite CLAUDE.md** to the "Keep" outline above, in English, moving the "Move OUT" content to its destinations (which already exist from Wave 2). Every removed fact must be either (a) a pointer to its new home, or (b) demonstrably already-loaded elsewhere on demand. Apply `docs/writing-standard.md`.
- [ ] **Step 3: Verify length + pointers resolve**

```bash
wc -l CLAUDE.md                                              # expect < 200 (target ~130)
for d in docs/capture-protocol.md docs/workflow.md docs/writing-standard.md; do grep -q "$d" CLAUDE.md && echo "ptr $d ok"; done   # expect 3 lines
grep -q '› capture:' CLAUDE.md && echo "marker stub ok"      # trigger stub retained
grep -qi 'PIPESTATUS' CLAUDE.md && echo "pipe one-liner ok"  # per-turn gotcha retained
```

- [ ] **Step 4: Sanity — no orphaned facts** — grep CLAUDE.md for the moved-out headers; confirm they survive as pointers, not full text:
```bash
grep -nE 'Tech-debt capture|Roadmap capture|Common commands' CLAUDE.md   # expect pointers only, no multi-line bodies
```
- [ ] **Step 5: Commit** — `git add CLAUDE.md && git commit --no-gpg-sign -m "docs(claude-md): trim to per-turn essentials, English, pointers to on-demand docs"`

---

## Wave 4 — Merge review skills  `[S]`

### Task 6: Merge `tech-debt-review` into `/backlog-review`; retire `tech-debt-review`

**Files:**
- Modify: `.claude/skills/backlog-review/SKILL.md` (124 lines → absorbs tech-debt triage; English).
- Delete: `.claude/skills/tech-debt-review/` (37-line skill, retired).
- Modify: any live reference to `/tech-debt-review` → `/backlog-review` (CLAUDE.md, finish-session skill — finish-session is rewritten in Task 7, so coordinate). **Do not** edit immutable specs/plans that historically reference it.

**Merge design (single `/backlog-review`, English, separate storages, keep format-audit — spec EQ1/Skills):**
- Description (frontmatter): triages BOTH `docs/roadmap.md` AND `docs/tech_debt/`. Triggers: `/backlog-review`, "разобрать backlog", "разобрать tech debt", "пройдись по roadmap/tech debt". Retire `/tech-debt-review` as a name.
- **Storages stay separate** — roadmap.md (phase buckets, format-audit) and tech_debt/ (frontmatter files, priority/category) are NOT merged into one file (spec Non-goals).
- Procedure (two passes, one skill):
  - **Pass 1 — roadmap.md:** keep backlog-review's existing 7 steps verbatim (read → **format audit** (multi-rule compliance table — preserve; spec: skill is rare, format matters more than overhead) → cross-check tech_debt links → display → batch-triage promote/defer/remove/won't-do/skip → apply → summary).
  - **Pass 2 — tech_debt/:** fold in tech-debt-review's logic (list & group by priority/category → frontmatter check → batch-ask resolved/wontfix/moved-to-roadmap/skip → apply → summary). `wontfix` stays in tech_debt (does NOT graduate to roadmap § Won't do).
  - Cross-check (roadmap ↔ tech_debt links + `roadmap: <phase>-candidate` orphans) runs once, bridging both passes.
- Reference `docs/capture-protocol.md` (Task 2) for "where items come from" (was "CLAUDE.md § Tech-debt capture").
- Translate to English.

> Subagent dispatch prompt (paste into the [S] task): "In /Users/uncerso/src/wasm-rust-cpp-js merge the `tech-debt-review` skill into `backlog-review`. Read `.claude/skills/backlog-review/SKILL.md` and `.claude/skills/tech-debt-review/SKILL.md` first. Produce a single English `.claude/skills/backlog-review/SKILL.md` that triages BOTH `docs/roadmap.md` (Pass 1: existing 7 steps incl. the full format-audit compliance table — preserve it) AND `docs/tech_debt/` (Pass 2: list/group by priority+category → batch-ask resolved/wontfix/moved-to-roadmap/skip; wontfix stays in tech_debt). Keep storages separate (do not merge the files). Reference `docs/capture-protocol.md` for where items originate. Then `git rm -r .claude/skills/tech-debt-review/`. Report: the new SKILL.md section headers, `wc -l`, confirmation the format-audit table survived, and `git grep -n '/tech-debt-review'` (so I can fix live references)."

- [ ] **Step 1: Read both skills** (subagent) and author the merged English `backlog-review/SKILL.md`.
- [ ] **Step 2: Delete the retired skill** — `git rm -r .claude/skills/tech-debt-review/`
- [ ] **Step 3: Fix live `/tech-debt-review` references** — `git grep -n '/tech-debt-review'`. Update CLAUDE.md (capture trigger pointer) to `/backlog-review`. Leave immutable specs/plans/pitfalls (frozen history) as-is. (finish-session refs handled in Task 7.)
- [ ] **Step 4: Verify**
```bash
test ! -d .claude/skills/tech-debt-review && echo "retired ok"
grep -qi 'tech_debt' .claude/skills/backlog-review/SKILL.md && echo "tech-debt pass present"
grep -qi 'format' .claude/skills/backlog-review/SKILL.md && echo "format audit retained"
git grep -n '/tech-debt-review' -- ':!docs/superpowers/specs' ':!docs/superpowers/plans' ':!docs/pitfalls'   # expect 0 live refs
```
- [ ] **Step 5: Commit** — `git add -A && git commit --no-gpg-sign -m "skills(backlog-review): absorb tech-debt-review, retire it, English"`

**Break-point ‖ — recommend `/finish-session`, resume in Session D.**

---

## Wave 5 — finish-session rewrite + marker scanner  `[I]`

### Task 8: Create `scripts/scan-markers.mjs`

> Done **before** Task 7 because finish-session calls it.

**Files:**
- Create: `scripts/scan-markers.mjs`

**Behavior:** read a Claude Code transcript JSONL, extract `› capture:` markers from assistant text blocks, group by type, print JSON. The external transcript path is a *runtime argument* (or newest `.jsonl` in the project dir), not a build dependency — this satisfies CLAUDE.md ephemeral-path audit (the script's purpose is to read the transcript).

- [ ] **Step 1: Write `scripts/scan-markers.mjs`**

```js
#!/usr/bin/env node
// Scan a Claude Code transcript for in-session capture markers (PB6).
// Usage: node scripts/scan-markers.mjs [transcript.jsonl]
// Default: newest .jsonl in ~/.claude/projects/<cwd-slug>/
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MARKER = /^›\s*capture:\s*(\S+)\s*—\s*([^:]+):\s*(.+)$/;

function resolveTranscript(argPath) {
    if (argPath) {
        return argPath;
    }
    const slug = process.cwd().replaceAll("/", "-");
    const dir = join(homedir(), ".claude", "projects", slug);
    const files = readdirSync(dir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => join(dir, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (files.length === 0) {
        throw new Error(`no .jsonl transcript in ${dir}`);
    }
    return files[0];
}

const path = resolveTranscript(process.argv[2]);
const markers = [];
for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) {
        continue;
    }
    let rec;
    try {
        rec = JSON.parse(line);
    } catch {
        continue;
    }
    const content = rec?.message?.content;
    if (!Array.isArray(content)) {
        continue;
    }
    for (const block of content) {
        if (block?.type !== "text") {
            continue;
        }
        for (const textLine of block.text.split("\n")) {
            const m = MARKER.exec(textLine.trim());
            if (m) {
                markers.push({ type: m[1], slug: m[2].trim(), note: m[3].trim() });
            }
        }
    }
}
const byType = {};
for (const mk of markers) {
    (byType[mk.type] ??= []).push(mk);
}
console.log(JSON.stringify({ transcript: path, count: markers.length, byType }, null, 2));
```

- [ ] **Step 2: Run it against the live transcript**

```bash
node scripts/scan-markers.mjs 2>&1 | tail -20
```
Expected: valid JSON with `transcript`, `count`, `byType` keys (count may be 0 if no markers emitted yet — that is a pass; the parse succeeding is the contract).

- [ ] **Step 3: Confirm lint doesn't choke** — `pnpm lint:ts 2>&1 | tail -5` (`.mjs` may be outside the lint glob; if ESLint flags it, either add it to the ignore list consistent with `glue.mjs` handling, or fix the lint). Expected: clean or untracked-by-lint.
- [ ] **Step 4: Commit** — `git add scripts/scan-markers.mjs && git commit --no-gpg-sign -m "scripts(scan-markers): collect in-session capture markers from transcript"`

### Task 7: Rewrite `.claude/skills/finish-session/SKILL.md`

**Files:**
- Modify: `.claude/skills/finish-session/SKILL.md` (374 lines).

**Changes (spec T4 + change-list item 7):**
1. **Marker-scan step (new, before drift audit):** run `node scripts/scan-markers.mjs` → collect `› capture:` markers → **one** triage pass → batch-write by type (tech-debt → `docs/tech_debt/`; roadmap → `docs/roadmap.md`; guideline-candidate → `docs/guidelines.md`; agent-lesson → `docs/pitfalls/` + `docs/workflow.md`; pitfall → routed by taxonomy below). This is the deterministic capture mechanism (replaces ad-hoc in-session capture round-trips).
2. **Pitfall-routing taxonomy (5 branches)** — replace the current "inline vs tech-debt" dispatch with:
   - (1) **eliminate** — fix the root cause, delete the note.
   - (2) **hook** — action-triggered `PreToolUse` reminder (0 per-turn tax; opt-in per item).
   - (3) **one-liner in CLAUDE.md** — recognition/process, broad, not command-detectable; store trigger + symptom + action, forensics → link.
   - (4) **skill-checklist** — a procedure rule (spec/execution) → into that skill's checklist.
   - (5) **link-only** — prevention already lives in code/test/gate.
   Route each accepted pitfall through one of these. This bounds CLAUDE.md growth.
3. **Lean session-state shape** — the snapshot keeps only: TL;DR (HEAD/tag/branch/status) · "What next session needs" · Deferred/open-loops · Resume commands · Stop-point. **Drop:** detailed Done (git log has it), result numbers (reporter has them), brainstorm dialogue (spec has it), drift/pitfall/memory recaps.
4. **New naming + home:** new snapshots → `docs/superpowers/session-states/session-state-YYYY-MM-DD-HHMM-slug.md` (note `session-states/` dir + `HHMM`). Existing names unchanged. Update the pattern glob references in the skill to `docs/superpowers/session-states/session-state-*.md`.
5. **Audit-scope expansion (conditional):** in addition to CLAUDE.md/README/guidelines/memory, audit `docs/capture-protocol.md`, `docs/workflow.md`, `docs/writing-standard.md` (and CONTRIBUTING if it ever exists) **only if** the session touched the adjacent surface.
6. **No-regret efficiencies:** don't re-read CLAUDE.md wholesale if already in context; batch findings + apply; pitfall-dispatch as one batched question.
7. **NEVER auto-invoke:** keep + reinforce — only *recommend* at break-points; the decision to invoke is always the user's.
8. **Reference fixups:** `/tech-debt-review` → `/backlog-review` (skill retired in Task 6); session-state pattern paths → `session-states/`.

- [ ] **Step 1: Read current skill** — `cat .claude/skills/finish-session/SKILL.md` (374 lines).
- [ ] **Step 2: Rewrite** applying changes 1–8. Keep the existing per-item-approval / never-auto-edit guarantees. Apply `docs/writing-standard.md`.
- [ ] **Step 3: Verify**
```bash
grep -q 'scan-markers' .claude/skills/finish-session/SKILL.md && echo "marker-scan wired"
grep -Eq 'eliminate|hook|one-liner|skill-checklist|link-only' .claude/skills/finish-session/SKILL.md && echo "taxonomy present"
grep -q 'session-states/session-state-' .claude/skills/finish-session/SKILL.md && echo "new dir path"
grep -q 'HHMM' .claude/skills/finish-session/SKILL.md && echo "HHMM naming"
grep -c '/tech-debt-review' .claude/skills/finish-session/SKILL.md   # expect 0
```
- [ ] **Step 4: Commit** — `git add .claude/skills/finish-session/SKILL.md && git commit --no-gpg-sign -m "skills(finish-session): marker-scan + 5-branch pitfall routing + lean session-state"`

---

## Wave 6 — Settings, README, memory  `[I]`

### Task 9: PB8 — sandbox write-allow + permission allowlist

**Files:**
- Modify: `.claude/settings.json` and/or `.claude/settings.local.json`.

**Goal:** stop the recurring `tsx` IPC-pipe sandbox block (CLAUDE.md "tsx + sandbox": pipe at `/tmp/claude-<uid>/tsx-<uid>/*.pipe`) and reduce permission prompts for trusted `pnpm`/`tsx` commands.

- [ ] **Step 1: Resolve the exact pipe path** — `echo "/tmp/claude-$(id -u)/tsx-$(id -u)"` (the `501` in CLAUDE.md is this machine's uid; verify). Expected: a concrete path to write-allow.
- [ ] **Step 2: Add sandbox write-allow** — use the `/update-config` skill to add the tsx-pipe directory to the sandbox write allowlist (so `pnpm smoke`/`build:*`/`fixtures` run without `dangerouslyDisableSandbox`). Do NOT add sensitive paths.
- [ ] **Step 3: Reduce permission prompts** — run the `/fewer-permission-prompts` skill to scan transcripts and propose a trusted `pnpm`/`tsx` allowlist into `.claude/settings.json`. Review proposals before accepting.
- [ ] **Step 4: Verify** — re-run a previously-blocked tsx command in sandbox (no bypass flag):
```bash
pnpm fixtures 2>&1 | tail -5     # expect: succeeds without "Operation not permitted" on the pipe
```
(If `pnpm fixtures` has side effects you want to avoid, substitute any tsx-spawning command, e.g. a `--help`-style invocation.)
- [ ] **Step 5: Commit** — `git add .claude/settings*.json && git commit --no-gpg-sign -m "config(sandbox): write-allow tsx IPC pipe + trusted pnpm/tsx allowlist"`

### Task 10: README anti-fluff pass + strip `file:line` from Debug-timings

**Files:**
- Modify: `README.md` (351 lines; Debug-timings § lines 235–254).

**Changes:**
- Remove the `file:line` internal references on lines 252, 254: `apps/runner-web/src/driver.ts:127`, `apps/runner-web/src/page.ts:68-69`, `apps/runner-web/src/worker.ts:49,83`, `packages/harness/src/measure.ts:22-31`, and the `docs/superpowers/notes/2026-05-05-perf-now-precision.md` deep-link. Replace with a one-line user-facing description of how to enable debug timings (no source-internal paths). If the section is purely an internal pointer, delete it.
- Light anti-fluff pass over the 12 `##` sections (apply `docs/writing-standard.md`): drop preamble, tighten modals. **Do NOT** translate README (language is RU; that is tech-debt `docs-language-consistency`, Task 11, not this task). Keep all manual content (requirements, install, build, run, report).

- [ ] **Step 1: Edit Debug-timings** — remove the `file:line` refs (verify gone): `grep -nE '(driver|page|worker|measure)\.ts:' README.md` (expect 0).
- [ ] **Step 2: Anti-fluff pass** — tighten, no content loss. `wc -l README.md` before/after (expect modest reduction, not a rewrite).
- [ ] **Step 3: Verify no broken internal links introduced** — `grep -nE '\]\(\.?/?(apps|packages|benches)/' README.md` (expect: only intentional user-facing links, no source-line deep links).
- [ ] **Step 4: Commit** — `git add README.md && git commit --no-gpg-sign -m "docs(readme): drop source-internal file:line refs from Debug-timings, anti-fluff pass"`

### Task 11: Memory updates + tech-debt `docs-language-consistency`

**Files:**
- Modify (memory, outside repo): `~/.claude/projects/-Users-uncerso-src-wasm-rust-cpp-js/memory/reference_session_state.md`, `project_wasm_benchmarks.md`, `MEMORY.md`, `feedback_no_auto_finish_session.md`.
- Create: `docs/tech_debt/docs-language-consistency.md`.

**Memory changes (Task 1 already fixed path prefixes; this is the convention prose):**
- `reference_session_state.md` — update to: new home `docs/superpowers/session-states/`; new naming `session-state-YYYY-MM-DD-HHMM-slug.md`; lean shape (TL;DR / next-needs / deferred / resume / stop-point); recall hierarchy memory → session-state → remembering-conversations.
- `project_wasm_benchmarks.md` — update the "latest session-state" pointer to `docs/superpowers/session-states/session-state-2026-06-11-workflow-cost-redesign-spec.md` and the resume instruction to read newest in `session-states/`.
- `MEMORY.md` — the `reference_session_state` one-line hook still accurate after the path transform; verify.
- `feedback_no_auto_finish_session.md` — still accurate (reinforced by Task 7); verify, no edit unless a path drifted.

**Tech-debt note `docs-language-consistency.md`** (format: `docs/tech_debt/README.md`): category docs; priority low; "What": README + specs/plans/pitfalls/roadmap mix RU/EN; consider a consistent-language convention. "Why it matters": cross-reader friction, search/grep inconsistency. "Possible fix": pick EN as canonical for new docs (already done for CLAUDE.md/workflow/capture-protocol/writing-standard); back-translation is opportunistic, not urgent. Status open.

- [ ] **Step 1: Update the 4 memory files** (Write tool). Keep frontmatter intact.
- [ ] **Step 2: Create `docs/tech_debt/docs-language-consistency.md`** per format.
- [ ] **Step 3: Verify**
```bash
grep -q 'session-states/' ~/.claude/projects/-Users-uncerso-src-wasm-rust-cpp-js/memory/reference_session_state.md && echo "mem dir ok"
grep -q 'HHMM' ~/.claude/projects/-Users-uncerso-src-wasm-rust-cpp-js/memory/reference_session_state.md && echo "mem naming ok"
test -f docs/tech_debt/docs-language-consistency.md && echo "tech-debt ok"
```
- [ ] **Step 4: Commit the tech-debt file** (memory is outside the repo, not committed) — `git add docs/tech_debt/docs-language-consistency.md && git commit --no-gpg-sign -m "docs(tech-debt): capture docs-language-consistency"`

---

## Wave 7 — Close

- [ ] **Step 1: Full gate**
```bash
pnpm typecheck && pnpm lint:all && pnpm test 2>&1 | tee /tmp/close.log; rc=${PIPESTATUS[0]}; echo "exit=$rc"
```
Expected: `exit=0`. (Docs/skills changes shouldn't affect TS/Rust; this proves the scanner + any lint-glob changes didn't regress.)

- [ ] **Step 2: Final reference sweep** — confirm no dangling refs to moved/retired things:
```bash
git grep -n 'superpowers/session-states/session-state-'            # 0
git grep -n '\.\./session-state-'                   # 0
git grep -n '/tech-debt-review' -- ':!docs/superpowers/specs' ':!docs/superpowers/plans' ':!docs/pitfalls'   # 0 live
ls docs/superpowers/session-states/*.md | wc -l     # 23
wc -l CLAUDE.md                                     # < 200
```

- [ ] **Step 3: Push + open PR**
```bash
git push -u origin feature/workflow-cost-redesign
gh pr create --title "Workflow & cost redesign" --body "Implements docs/superpowers/specs/2026-06-11-workflow-cost-redesign-design.md. Spec + plan + code on this branch; reviewable as one PR."
```
User reviews on GitHub; master changes only via merge (spec SC-branch).

- [ ] **Step 4: Recommend `/finish-session`** (do not auto-invoke — spec T4 + memory `feedback_no_auto_finish_session`). The close itself runs the new marker-scan + lean session-state under the rewritten skill.

---

## Self-Review (plan vs spec)

**Change-list coverage (12 items):**

| # | Change-list item | Task |
|---|---|---|
| 1 | move session-states + refs | Task 1 |
| 2 | CLAUDE.md trim + English | Task 5 |
| 3 | `docs/capture-protocol.md` + CLAUDE.md stub + /backlog-review ref | Task 2 (+ stub in 5, ref in 6) |
| 4 | `docs/workflow.md` + CLAUDE.md pointer | Task 3 (+ pointer in 5) |
| 5 | merge skills → /backlog-review, retire /tech-debt-review | Task 6 |
| 6 | README file:line + anti-fluff | Task 10 |
| 7 | finish-session rewrite | Task 7 |
| 8 | marker scanner | Task 8 |
| 9 | PB8 sandbox + permission | Task 9 |
| 10 | writing-plans Execution-Protocol convention | Task 3 (workflow.md) + this plan's Execution Protocol section |
| 11 | PB5 anti-fluff → writing-standard | Task 4 |
| 12 | tech-debt docs-language-consistency | Task 11 |

**Decisions/spec deviations recorded:**
- Reference-update scope: spec said "~21"; reality is 108 lines / 43 files. Resolved with a single idempotent substring transform (Task 1) that correctly handles absolute paths, globs, relative `../` cross-links, and historical self-refs, while leaving co-located bare-filename refs (self-healing) and narrative mentions untouched.
- `writing-standard` placed in its own `docs/writing-standard.md` (not a workflow.md appendix) to keep workflow.md ≤ ~60 lines.
- Execution-Protocol convention (item 10) homed in `docs/workflow.md` + CLAUDE.md pointer because the `writing-plans` skill is in the plugin cache and not reliably editable.
- Open item flagged in spec/session-state — exact tsx-pipe path — resolved at execution via `id -u` (Task 9 Step 1).

**No placeholders:** every doc-creation task lists exact required sections; the scanner ships full source; transforms are exact `sed`/`grep` commands with expected outputs.
