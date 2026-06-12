# Workflow Trigger & Landing Layer — Design Spec

**Дата:** 2026-06-12 · **Статус:** draft (awaiting user review) · **Тип:** meta / process
**Предшественник:** `docs/superpowers/specs/2026-06-11-workflow-cost-redesign-design.md` (этот спек чинит дыры в нём).

## Цель

Сделать так, чтобы итерационный пайплайн (`docs/workflow.md`) **реально срабатывал** каждую сессию, и закрыть дыры landing-слоя (H1–H7), оставшиеся после workflow-cost-redesign. Это first-class работа по north-star goal #3 («улучшать то, как мы работаем с агентом»).

**Корневой диагноз:** решение существует операционально, только если оно лежит в **always-loaded поверхности** (global/project CLAUDE.md), в **auto-trigger скилле**, или в **детерминированном хуке**. Workflow-cost-redesign оптимизировал *контент* пайплайна, но не спроектировал *landing-слой* — и ряд решений (T1, часть T2, сам триггер workflow.md) не приземлился ни на одну firing-поверхность. Доказано в сессии 2026-06-12: я пропустил Phase 0/1, не писал confidence-проценты, а sandbox-fix оказался нерабочим.

## Hole-audit (evidence base)

| # | Дыра | Доказательство | Sev | Фикс |
|---|---|---|---|---|
| **H6** | **Корень:** coverage map (EQ3) проверяла *prompt-point → decision* и *change-list → task*, но никогда *decision → firing-surface*. Решения между телом спека и change-list невидимы. | spec EQ3 покрывает 12 change-list items; T1/T2 не были change-list items | root | landing-audit (D5) |
| **H1** | T1 confidence-схема не приземлилась | grep: только в spec + 2 `pitfalls/*brainstorm.md` + memory; ни одной always-loaded/trigger-поверхности | high | D3 |
| **H2** | T2 codeburn-правила (retry ≤2, read:edit ~4:1, subagent-only-for-heavy) дропнуты целиком | grep: 0 совпадений в CLAUDE.md/workflow.md/skills | med | D4 |
| **H4** | Пайплайн (`workflow.md`) **не имеет триггера** — только пассивный указатель в CLAUDE.md | пропуск Phase 0/1 в сессии 2026-06-12; ни skill, ни hook не оборачивает пайплайн | high | D1 (+D2) |
| **H5** | Execution-Protocol convention enforce'ится только через пассивный doc+указатель | `writing-plans` в plugin-cache, не редактируется; опора на память | med | D1 (Phase 4 шаг) |
| **H3** | **Sandbox-fix не работает** — `listen EPERM` всё ещё на `/tmp/claude-501/tsx-501/*.pipe` | live-прогон `pnpm exec tsx -e` без bypass, 2026-06-12 | high | D6 |
| **H7** | Deferred verify (Task 9 Step 4 редизайна) пересёк границу сессии не отслеженным → отгрузился сломанным (H3) | session-state числил sandbox как «open loop»; задача считалась done | med | D7 |
| H8 | Нумерация фаз: spec/plan говорят 0–8, live docs — 0–7 (верно) | grep | cosmetic | действий нет; live-доки уже верны |

H1/H2/H4/H5 — один и тот же отказ: решение без firing-поверхности. H6 — почему ни одно не поймали.

## Решения

### D1 — `/iterate` skill (триггер пайплайна)

Репо-локальный скилл `.claude/skills/iterate/SKILL.md` — **тонкий драйвер**, не дубликат `workflow.md`.

