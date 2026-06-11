# Workflow & Cost Redesign — Design Spec

**Дата:** 2026-06-11 · **Статус:** draft (awaiting user review) · **Тип:** meta / process

## Цель

Перестроить то, *как* мы работаем в этом репо с AI-агентом, по четырём осям:
1. **Стоимость** — срезать расход токенов (главная боль).
2. **Пайплайн** — сделать итерацию явной и надёжной (ничего не забывается).
3. **Захват знаний** — дёшево и надёжно фиксировать guidelines / roadmap / tech-debt / pitfalls / agent-lessons.
4. **Living-доки** — подрезать то, что грузится каждый ход.

North-star проекта (3 цели): воспроизводимое сравнение wasm-языков; product-guidelines; **+ best-practices по работе с агентами** (PG3) — последнее этот редизайн делает first-class.

## Evidence base (codeburn, 2026-06-11)

Эмпирика по 209 сессиям (`codeburn optimize --period all`), подтверждённая ручным разбором топ-сессий:

- **Драйвер стоимости = число ходов × накопленный контекст (cache-read).** В худшей сессии: 592 хода, 172M cache-read токенов, ~290K контекста/ход; cache-read доминирует ~**100–150×** над output/cache-creation.
- **НЕ edits.** Output размазан ровно (макс ~6.6K/ход), ни одной гигантской записи. Исходная гипотеза «дорого из-за правок CLAUDE.md/README» — **опровергнута**.
- Усилители: subagent fan-out (57 Agent-вызовов в дорогой сессии), task-tracking (84 op), ретраи (8/19/24).
- **#1 рычаг (слова codeburn): дробить multi-wave работу на свежие сессии по волнам.** ⇒ короткие сессии — главный выигрыш всего редизайна; всё остальное (трим доков, язык, lean session-state) вторично, хоть и компаундится.

## Cost-модель

Цена хода ≈ `cached_prefix×0.1 + uncached_suffix + output×5`. Cached-prefix растёт по сессии ⇒ суммарная cache-read стоимость ~квадратична по длине сессии. Отсюда: **сократить сессию вдвое срезает заметно больше половины хвоста**, при фиксированном (но малом, после этого редизайна) оверхеде разрыва.

---

## Решения по темам

### T1 — Конвенция взаимодействия
- **Confidence-схема:** каждый выбор-вопрос получает на опцию `уверенность ~X%` = P(это тот вариант, о котором ты будешь рад) + одно «почему». `(Recommended)` = top-pick. Шкала: 85–95 почти точно / 65–80 склоняюсь / 50–60 close-call / <50 скорее против.

### T2 — Стоимость
- **Измерение: codeburn**, свой анализатор НЕ строим (покрывает ~90%). Для PB6-маркеров — крошечный сканер (~10 строк). Ad-hoc «рост контекста по ходам» / «атрибуция на субагентов» — одноразовые `jq` по `.message.usage`.
- **codeburn-правила:** retry-budget **≤2 попытки → стоп/пересмотр подхода**; **subagent fan-out не бесплатен** (субагент только для тяжёлого/большого, не «субагентить всё»); **read-before-edit / grep-callers** (edit:read держать ближе к 4:1).
- **PB8 sandbox/permission:** sandbox write-allow для tsx IPC-pipe (точный путь сверить); permission-allowlist доверенных `pnpm`/`tsx` через `/fewer-permission-prompts` + `/update-config`.

### T3 — Living-доки
- **Doc-role model:** CLAUDE.md = только нужное **почти каждый ход**; README = внешний manual; specs/plans/pitfalls/guidelines/workflow.md = по требованию.
- **CLAUDE.md:** вынести situational (capture-протоколы → `docs/capture-protocol.md` + короткий триггер; Common Commands → указатель на README; pitfall-bullets → taxonomy ниже) **+ перевод на English**; цель <200 (~130) строк.
- **README:** лёгкое касание — убрать `file:line`-внутренности из «Debug timings» (→ `docs/`/CONTRIBUTING или удалить), anti-fluff проход; manual-секции оставить. Язык README — в tech-debt `docs-language-consistency`.
- **PB5 anti-fluff checklist** (8 правил, ниже) = writing-standard, применять инлайн по умолчанию.
- **GM2 writing-clearly:** грузить только **через субагент** на polish-проходе (read + persistence — дорого); default = PB5-чеклист инлайн. Дистилляция в шпаргалку → tech-debt `writing-clearly-distillation`.
- **PG2 «важное» для guideline:** тест — «меняет ли это решение product-инженера (язык/toolchain/флаг/паттерн) + воспроизводимо?». Нет → литература, не guideline.

