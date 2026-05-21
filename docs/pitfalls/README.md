# Pitfalls

Lessons from executing sessions — что пошло не так и как избежать повторения. Один файл
per `/finish-session` invocation (см. раздел Naming ниже). Источник — рефлексия в момент
закрытия сессии.

Назначение — следующая spec/plan author читает relevant pitfalls перед написанием,
executor читает перед большим объёмом работы чтобы избежать known gotchas.

## Distinct from

- `docs/tech_debt/*.md` — actionable backlog items (один fix на item). Pitfall может
  породить tech-debt entry («починить X»), но сам pitfall — это lesson, не задача.
  Bulk-deferred pitfall'ы автоматически roll в
  `docs/tech_debt/incorporate-pitfalls-YYYY-MM-DD.md` — handle через который
  `/tech-debt-review` подхватывает items.
- `docs/guidelines.md` — confirmed product-engineer advice. Pitfall становится guideline'ом
  когда наблюдение reproducible across ≥2 контекстов.
- `docs/superpowers/notes/` — investigation results, measurements (например,
  `2026-05-05-perf-now-precision.md`).
- `docs/superpowers/session-state-*.md` — handoff snapshots, эфемерные.

## Naming

`YYYY-MM-DD-<slug>.md` — дата `/finish-session` call. Slug derived
из session-state slug если есть, иначе из dominant theme сессии.
Один файл per `/finish-session` invocation. Пример:
`2026-05-21-phase-1-1-0-execution.md`.

## Format

H1 + категоризованные секции (Planning, Tooling, Process). Каждый pitfall:

- **What happened** — краткая фактура.
- **Root cause** — почему случилось.
- **Prevention** — что делать в будущем чтобы избежать.

Никакого frontmatter. Документ читается линейно, актуальный на момент написания —
исправления приходят через новые файлы или через ссылки из tech-debt/spec/guidelines.

## Lifecycle

Pitfall-файл — immutable historical record после создания. Никаких status-frontmatter'ов или edit'ов.

**Dispatch happens immediately при создании файла:** `/finish-session` спрашивает
per-pitfall {inline-apply сейчас / bulk в tech-debt}. Inline → AI делает Edit
в target file (обычно CLAUDE.md, spec template, guidelines.md). Bulk → items
накапливаются в `docs/tech_debt/incorporate-pitfalls-YYYY-MM-DD.md`, который
попадает в стандартный `/tech-debt-review` cadence.

Pitfall-файл остаётся как evidence trail даже после full incorporation —
служит свидетельством pattern'а.