- **Контент:** читает `docs/workflow.md` и ведёт по фазам 0–7. Таблицу фаз НЕ дублирует (ссылается на workflow.md); добавляет (а) continue-vs-fresh routing-логику Phase 0 и (б) per-phase чеклист действий.
- **Фазы он оркестрирует, вызывая существующие скиллы:** Phase 3 → `/brainstorming`, Phase 4 → `/writing-plans`, Phase 6 → `executing-plans`/`subagent-driven-development`, Close → рекомендует `/finish-session`.
- **Триггеры (frontmatter description):** explicit `/iterate`; auto на фразы «новая итерация / new iteration / next phase / продолжаем работу / continue the work / давай дальше». Опирается на агрессивное правило using-superpowers («1% шанс → invoke»).
- **Continue-vs-fresh (ядро «начиналась ИЛИ продолжалась»):** Phase 0 Orient читает три durable-сигнала и маршрутизирует:
  1. свежайший `docs/superpowers/session-states/session-state-*.md` (нарративный handoff: open-loops, «what next session needs»),
  2. чекбоксы in-flight плана (`- [ ]` vs `- [x]` = механический ledger задач),
  3. `git branch` (есть ли несмёрдженный `feature/*` с открытым планом).
  - open loops + незакрытые `[ ]` на feature-ветке → **CONTINUE** с следующей `[ ]` задачи по Execution Protocol плана (пропустить Select/Branch/Design/Plan).
  - последняя работа закрыта/смёрджена → **START FRESH** с Phase 1 Select.
  - Пользователь всегда зовёт один и тот же `/iterate`; решение continue/fresh — работа Phase 0, не пользователя.

### D2 — Хука пока нет (deferred)

- Хук НЕ строим в эту итерацию (решение пользователя: skill-first, YAGNI).
- CLAUDE.md workflow-указатель делаем **actionable**: «iteration/phase work → invoke `/iterate`» (вместо пассивного «pipeline lives in workflow.md»).
- Записать одну строку в `docs/roadmap.md`: «SessionStart-hook insurance — добавить, если /iterate-invocation drift повторится». Хук = детерминированная страховка против дрейфа; оправдан, только если skill-триггер на практике промахивается.

### D3 — T1 confidence-схема → новый глобальный `~/.claude/CLAUDE.md`

- Файла нет → **создать минимальный** `~/.claude/CLAUDE.md` (вне репо, не коммитится).
- Правило: на каждом choice/AskUserQuestion-вопросе каждая опция получает **`уверенность ~X%`** = P(это тот вариант, о котором ты будешь рад) **+ одно «почему»**. Шкала: 85–95 почти точно / 65–80 склоняюсь / 50–60 close-call / <50 скорее против. Top-pick первым, помечен `(Recommended)`.
- Дом — глобальный (cross-project preference, не репо-конвенция). Память отвергнута: грузится как «background context, not user instructions» → soft (ровно причина, почему T1 в `feedback_brainstorming_mechanism_check` не сработал). Скилл отвергнут: T1 — standing output-конвенция, не procedure-to-invoke.
- Репо-CLAUDE.md T1 НЕ дублирует.

### D4 — T2 codeburn-правила → репо CLAUDE.md

Компактный блок (≤4 строки), т.к. это per-turn поведенческие правила (решаются на каждом ходу):
- **retry-budget:** ≤2 попытки → стоп, пересмотреть подход (не долбить).
- **subagent fan-out не бесплатен:** субагент только для тяжёлого/большого, не «субагентить всё».
- **read-before-edit / grep-callers:** держать edit:read ~4:1.

### D5 — Landing-audit (мета-фикс H6)

Стоячая проверка на двух firing-поверхностях:
- **`docs/workflow.md` § Spec & plan discipline** — новый буллет: «**Landing audit** — каждое решение спека ОБЯЗАНО назвать firing-поверхность (global/project CLAUDE.md, skill, hook), которая заставляет его грузиться/триггериться. Нет поверхности → решение не сработает. Проверить каждое до hand-off в план.»
- **`finish-session` skill (drift-audit)** — добавить шаг: «для решений, принятых в сессии, подтвердить, что каждое приземлилось на firing-поверхность».
- **writing-plans coverage-map convention** (в workflow.md): план мапит *decision → firing-surface*, не только change-list → task.

### D6 — Sandbox-fix (H3), через systematic-debugging