**PB5 anti-fluff checklist (writing-standard):** (1) без преамбулы/повтора вопроса — начинай с действия; (2) soft-модалы → NEVER/MUST по тяжести; (3) сравнение 3+ предложений → таблица; (4) для discipline-правил — таблица рационализаций; (5) red-flags до решений; (6) один рабочий пример, не мульти-язык; (7) для output-генерящих — density-цель; (8) validation-checklist в конце (recency).

### T4 — Захват и память
- **PB6 marker-then-batch:** в-сессии — однострочный маркер в обычном ответе `› capture: <type> — <slug>: <одна строка>` (0 round-trip, персистится в транскрипт). На finish-session — детерминированный **скан маркеров → один триаж → batch-запись**. Типы: `{tech-debt, roadmap, guideline-candidate, agent-lesson, pitfall}`. Поглощает SC-roadmap (roadmap-маркеры собираются тем же сканом).
- **session-state — lean handoff:** держать TL;DR (HEAD/tag/branch/статус) · «What next session needs» · Deferred/open-loops · Resume-команды · Stop-point. **Выкинуть:** детальный Done (git log), result-числа (reporter), brainstorm-диалог (spec), рекапы drift/pitfall/memory.
- **session-state нейминг + дом:** новые — `session-state-YYYY-MM-DD-HHMM-slug.md`; **перенести ВСЕ в `docs/superpowers/session-states/`** + обновить ~21 ссылающийся файл (механически, subagent-задача; чинить относительные `../` ссылки; существующие имена не менять).
- **finish-session — расширить scope аудита:** + `docs/capture-protocol.md`, + CONTRIBUTING (если заведём), + вынесенные доки; аудитить **условно** (только если сессия трогала смежную поверхность).
- **finish-session — NEVER auto-invoke:** только рекомендовать на break-точках; решение «звать или нет» всегда за user'ом.
- **Pitfall-routing taxonomy (5 веток):** (1) **eliminate** — починить root-cause, заметку удалить; (2) **hook** — action-triggered `PreToolUse`-напоминание (0 налога каждый ход; opt-in поштучно); (3) **one-liner в CLAUDE.md** — recognition/process, широкое, недетектируемое командой (хранит триггер+симптом+действие, форензику — в ссылку); (4) **skill-checklist** — правило процедуры (spec/execution) → в её чеклист; (5) **link-only** — профилактика уже в коде/тесте/гейте. Маршрутизирует pitfall-dispatch finish-session. Бьёт по безграничному росту CLAUDE.md.
- **remembering-conversations:** fallback-recall (иерархия: память → session-state → remembering-conversations), не рутинный шаг.

### T5 — Пайплайн итерации (спина)
**Single adaptive lane** (не two-lane): фазы авто-масштабируются к размеру задачи; session-split — по SC7, не по «полосе».

