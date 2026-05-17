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
- Items уже в `docs/tech_debt/`, `docs/roadmap.md`, или `docs/superpowers/specs/`/`plans/`.
- Принятые trade-offs в README «Известные ограничения».
- Style nitpicks без impact.
- Items feature-уровня (новые workloads, runtime axes, infra epics) — это другой capture
  protocol, см. секцию «Roadmap capture» ниже.

**Trigger phrases в собственных рассуждениях** — если эти слова возникают в твоём
ответе, остановись и спроси: process gap, latent bug, should fix later, open review
ticket, investigation needed, не блокирующее, TODO, follow-up, skipped for now,
нужно разобраться позже.

Periodic triage: skill `/tech-debt-review` (см. `.claude/skills/tech-debt-review/`).

## Roadmap capture

Когда во время работы замечаешь крупную future-work возможность (новый workload, runtime
axis, browser support, инфраструктурный epic, фичу требующую spec'а) — **останови
работу один раз и предложи добавить в `docs/roadmap.md`**:

> «Заметил <X> — это feature-level work, кандидат в Phase X.Y (или TBD, если phase неясна). Добавить в `docs/roadmap.md`?»

Если user соглашается:
1. Добавить одну строку в подходящий bucket (или `## TBD`, если phase неясна):
   `- **<kebab-name>** — <one-line описание> ([→ <source>](path))` если есть spec
   section / tech-debt slug, иначе без ссылки.
2. Использовать observation из контекста.
3. **Не пытаться писать spec в этот момент** — это просто capture одной строкой.

Если user говорит «later» / «нет» — не предлагай снова в этой сессии.

**Граница tech-debt vs roadmap:**
- Tech-debt → мелкое, fix < 1 дня, single file/function impact. Идёт в `docs/tech_debt/`.
- Roadmap → новая фича / runtime axis / infra epic, требует brainstorm + spec.
  Одна строка в `docs/roadmap.md`.

**Что НЕ предлагать к roadmap capture:**
- Items уже в `docs/roadmap.md`, `docs/superpowers/specs/`, или `plans/`.
- Tech-debt scale items — используй tech-debt capture выше.
- Accepted trade-offs в README «Известные ограничения».

**Trigger phrases в собственных рассуждениях:** new workload, new axis, browser support,
runtime profile, future phase, big feature, requires spec, after Phase X.Y, separate
effort needed, отдельная фаза, требует дизайна.

Periodic triage: skill `/backlog-review` (см. `.claude/skills/backlog-review/`).

## Commits

Используй `--no-gpg-sign` для агентских коммитов в этом репо (GPG bypass
авторизован user'ом).
