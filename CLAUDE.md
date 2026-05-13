# CLAUDE.md

Repo-local guidance для AI assistants, работающих в этом проекте.

## Tech-debt capture

Когда во время работы замечаешь: process gap, latent bug, open review ticket,
investigation без owner'а, ergonomics improvement opportunity, «should fix later» —
**останови работу один раз и предложи зафиксировать**:

> «Заметил <X> в <file:line> — выглядит как tech-debt (category: <Y>). Оформить в `docs/tech_debt/`?»

Если user соглашается:
1. Создать `docs/tech_debt/<kebab-slug>.md` (формат → `docs/tech_debt/README.md`).
2. Использовать observation из контекста, не повторное расследование.
3. Не блокировать основную задачу.

Если user говорит «later» / «нет» — продолжай, **не повторяй предложение в этой сессии**.

**Что НЕ предлагать к фиксации:**
- Items уже в `docs/superpowers/plans/` или `specs/` (Phase 1.1+ roadmap).
- Принятые trade-offs в README «Известные ограничения».
- Style nitpicks без impact.

**Trigger phrases в собственных рассуждениях** — если эти слова возникают в твоём
ответе, остановись и спроси: process gap, latent bug, should fix later, open review
ticket, investigation needed, не блокирующее, TODO, follow-up, skipped for now,
нужно разобраться позже.

Periodic triage: skill `/tech-debt-review` (см. `.claude/skills/tech-debt-review/`).

## Commits

Используй `--no-gpg-sign` для агентских коммитов в этом репо (GPG bypass
авторизован user'ом).
