---
id: reviewer-lint-verification
title: Subagent code-quality reviewers must run actual lint before claiming lint violations
created: 2026-05-23
source: docs/pitfalls/2026-05-23-phase-1-1-2-execution.md § Process
category: process-gap
status: open
priority: low
---

## What

Phase 1.1.2 Task 12 quality reviewer (`superpowers:code-reviewer` subagent с
sonnet model) reported "**Important — ESLint Style Violations (brace-style rule)**" как
"blocking", recommending `pnpm lint:ts:fix` re-commit. Verification (мой own
`pnpm lint:ts` run) показал 0 errors. Reviewer's claim был performative —
pattern-matching на single-line braces без actually running the linter.

(Существовали реальные latent brace-style violations в reference.ts от Tasks 9/12,
но они surface'нулись позже в Task 22a/22b когда я ran lint без `| tail` masking.
Reviewer случайно угадал что nothing-burger претензия может быть legitimate, но
причина была random.)

## Why it matters

- **Wasted iteration:** false alarm review claim требует follow-up investigation
  (5-10 min на task).
- **Trust erosion:** если reviewer hallucinates simple-to-verify claims like lint
  errors, harder to trust его на more subtle claims (architecture, semantics).
- **Pattern generalizes:** аналогичная hallucination возможна для test claims,
  typecheck claims, build claims. Любая claim про tool output should require actual
  tool run.

## Possible fix

**Primary fix is in subagent skill prompts (out-of-repo, в `~/.claude/skills/` или
plugin caches),** not в этом репо. Этот tech-debt entry — pointer + reminder.

Конкретно — `~/.claude/plugins/cache/claude-plugins-official/superpowers/.../skills/requesting-code-review/code-reviewer.md`
(template для reviewer subagent) should explicitly require:

> «Перед claim'ом про lint/test/typecheck violations — RUN the tool (e.g.
> `pnpm lint:ts`, `pnpm typecheck`, `pnpm test`) и cite actual output. Не делать
> claim про tool output без actual run.»

Sub-skill changes за пределами этого repo, поэтому fix here = «captured + remind to
update reviewer prompt в follow-up session».

**Secondary fix** (in-repo guard): pre-commit hook (когда Phase 1.2 ci-github-actions
landed) который runs lint+typecheck+test. Если AI commit'ит broken state — hook
блокирует. Это catches issues что reviewer missed.

## References

- `docs/pitfalls/2026-05-23-phase-1-1-2-execution.md` § Process > "Two-stage review can
  hallucinate violations not present в lint"
- Reviewer template: `superpowers/skills/requesting-code-review/code-reviewer.md`
  (out-of-repo).
- Phase 1.1.2 Task 12 (commit `9913276`) — first occurrence.