- **Гипотезы (проверить, не settled):** (a) `allowUnixSockets` — не та ручка: `listen`/bind создаёт файл сокета = filesystem **write**; PB8 в *спеке* говорил «write-allow», а имплементация (e196a07) поставила `allowUnixSockets`. (b) macOS `/tmp` → `/private/tmp` канонизация: live sandbox write-allowlist перечисляет **обе** формы, а наш glob — только `/tmp/claude-*`.
- **Процедура:** systematic-debugging → root-cause → реальный фикс в `.claude/settings.json` (вероятно filesystem write-allow на tsx-pipe dir в обеих формах пути) → **ре-верифай** `pnpm exec tsx -e "console.log(1)"` без bypass, должно пройти без EPERM → переписать CLAUDE.md gotcha «tsx + sandbox» (убрать/обновить совет про `dangerouslyDisableSandbox`) → закрыть tech-debt `claude-md-tsx-sandbox-gotcha`.
- Если реальный фикс не находится — задокументировать точную причину и оставить gotcha как есть (не отгружать сломанным молча — урок H7).

### D7 — H7/H8 cleanup

- **finish-session:** добавить правило «open-loops ОБЯЗАНЫ закрыться или быть явно ре-deferred (с причиной) до phase-close» — чтобы отложенный verify не отгрузился сломанным молча (как H3).
- **H8:** live-доки уже говорят 0–7; действий нет.

## Firing-surface проверка (dogfood D5)

| Решение | Firing-поверхность | Срабатывает? |
|---|---|---|
| D1 `/iterate` | skill description (auto) + explicit | ✓ |
| D2 actionable указатель | репо CLAUDE.md (always) | ✓ |
| D3 T1 | global `~/.claude/CLAUDE.md` (always, везде) | ✓ |
| D4 T2 | репо CLAUDE.md (always) | ✓ |
| D5 landing-audit | workflow.md (грузится в Design/Plan через /iterate) + finish-session skill | ✓ |
| D6 sandbox | settings.json (детерминировано) + CLAUDE.md gotcha | ✓ |
| D7 open-loops rule | finish-session skill | ✓ |

Каждое решение названо с поверхностью → этот спек проходит собственный landing-audit.

## Non-goals

- SessionStart-hook (deferred, D2).
- Back-translation прочих доков (отдельный tech-debt `docs-language-consistency`).
- Любая benchmark/продуктовая работа (это чисто goal #3).
- Не трогаем хранилища roadmap/tech_debt структурно.

## Branch / out-of-repo

- Ветка: продолжаем на `feature/workflow-cost-redesign` (master не содержит редизайн-доков/скиллов; её PR ещё не открыт; эта итерация чинит ровно ту работу → одна когезивная «redesign + fixes» PR).
- Out-of-repo: создать global `~/.claude/CLAUDE.md` (не коммитится); возможно строка в roadmap про hook-insurance.

## Change-list (вход для writing-plans; [I]=inline, [S]=subagent)

1. **[I]** Создать `.claude/skills/iterate/SKILL.md` (тонкий драйвер фаз 0–7 + continue-vs-fresh routing; description-триггеры). (D1)
2. **[I]** Создать global `~/.claude/CLAUDE.md` с confidence-схемой. (D3)
3. **[I]** Репо CLAUDE.md: actionable workflow-указатель → `/iterate` (D2); блок T2 codeburn-правил (D4); переписать «tsx + sandbox» gotcha после D6.
4. **[I]** `docs/workflow.md`: буллет landing-audit + decision→surface coverage-convention. (D5)
5. **[I]** `.claude/skills/finish-session/SKILL.md`: landing-audit шаг в drift-audit (D5) + open-loops-before-close правило (D7).
6. **[I/debug]** Sandbox: root-cause + фикс `.claude/settings.json` + ре-верифай без bypass. (D6)
7. **[I]** `docs/roadmap.md`: строка про SessionStart-hook insurance (D2); закрыть tech-debt `claude-md-tsx-sandbox-gotcha` после D6.
