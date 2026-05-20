---
id: incorporate-pitfalls-2026-05-21
title: Разобрать pitfalls из Phase 1.1.0 execution и incorporate в spec/plan/CLAUDE.md
created: 2026-05-21
source: docs/pitfalls/2026-05-21-phase-1-1-0-execution.md
category: process-gap
status: open
priority: medium
---

## What

В `docs/pitfalls/2026-05-21-phase-1-1-0-execution.md` зафиксировано **11 pitfall'ов**
из исполнения Phase 1.1.0 (planning gaps, tooling friction, process patterns).
Каждый имеет «Prevention» секцию. Нужно пройти по списку и dispatch'нуть каждый item
в подходящее место.

## Why it matters

Pitfall'ы остаются только в `docs/pitfalls/` — это **historical record**, не actionable
backlog. Lessons не incorporated в spec template / CLAUDE.md / guidelines продолжат
повторяться в будущих phase. Высокая ценность low-effort review: каждый pitfall ≈ 5 min
на decision.

## Possible fix

Walk-through по `docs/pitfalls/2026-05-21-phase-1-1-0-execution.md`. Для каждого pitfall
выбрать одно из:

1. **Update CLAUDE.md** — обычно для tooling/operational items (#4 pnpm sandbox, #5
   `$TMPDIR`). Один параграф в подходящую секцию.
2. **Update spec/plan template** — для planning gotchas (#1 pre-flight gate, #2
   addr_of! rationale, #3 clippy single-char check). Spec template как такового нет —
   потребуется solidify в новый файл `docs/superpowers/specs/_template.md` или
   inline в существующий spec'е как «design conventions» секция.
3. **Add to `docs/guidelines.md`** — для confirmed patterns с product impact (alignas
   invariant, thread_local cost на wasm32).
4. **Capture as new tech-debt** — для concrete code items (e.g. dead TS interface
   fields после W5 cleanup — pitfall #11 sub-finding).
5. **Update memory** — для validated execution patterns (#10 hybrid execution уже там).
6. **Skip / accept** — если incorporation cost > benefit или уже captured elsewhere.

После прохода — удалить этот tech-debt file (status: resolved), pitfalls file остаётся
historical record.

## Suggested workflow

1. Read pitfalls file целиком.
2. AskUserQuestion на каждый pitfall: где incorporate? (одна question с multiSelect).
3. Apply edits batch'ем.
4. Commit как «docs(process): incorporate Phase 1.1.0 pitfalls» + delete этот file.

## References

- `docs/pitfalls/2026-05-21-phase-1-1-0-execution.md` — source.
- `docs/pitfalls/README.md` — conventions для pitfalls directory.
- Phase 1.1.0 closure: tag `phase-1-1-0`, master `8720f2f`.
