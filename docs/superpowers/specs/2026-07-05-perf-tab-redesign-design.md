# Phase 1.2 perf-tab redesign — design

**Date:** 2026-07-05
**Branch:** `feature/phase-1.2-perf-tab-redesign`
**Refines roadmap:** `bindgen-size-opt-level` (обогащение формулировки, § C) ([→ roadmap § Phase 1.2](../../roadmap.md)).
**Predecessor:** pipeline-hygiene (PR #14, merged 2026-07-05) — ввёл текущий shape_dispatch heatmap-grid (срез B), который здесь переделываем.

## Goal

Три правки perf-таба reporter'а (+ одна doc-правка), закрываемые одной пачкой:

- **A** — переделать виджет shape_dispatch с heatmap-сетки на бары в стиле `cbox` (как в остальных таблицах). Причина: при полном наборе данных heatmap с общей цветовой шкалой ломается — JS (warm-median 1.8–4.5 мс) в 4–8× медленнее wasm (0.4–1.5 мс), поэтому весь «жар» уходит в JS, а вариативность между wasm-тулчейнами схлопывается в один светлый bucket и не читается.
- **B** — стабилизировать layout perf-таба при переключении фильтров (size S/M/L × profile speed/size): сейчас колонки детальных таблиц прыгают, а `<details>`-спойлеры сбрасывают открыто/закрыто. Данных во всех слайсах одинаковое количество → визуально должны меняться только числа, не структура.
- **C** — обогатить существующий roadmap-пункт `bindgen-size-opt-level` наблюдаемым следствием (bindgen size- и speed-артефакты почти идентичны). Doc-only, нового item не создаём.

Дизайн A согласован через визуальный компаньон (несколько итераций мокапов на реальных числах). Работа сосредоточена в `packages/reporter/src/render-perf.ts` (рендер + CSS + JS); модель `perf-view-model.ts` для A/B **не меняется** (данные уже присутствуют). Архитектура reporter'а (статический HTML на слайс + display-toggle) сохраняется.

---

## A — shape_dispatch: heatmap → cbox-бары

### Находка

`render-perf.ts:307` (`renderShapeGrid`) красит ячейки heat-bucket'ами `a1..a5`, где bucket считается от **единого `max` на всю секцию** (`:310-319`). Т.к. JS ≈ 4.49 мс задаёт этот max, все wasm-ячейки (0.4–1.5 мс) падают в bucket 1 (`round(0.5/4.49·5) = 1`) — весь цвет уходит в JS, вариативность wasm невидима. Дискретные цветовые buckets усугубляют: даже соседние wasm-значения неразличимы.

### Решение (согласовано через компаньон)

Заменить heat-ячейки на бары `cbox` — тот же визуал, что у детальных таблиц/small-multiples (скруглённый трек + число справа). Зафиксированные решения:

- **Структура — без изменений:** строки = impl (js/idiomatic, rust/{raw,bindgen}, cpp/{emscripten,wasi-sdk}, в порядке `implOrderRank`), по 2 подстроки (homo / mixed), столбцы = env (node/chromium/firefox) × dispatch (static/dynamic) = 6 колонок значений. `homo_static·js` остаётся прочерком (языковое свойство — существующий `SHAPE_CAPTION` сохраняем).
- **Ячейка = `cbox`-бар:** трек + `warmMedian.toFixed(2)` мс справа. На dynamic-ячейке — существующий `+Δ%` (dynamic vs static sibling, логика `.dlt` из `renderShapeCell`).
- **Один цвет** для всех баров (репортный `#a7c8e3`). НЕ разделяем static/dynamic оттенком (уже разведены позицией столбца + подписью + `+Δ%`; один цвет делает длину бара единственной переменной → скачок static→dynamic читается как «бар длиннее»). НЕ выделяем JS спец-цветом (JS на общей палитре; это показывает факт «JS ≈ безразличен к static»: его mixed·static ≈ mixed·dynamic).
- **Шкала — max по env:** каждый env (node/chromium/firefox) масштабируется к своему максимуму, посчитанному по **всем** impl/layout/dispatch этого env (**включая JS**). Fill = `min(100, round(value/envMax·100))%`.
  - JS остаётся в шкале → короткий wasm-бар визуально = «в разы быстрее» (это желаемый посыл; вариант «max только по wasm» отклонён — прятал отрыв wask от JS).
  - Внутри env static и dynamic на одной шкале → скачок читается длиной бара. Между env шкалы разные (chromium/firefox не пережаты под node-овским JS); кросс-env сравнение — по числу мс, не по длине. Это проговорить в caption.

### Изменения

- `packages/reporter/src/render-perf.ts`:
  - `renderShapeGrid` / `renderShapeCell`: вместо heat-bucket'а — `cbox`-бар; вычислять `envMax` per env (по всем ячейкам этого env, включая JS) вместо единого `max` секции; fill по `envMax`.
  - Удалить heat-CSS (`.shape-grid td.a1..a5`, `shapeBucket()`); ввести/переиспользовать `cbox`-CSS для grid-ячеек (существующий `.cbox` фикс. `width:118px` → grid-вариант, тянущийся во всю колонку; число-поле фикс. ширины).
  - Обновить eyebrow (`:366`): `lower/darker = faster` → `shorter = faster · шкала бара по env (вкл. js)`.
  - `SHAPE_CAPTION`: сохранить пояснение прочерка `homo_static·js`; **добавить** строку про per-env шкалу (длины баров сравнимы внутри env, между env — по числу).
- **Модель `perf-view-model.ts` — без изменений** (ShapeSection уже даёт `byEnv[env] → ShapeGridCell[]` с `warmMedian`; per-env max считается в рендере — view-концерн).
- Тесты: `packages/reporter/tests/render-perf.test.ts` — обновить ассерты на `.shape-grid`/`.aN` → на `cbox`-разметку.

### Acceptance

- `pnpm build:all` (reporter) + `pnpm test` зелёные.
- **Визуальная проверка** (iterate Phase 7): открыть отчёт → бары `cbox` вместо heat; вариативность wasm читаема; скачок static→dynamic виден длиной; JS одним цветом со всеми; `homo_static·js` = прочерк + пояснение; шкала по env (firefox/chromium раскрыты).

---

## B — стабильность layout при переключении фильтров (Approach A)

### Находка

Каждая комбинация (size × profile) рендерится отдельным DOM-блоком `.perf-slice`; фильтр тоглит `display:none` (`PERF_JS`, `:102-131`). Два симптома:

1. **Колонки прыгают** — детальные таблицы `.pf-t` (`:45-53`) имеют `width:100%` + авто-`table-layout` + `white-space:nowrap` ⇒ ширина колонок = максимум содержимого *этого слайса*. Доминирующий вклад: impl-колонка — суффикс профиля меняется (`…/speed` ↔ `…/size`, 5 vs 4 символа) + появляется/исчезает бейдж `<res` (`.subres`). (`init`/`warm med` — это `cbox` фикс. 118px, не двигаются; `cv`/`relSem` — всегда `0.xxx`, стабильны; `first`/`p95`/`mad` — плавают лишь при переходе магнитуды через степень десятки, в основном при смене S/M/L.)
2. **Спойлеры сбрасываются** — `<details>` живут внутри каждого слайса; открыл в одном фильтре → у нового слайса свой `<details>` в дефолтном (закрытом) состоянии.

### Решение (Approach A — точечный, архитектура та же)

**(1) Колонки — `min-width` в `ch` (не жёсткий `width`):**
- Impl-колонка (`.pf-t td:first-child`/`th:first-child`): `min-width` ≈ 23ch (вмещает `cpp/emscripten/speed` + бейдж `<res`). Пинит колонку под все текущие лейблы как `width`, но деградирует мягко (вырастет под неожиданно длинный лейбл вместо clip/overflow) + масштабируется со шрифтом (адаптивно).
- Числовые `first`/`p95`/`mad` (nth-child 4/6/7 в порядке impl|env|init|first|warm|p95|mad|cv|relSem|ok, либо через `<col>`-классы — уточнить в плане): `min-width` в `ch` под самое широкое ожидаемое значение → значения ниже потолка не джиттерят, выше — колонка растёт (адаптивно).
- `table-layout:auto` + `width:100%` **сохраняем** (ради адаптивности). Честный нюанс: связка auto+100% не даёт идеальной инвариантности — изменение контента в auto-колонке перераспределяется по всем; `min-width` убирает главный (impl+badge) риппл, остаточный джиттер числовых — минимальный. **Escalation** (если Phase-7 покажет заметное движение): `table-layout:fixed` с колонками в `%`/`ch` — полная инвариантность, но смена раскладки. НЕ делаем в v1.

**(2) Спойлеры — общий Set открытых ключей:**
- Каждому `<details>` — семантический ключ `data-sync`, идентичный у всех (size,profile)-слайсов одного виджета: `"<workloadId>:all"` для «details · all envs», `"shape:<layout>:<dispatch>"` для 4 combo-таблиц shape_dispatch. Ключ **не** включает size/profile.
- `PERF_JS`: держать `Set` открытых ключей; делегированный слушатель `toggle` обновляет Set; при переключении фильтра (`activateSlice`) применять Set к `<details data-sync>` показываемого слайса. Ключ-based ⇒ если спойлер отсутствует в каком-то слайсе (нет данных для combo) — просто не синкается, без падения.

### Изменения

- `packages/reporter/src/render-perf.ts`:
  - CSS `.pf-t`: `min-width` в `ch` на impl-колонку + `first`/`p95`/`mad`.
  - `renderPerfDetail` — прокинуть `workloadId` для ключа `data-sync="<workloadId>:all"` (сейчас не знает id → добавить параметр из `renderPerfView`/`workloadSections`).
  - `renderShapeComboDetail` — `data-sync="shape:<layout>:<dispatch>"`.
  - `PERF_JS` — Set открытых ключей + sync в `activateSlice` + `toggle`-listener.
- Тесты: `render-perf.test.ts` — ассерт наличия `data-sync` ключей + `min-width`-стилей (по вкусу).

### Acceptance

- `pnpm typecheck` + `pnpm test` зелёные.
- **Визуальная проверка** (Phase 7): переключение size/profile → impl-колонка не прыгает; открытые спойлеры остаются открытыми; закрытые — закрытыми; числовой джиттер незаметен (иначе — escalation задокументировать).

---

## C — roadmap `bindgen-size-opt-level`: обогатить формулировкой следствия

### Находка (премисса верифицирована кодом)

`scripts/build-rust.ts:60-95`: оба профиля bindgen собираются через `wasm-pack build --release` (opt-level=3 codegen); speed → `optimizeWasm(wasm, "O3")`, size → `optimizeWasm(wasm, "Oz")`. Т.е. bindgen speed и size **отличаются только уровнем wasm-opt** — codegen идентичен (комментарий `:67-72` это фиксирует). Отсюда наблюдаемое: bindgen size- и speed-артефакты почти идентичны, size-фильтр для bindgen почти не отличается от speed. Существующий пункт `bindgen-size-opt-level` (roadmap.md:37) описывает механизм (opt-level=3 vs raw's `z`) + фикс (`CARGO_PROFILE_RELEASE_OPT_LEVEL=z`), но не проговаривает это следствие.

### Решение

- `docs/roadmap.md` — дописать в пункт `bindgen-size-opt-level` одно предложение про наблюдаемое следствие (bindgen size≈speed, т.к. общий opt-level=3 codegen, отличие лишь `wasm-opt -Oz` vs `-O3`) как симптом/мотивацию. Нового item не заводим.
- Никаких изменений сборки/кода в этом срезе (сам фикс opt-level=z остаётся отложенным пунктом).

### Acceptance

- Пункт roadmap обновлён; формат compliance (`- **<name>** — …`) сохранён.

---

## Порядок исполнения

A и B — один файл (`render-perf.ts`), но независимые концерны; C — doc-only.

1. **A** (shape_dispatch рендер + CSS + тесты) — крупнейший по коду.
2. **B** (min-width CSS + спойлер-sync JS + тесты) — тот же файл, отдельная волна во избежание конфликтов в `PERF_JS`/CSS.
3. **C** (roadmap-правка) — тривиально, в любой момент.

Уточнится в плане (`/writing-plans` + Execution Protocol).

## Out of scope

- **Approach B задачи 2** (единая структура + data-swap через JS) — отклонён в пользу точечного Approach A (меньше кода/риска, тот же наблюдаемый результат).
- **`table-layout:fixed`** для `.pf-t` — только escalation, если v1 (`min-width`) оставит заметный джиттер (проверка Phase 7).
- **Фикс самого `bindgen-size-opt-level`** (`CARGO_PROFILE_RELEASE_OPT_LEVEL=z` + ре-бейзлайн bindgen size) — остаётся отложенным roadmap-пунктом; здесь только обогащаем формулировку.
- **Реализация `homo_static·js`** — не делаем (языковое свойство; прочерк + пояснение, как в pipeline-hygiene).

## Риски

- **A — cbox-сетка перегружена/узка:** 6 cbox-колонок × 5 impl × 2 подстроки. Митигация: компактный cbox (трек flex + узкое число-поле); визуальная проверка Phase 7; при тесноте — сузить число-поле / уменьшить gap.
- **A — per-env шкала вводит в заблуждение** (кросс-env длины несравнимы): митигация — явный caption + число мс в каждой ячейке.
- **B — остаточный числовой джиттер** от auto+100%: ловится визуальной проверкой; escalation `table-layout:fixed` задокументирован.
- **B — спойлер-sync ломает существующий display-toggle:** митигация — тест на присутствие `data-sync`, ручная проверка открыто/закрыто через переключение.

## Testing / gates

Полный gate-набор: `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke` (`build:all` / `smoke` — вне sandbox). Обновляемые unit: `render-perf.test.ts` (cbox-разметка A, `data-sync` B). Визуальная проверка отчёта (A: бары/шкала; B: стабильность layout + спойлеры) — iterate Phase 7, обязательна (гейты не ловят render/UX-регрессии).
