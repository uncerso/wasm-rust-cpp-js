# Session state — 2026-06-11 workflow & cost redesign (spec done)

Brainstorm workflow & cost-редизайна завершён; spec написана и закоммичена на ветку.
Execution не начат, план не написан.

## TL;DR

- Branch: `feature/workflow-cost-redesign` @ `843c533` (spec + tech-debt
  `writing-clearly-distillation`). master не тронут, **не запушено**.
- Pre-existing uncommitted (`M CLAUDE.md`, `M package.json`, 2 untracked) —
  предшествуют сессии, вне scope.
- Spec: `docs/superpowers/specs/2026-06-11-workflow-cost-redesign-design.md` — все
  решения T1–T6 + § Coverage map (point-by-point traceability к исходному промпту)
  + § Change-list (12 items, помечены [I] inline / [S] subagent).

## What the next session needs

- Запустить `/writing-plans`, **читая только спеку** (она самодостаточна) — план
  дешевле писать со свежего контекста (codeburn: стоимость = ходы × накопленный
  контекст).
- План пишется на **этой же ветке** (model A: spec + plan + код на ветке). План
  **обязан** содержать секцию **Execution Protocol**: hybrid-карта (inline/subagent
  per task) + статические break-points + правило per-task break-check (~1/3 окна
  soft, ~1/2 hard).
- Из change-list 4 пункта subagent-suitable (перенос всех session-state'ов в
  `docs/superpowers/session-states/` + обновление ~21 ссылки; слияние
  `tech-debt-review`→`backlog-review`). Остальное — inline.

## Deferred / open-loops

- Создать tech-debt `docs-language-consistency` (change-list п.12) — язык README +
  specs/plans/pitfalls/roadmap.
- PB8: точный путь tsx-pipe для sandbox write-allow — сверить при реализации.
- session-state + pitfall этой сессии записаны **uncommitted** на ветке — закоммитить
  при желании.

## Resume

```bash
git checkout feature/workflow-cost-redesign
# read: docs/superpowers/specs/2026-06-11-workflow-cost-redesign-design.md
# then: /writing-plans
```

## Stop point

- Spec одобрена + закоммичена (`843c533`). План не начат, реализация не начата.
