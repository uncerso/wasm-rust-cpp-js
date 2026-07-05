# Perf-tab redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переделать shape_dispatch perf-виджет с heatmap на `cbox`-бары (шкала max-по-env) и стабилизировать layout perf-таба при переключении фильтров (min-width колонок + синхронизация спойлеров), плюс обогатить roadmap-пункт.

**Architecture:** Всё в одном файле `packages/reporter/src/render-perf.ts` (рендер-строки + `PERF_CSS` + `PERF_JS`); модель `perf-view-model.ts` не меняется (данные уже есть, per-env max считается в рендере). Архитектура reporter'а сохраняется: статический HTML на каждый `(size,profile)`-слайс + `display`-toggle; добавляется JS-синхронизация состояния `<details>` по семантическим ключам.

**Tech Stack:** TypeScript (ESM, strict), Vitest, статический HTML/CSS-рендер (без фреймворка). Отчёт генерится `pnpm report`, открывается `results/summarized/<ts>/index.html`.

## Global Constraints

- **TS-стиль** (ESLint flat-config, enforced): 4-space indent, double quotes, semicolons, trailing comma (multiline), `curly: all`, `verbatimModuleSyntax` + strict. Прогонять `pnpm lint:ts` перед коммитом.
- **Никогда не редактировать** авто-генерённые `**/glue.mjs` / `**/glue.js`.
- **Коммиты агента** — с `--no-gpg-sign`.
- **Gate-набор фазы:** `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke` (`build:all`/`smoke` — вне sandbox, `dangerouslyDisableSandbox: true`; `typecheck`/`test`/`lint:ts` работают в sandbox).
- **Reporter unit-тесты:** `pnpm --filter @bench/reporter test` (Vitest, `packages/reporter/tests/`).
- **Визуальная проверка обязательна** (гейты не ловят render/UX): `pnpm report` (вне sandbox) → открыть `results/summarized/<newest>/index.html`.

---

## File Structure

