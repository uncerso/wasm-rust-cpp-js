# Tech-debt backlog

Рабочая очередь незакрытых tech-debt items: process gaps, latent bugs, open review
tickets, investigations без owner'а, ergonomics nice-to-haves. **Один item — один файл.**

Это НЕ то же самое, что:
- `docs/superpowers/plans/` + `specs/` — phase roadmap (запланированные features).
- README «Известные ограничения» — user-facing accepted trade-offs.

Periodic triage: запусти skill `/tech-debt-review`.

## Format

Каждый item — `<kebab-slug>.md` с frontmatter:

```markdown
---
id: <kebab-case-slug>             # совпадает с filename без .md
title: <one-line description>
created: YYYY-MM-DD
source: <commit-sha | docs/superpowers/...md | "session YYYY-MM-DD ...">
category: process-gap | latent-bug | investigation | open-review-ticket | nice-to-have | known-limitation
status: open | in-progress
priority: high | medium | low
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
- `open|in-progress` → **resolved**: переместить файл в `docs/tech_debt/resolved/`. Сохранить запись для git-grep'аемости.
- `open|in-progress` → **wontfix**: изменить status на `wontfix`, добавить секцию `## Decision` с rationale. Файл остаётся в backlog.
- `open|in-progress` → **moved-to-roadmap**: item включён в plan/spec следующей phase. Удалить файл, ссылку на это решение добавить в commit-message при удалении.

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