| # | Фаза | Что | Где детали |
|---|---|---|---|
| 0 | **Orient** | прочитать lean session-state; `git branch --merged master` → предложить удалить смёрдженные `feature/*`; remembering-conversations только если не хватило | workflow.md |
| 1 | **Select** | roadmap + tech_debt; если backlog прокис → `/backlog-review`; предложить кусок (важность × зависимости × группировка); tech-debt входит как **батч-итерация** или **пришитая первой задачей**; подтвердить | `/backlog-review` |
| 2 | **Branch** | создать `feature/<phase>-<slug>` от master | — |
| 3 | **Design** | `/brainstorming` (масштабируется: мелочь = пара предложений) → spec; **коммит spec на ветку** | brainstorming |
| 4 | **Plan** | `/writing-plans` → план **со встроенным Execution Protocol**; **коммит plan на ветку** | writing-plans conv. |
| → | **Break** | **рекомендовать** `/finish-session` (решает user) | — |
| 5 | **Orient** | прочитать session-state | — |
| 6 | **Execute** | Wave-0 baseline-гейт; hybrid-routing из тегов плана (kickoff-подтверждение); **per-task break-check**; код-коммиты на ветку | план |
| 7 | **Close** | гейты зелёные → push → PR (user ревьюит на GitHub); **рекомендовать** `/finish-session` (marker-scan → триаж → batch-захват; drift-аудит; lean session-state) | finish-session |

- **SC4:** Select **до** brainstorming (разделяем «что» — ценность/приоритет — от «как» — корректность/архитектура).
- **SC6/PB7 hybrid:** kickoff-классификация задач плана (inline тривиальное / subagent тяжёлое; критерий — `feedback_execution_strategy`); субагент чистит главный контекст, но стоит сам ⇒ судить.
- **SC7 break (двойной триггер):** **статические** break-points в плане (концы волн / границы независимых задач) + **динамический** по давлению контекста. Пороги: **~1/3 окна — мягкий** (предложить на ближайшей независимой границе), **~1/2 — жёсткий потолок** (завершаемся), ниже ~1/4 не рвём. Жёсткое правило: после авто-компакции → пауза на ближайшей границе. Только на границах задач с независимой следующей. **break-check — шаг per-task цикла в Execution Protocol плана** (надёжно: процедура, не память).
- **Execution Protocol** (в каждом плане по конвенции writing-plans): hybrid-карта + статические break-points + standing-правило break-check. План читается в начале execution всегда ⇒ ничего не забывается в свежей сессии.
- **SC-branch / Git topology (model A, branch-early):** ветка `feature/<phase>-<slug>` создаётся на **шаге 2** (после Select); **spec + plan + код — всё на ветке**. Commit-timing: spec → конец Design (шаг 3), plan → конец Plan (шаг 4), код → per-wave (шаг 6). На Close — push + PR, содержащий **spec + plan + код вместе** → ревью на GitHub; master меняется только через мёрдж. **Удаление ветки после мёрджа** (проверка `git branch --merged master` в Orient). Меняет старую практику «коммиты на master, не пушим».

### T6 — Мета
- **workflow.md = крошечный индекс** (фазы 0–8 + таблица владения), ~40 строк, English; в CLAUDE.md — ~3-строчный указатель. Детали фазо-локальны (грузятся в своей фазе). Делить на 2 скилла только если индекс >~60 строк.
- **PG3 = вариант A** (без нового артефакта: agent-lessons живут в `pitfalls/` + actionable в `workflow.md`) **+ marker-type `agent-lesson`** (тег в момент создания → greppable). Graduate в `docs/agent-guidelines.md` (формат-B claims) при ≥ пороге evidence.
- **EQ3 coverage map** (ниже) = механизм проверки, что ничего не потеряно.

---

## Skills (изменения)
- **Слить** `tech-debt-review` в `backlog-review` → единый **`/backlog-review`** (English; триажит `roadmap.md` + `tech_debt/`; **format-audit сохранить** — скилл редкий, формат важнее оверхеда; хранилища раздельные). `/tech-debt-review` ретайрим.
- Рутинный триаж — на шаге Select; `/backlog-review` — изредка, глубокая зачистка.

