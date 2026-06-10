---
id: writing-clearly-distillation
title: Distill writing-clearly-and-concisely into a lightweight cheat-sheet
created: 2026-06-11
source: docs/superpowers/specs/2026-06-11-workflow-cost-redesign-design.md
category: nice-to-have
status: open
priority: low
---

## What

Скилл `writing-clearly-and-concisely` (Strunk-правила) полезен для polish'а
значимых persistent-доков, но тяжёлый: два вида цены — (1) разовое чтение при
вызове, (2) persistence (висит в контексте и перечитывается каждый последующий
ход; именно это копится квадратично по длине сессии). Даже вызов в субагенте
платит токенами субагента.

Распарсить скилл один раз и выжать его правила в короткую (~1 страница)
шпаргалку — тогда его ценность применяется **вообще без загрузки скилла**.

## Why it matters

Polish-проходы по значимым докам (spec, workflow.md, переписываемые
CLAUDE.md/README) иначе платят за тяжёлый скилл повторно. Шпаргалка превращает
это в near-zero inline-проверку. Дополняет PB5 anti-fluff checklist (тот покрывает
~80%; этот добавит остаток Strunk-правил).

## Possible fix

Субагент читает `writing-clearly-and-concisely` один раз, отдаёт ≤1-страничную
шпаргалку правил; закоммитить её как writing-standard (рядом с PB5-чеклистом,
напр. в `docs/workflow.md` appendix или отдельным `docs/writing-standard.md`).
Дальше — применять инлайн, скилл больше не грузить.

## References

- `docs/superpowers/specs/2026-06-11-workflow-cost-redesign-design.md` § Living docs (GM2)
- Связано: PB5 anti-fluff checklist (writing-standard) в той же спеке.
