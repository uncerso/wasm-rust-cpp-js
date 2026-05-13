---
id: cargo-lock-stage-discipline
title: Cargo.lock иногда забывают staged при изменении [dependencies]
created: 2026-05-14
source: docs/superpowers/session-state-2026-05-05-wave-3.md
category: process-gap
status: open
priority: low
---

## What

В Phase 1.0.5 Wave 3 Cargo.lock не был включён в Tasks 12-13. Item оставлен как
напоминание: «при следующем изменении [dependencies] — помнить про `git add Cargo.lock`».

## Why it matters

Lockfile drift между ветками → невоспроизводимые builds. Для бенчмарков, цель которых
byte-identical artifacts, это серьёзно. Сейчас на agentic-flow это «полагается» на manual
discipline.

## Possible fix

- Pre-commit hook, который при изменении Cargo.toml требует Cargo.lock в staged.
- Или CLAUDE.md instruction: «при touching Cargo.toml всегда git add Cargo.lock».
- Или CI assertion в будущем (когда CI появится).

## References

- `docs/superpowers/session-state-2026-05-05-wave-3.md` (carry-over note)
- `benches/matmul/rust/*/Cargo.lock` paths
