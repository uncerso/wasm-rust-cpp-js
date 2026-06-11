# Session state — pitfalls workflow & docs hygiene (2026-05-22)

Сессия `/research` по двум связанным вопросам:
1. Автоматизация сбора pitfall'ов в `/finish-session` + их dispatch.
2. Зачистка rolling phase-status из `README.md` и `CLAUDE.md`.

## Сделано в этой сессии

Дизайн и план обсуждались в `/research` dialogue (эфемерные scratchpad'ы, не сохранены
в репо per `/research` skill convention). Все долгоживущие outcome'ы перечислены ниже.

**Коммиты на master (`fff7b84..05a80b2`):**
- `fff7b84` — `docs(pitfalls): describe immediate dispatch lifecycle` — переписан
  `docs/pitfalls/README.md`: новая lifecycle (immediate dispatch вместо ad-hoc triage
  на старте phase), naming convention (`<slug>` из session-state), bulk-deferred
  handle в `docs/tech_debt/`.
- `2e338ea` — `docs(readme): drop rolling phase-status paragraph` — удалён вводный
  blockquote-абзац «Статус: Phase 1.1.0 завершён, Phase 1.1.1 next» из `README.md`.
- `d7cab0a` — `docs(claude-md): drop phase-closure parentheticals from pointers` —
  обрезаны parenthetical hints «(Phase 1.0, 1.0.5, 1.0.6, 1.1.0 закрыты; Phase 1.1.1
  next)» с двух bullet'ов в `CLAUDE.md` (строки 14-15). Forensic phase-refs в
  conventions sections и в README «Известные ограничения» сохранены.
- `05a80b2` — `docs(pitfalls): capture session pitfalls + fix README intro` — step 8.5
  /finish-session: 2 pitfall'а в `docs/pitfalls/2026-05-22-pitfalls-workflow.md` +
  bulk-debt `docs/tech_debt/incorporate-pitfalls-2026-05-22.md` (priority low) + фикс
  intro paragraph `docs/pitfalls/README.md` для соответствия новой convention.

**Личный скил (НЕ закоммичен — за пределами репо):**
- `~/.claude/skills/finish-session/SKILL.md` (272 → 362 строки, 7 правок):
  - Frontmatter description расширен про pitfall collection.
  - В «What this skill does NOT do» добавлено 2 bullet'а (про критичность и пустой
    discard).
  - В step 2 (Audit CLAUDE.md) и step 3 (Audit README.md) добавлено anti-regression
    правило про phase-status updates.
  - В step 3 удалён устаревший bullet «Status line (Phase 1.0.5 завершён…) outdated».
  - Между step 8 и step 9 вставлен **step 8.5 «Offer pitfall collection»** с
    friction-signals heuristic и per-item dispatch.
  - В Edge cases добавлен «No friction signals» edge case.
  - В Composition with other skills добавлен «Pitfall dispatch» bullet.

**Memory feedback (НЕ закоммичен — за пределами репо):**
- `~/.claude/projects/-Users-uncerso-src-wasm-rust-cpp-js/memory/feedback_no_language_mixing.md`
  — не мешать русский и английский в ответах когда пользователь пишет по-русски.

## Открытые tech-debt'ы

- **`docs/tech_debt/incorporate-pitfalls-2026-05-21.md`** (legacy, untouched per spec
  scope) — 11 pitfall'ов из Phase 1.1.0 execution ждут manual walkthrough.
  `priority: medium`. Подхватится в следующем `/tech-debt-review`.
- **`docs/tech_debt/incorporate-pitfalls-2026-05-22.md`** (новый, из этой сессии) —
  2 pitfall'а про meta-process. `priority: low`. Подхватится в следующем
  `/tech-debt-review`.

## Что знать следующей сессии

- **Pitfall workflow live.** Если следующая сессия будет substantive с friction signals
  (tool failures, plan deviations, trigger phrases, sandbox bypass), `/finish-session`
  автоматически предложит сбор pitfall'ов через step 8.5. Не игнорировать — это и есть
  новый pipeline.
- **README/CLAUDE.md больше не несут rolling status.** Если возникнет искушение
  обновить «Phase X closed, Phase Y next» в этих файлах — это явно запрещено новым
  anti-regression правилом в `/finish-session`. Phase history живёт в git tags,
  `docs/roadmap.md`, `docs/superpowers/plans/`.
- **Слаг pitfall-файла из session-state.** Convention: pitfall-файл именуется по
  session-state slug если есть, иначе AI proposes из dominant theme. Этот session-state
  использует слаг `pitfalls-workflow`, совпадает с pitfall-файлом — pattern для
  будущих сессий.
- **Language preference.** Когда user пишет по-русски — отвечать по-русски без
  code-switching (см. memory `feedback_no_language_mixing.md`).
- **Phase 1.1.1 (`interop_calls`) — следующая работа по плану.** Не запущена в этой
  сессии. По `docs/roadmap.md` — это первый sub-phase Phase 1.1.

## Tag не ставится

Это процессная сессия (workflow + docs hygiene), не закрытие phase'ы. Tag `phase-*`
не нужен — `master` advanced на 4 коммита, документировано через git log.
