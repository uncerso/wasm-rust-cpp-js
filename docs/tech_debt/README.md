# Tech-debt backlog

Рабочая очередь незакрытых tech-debt items: process gaps, latent bugs, open review
tickets, investigations без owner'а, ergonomics nice-to-haves. **Один item — один файл.**

Это НЕ то же самое, что:
- `docs/roadmap.md` — top-level live index отложенной work'и (feature-level items).
- `docs/superpowers/plans/` + `specs/` — phase roadmap (запланированные features).
- README «Известные ограничения» — user-facing accepted trade-offs.

Tech-debt items с phase target (`roadmap: phase-X.Y-candidate` frontmatter) одновременно
залинкованы из `docs/roadmap.md` под соответствующим Phase bucket'ом. Roadmap.md — index;
файл здесь — source of truth.

Periodic triage: запусти skill `/backlog-review`.

## Format

Каждый item — `<kebab-slug>.md` с frontmatter:

```markdown
---
id: <kebab-case-slug>             # совпадает с filename без .md
title: <one-line description>
created: YYYY-MM-DD
source: <commit-sha | docs/superpowers/...md | "session YYYY-MM-DD ...">
category: process-gap | latent-bug | investigation | open-review-ticket | nice-to-have | known-limitation
status: open | in-progress | wontfix | resolved
priority: high | medium | low
roadmap: <phase-tag>-candidate    # optional — see § Roadmap marker
---

## What
<verbatim quote или concise problem statement>

## Why it matters
<impact, blast radius — почему стоит когда-нибудь чинить>

## Possible fix
<brief sketch или "TBD" / "investigation needed">

## References
- <links to session-state, commit, related code paths>
```

## Status machine

- `open` → `in-progress` (когда работа реально начата)
- `open|in-progress` → **resolved**: **удалить файл**. История через
  `git log --all --full-history -- docs/tech_debt/<slug>.md`. Если item был залинкован
  из `docs/roadmap.md` — удалить также эту строку (per roadmap.md «removal» convention).
- `open|in-progress` → **wontfix**: изменить status на `wontfix`, добавить секцию
  `## Decision` с rationale. Файл остаётся в backlog. **НЕ дублировать** в
  `docs/roadmap.md` § Won't do (та секция для feature-level rejections).
- `open|in-progress` → **moved-to-roadmap**: item включён в plan/spec следующей phase.
  Удалить файл (history через git), ссылку на это решение добавить в commit-message.
  Если был залинкован из `docs/roadmap.md` — также удалить строку.
  - **Если plan-файл ещё не создан** (e.g. triage до старта phase planning): добавить
    `roadmap: <phase>-candidate` в frontmatter и секцию `## Roadmap` в конце файла со
    sketch'ом куда item должен попасть, добавить ссылку в `docs/roadmap.md` под
    соответствующим Phase bucket'ом. Файл остаётся в backlog (status: open). Когда
    plan-файл создан и item включён в него — файл удаляется + ссылка из roadmap.md
    также удаляется.

## Roadmap marker

Field `roadmap: <phase>-candidate` (e.g. `phase-1.1-candidate`) ставится во время triage,
когда item направлен в следующую phase, но plan-файл ещё не создан. Когда planning старт'ует,
эти items берутся в первую очередь рассмотрения. Поиск: `grep -l "^roadmap:" docs/tech_debt/*.md`.

## Categories

- **process-gap** — workflow/tooling не делает что должен (e.g. typecheck не покрывает scripts/).
- **latent-bug** — потенциальная проблема, не firing сейчас, но опасная при изменении окружения.
- **investigation** — открытый вопрос требующий измерений или диагностики.
- **open-review-ticket** — отложенная замечание от code review.
- **nice-to-have** — improvement без urgency.
- **known-limitation** — accepted trade-off, файл существует чтобы не забыть.

## Priority

Грубая оценка blast radius × вероятность × разница между «починить сейчас» и «потом».
Не стрелка к deadline.
