---
id: incorporate-pitfalls-2026-05-22
title: Process 2 pitfalls из /research-сессии 2026-05-22 (pitfalls workflow + docs hygiene)
created: 2026-05-22
source: docs/pitfalls/2026-05-22-pitfalls-workflow.md
category: process-gap
status: open
priority: low
---

## What

В `docs/pitfalls/2026-05-22-pitfalls-workflow.md` зафиксировано **2 pitfall'а** из
исполнения /research-сессии по дизайну pitfalls workflow и docs hygiene. Оба deferred
сюда per /finish-session step 8.5 dispatch с priority `low`.

## Why it matters

Оба pitfall'а относятся к meta-process (как AI ведёт /brainstorming, как scope'ит
docs-спеки). Низкий приоритет — не блокируют конкретную фичу, но lessons могут улучшить
последующие /research сессии. Concrete inline-fix к intro paragraph
`docs/pitfalls/README.md` уже применён в той же сессии — оставлены только general lessons.

## Possible fix

Walk-through по `docs/pitfalls/2026-05-22-pitfalls-workflow.md`:

1. **Mechanism trace before /brainstorming recommendation (pitfall #1).** Target
   неясен — нужно short design decision:
   - (a) Mini-bullet в `~/.claude/skills/brainstorming/SKILL.md` («Before marking
     option as recommended, trace mechanism»).
   - (b) Mini-bullet в `~/.claude/skills/research/SKILL.md` (research-specific
     entrypoint).
   - (c) Memory feedback entry в `~/.claude/projects/<slug>/memory/`
     (`feedback_brainstorming_mechanism_check.md`) про общий habit.
   - Выбрать один target и применить.

2. **Grep full file before docs-spec scope (pitfall #2 generic lesson).** Concrete
   inline-fix к intro paragraph уже сделан. Остаётся generic lesson:
   - (a) Mini-bullet в `~/.claude/skills/writing-plans/SKILL.md` или
     `brainstorming/SKILL.md` про «grep file for related convention mentions before
     locking scope».
   - (b) Можно skip — это more of a one-time observation, чем deep convention.

После прохода — удалить этот tech-debt file (status: resolved), pitfalls file остаётся
historical record.

## References

- `docs/pitfalls/2026-05-22-pitfalls-workflow.md` — source.
- `docs/pitfalls/README.md` — conventions для pitfalls directory.
- /research session commits: `fff7b84..d7cab0a` на master.
