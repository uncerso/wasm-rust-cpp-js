---
id: docs-language-consistency
title: Docs mix RU/EN — no canonical-language convention
created: 2026-06-11
source: docs/superpowers/plans/2026-06-11-workflow-cost-redesign.md
category: docs
status: open
priority: low
---

## What

The repo's prose mixes Russian and English with no stated convention. `README.md`
and the `docs/superpowers/{specs,plans}/`, `docs/pitfalls/`, `docs/roadmap.md`
bodies are largely Russian; `CLAUDE.md`, `docs/workflow.md`,
`docs/capture-protocol.md`, and `docs/writing-standard.md` were rewritten to
English during the workflow-cost-redesign. There is no rule for which language a
new doc should use.

## Why it matters

Cross-reader friction (a reader strong in one language re-parses the other) and
search/grep inconsistency (a term exists under both its English and Russian
spelling, so a single grep misses half the hits). Low impact — no gate or build
depends on it; it is a readability/discoverability tax, not a correctness issue.

## Possible fix

Adopt **English as canonical for new docs** (already the de-facto rule for
`CLAUDE.md`, `docs/workflow.md`, `docs/capture-protocol.md`,
`docs/writing-standard.md`). Back-translation of existing Russian docs is
**opportunistic, not urgent** — translate a file only when it is being
substantially edited anyway. Do not schedule a bulk translation pass.

## Suggested workflow for review

Surface at the next `/backlog-review` (Pass 2 — tech_debt). Decide whether to
promote the "English canonical for new docs" rule into a one-line convention
(CLAUDE.md or `docs/writing-standard.md`) or keep it as this latent note.
