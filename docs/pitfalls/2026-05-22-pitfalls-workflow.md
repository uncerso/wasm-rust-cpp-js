# Pitfalls — pitfalls workflow design session (2026-05-22)

Lessons из исполнения /research-сессии по дизайну pitfalls workflow и docs hygiene
(commits `fff7b84..d7cab0a` на master + правки личного скила
`~/.claude/skills/finish-session/SKILL.md`).

---

## Process patterns

### 1. Проверять механизм опции до пометки её рекомендованной в /brainstorming

**What happened.** В первом clarifying question рекомендовал «(b) at start of next
session» для pitfall-triage triggerа — surface-level recommendation без концретного
механизма. User pushed back дважды («откуда возьмётся info про unprocessed pitfalls?
не забьёт ли это новый контекст в начале сессии?»). Option dissolved при probe —
пришлось revise рекомендацию на opportunistic triage через `/tech-debt-review`.

**Root cause.** Recommendation сделан на surface-level fit («session boundary = natural
cadence»), без concrete trace implementation. Не задал себе вопрос «как именно это
выглядит шаг за шагом?» до того, как назвать вариант рекомендуемым.

**Prevention.** Перед тем как пометить опцию рекомендованной в /brainstorming, force
concrete trace: (1) что именно сделает next session? (2) откуда возьмёт информацию?
(3) что user увидит? (4) что fails? Если на любом шаге появляется fuzz — опция не
готова к рекомендации; downgrade в neutral option, не recommended.

### 2. Грепать весь файл по теме конвенции до lock'а scope'а docs-спеки

**What happened.** Спека для `docs/pitfalls/README.md` обозначила три раздела для
правки (Distinct from / Naming / Lifecycle). После применения правок вводный абзац
(строки 3-5) остался говорить «Один файл на сессию или фазу», что contradicts
обновлённую convention «one per /finish-session call». Замечено во время plan
execution (Task 1 step 1.5) — фикс отложен (out of plan scope), оставлен для
/finish-session audit. В итоге исправлено в той же `/finish-session` сессии inline.

**Root cause.** Spec scoped по section headings, без grep'а файла на related-словам.
Informal mentions конвенции в intro/footer не попали в scope, потому что не привязаны
к разделу с явным заголовком.

**Prevention.** Когда спека правит convention text в docs-файле, до lock'а scope
сделать grep всему файлу на related terms. Для нашего кейса:
`grep -F "Один файл" docs/pitfalls/README.md` поймал бы intro line 3-4 в момент
scoping. Generic lesson задеплоен в tech-debt `incorporate-pitfalls-2026-05-22.md`
для решения о точном target'е (skill `/brainstorming`, `/research`, или memory).

---

## Что НЕ pitfall (но наблюдение)

- **zsh `! grep && ! grep && ...` chain produces `command not found: !`** — narrow
  shell-syntax knowledge point, fallback (`if grep -q PAT; then echo FAIL; exit 1; fi`
  loop) сразу сработал. Не lesson на будущее, а one-time gotcha, который plan handled
  gracefully.
- **Code-switching русский+английский в ответах** — feedback от пользователя в этой
  сессии, фиксируется как memory feedback entry, не pitfall. Применимо к стилю ответов,
  не к процессу работы.
