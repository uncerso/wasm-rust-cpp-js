---
id: subagent-leaves-micro-tech-debt
title: Investigate почему subagent делает judgment call оставить type-only dead fields вместо удаления
created: 2026-05-22
source: docs/pitfalls/2026-05-21-phase-1-1-0-execution.md (§11)
category: process-gap
status: open
priority: medium
---

## What

В Phase 1.1.0 Wave 5 subagent (delegated multi-file dead-API cleanup) удалил
`readOutput`/`output_view` runtime path'ы, но **оставил** связанные TypeScript interface
fields (`output_ptr`, `output_len` в `loaders/raw-wasm`; `_output_ptr`, `_output_len` в
`loaders/emscripten`). Explicit deviation note в report'е, обоснование — «type-only
declarations ⇒ no bundle/runtime impact».

## Why it matters

Micro-tech-debt оставлен по defensible judgment call'у — но удалить эти поля **так же
дёшево**, как оставить. Открытый вопрос: что вообще заставляет subagent делать такой
trade-off, когда no-overhead clean path существует?

Hypotheses (нужны разные fix'ы):

- (a) Brief был sufficiently vague («cleanup `readOutput`») и subagent добавил
  conservative bias («оставлю что не упомянуто явно»).
- (b) Subagent оценивал «scope creep risk» — лучше не трогать что не сказано.
- (c) Subagent overweights «no runtime impact» как proxy «можно не делать».
- (d) Pattern-matching from training: type-only declarations часто оставляют для
  forward-compat.

Fix depends on root cause: (a) — explicit brief policy; (b)/(c) — meta-issue с judgment
heuristics, проявится в других shapes; (d) — нужен явный contradicting prompt.

## Possible fix

Investigation steps:

1. Прочитать W5 subagent report'ы (commits `9f1b636..8720f2f` в Phase 1.1.0 range) и
   exact rationale из deviation notes.
2. Сравнить с originals plan'а — был ли brief actually vague или явно требовал full
   cleanup.
3. Решить root cause — brief gap, training bias, или meta-process pattern.
4. Если brief gap — обновить subagent dispatch convention (CLAUDE.md или memory).
5. Если deeper issue — capture как research item для отдельной /research-сессии про
   subagent judgment heuristics.

После investigation — close этот tech-debt, dispatch findings в подходящее место
(memory / CLAUDE.md / research item).

## References

- `docs/pitfalls/2026-05-21-phase-1-1-0-execution.md` §11.
- Phase 1.1.0 plan: `docs/superpowers/plans/2026-05-20-phase-1-1-0-hardening-preamble.md`
  (W5 section).
- Concrete cleanup tracked отдельно: `docs/tech_debt/dead-ts-output-fields.md`.