- `packages/reporter/src/render-perf.ts` — **Modify.** Рендер perf-таба: `PERF_CSS` (shape-grid + `.pf-t` min-width), `PERF_JS` (спойлер-sync), `renderShapeGrid`/`renderShapeCell`/`renderShapeGridRows` (cbox-бары + per-env max), `renderPerfDetail`/`renderShapeComboDetail`/`renderSlice`/`renderPerfView` (проброс `data-sync`), eyebrow/`SHAPE_CAPTION`.
- `packages/reporter/tests/render-perf.test.ts` — **Modify.** Обновить shape-тест (cbox вместо heat), добавить тесты min-width + `data-sync`.
- `docs/roadmap.md` — **Modify.** Обогатить `bindgen-size-opt-level`.
- `README.md` — **Modify.** Актуализировать описание shape_dispatch в § Отчёт (stale ещё с PR #14: «2×2 heatmap … pinned node·rust/raw»).
- `perf-view-model.ts` — **не трогаем.**

---

## Task 1 [S]: shape_dispatch — cbox-бары + шкала max-по-env

**Files:**
- Modify: `packages/reporter/src/render-perf.ts` (CSS-блок shape-grid heat-правила `:61-78`, `.shape-cap` `:79-80` сохранить; `shapeBucket` `:257-263`; `renderShapeCell` `:278-292`; `renderShapeGridRows` `:294-305`; `renderShapeGrid` `:307-333`; eyebrow `:366`; `SHAPE_CAPTION` `:273-276`)
- Test: `packages/reporter/tests/render-perf.test.ts` (тест `:176-212`)

**Interfaces:**
- Consumes: `ShapeSection` / `ShapeGridRow` / `ShapeGridCell` из `perf-view-model.ts` (без изменений): `section.rows[].byEnv[env]: ShapeGridCell[]` (4 ячейки, порядок `SHAPE_DISPATCH_GRID`), `cell.warmMedian: number|null`, `cell.dispatch: "static"|"dynamic"`.
- Produces: HTML `<table class="shape-grid">` с `<td class="sc">`, содержащими `<span class="cbox">` (переиспользуемый визуал баров), либо `<td class="e">—</td>` для null.

- [ ] **Step 1: Обновить shape-тест под cbox (сделать его падающим)**

В `render-perf.test.ts` заменить тело теста `:176` (переименовать в «renders shape_dispatch as an impl×env cbox-bar grid …»). Заменить блок ассертов; добавить cbox-проверки, сохранить структурные:

```ts
    it("renders shape_dispatch as an impl×env cbox-bar grid with per-env scale, deltas + 4 combo detail tables", () => {
        const rr = (id: string, wm: number, env: string): BenchResult =>
            fakeResult({ id, language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, wm, env);
        const js = (id: string, wm: number, env: string): BenchResult =>
            fakeResult({ id, language: "js", toolchain: "idiomatic", profile: "speed", inputSize: "L" }, wm, env);
        const html = renderPerfView(aggregate([
            rr("shape_dispatch_homo_static", 1.20, "node"), rr("shape_dispatch_homo_dyn", 1.40, "node"),
            rr("shape_dispatch_mixed_static", 1.30, "node"), rr("shape_dispatch_mixed_dyn", 1.90, "node"),
            js("shape_dispatch_homo_dyn", 3.80, "node"), js("shape_dispatch_mixed_static", 3.60, "node"),
            js("shape_dispatch_mixed_dyn", 4.00, "node"),
        ]));
        expect(html).toContain('class="shape-grid"');
        expect(html).not.toContain('class="shape-heat"');
        // cbox bars, not heat buckets
        expect(html).toContain('class="sc"');
        expect(html).not.toMatch(/class="a[1-5]"/);
        // per-env scale: node max = 4.00 (js mixed·dyn) → its bar is 100%
        expect(html).toContain("width:100%");
        // impl rows, env + dispatch headers, layout sub-rows
        expect(html).toContain("rust/raw");
        expect(html).toContain("js/idiomatic");
        expect(html).toContain(">node<");
        expect(html).toContain(">static<");
        expect(html).toContain(">dynamic<");
        expect(html).toContain(">homo<");
        expect(html).toContain(">mixed<");
        // delta on a dynamic cell + dash for js homo·static + 4 detail tables + caption
        expect(html).toMatch(/\+\d+%/);
        expect(html).toContain("—");
        expect(html).toContain("details · homo·static");
        expect(html).toContain("details · homo·dynamic");
        expect(html).toContain("details · mixed·static");
        expect(html).toContain("details · mixed·dynamic");
        expect(html).toContain("static-typing");
        expect(html).toContain("homo_static");
    });
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm --filter @bench/reporter test -- render-perf`
Expected: FAIL (текущий рендер даёт `class="a1".."a5"`, нет `class="sc"`).

- [ ] **Step 3: Заменить CSS-блок shape-grid**

В `render-perf.ts` заменить строки shape-grid CSS от `.shape-grid{` (`:61`) до последнего `td.a5 .dlt`-правила включительно (`:78`) на блок ниже. **ВАЖНО:** правила `.shape-cap{…}` / `.shape-cap code{…}` (`:79-80`) идут сразу после — их НЕ удалять (стиль подписи сохраняется).

```css
.shape-grid{border-collapse:separate;border-spacing:5px 6px;margin-top:8px}
.shape-grid th{font:700 9px ui-monospace;letter-spacing:.05em;text-transform:uppercase;color:#8a93a0;padding:2px 6px;text-align:center}
.shape-grid th.env{border-bottom:1px solid #e0e5ec;padding-bottom:4px;font-size:10px}
.shape-grid th.sub{font-size:11px;font-weight:600;color:#9aa3b0;text-transform:none;letter-spacing:0}
.shape-grid th.impl{text-align:right;text-transform:none;letter-spacing:0;font:600 12px ui-monospace;color:#3a4555;vertical-align:middle;white-space:nowrap;padding-right:10px}
.shape-grid th.lay{text-align:right;text-transform:none;letter-spacing:0;font-size:11px;font-weight:600;color:#9aa3b0;padding-right:6px}
.shape-grid td.sc{width:118px;padding:0;vertical-align:middle}
.shape-grid td.e{text-align:right;color:#c2c9d2;font:700 11px ui-monospace;padding-right:8px}
.shape-grid td.gap,.shape-grid th.gap{width:14px;padding:0;background:none}
.shape-grid tr.ig td{height:2px;padding:0;background:none}
.shape-grid .cbox{width:100%;box-sizing:border-box}
.shape-grid .cbox .tk i{background:#a7c8e3}
.shape-grid .cbox .v{display:flex;flex-direction:column;align-items:flex-end;line-height:1.15;flex:0 0 auto;min-width:44px}
.shape-grid .cbox .v .dlt{position:static;font:600 8.5px ui-monospace;color:#b5762f}
```

(Убраны: `td{width:84px;height:46px…}`, `td.a1..a5`, `.dlt{position:absolute…}`, `td.a1 .dlt`/`td.a5 .dlt`. Общий `.cbox` — из detail-CSS `:54-57` — переиспользуется; здесь только scoped-оверрайды.)

- [ ] **Step 4: Удалить `shapeBucket`, переписать `renderShapeCell` (per-env max + cbox)**

Удалить функцию `shapeBucket` (`:257-263`). Заменить `renderShapeCell` (`:278-292`) на:

```ts
function renderShapeCell(cell: ShapeGridCell | undefined, staticSibling: ShapeGridCell | undefined, envMax: number): string {
    const wm = cell?.warmMedian ?? null;
    if (wm == null) {
        return "<td class=\"e\">—</td>";
    }
    let delta = "";
    if (cell?.dispatch === "dynamic") {
        const stat = staticSibling?.warmMedian ?? null;
        if (stat != null && stat > 0) {
            const pct = Math.round(((wm - stat) / stat) * 100);
            delta = `<span class="dlt">${pct >= 0 ? "+" : ""}${pct}%</span>`;
        }
    }
    const w = envMax > 0 ? Math.min(100, Math.round((wm / envMax) * 100)) : 0;
    return `<td class="sc"><span class="cbox"><span class="tk"><i style="width:${w}%"></i></span><span class="v">${wm.toFixed(2)}${delta}</span></span></td>`;
}
```

- [ ] **Step 5: Прокинуть per-env max в `renderShapeGridRows`**

Заменить `renderShapeGridRows` (`:294-305`) — второй параметр `max` → `envMax: Record<string, number>`, брать `envMax[env]` на ячейку:

```ts
function renderShapeGridRows(row: ShapeGridRow, envs: string[], envMax: Record<string, number>): string {
    return SHAPE_LAYOUT_ROWS.map((lr, i) => {
        const cells = envs.map((env) => {
            const arr = row.byEnv[env] ?? [];
            const stat = arr[lr.staticIdx];
            const dyn = arr[lr.dynIdx];
            const m = envMax[env] ?? 0;
            return renderShapeCell(stat, undefined, m) + renderShapeCell(dyn, stat, m);
        }).join("<td class=\"gap\"></td>");
        const implTh = i === 0 ? `<th class="impl" rowspan="2">${escape(row.impl)}</th>` : "";
        return `<tr>${implTh}<th class="lay">${lr.label}</th>${cells}</tr>`;
    }).join("");
}
```

- [ ] **Step 6: Считать per-env max в `renderShapeGrid`**

В `renderShapeGrid` (`:307-333`) заменить вычисление единого `max` на per-env map и передать в `renderShapeGridRows`:

```ts
function renderShapeGrid(section: ShapeSection): string {
    // Per-env heat scale (max of that env across all impls/layouts/dispatch, incl. js):
    // JS stays in the scale so a short wasm bar reads as "much faster"; within an env
    // static & dynamic share one scale (the static→dynamic jump reads as bar length).
    const envMax: Record<string, number> = {};
    for (const env of section.envs) {
        let m = 0;
        for (const row of section.rows) {
            for (const cell of row.byEnv[env] ?? []) {
                if (cell.warmMedian != null && cell.warmMedian > m) {
                    m = cell.warmMedian;
                }
            }
        }
        envMax[env] = m;
    }
    const envHead = section.envs.map((env) => `<th class="env" colspan="2">${escape(env)}</th>`).join("<th class=\"gap\"></th>");
    const subHead = section.envs.map(() => "<th class=\"sub\">static</th><th class=\"sub\">dynamic</th>").join("<th class=\"gap\"></th>");
    const totalCols = 2 + section.envs.length * 2 + Math.max(0, section.envs.length - 1);
    const gapRow = `<tr class="ig"><td colspan="${totalCols}"></td></tr>`;
    const body = section.rows.map((row) => renderShapeGridRows(row, section.envs, envMax)).join(gapRow);
    return `<table class="shape-grid">
    <thead>
      <tr><th></th><th></th>${envHead}</tr>
      <tr><th></th><th></th>${subHead}</tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}
