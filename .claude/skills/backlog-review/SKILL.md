---
name: backlog-review
description: Review and triage items in docs/roadmap.md. Use when user types /backlog-review or asks "разобрать backlog" / "пройдись по roadmap". Audits format compliance, cross-checks с docs/tech_debt/, спрашивает user'а батчем promote/defer/remove/move-to-wontdo/skip. Никогда не делает edits без явного подтверждения. Не путать с /tech-debt-review (тот для docs/tech_debt/*.md).
---

# Backlog review

Triage `docs/roadmap.md` — единственного live index'а отложенной работы. Skill держит
формат в порядке, кросс-проверяет с tech-debt items, и перетасовывает buckets по
решениям user'а.

## Steps

### 1. Read roadmap.md

`Read` файл `docs/roadmap.md`. Parse buckets: `## Phase X.Y`, `## TBD`, `## Won't do`.
Внутри каждого bucket'а parse cluster sub-headers (`### <name>`) и items
(`- **<name>** — <desc> ([→ <source>](path))`).

### 2. Format audit (Layer 2 защиты от drift'а)

Проверить compliance с conventions:

| Правило | Что проверить |
|---|---|
| Item prefix | Каждый item line начинается с `- **` |
| Bold name | Между `**...**` — kebab-case имя |
| Separator | Дальше идёт ` — ` (пробел + em-dash + пробел) |
| Source link format | Если ссылка есть — обёрнута как `([→ <text>](path))` |
| Phase headers | `## Phase X.Y` или `## TBD` или `## Won't do` (другие H2 — нарушение) |
| Cluster headers | H3 внутри Phase bucket'а — это cluster `### <name>` |
| Won't do entries | Должны иметь `**Decided <YYYY-MM-DD>:** <rationale>` |
| Conventions section | `## Conventions` присутствует со списком правил |
| Dangling links | Для каждой ссылки `(path)` — проверить `path` существует (relative от `docs/`) |

Если violations найдены:
- Показать user'у каждое нарушение с location (line number / item name).
- **Для каждого** через `AskUserQuestion` спросить: исправить как предлагается / исправить
  по-другому (custom) / skip (оставить нарушение).
- Применить решения как edits.
- **Только после format compliance** — переходи к шагу 3.

Если violations нет — print «Format OK» и переходи дальше.

### 3. Cross-check с docs/tech_debt/

a. Найти tech-debt items с `roadmap: <phase>-candidate` frontmatter:
   ```
   grep -l "^roadmap:" docs/tech_debt/*.md
   ```
   Для каждого: проверить, что slug залинкован хотя бы из одного bucket'а roadmap.md.
   Если нет — **flag** «orphan candidate: `<slug>` имеет roadmap marker, но не в roadmap.md».

b. Для каждой ссылки `tech_debt/<slug>.md` из roadmap.md — проверить:
   - Файл существует.
   - Frontmatter status — НЕ `resolved`/`wontfix` (если так, item должен был быть удалён из roadmap.md по convention'у).

Каждую inconsistency показать user'у. Через `AskUserQuestion` предложить fix:
- Добавить ссылку в roadmap.md (если orphan candidate).
- Убрать ссылку из roadmap.md (если tech-debt resolved/wontfix).
- Skip (оставить inconsistency, обычно для нестандартных кейсов).

### 4. Compact display of buckets

Распечатать summary каждого bucket'а:
- `## Phase X.Y`: N items (по кластерам — counts).
- `## TBD`: N items.
- `## Won't do`: N items.

### 5. Triage prompt

Через `AskUserQuestion` (single or multiSelect, в зависимости от bucket size — см.
шаблон /tech-debt-review для UX-параллели):

Для каждого item — варианты:
- **promote** — переместить в более ранний bucket (e.g. Phase 1.2 → 1.1).
- **defer** — переместить в более поздний bucket (e.g. Phase 1.1 → 1.2 или TBD → Phase 1.2).
- **remove (done/spec'd)** — item завершён, реализован, или graduate'нул в spec.
  Удалить строку. Если ссылается на tech-debt slug — спросить, удалить ли tech-debt
  файл (per «resolved → delete» policy).
- **move to Won't do** — explicit rejection. Спросить rationale + сегодняшнюю дату,
  переместить entry в `## Won't do` с форматом
  `- **<name>** — <desc>; **Decided <YYYY-MM-DD>:** <rationale>`.
- **skip** — без изменений.

Учитывая много items (>16) — батч'и по bucket'у или кластеру, не более 4 вопросов
за раз. Для большого backlog'а делать несколько раундов (как было в /tech-debt-review
первого запуска).

### 6. Apply edits

Применить решения user'а к roadmap.md. Сохранять file shape (Conventions, Phase headers,
emptied sections с placeholder `<!-- empty -->`).

При перемещении items между bucket'ами — preserve clusters, если возможно. Если cluster
становится пустым — удалить cluster sub-header.

При удалении tech-debt линков из roadmap.md — также рассмотреть удаление файла tech-debt
(per «resolved → delete» policy, см. `docs/tech_debt/README.md` § Status machine).

### 7. Summary

Финальный отчёт:
- Сколько items было до review (по bucket'ам).
- Что произошло: X promoted, Y deferred, Z removed, W moved to Won't do, V skipped.
- Сколько inconsistencies fix'нуто.
- Что осталось в каждом bucket'е.

## Important

- **Никогда** не делать file edits / deletions без explicit confirmation через `AskUserQuestion`.
- Audit step (2) **всегда** идёт перед triage. Если formatting слов, fix первой очередью.
- Cross-check (3) **только flag'ает** inconsistencies, не fix'ит автоматически.
- Не путать с `/tech-debt-review` — этот skill triage'ит ТОЛЬКО `docs/roadmap.md`. Если
  user хочет triage docs/tech_debt/* items напрямую — направить на `/tech-debt-review`.
- Не пытаться писать specs для items — graduate-to-spec это другой workflow
  (`superpowers:brainstorming` → `superpowers:writing-plans`).

## Cross-references

- Conventions для roadmap.md формата — в `docs/roadmap.md` § Conventions (source of truth).
- Capture protocol (как items появляются в roadmap.md) — в `CLAUDE.md` § «Roadmap capture».
- Tech-debt counterpart skill — `.claude/skills/tech-debt-review/SKILL.md`.
- Tech-debt status flow (включая resolved → delete) — `docs/tech_debt/README.md` § Status machine.
