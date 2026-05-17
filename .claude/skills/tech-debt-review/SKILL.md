---
name: tech-debt-review
description: Review and triage items in docs/tech_debt/. Use when user types /tech-debt-review or asks "разобрать tech debt" or "пройдись по tech debt". Lists all open items, groups by category and priority, asks user batched what to close, mark wontfix, move to roadmap, or skip. Never deletes files without explicit user confirmation.
---

# Tech-debt review

## Steps

1. `ls docs/tech_debt/*.md` — список items (исключая `README.md`). Resolved items уже удалены из disk'а (history через git log).
2. Прочитать frontmatter каждого файла (`id`, `title`, `category`, `priority`, `status`).
   - Skip файлы со `status: wontfix` — они уже принятые решения, не нуждаются в triage.
3. Сгруппировать по `priority` (high → medium → low), затем по `category`.
4. Вывести компактный список user'у — каждый item: `[category/priority] title (id)` + 1-2 строки из `## What` или `## Why it matters`.
5. **Спросить user'а батчем** через `AskUserQuestion` (multiSelect=true), какие items закрыть/перенести:
   - **resolved** — item решён. Спросить short note почему (1-2 строки), потом **удалить файл** (history через `git log --all --full-history -- docs/tech_debt/<slug>.md`). Если item залинкован из `docs/roadmap.md` — удалить также строку из roadmap.md (per `docs/tech_debt/README.md` § Status machine).
   - **wontfix** — item не будет чинен. Спросить rationale, потом изменить status в frontmatter на `wontfix` + добавить `## Decision` секцию. Файл остаётся в backlog. **НЕ дублировать** в `docs/roadmap.md` § Won't do (та секция для feature-level rejections).
   - **moved-to-roadmap** — item включён в следующую phase plan. Удалить файл, упомянуть в commit-message: `tech_debt: <slug> moved to <plan-file>`. Если был залинкован из roadmap.md — также удалить ссылку (per roadmap.md «removal» convention).
   - **skip** — оставить как есть.
6. Применить решения user'а: file deletions / status edits / roadmap.md updates.
7. Финальный summary:
   - Сколько items было до review (X open).
   - Сколько решено: Y resolved, Z wontfix, W moved-to-roadmap, V skipped.
   - Что осталось в backlog.

## Important

- **Никогда** не делать file moves/edits/deletions без explicit confirmation user'а через AskUserQuestion.
- Не пытаться «починить» items в рамках этой команды — это только triage.
- Не предлагать новые items добавить — это работа capture protocol в основной сессии.
- Если все items в backlog → status open, и user захочет batch-resolve по типу — позволить multiSelect.

## Capture protocol context

Items появляются в `docs/tech_debt/` через capture protocol: AI замечает что-то во время
работы, предлагает user'у zафиксировать, при confirm пишет файл. Полный текст protocol —
в `CLAUDE.md` секции «Tech-debt capture».