```

- [ ] **Step 7: Обновить eyebrow + `SHAPE_CAPTION`**

Eyebrow (`:366`) — заменить строку внутри `<span class="perf-eyebrow">…</span>` на:
`warm-median (ms) · impl × env · shorter = faster · bar scaled per env (incl. js) · +Δ% = dynamic vs static`

`SHAPE_CAPTION` (`:273-276`) заменить на:

```ts
const SHAPE_CAPTION =
    "<p class=\"shape-cap\">bar length = warm-median, scaled per env (max of that env, incl. js) — comparable within an env; "
    + "across envs compare the ms number · +Δ% = dynamic vs static · — = not applicable. "
    + "Static/dynamic dispatch is a static-typing concept; for a dynamically-typed language (js) the static form of "
    + "homogeneous data is identical to the dynamic form, so <code>homo_static·js</code> does not exist.</p>";
```

- [ ] **Step 8: Запустить тест — убедиться, что проходит**

Run: `pnpm --filter @bench/reporter test -- render-perf`
Expected: PASS (все тесты `renderPerfView`, включая обновлённый shape-тест).

- [ ] **Step 9: Typecheck + lint**

Run: `pnpm --filter @bench/reporter typecheck && pnpm lint:ts`
Expected: без ошибок.

- [ ] **Step 10: Commit**

```bash
git add packages/reporter/src/render-perf.ts packages/reporter/tests/render-perf.test.ts
git commit --no-gpg-sign -m "feat(reporter): shape_dispatch perf — cbox bars + per-env scale (replace heatmap)"
```

---

## Task 2 [I]: `.pf-t` min-width колонок (стабильность ширины)

**Files:**
- Modify: `packages/reporter/src/render-perf.ts` (`PERF_CSS`, блок `.pf-t` `:45-53`)
- Test: `packages/reporter/tests/render-perf.test.ts`

**Interfaces:**
- Consumes: колонки `.pf-t` в порядке `impl(1) | env(2) | init(3) | first(4) | warm med(5) | p95(6) | mad(7) | cv(8) | relSem(9) | ok(10)` (см. `<thead>` в `renderPerfDetail` `:204`). `init`/`warm med` — `cbox` (фикс. 118px); `cv`/`relSem` стабильны (`0.xxx`).
- Produces: CSS-правила `min-width` (в `ch`) на impl-колонку + `first`/`p95`/`mad`.

- [ ] **Step 1: Тест на присутствие min-width (падающий)**

Добавить в `render-perf.test.ts` (внутри `describe("renderPerfView")`):

```ts
    it("pins the detail-table impl + ms columns via min-width (layout stable across filters)", () => {
        // impl column min-width and the ms-text columns (first/p95/mad) via nth-child, in ch
        expect(PERF_CSS).toMatch(/\.pf-t (td|th):first-child\{[^}]*min-width:\d+ch/);
        expect(PERF_CSS).toMatch(/\.pf-t td:nth-child\(4\)[^{]*\{[^}]*min-width:\d+ch/);
        expect(PERF_CSS).toMatch(/\.pf-t td:nth-child\(6\)[^{]*\{[^}]*min-width:\d+ch/);
        expect(PERF_CSS).toMatch(/\.pf-t td:nth-child\(7\)[^{]*\{[^}]*min-width:\d+ch/);
    });
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm --filter @bench/reporter test -- render-perf`
Expected: FAIL (нет min-width-правил).

- [ ] **Step 3: Добавить min-width-правила в `.pf-t` CSS**

После существующего блока `.pf-t th,.pf-t td{…}` (`:46`) добавить в `PERF_CSS`:

```css
.pf-t th:first-child,.pf-t td:first-child{min-width:23ch}
.pf-t td:nth-child(4),.pf-t th:nth-child(4),.pf-t td:nth-child(6),.pf-t th:nth-child(6),.pf-t td:nth-child(7),.pf-t th:nth-child(7){min-width:8ch}
```

(impl-колонка ≥23ch — вмещает `cpp/emscripten/speed` + бейдж `<res`; `first`/`p95`/`mad` ≥8ch — вмещает `999.999` + запас. `table-layout:auto` + `width:100%` сохраняются — адаптивность.)

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `pnpm --filter @bench/reporter test -- render-perf`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @bench/reporter typecheck && pnpm lint:ts`
Expected: без ошибок.

- [ ] **Step 6: Commit**

```bash
git add packages/reporter/src/render-perf.ts packages/reporter/tests/render-perf.test.ts
git commit --no-gpg-sign -m "fix(reporter): pin .pf-t impl + ms columns via min-width (stable layout across filters)"
```

---

## Task 3 [S]: синхронизация состояния спойлеров между фильтрами

**Files:**
- Modify: `packages/reporter/src/render-perf.ts` (`PERF_JS` `:102-131`; `renderPerfDetail` `:194-210`; `renderShapeComboDetail` `:335-351`; `renderSlice` `:158-168`; `renderPerfView` workloadSections `:395-402`)
- Test: `packages/reporter/tests/render-perf.test.ts`

**Interfaces:**
- Consumes: `slice`/`wl.id` (workload id) в `renderPerfView`; `combo.layout`/`combo.dispatch` в `renderShapeComboDetail`.
- Produces: `<details data-sync="<key>">` где key = `"<workloadId>:all"` (small-multiples detail) или `"shape:<layout>:<dispatch>"` (shape combo). `PERF_JS` синхронизирует одинаковые ключи между слайсами.

- [ ] **Step 1: Тесты на data-sync ключи (падающие)**

Добавить в `render-perf.test.ts`:

```ts
    it("tags detail spoilers with a filter-stable data-sync key", () => {
        const html = renderPerfView(aggregate([fakeResult({ id: "hashmap_int" }, 1.0, "node")]));
        expect(html).toContain('data-sync="hashmap_int:all"');
    });

    it("tags shape_dispatch combo spoilers with a layout·dispatch data-sync key", () => {
        const rr = (id: string, wm: number): BenchResult =>
            fakeResult({ id, language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, wm, "node");
        const html = renderPerfView(aggregate([
            rr("shape_dispatch_homo_static", 1.2), rr("shape_dispatch_homo_dyn", 1.4),
            rr("shape_dispatch_mixed_static", 1.3), rr("shape_dispatch_mixed_dyn", 1.9),
        ]));
        expect(html).toContain('data-sync="shape:homo:dynamic"');
        expect(html).toContain('data-sync="shape:mixed:static"');
    });

    it("PERF_JS syncs data-sync spoiler state with a re-entry guard", () => {
        expect(PERF_JS).toContain("data-sync");
        expect(PERF_JS).toContain("CSS.escape");
    });
```

(Импорт `PERF_JS` добавить в `import { PERF_CSS, PERF_JS, renderPerfView } from "../src/render-perf.js";`.)

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm --filter @bench/reporter test -- render-perf`
Expected: FAIL (нет `data-sync` / `PERF_JS` не экспортит sync-логику).

- [ ] **Step 3: Прокинуть workloadId в detail-спойлер**

`renderPerfDetail` (`:194`) — добавить параметр `workloadId` и ключ на `<details>`:

```ts
function renderPerfDetail(slice: PerfSlice, workloadId: string): string {
    if (slice.detail.length === 0) {
        return "";
    }
    const maxInit = slice.detail.reduce((m, r) => Math.max(m, r.initTotal), 0);
    const maxWarm = slice.detail.reduce((m, r) => Math.max(m, r.warmMedian), 0);
    const rows = slice.detail.map((row) => renderDetailRow(row, maxInit, maxWarm)).join("\n");
    return `<details data-sync="${escape(workloadId)}:all">
<summary class="pf-tg">details · all envs</summary>
<table class="pf-t">
<thead><tr><th>impl</th><th>env</th><th>init</th><th>first</th><th>warm med</th><th>p95</th><th>mad</th><th>cv</th><th>relSem</th><th>ok</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</details>`;
}
```

`renderSlice` (`:158`) — принять и прокинуть `workloadId`:

```ts
function renderSlice(slice: PerfSlice, workloadId: string): string {
    const max = computeGlobalMax(slice.multiples);
    const headCols = slice.envs.map((env) => `<span class="eh">${escape(env)}</span>`).join("");
    const head = `<div class="em-head"><span class="sp"></span>${headCols}</div>`;
    const rows = slice.multiples.map((m) => {
        const cells = slice.envs.map((env) => renderCell(m.byEnv[env], max)).join("");
        return `<div class="em-row"><div class="em-impl">${escape(m.impl)}</div>${cells}</div>`;
    }).join("\n");
    const detail = renderPerfDetail(slice, workloadId);
    return `${head}\n${rows}${detail ? "\n" + detail : ""}`;
}
```

`renderPerfView` workloadSections (`:396`) — передать `wl.id`:

```ts
            return `<div class="perf-slice"${display} data-size="${escape(slice.size)}" data-profile="${escape(slice.profile)}">
${renderSlice(slice, wl.id)}
</div>`;
```

- [ ] **Step 4: Ключ на shape combo-спойлер**

`renderShapeComboDetail` (`:342`) — заменить открывающий `<details>` на:

```ts
    return `<details data-sync="shape:${escape(combo.layout)}:${escape(combo.dispatch)}">
<summary class="pf-tg">details · ${escape(combo.layout)}·${escape(combo.dispatch)}</summary>
```

(остальное тело функции без изменений).

- [ ] **Step 5: Добавить sync-логику в `PERF_JS`**

В `PERF_JS` (`:102`), внутри IIFE, ПОСЛЕ навешивания слушателей на seg-контролы (перед закрывающим `}());`), добавить:

```js
  // Spoiler state is shared across (size,profile) slices by semantic data-sync key,
  // so toggling a detail in one filter keeps it open/closed in every other filter.
  var syncing = false;
  document.querySelectorAll('.perf-body details[data-sync]').forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (syncing) { return; }
      syncing = true;
      var key = d.dataset.sync;
      document.querySelectorAll('details[data-sync="' + CSS.escape(key) + '"]').forEach(function (o) {
        if (o !== d && o.open !== d.open) { o.open = d.open; }
      });
      syncing = false;
    });
  });
```

- [ ] **Step 6: Запустить — убедиться, что проходит**

Run: `pnpm --filter @bench/reporter test -- render-perf`
Expected: PASS.

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm --filter @bench/reporter typecheck && pnpm lint:ts`
Expected: без ошибок.

- [ ] **Step 8: Commit**

```bash
git add packages/reporter/src/render-perf.ts packages/reporter/tests/render-perf.test.ts
git commit --no-gpg-sign -m "feat(reporter): sync detail-spoiler open state across perf filters (data-sync keys)"
```

---

## Task 4 [I]: docs — roadmap `bindgen-size-opt-level` + README § Отчёт

**Files:**
- Modify: `docs/roadmap.md` (пункт `bindgen-size-opt-level`, `:37`)
- Modify: `README.md` (§ Отчёт, Perf-буллет, `:266`)

- [ ] **Step 1: Обогатить roadmap-пункт**

В `docs/roadmap.md`, в конец описания пункта `**bindgen-size-opt-level**` (`:37`, перед `Ре-бейзлайн bindgen size. Captured Phase 1.4.`) вставить предложение:

```
Наблюдаемое следствие: bindgen size- и speed-артефакты почти идентичны (оба — `--release` opt-level=3 codegen, отличие лишь `wasm-opt -Oz` vs `-O3`, verified `scripts/build-rust.ts:60-95`) → size-фильтр для bindgen почти не отличается от speed.
```

- [ ] **Step 2: Актуализировать README Perf-буллет**

В `README.md` § Отчёт, в Perf-буллете (`:266`) заменить фрагмент про shape_dispatch. Заменить:

> `плюс 2×2 heatmap для shape_dispatch. Impl'ы во всех ячейках идут в канонический порядок js → rust → cpp. Сегментные контролы size (по умолчанию максимальный доступный) и профиль переключают активный срез; heatmap shape_dispatch следует выбранному size/профилю (pinned impl node·rust/raw).`

на:

> `плюс для shape_dispatch — impl×env сетка cbox-баров (warm-median, шкала бара по env, включая js; +Δ% = dynamic vs static; homo_static·js = прочерк, языковое свойство) с 4 свёрнутыми detail-таблицами по комбо. Impl'ы во всех ячейках идут в канонический порядок js → rust → cpp. Сегментные контролы size (по умолчанию максимальный доступный) и профиль переключают активный срез (открытые detail-спойлеры и ширины колонок сохраняются между фильтрами).`

- [ ] **Step 3: Commit**

```bash
git add docs/roadmap.md README.md
git commit --no-gpg-sign -m "docs: bindgen-size-opt-level observable-consequence + README shape_dispatch/perf-filter description"
```

---

## Execution Protocol

**Routing (гибрид inline/subagent — CLAUDE.md § Cost discipline «subagent для сложного, inline для тривиального»):**
- **Task 1 [S]** — рендер+CSS+per-env scale+тест: самый крупный, изолированный концерн → subagent (полный gate-набор в брифе: lint+typecheck+test).
- **Task 2 [I]** — CSS min-width + один тест: тривиально → inline.
- **Task 3 [S]** — render-проброс + `PERF_JS` sync + тесты: JS-логика с re-entry guard → subagent.
- **Task 4 [I]** — doc-правки → inline.

При исполнении **не переспрашивать** роутинг у харнесса; следовать тегам. Если исполнитель — эта сессия целиком inline, тоже допустимо (полный контекст дизайна здесь).

**Wave-0 baseline gate (до первой правки):** прогнать `pnpm --filter @bench/reporter test` + `pnpm typecheck` — убедиться, что baseline зелёный (иначе фиксируем pre-existing failure до старта).

**Порядок волн:** Task 1 → Task 2 → Task 3 → Task 4. Task 1/2/3 трогают один файл (`render-perf.ts`) — строго последовательно (не параллелить, чтобы не конфликтовать в `PERF_CSS`/`PERF_JS`). Task 4 независим (docs).

**Static break-points (рекомендовать `/finish-session`, решает пользователь):**
- После Task 3 (весь код perf-таба готов, до docs) — естественная точка на визуальную проверку.
- После Task 4 + полного gate-набора + визуальной проверки — перед push/PR.

**Per-task break-check:** после каждого Task — тест+typecheck+lint зелёные (в шагах); если Task провалил gate дважды одним подходом → STOP, переосмыслить (retry budget ≤2, CLAUDE.md).

**Landing (Phase 7, до объявления фазы закрытой):**
1. Полный gate-набор: `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke` (вне sandbox — `dangerouslyDisableSandbox`).
2. **Визуальная проверка** (обязательна): `pnpm report` → открыть `results/summarized/<newest>/index.html`:
   - shape_dispatch: cbox-бары вместо heat; вариативность wasm читаема; JS одним цветом; `homo_static·js` = прочерк + пояснение; шкала по env (firefox/chromium раскрыты); скачок static→dynamic виден длиной; переключение size/profile работает.
   - Стабильность: переключение фильтров → impl-колонка `.pf-t` не прыгает; открытые спойлеры остаются открытыми; числовой джиттер незаметен (иначе — escalation `table-layout:fixed`, задокументировать).
3. Spec-coverage diff: все § spec (A/B/C) реализованы; escalation-пункты (`table-layout:fixed`, фикс opt-level=z) — осознанно отложены, surface пользователю.
4. Push + PR — **действие пользователя** (Yubikey SSH, gh отсутствует): hand-off `! git push -u origin feature/phase-1.2-perf-tab-redesign` + compare-ссылка.

## Self-review notes (writing-plans)

- **Spec coverage:** A → Task 1; B(колонки) → Task 2; B(спойлеры) → Task 3; C(roadmap) → Task 4 Step 1; README-drift → Task 4 Step 2. Все § покрыты.
- **Placeholder scan:** нет TBD/«handle edge cases» — весь код приведён.
- **Type consistency:** `renderSlice(slice, workloadId)` / `renderPerfDetail(slice, workloadId)` / `renderShapeGridRows(row, envs, envMax: Record<string,number>)` — сигнатуры согласованы между задачами; `escape` — существующий хелпер (`:12`).