## Change-list (вход для writing-plans; [I]=inline, [S]=subagent)
1. **[S]** Перенести все `session-state-*.md` → `docs/superpowers/session-states/`; обновить ~21 ссылку (вкл. relative `../`, immutable specs — правки чисто механические), вкл. CLAUDE.md, finish-session skill, память (`reference_session_state`, `project_wasm_benchmarks`, `MEMORY.md`), `pitfalls/README.md`, tech-debt `cargo-lock-stage-discipline.md`.
2. **[I]** CLAUDE.md: вынос situational + указатели + перевод на English (<200 строк).
3. **[I]** Создать `docs/capture-protocol.md` (полный capture-протокол + типы маркеров вкл. `agent-lesson`); короткий триггер+phrase-list в CLAUDE.md; `/backlog-review` ссылается.
4. **[I]** Создать `docs/workflow.md` (tiny index, English) + указатель в CLAUDE.md.
5. **[S]** Слить review-скиллы → `/backlog-review` (English), ретайр `/tech-debt-review`.
6. **[I]** README: убрать `file:line` из Debug-timings, anti-fluff проход.
7. **[I]** finish-session skill: marker-scan + batch-триаж; no-regret (не перечитывать CLAUDE.md, батчить findings+apply, pitfall-dispatch одним вопросом); расширить audit-scope (условно); pitfall-routing 5-веток; never-auto-invoke; lean session-state shape + HHMM + новый каталог.
8. **[I]** Маркер-сканер (~10 строк, `jq`/node) для PB6 — собирает `› capture:` из транскрипта.
9. **[I]** PB8: sandbox write-allow tsx-pipe (сверить путь) + permission-allowlist через `/fewer-permission-prompts`/`/update-config`.
10. **[I]** writing-plans-конвенция: план обязан содержать секцию «Execution Protocol» (hybrid-карта + break-points + break-check).
11. **[I]** PB5 anti-fluff checklist → writing-standard (в workflow.md appendix или `docs/writing-standard.md`).
12. **[I]** Завести tech-debt `docs-language-consistency` (README + specs/plans/pitfalls/roadmap — язык, «на подумать»).

## Открыто / tech-debt
- `docs-language-consistency` — язык README + остальных доков (создать в change-list п.12).
- `writing-clearly-distillation` — шпаргалка (файл создан).
- 2 codeburn-флагнутых «unused» скилла = `remembering-conversations` + `writing-clearly-and-concisely` — **НЕ архивируем** (внедряем).

## Non-goals
- Не объединяем хранилища `tech_debt/` + `roadmap.md`.
- Не строим кастомный token-analyzer (codeburn покрывает).
- Hooks — не блокетом, opt-in поштучно.
- Не трогаем `BASH_MAX_OUTPUT_LENGTH` (экономия — шум).

---

## Coverage map (EQ3) — каждый пункт исходного промпта → решение

| ID | Пункт | Решение (раздел) |
|---|---|---|
| GM1 | confidence/recommended | T1 confidence-схема |
| GM2 | writing-clearly интеграция | T3: субагент на polish + tech-debt дистилляции |
| GM3 | remembering-conversations | T4 fallback-recall |
| GM4 | session-state формат/оценка | T4 lean + HHMM + перенос каталога |
| PB1 | что ест токены в finish-session | T2/Evidence: turns×контекст, не edits |
| PB2 | оптимизация CLAUDE.md | T3 вынос+English |
| PB3 | анализ токенов | T2 codeburn (не свой скрипт) |
| PB4 | объём README | T3 лёгкое касание |
| PB5 | искоренение «воды» | T3 anti-fluff checklist (writing-standard) |
| PB6 | когда захватывать | T4 marker-then-batch |
| PB7 | hybrid-исполнение | T5 SC6 kickoff-классификация |
| PB8 | sandbox/permission трение | T2 PB8 фиксы |
| PG1/PG2 | wasm-сравнение / guidelines / «важное» | north-star + T3 PG2-тест |
| PG3 | best-practices по агентам | T6 вариант A + marker-type agent-lesson |
| SC / SC2–7 | 8-шаговый сценарий + улучшения | T5 пайплайн (Orient/Select/.../Close) |
| SC-branch | ветка/merge/удаление | T5 SC-branch |
| EQ1 | судьба review-скиллов | Skills: слить в /backlog-review |
| EQ2 | альтернативы устройства работы | T5: рассмотрены spec-once / small-batch → adaptive single-lane |
| EQ3 | проверка покрытия | эта таблица |
