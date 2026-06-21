# Reporter Shell + Size Visualization — Implementation Plan (Plan 2/3, Phase 1.3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Превратить монолитный reporter в одну статическую страницу с вкладками **Size**/**Perf** и клиентскими фильтрами; Size-вкладка читает `composition` из `dist/*/meta.json` и рисует композиционные stacked-bars на общей байтовой шкале (floor-band + observed-band) + кросс-языковую таблицу по категориям.

**Architecture:** Reporter (`packages/reporter`) расщепляется на фокусные модули: чистая логика (`size-data` загрузка/нормализация meta, `size-view-model` группировка floor/observed + сегменты) — TDD-тестируемая; рендер (`render-perf` перенос существующей таблицы минус size-колонки, `render-size` бары+таблица+контролы, `render-shell` оболочка+вкладки+клиентский JS). `scripts/report.ts` дополнительно globит `dist/*/*/meta.json`, валидирует новой `ArtifactMetaSchema` (в `result-schema` — единый источник схем) и передаёт `SizeData` в рендер. Production-бинарь и perf-данные не трогаются — Size читает только `dist`-мету.

**Tech Stack:** TypeScript (vitest, zod), статический HTML + inline CSS + минимальный vanilla-JS (вкладки, фильтры, пересчёт общей шкалы). Никаких новых runtime-зависимостей.

**Это Plan 2/3 фазы.** Plan 1 (движок атрибуции + schema + rust/cpp meta) — закрыт. Plan 3 = дифференциал headline-claims + guidelines + README + roadmap + bindgen/emscripten атрибуция. Outline — внизу.

## Global Constraints

- **TS-стиль:** 4-space indent, double quotes, semicolons, trailing comma (multiline), `curly: all`, `verbatimModuleSyntax` + strict. Импорты модулей с `.js`-расширением (ESM).
- **Схемы — только через `packages/result-schema`** (единый источник). Новая `ArtifactMetaSchema` живёт там.
- **Никаких новых зависимостей** (reporter зависит только от `@bench/result-schema`).
- **Весь интерполируемый в HTML текст — через `escape()`** (XSS-дисциплина существующего рендера).
- **Commits:** `--no-gpg-sign`. Push/PR — действие пользователя.
- **Sandbox:** `pnpm report` / любой `tsx` биндят pipe → `dangerouslyDisableSandbox: true` (CLAUDE.md § Tooling gotchas). Чистые `pnpm typecheck` / `test` / `lint:*` — в sandbox.

---

## Pre-flight notes (read once)

- **Reporter сейчас НЕ читает `dist`-мету.** `scripts/report.ts` грузит только `results/raw/<newest>/*.json` (BenchResult). Size-данные (`composition`) — в `dist/<id>/<lang>-<toolchain>-<profile>/meta.json` (`ArtifactMeta`). Plan добавляет загрузку `dist`.
- **Покрытие composition сейчас:** 16/73 meta имеют non-null `composition` (rust/raw × workloads × profiles). cpp/wasi-sdk (degraded heisenbug → Plan 3), rust/bindgen, cpp/emscripten, js → `composition: null`. Size-вид ОБЯЗАН деградировать чисто: null → один бар из production-тотала с пометкой.
- **JS-бинари:** `wasm: null`, `jsModule: {raw,gz,brotli}` (бандл), `composition: null`. Size-вид JS = один observed-бар из `jsModule`-байт, floor≈0, помечен отдельно (спека § JS).
- **`results/raw` присутствует** (newest `2026-06-13-size-perf-levers`, 297 JSON) → `pnpm report` запускается без нового bench-прогона.
- **Существующие reporter-тесты** (`render.test.ts`) ассертят size-колонки в perf-таблице (`<th>wasm raw (B)</th>` и т.д.) — они УЕДУТ в Size-вид; эти ассерты обновляются в Task 1.3.
- **Клиентский JS не покрыт vitest** (нет DOM). Чистая логика вью-модели тестируется юнит-тестами; интерактивность (вкладки/фильтры/шкала) верифицируется ручным открытием отчёта в браузере на break-point'ах W2/W3 (см. memory «Manual browser check»).

---

## File Structure

**`packages/result-schema/src/`:**
- Create `artifact-meta.ts` — `ArtifactStatSchema` + `ArtifactMetaSchema` (read-side валидация `meta.json`), `type ArtifactMeta`/`ArtifactStat`. Единый источник.
- Modify `index.ts` — re-export.

**`scripts/lib/`:**
- Modify `meta.ts` — `ArtifactStat`/`ArtifactMeta` теперь `z.infer` из result-schema (удаляем дублирующие интерфейсы).

**`packages/reporter/src/`:**
- Create `size-data.ts` — `parseArtifactMeta(json)`, `buildSizeData(metas)`, типы `SizeBinary`/`SizeData`.
- Create `size-view-model.ts` — `bandOf()`, `buildSizeViewModel(data)`, `buildCrossLangTables(vm, compression)`, типы.
- Create `render-perf.ts` — `renderPerfView(agg)` (перенос `renderBenchmark` + shape_dispatch 2×2 grid из `render.ts`, **минус** size-колонки).
- Create `render-size.ts` — `renderSizeView(vm, tables)` (бары + кросс-языковая таблица + контролы фильтров).
- Modify `render.ts` — `renderHtml(agg, sizeData)` становится оболочкой: head/CSS, tab-nav, обе вкладки, клиентский `<script>` (вкладки + фильтры + пересчёт шкалы).
- Modify `index.ts` — re-export новых модулей.
- Modify `tests/render.test.ts` — обновить под расщепление (perf без size-колонок + новая оболочка).
- Create `tests/size-data.test.ts`, `tests/size-view-model.test.ts`, `tests/render-size.test.ts`.

**`scripts/`:**
- Modify `report.ts` — глоб `dist/*/*/meta.json` → `buildSizeData` → `renderHtml(agg, sizeData)`; arg `--dist=`.

**`README.md`:** Modify § Отчёт (вкладки Size/Perf).

---

## Wave 1 — Shell + meta-loading + perf relocation

> Цель волны: отчёт открывается с двумя рабочими вкладками; Perf рендерит существующую таблицу/grid **без** size-колонок; Size-данные загружены из `dist` (плейсхолдер-вид). Independently shippable.

### Task 1.1: `ArtifactMetaSchema` в result-schema + унификация `meta.ts`

**Files:**
- Create: `packages/result-schema/src/artifact-meta.ts`
- Modify: `packages/result-schema/src/index.ts`
- Modify: `scripts/lib/meta.ts:7-22` (заменить интерфейсы на `z.infer`-импорты)
- Test: `packages/result-schema/tests/artifact-meta.test.ts`

**Interfaces:**
- Consumes: `LanguageSchema`, `ToolchainSchema`, `ProfileSchema` (из `./schema.js`), `SizeCompositionSchema` (из `./size-composition.js`).
- Produces: `ArtifactMetaSchema` (zod), `type ArtifactMeta`, `ArtifactStatSchema`, `type ArtifactStat`.

- [ ] **Step 1: Падающий тест**

`packages/result-schema/tests/artifact-meta.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { ArtifactMetaSchema } from "../src/index.js";

const base = {
    combination: { benchmarkId: "matmul", language: "rust", toolchain: "raw", profile: "size" },
    wasm: { rawBytes: 1639, gzipBytes: 1098, brotliBytes: 1003, hashSha256: "a".repeat(64) },
    jsGlue: null,
    jsModule: null,
    totalTransferGzipBytes: 1098,
    toolchainVersions: { rustc: "1.95.0", node: "v22" },
};

describe("ArtifactMetaSchema", () => {
    it("accepts meta with null composition", () => {
        expect(() => ArtifactMetaSchema.parse({ ...base, composition: null })).not.toThrow();
    });

    it("accepts meta with a valid composition", () => {
        const composition = {
            source: "pre-opt-twiggy",
            productionTotal: { rawBytes: 1639, gzipBytes: 1098, brotliBytes: 1003 },
            preOptTotalBytes: 1750,
            calibrationFactor: 0.936,
            unattributedShare: 0.02,
            facilities: [{ facility: "observed", scaling: "observed", share: 0.59, approxBytes: 964 }],
        };
        expect(() => ArtifactMetaSchema.parse({ ...base, composition })).not.toThrow();
    });

    it("rejects an unknown language enum", () => {
        expect(() => ArtifactMetaSchema.parse({ ...base, combination: { ...base.combination, language: "go" }, composition: null })).toThrow();
    });
});
```

- [ ] **Step 2: Run — fail.** `pnpm --filter @bench/result-schema test` → FAIL (`ArtifactMetaSchema` не экспортирован).

- [ ] **Step 3: Реализовать схему**

`packages/result-schema/src/artifact-meta.ts`:
```typescript
import { z } from "zod";
import { LanguageSchema, ToolchainSchema, ProfileSchema } from "./schema.js";
import { SizeCompositionSchema } from "./size-composition.js";

export const ArtifactStatSchema = z.object({
    rawBytes: z.number().int().nonnegative(),
    gzipBytes: z.number().int().nonnegative(),
    brotliBytes: z.number().int().nonnegative(),
    hashSha256: z.string(),
});

export const ArtifactMetaSchema = z.object({
    combination: z.object({
        benchmarkId: z.string(),
        language: LanguageSchema,
        toolchain: ToolchainSchema,
        profile: ProfileSchema,
    }),
    wasm: ArtifactStatSchema.nullable(),
    jsGlue: ArtifactStatSchema.nullable(),
    jsModule: ArtifactStatSchema.nullable(),
    totalTransferGzipBytes: z.number().int().nonnegative(),
    toolchainVersions: z.record(z.string(), z.string()),
    composition: SizeCompositionSchema.nullable(),
});

export type ArtifactStat = z.infer<typeof ArtifactStatSchema>;
export type ArtifactMeta = z.infer<typeof ArtifactMetaSchema>;
```

- [ ] **Step 4: Re-export.** В `packages/result-schema/src/index.ts` добавить: `export * from "./artifact-meta.js";`

- [ ] **Step 5: Run — pass.** `pnpm --filter @bench/result-schema test` → PASS.

- [ ] **Step 6: Унифицировать `scripts/lib/meta.ts`**

Заменить локальные интерфейсы `ArtifactStat` (строки 7-12) и `ArtifactMeta` (строки 14-22) на импорт. Итог верхней части файла:
```typescript
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { join } from "node:path";
import type { ArtifactMeta, ArtifactStat } from "@bench/result-schema";

export type { ArtifactMeta, ArtifactStat } from "@bench/result-schema";
```
(`statArtifact` и `writeMeta` ниже не меняются. Re-export сохраняет существующие импорты `ArtifactMeta`/`ArtifactStat` из `./meta.js` в build-скриптах.)

- [ ] **Step 7: Verify typecheck (риск ripple на build-скрипты)**

Run (sandbox ok): `pnpm typecheck`
Expected: PASS. build-rust.ts / build-cpp.ts присваивают `language: "rust"`/`"cpp"` литералами — совместимо с enum. Если падает на конкретном assignment — это реальное расхождение типов, починить точечно (НЕ ослаблять схему). Per-task break-check.

- [ ] **Step 8: Commit**

```bash
git add packages/result-schema/src/artifact-meta.ts packages/result-schema/src/index.ts packages/result-schema/tests/artifact-meta.test.ts scripts/lib/meta.ts
git commit --no-gpg-sign -m "feat(result-schema): ArtifactMetaSchema; unify scripts/lib/meta types (P2 W1)"
```

### Task 1.2: `size-data.ts` — загрузка + нормализация meta в `SizeData`

**Files:**
- Create: `packages/reporter/src/size-data.ts`
- Test: `packages/reporter/tests/size-data.test.ts`

**Interfaces:**
- Consumes: `ArtifactMetaSchema`, `type ArtifactMeta` (из `@bench/result-schema`).
- Produces: `parseArtifactMeta(json: string): ArtifactMeta`; `buildSizeData(metas: readonly ArtifactMeta[]): SizeData`; `interface SizeBinary { id; language; toolchain; profile; label; totals: {rawBytes; gzipBytes; brotliBytes}; composition: ArtifactMeta["composition"]; isJs: boolean }`; `interface SizeData { binaries: SizeBinary[] }`.

- [ ] **Step 1: Падающий тест**

`packages/reporter/tests/size-data.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { buildSizeData, parseArtifactMeta } from "../src/size-data.js";
import type { ArtifactMeta } from "@bench/result-schema";

function meta(over: Partial<ArtifactMeta> = {}): ArtifactMeta {
    return {
        combination: { benchmarkId: "matmul", language: "rust", toolchain: "raw", profile: "size" },
        wasm: { rawBytes: 1639, gzipBytes: 1098, brotliBytes: 1003, hashSha256: "a".repeat(64) },
        jsGlue: null,
        jsModule: null,
        totalTransferGzipBytes: 1098,
        toolchainVersions: {},
        composition: null,
        ...over,
    };
}

describe("parseArtifactMeta", () => {
    it("parses + validates a meta.json string", () => {
        const m = parseArtifactMeta(JSON.stringify(meta()));
        expect(m.combination.benchmarkId).toBe("matmul");
    });
});

describe("buildSizeData", () => {
    it("takes wasm totals for wasm binaries", () => {
        const d = buildSizeData([meta()]);
        expect(d.binaries).toHaveLength(1);
        expect(d.binaries[0]!.totals).toEqual({ rawBytes: 1639, gzipBytes: 1098, brotliBytes: 1003 });
        expect(d.binaries[0]!.label).toBe("rust/raw/size");
        expect(d.binaries[0]!.isJs).toBe(false);
    });

    it("takes jsModule totals for JS binaries", () => {
        const js = meta({
            combination: { benchmarkId: "matmul", language: "js", toolchain: "idiomatic", profile: "speed" },
            wasm: null,
            jsModule: { rawBytes: 969, gzipBytes: 485, brotliBytes: 416, hashSha256: "b".repeat(64) },
        });
        const d = buildSizeData([js]);
        expect(d.binaries[0]!.isJs).toBe(true);
        expect(d.binaries[0]!.totals).toEqual({ rawBytes: 969, gzipBytes: 485, brotliBytes: 416 });
    });

    it("sorts binaries deterministically by id then label", () => {
        const a = meta({ combination: { benchmarkId: "b", language: "rust", toolchain: "raw", profile: "size" } });
        const b = meta({ combination: { benchmarkId: "a", language: "rust", toolchain: "raw", profile: "speed" } });
        const d = buildSizeData([a, b]);
        expect(d.binaries.map((x) => `${x.id}|${x.label}`)).toEqual(["a|rust/raw/speed", "b|rust/raw/size"]);
    });

    it("skips binaries with neither wasm nor jsModule", () => {
        const d = buildSizeData([meta({ wasm: null, jsModule: null })]);
        expect(d.binaries).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run — fail.** `pnpm --filter @bench/reporter test` → FAIL.

- [ ] **Step 3: Реализовать**

`packages/reporter/src/size-data.ts`:
```typescript
import { ArtifactMetaSchema, type ArtifactMeta } from "@bench/result-schema";

export interface SizeBinary {
    id: string;
    language: string;
    toolchain: string;
    profile: string;
    label: string; // `${language}/${toolchain}/${profile}`
    totals: { rawBytes: number; gzipBytes: number; brotliBytes: number };
    composition: ArtifactMeta["composition"];
    isJs: boolean;
}

export interface SizeData {
    binaries: SizeBinary[];
}

export function parseArtifactMeta(json: string): ArtifactMeta {
    return ArtifactMetaSchema.parse(JSON.parse(json));
}

export function buildSizeData(metas: readonly ArtifactMeta[]): SizeData {
    const binaries: SizeBinary[] = [];
    for (const m of metas) {
        const stat = m.wasm ?? m.jsModule;
        if (!stat) {
            continue; // nothing shippable to size
        }
        const { benchmarkId, language, toolchain, profile } = m.combination;
        binaries.push({
            id: benchmarkId,
            language,
            toolchain,
            profile,
            label: `${language}/${toolchain}/${profile}`,
            totals: { rawBytes: stat.rawBytes, gzipBytes: stat.gzipBytes, brotliBytes: stat.brotliBytes },
            composition: m.composition,
            isJs: language === "js",
        });
    }
    binaries.sort((a, b) => a.id.localeCompare(b.id) || a.label.localeCompare(b.label));
    return { binaries };
}
```

- [ ] **Step 4: Run — pass.** `pnpm --filter @bench/reporter test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reporter/src/size-data.ts packages/reporter/tests/size-data.test.ts
git commit --no-gpg-sign -m "feat(reporter): size-data loader (meta.json -> SizeData) (P2 W1)"
```

### Task 1.3: `render-perf.ts` — перенос perf-таблицы минус size-колонки

**Files:**
- Create: `packages/reporter/src/render-perf.ts`
- Modify: `packages/reporter/src/render.ts` (вырезать перенесённое — временно, оболочка собирается в 1.4)
- Modify: `packages/reporter/tests/render.test.ts` (size-колонки убраны)

**Interfaces:**
- Consumes: `type Aggregated`, `type AggregatedBenchmark` (из `./aggregate.js`), `type BenchResult`.
- Produces: `renderPerfView(agg: Aggregated): string` (только секции, без `<html>`-обёртки); `escape(s: string): string` (экспортируется для переиспользования рендером).

- [ ] **Step 1: Реализовать `render-perf.ts`** (перенос `renderRow`/`renderBenchmark`/shape_dispatch из `render.ts`, **удалив** 3 size-колонки)

`packages/reporter/src/render-perf.ts`:
```typescript
import type { Aggregated, AggregatedBenchmark } from "./aggregate.js";
import type { BenchResult } from "@bench/result-schema";

const ESCAPES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

export function escape(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

function renderRow(r: BenchResult): string {
    const noisyClass = r.stats.noisy ? "noisy" : "";
    const failClass = r.quality.correctnessFailed ? "fail" : "";
    const cls = [noisyClass, failClass].filter(Boolean).join(" ");
    return `<tr class="${cls}">
    <td>${escape(r.env.name)}</td>
    <td>${escape(r.benchmark.language)}/${escape(r.benchmark.toolchain)}/${escape(r.benchmark.profile)}</td>
    <td>${escape(r.benchmark.inputSize)}</td>
    <td>${r.timingsMs.initTotal.toFixed(3)}</td>
    <td>${r.timingsMs.firstCall.toFixed(3)}</td>
    <td>${r.timingsMs.warmMedian.toFixed(3)}</td>
    <td>${r.timingsMs.warmP95.toFixed(3)}</td>
    <td>${r.stats.cv.toFixed(3)}</td>
    <td>${r.quality.validated ? "✓" : "✗"}</td>
  </tr>`;
}

function renderBenchmark(b: AggregatedBenchmark): string {
    const rows = b.cases.map((c) => renderRow(c.result)).join("\n");
    return `<section>
    <h2>${escape(b.id)}</h2>
    <table>
      <thead><tr>
        <th>env</th><th>impl</th><th>size</th>
        <th>init (ms)</th><th>first (ms)</th>
        <th>warm med (ms)</th><th>warm p95 (ms)</th><th>cv</th><th>ok</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

const SHAPE_DISPATCH_PINNED_KEY = "node|rust|raw|speed|L";
const SHAPE_DISPATCH_GRID: { layout: string; dispatch: string; id: string }[] = [
    { layout: "homo", dispatch: "static", id: "shape_dispatch_homo_static" },
    { layout: "homo", dispatch: "dynamic", id: "shape_dispatch_homo_dyn" },
    { layout: "mixed", dispatch: "static", id: "shape_dispatch_mixed_static" },
    { layout: "mixed", dispatch: "dynamic", id: "shape_dispatch_mixed_dyn" },
];
const SHAPE_DISPATCH_IDS = new Set(SHAPE_DISPATCH_GRID.map((g) => g.id));

function pinnedCell(agg: Aggregated, id: string): string {
    const b = agg.benchmarks[id];
    const hit = b?.cases.find((c) => c.key === SHAPE_DISPATCH_PINNED_KEY);
    return hit ? hit.result.timingsMs.warmMedian.toFixed(3) : "—";
}

function renderShapeDispatchSection(agg: Aggregated): string {
    const cell = (layout: string, dispatch: string): string => {
        const entry = SHAPE_DISPATCH_GRID.find((g) => g.layout === layout && g.dispatch === dispatch);
        return entry ? pinnedCell(agg, entry.id) : "—";
    };
    const grid = `<table class="grid">
      <thead><tr><th></th><th>static</th><th>dynamic</th></tr></thead>
      <tbody>
        <tr><th>homo</th><td>${cell("homo", "static")}</td><td>${cell("homo", "dynamic")}</td></tr>
        <tr><th>mixed</th><td>${cell("mixed", "static")}</td><td>${cell("mixed", "dynamic")}</td></tr>
      </tbody>
    </table>`;
    const details = SHAPE_DISPATCH_GRID
        .map((g) => agg.benchmarks[g.id])
        .filter((b): b is AggregatedBenchmark => Boolean(b))
        .map(renderBenchmark)
        .join("\n");
    return `<section class="shape-dispatch">
    <h2>shape_dispatch (2×2 factorial)</h2>
    <p class="grid-label">headline: rust/raw speed L node — warm-median (ms)</p>
    ${grid}
    ${details}
  </section>`;
}

export function renderPerfView(agg: Aggregated): string {
    const flat = Object.values(agg.benchmarks)
        .filter((b) => !SHAPE_DISPATCH_IDS.has(b.id))
        .map(renderBenchmark)
        .join("\n");
    const hasShapeDispatch = Object.values(agg.benchmarks).some((b) => SHAPE_DISPATCH_IDS.has(b.id));
    return hasShapeDispatch ? `${flat}\n${renderShapeDispatchSection(agg)}` : flat;
}
```

- [ ] **Step 2: Обновить `render.test.ts`** — secciones size-колонок убираем, проверяем perf-заголовки + отсутствие size-колонок

Заменить тест `"includes units in size and timing column headers"` на:
```typescript
    it("includes timing column headers and drops size columns (moved to Size view)", () => {
        const html = renderHtml(aggregate([fakeResult()]), { binaries: [] });
        expect(html).toContain("<th>init (ms)</th>");
        expect(html).toContain("<th>first (ms)</th>");
        expect(html).toContain("<th>warm med (ms)</th>");
        expect(html).toContain("<th>warm p95 (ms)</th>");
        expect(html).toContain("<th>cv</th>");
        expect(html).toContain("<th>ok</th>");
        expect(html).not.toContain("<th>wasm raw (B)</th>");
        expect(html).not.toContain("<th>total gz (B)</th>");
    });
```
В остальных тестах файла обновить вызовы `renderHtml(aggregate([...]))` → `renderHtml(aggregate([...]), { binaries: [] })` (новая сигнатура из 1.4). Убрать ассерт `expect(html).toContain("1234")` (это был `totalTransferGzipBytes` из perf-строки — колонка удалена).

- [ ] **Step 3: Временная заглушка `render.ts`** (полноценная оболочка — Task 1.4; здесь только чтобы пакет компилировался)

В `render.ts` заменить тело файла на тонкий re-use (будет переписан в 1.4):
```typescript
import type { Aggregated } from "./aggregate.js";
import type { SizeData } from "./size-data.js";
import { renderPerfView, escape } from "./render-perf.js";

export function renderHtml(agg: Aggregated, _sizeData: SizeData): string {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>bench results</title></head>
<body>
<h1>${escape("wasm-rust-cpp-js results")}</h1>
<p>Generated ${escape(agg.generatedAt)}.</p>
${renderPerfView(agg)}
</body></html>`;
}
```

- [ ] **Step 4: index.ts re-export**

`packages/reporter/src/index.ts`:
```typescript
export * from "./aggregate.js";
export * from "./render.js";
export * from "./render-perf.js";
export * from "./size-data.js";
```

- [ ] **Step 5: Run — pass.** `pnpm --filter @bench/reporter test && pnpm --filter @bench/reporter typecheck` → оба PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/reporter/src/render-perf.ts packages/reporter/src/render.ts packages/reporter/src/index.ts packages/reporter/tests/render.test.ts
git commit --no-gpg-sign -m "refactor(reporter): extract renderPerfView, drop size columns (P2 W1)"
```

### Task 1.4: Оболочка с вкладками + загрузка `dist`-меты в `report.ts`

**Files:**
- Modify: `packages/reporter/src/render.ts` (полная оболочка: head/CSS + tab-nav + обе вкладки + клиентский JS вкладок)
- Modify: `scripts/report.ts` (глоб `dist` → `buildSizeData` → `renderHtml(agg, sizeData)`)
- Modify: `packages/reporter/tests/render.test.ts` (ассерты вкладок)

**Interfaces:**
- Consumes: `renderPerfView`, `escape` (из `./render-perf.js`); `type SizeData`; `renderSizeView` ещё не существует — в 1.4 Size-вкладка = плейсхолдер, заменяется в Task 2.2.
- Produces: `renderHtml(agg: Aggregated, sizeData: SizeData): string` (полная страница с `<nav>` вкладками + `#tab-size`/`#tab-perf`).

- [ ] **Step 1: Полная оболочка `render.ts`**
```typescript
import type { Aggregated } from "./aggregate.js";
import type { SizeData } from "./size-data.js";
import { renderPerfView, escape } from "./render-perf.js";

const SHELL_CSS = `
  body { font-family: ui-monospace, monospace; max-width: 1400px; margin: 1em auto; padding: 0 1em; }
  nav.tabs { display: flex; gap: 0.5em; margin: 1em 0; border-bottom: 2px solid #ccc; }
  nav.tabs button { font: inherit; padding: 0.4em 1em; border: 1px solid #ccc; border-bottom: none;
    background: #f0f0f0; cursor: pointer; }
  nav.tabs button.active { background: #fff; font-weight: bold; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: right; }
  th { background: #f0f0f0; }
  tr.noisy { background: #fff8d0; }
  tr.fail  { background: #ffd0d0; }
  td:first-child, td:nth-child(2), td:nth-child(3) { text-align: left; }
  table.grid { width: auto; margin: 0.5em 0 1em; }
  table.grid th { text-align: left; }
  table.grid td { text-align: right; min-width: 6em; }
  p.grid-label { font-size: 12px; color: #555; margin: 0.25em 0; }
`;

const TABS_JS = `
  function showTab(name) {
    for (const p of document.querySelectorAll('.tab-panel')) {
      p.classList.toggle('active', p.id === 'tab-' + name);
    }
    for (const b of document.querySelectorAll('nav.tabs button')) {
      b.classList.toggle('active', b.dataset.tab === name);
    }
  }
  document.addEventListener('DOMContentLoaded', function () {
    for (const b of document.querySelectorAll('nav.tabs button')) {
      b.addEventListener('click', function () { showTab(b.dataset.tab); });
    }
    showTab('size');
  });
`;

export function renderHtml(agg: Aggregated, sizeData: SizeData): string {
    const sizePlaceholder = `<p>Size view: ${sizeData.binaries.length} binaries loaded.</p>`;
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>bench results</title>
<style>${SHELL_CSS}</style></head>
<body>
<h1>wasm-rust-cpp-js results</h1>
<p>Generated ${escape(agg.generatedAt)}.</p>
<nav class="tabs">
  <button data-tab="size">Size</button>
  <button data-tab="perf">Perf</button>
</nav>
<section id="tab-size" class="tab-panel">${sizePlaceholder}</section>
<section id="tab-perf" class="tab-panel">
${renderPerfView(agg)}
</section>
<script>${TABS_JS}</script>
</body></html>`;
}
```

- [ ] **Step 2: Ассерты вкладок в `render.test.ts`** (добавить)
```typescript
    it("renders a tabbed shell with Size and Perf panels", () => {
        const html = renderHtml(aggregate([fakeResult()]), { binaries: [] });
        expect(html).toContain('<nav class="tabs">');
        expect(html).toContain('data-tab="size"');
        expect(html).toContain('data-tab="perf"');
        expect(html).toContain('id="tab-size"');
        expect(html).toContain('id="tab-perf"');
    });
```

- [ ] **Step 3: Загрузка `dist`-меты в `report.ts`**

В `scripts/report.ts`: импорт `import { aggregate, renderHtml, buildSizeData, parseArtifactMeta } from "@bench/reporter";` и `import type { ArtifactMeta } from "@bench/result-schema";`. Добавить хелпер + вызов:
```typescript
async function loadDistMetas(distDir: string): Promise<ArtifactMeta[]> {
    const metas: ArtifactMeta[] = [];
    let workloads: string[];
    try {
        workloads = await readdir(distDir);
    } catch {
        return metas; // no dist yet
    }
    for (const w of workloads) {
        const wDir = join(distDir, w);
        if (!(await stat(wDir)).isDirectory()) {
            continue;
        }
        for (const combo of await readdir(wDir)) {
            const metaPath = join(wDir, combo, "meta.json");
            try {
                metas.push(parseArtifactMeta(await readFile(metaPath, "utf8")));
            } catch {
                // not a binary dir (e.g. fixtures) or no meta.json — skip
            }
        }
    }
    return metas;
}
```
В `main()`, после загрузки `results`, перед `renderHtml`:
```typescript
    const distDir = getArg("dist") ?? "dist";
    const sizeData = buildSizeData(await loadDistMetas(distDir));
    const html = renderHtml(aggregate(results), sizeData);
```
(удалить старую строку `const html = renderHtml(aggregate(results));`).

- [ ] **Step 4: Verify — отчёт собирается с вкладками**

`dangerouslyDisableSandbox: true`:
```bash
pnpm report 2>&1 | tail -3
out=$(ls -td results/summarized/*/ | head -1); echo "out=$out"
grep -c 'class="tabs"' "$out/index.html"
grep -o 'Size view: [0-9]* binaries loaded' "$out/index.html"
```
Expected: report пишет index.html; `class="tabs"` найден; «Size view: N binaries loaded» с N≈48 (wasm+js бинари с stat; cpp/rust/js, без чисто-null). Per-task break-check: если N=0 — глоб `dist` не сработал, проверить `loadDistMetas`.

- [ ] **Step 5: Run gates.** `pnpm --filter @bench/reporter test && pnpm typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/reporter/src/render.ts packages/reporter/tests/render.test.ts scripts/report.ts
git commit --no-gpg-sign -m "feat(reporter): tabbed shell (Size/Perf) + load dist meta into report (P2 W1)"
```

- [ ] **GATE (W1):** `pnpm report` пишет HTML с рабочими вкладками; Perf рендерит без size-колонок; Size-данные загружены (placeholder). Break-point — доложить.

---

## Wave 2 — Per-binary композиционные bars (ядро Size-вида)

> Цель волны: Size-вкладка рисует per-binary stacked-bars (floor-band + observed-band + unattributed) на общей байтовой шкале, с фильтрами (сжатие raw/gz/brotli, профиль, тулчейны, «только наблюдаемое»). Деградирует на null-composition.

### Task 2.1: `size-view-model.ts` — группировка band + сегменты

**Files:**
- Create: `packages/reporter/src/size-view-model.ts`
- Test: `packages/reporter/tests/size-view-model.test.ts`

**Interfaces:**
- Consumes: `type SizeData`, `type SizeBinary` (из `./size-data.js`).
- Produces:
  - `bandOf(scaling: string): Band` где `type Band = "floor" | "observed" | "unattributed"`.
  - `interface Segment { facility: string; scaling: string; band: Band; rawBytes: number; gzBytes: number; brotliBytes: number; share: number }`.
  - `interface BinaryViewModel { id; language; toolchain; profile; label; isJs: boolean; totals: {rawBytes; gzipBytes; brotliBytes}; hasComposition: boolean; note: string | null; segments: Segment[] }`.
  - `interface SizeViewModel { binaries: BinaryViewModel[] }`.
  - `buildSizeViewModel(data: SizeData): SizeViewModel`.

- [ ] **Step 1: Падающий тест**

`packages/reporter/tests/size-view-model.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { bandOf, buildSizeViewModel } from "../src/size-view-model.js";
import type { SizeBinary } from "../src/size-data.js";

function bin(over: Partial<SizeBinary> = {}): SizeBinary {
    return {
        id: "hashmap_int", language: "rust", toolchain: "raw", profile: "size",
        label: "rust/raw/size",
        totals: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 450 },
        composition: null, isJs: false,
        ...over,
    };
}

const composition = {
    source: "pre-opt-twiggy" as const,
    productionTotal: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 450 },
    preOptTotalBytes: 1100, calibrationFactor: 0.9, unattributedShare: 0.05,
    facilities: [
        { facility: "allocator", scaling: "paid-once" as const, share: 0.45, approxBytes: 450 },
        { facility: "observed", scaling: "observed" as const, share: 0.30, approxBytes: 300 },
        { facility: "monomorphized", scaling: "per-type" as const, share: 0.20, approxBytes: 200 },
    ],
};

describe("bandOf", () => {
    it("maps observed + per-type to observed band, else floor", () => {
        expect(bandOf("observed")).toBe("observed");
        expect(bandOf("per-type")).toBe("observed");
        expect(bandOf("paid-once")).toBe("floor");
    });
});

describe("buildSizeViewModel", () => {
    it("emits floor, observed, then unattributed segments summing to ~total", () => {
        const vm = buildSizeViewModel({ binaries: [bin({ composition })] });
        const b = vm.binaries[0]!;
        expect(b.hasComposition).toBe(true);
        expect(b.segments.map((s) => s.facility)).toEqual(["allocator", "observed", "monomorphized", "unattributed"]);
        expect(b.segments.map((s) => s.band)).toEqual(["floor", "observed", "observed", "unattributed"]);
        const sumRaw = b.segments.reduce((a, s) => a + s.rawBytes, 0);
        expect(sumRaw).toBe(1000); // 450+300+200 + unattr 50
        const sumShare = b.segments.reduce((a, s) => a + s.share, 0);
        expect(sumShare).toBeCloseTo(1, 6);
    });

    it("derives per-segment gz/brotli from share x production totals", () => {
        const vm = buildSizeViewModel({ binaries: [bin({ composition })] });
        const alloc = vm.binaries[0]!.segments.find((s) => s.facility === "allocator")!;
        expect(alloc.gzBytes).toBe(Math.round(0.45 * 500));
        expect(alloc.brotliBytes).toBe(Math.round(0.45 * 450));
    });

    it("degrades null composition to one observed bar with a note", () => {
        const vm = buildSizeViewModel({ binaries: [bin({ composition: null })] });
        const b = vm.binaries[0]!;
        expect(b.hasComposition).toBe(false);
        expect(b.segments).toHaveLength(1);
        expect(b.segments[0]!.rawBytes).toBe(1000);
        expect(b.note).toContain("unavailable");
    });

    it("marks JS as a single observed bar (floor 0)", () => {
        const js = bin({ language: "js", toolchain: "idiomatic", profile: "speed", label: "js/idiomatic/speed", isJs: true, composition: null });
        const vm = buildSizeViewModel({ binaries: [js] });
        const b = vm.binaries[0]!;
        expect(b.segments[0]!.band).toBe("observed");
        expect(b.note).toContain("JS");
    });
});
```

- [ ] **Step 2: Run — fail.** `pnpm --filter @bench/reporter test` → FAIL.

- [ ] **Step 3: Реализовать**

`packages/reporter/src/size-view-model.ts`:
```typescript
import type { SizeBinary, SizeData } from "./size-data.js";

export type Band = "floor" | "observed" | "unattributed";

export interface Segment {
    facility: string;
    scaling: string;
    band: Band;
    rawBytes: number;
    gzBytes: number;
    brotliBytes: number;
    share: number;
}

export interface BinaryViewModel {
    id: string;
    language: string;
    toolchain: string;
    profile: string;
    label: string;
    isJs: boolean;
    totals: { rawBytes: number; gzipBytes: number; brotliBytes: number };
    hasComposition: boolean;
    note: string | null;
    segments: Segment[];
}

export interface SizeViewModel {
    binaries: BinaryViewModel[];
}

export function bandOf(scaling: string): Band {
    return scaling === "observed" || scaling === "per-type" ? "observed" : "floor";
}

const BAND_ORDER: Record<Band, number> = { floor: 0, observed: 1, unattributed: 2 };

function modelFor(b: SizeBinary): BinaryViewModel {
    const base = {
        id: b.id, language: b.language, toolchain: b.toolchain, profile: b.profile,
        label: b.label, isJs: b.isJs, totals: b.totals,
    };
    if (!b.composition) {
        return {
            ...base,
            hasComposition: false,
            note: b.isJs ? "JS bundle — всё observed, floor≈0" : "composition unavailable (Plan 3)",
            segments: [{
                facility: b.isJs ? "js-bundle" : "(unattributed total)",
                scaling: "observed",
                band: "observed",
                rawBytes: b.totals.rawBytes,
                gzBytes: b.totals.gzipBytes,
                brotliBytes: b.totals.brotliBytes,
                share: 1,
            }],
        };
    }
    const c = b.composition;
    const segments: Segment[] = c.facilities.map((f) => ({
        facility: f.facility,
        scaling: f.scaling,
        band: bandOf(f.scaling),
        rawBytes: f.approxBytes,
        gzBytes: Math.round(f.share * b.totals.gzipBytes),
        brotliBytes: Math.round(f.share * b.totals.brotliBytes),
        share: f.share,
    }));
    if (c.unattributedShare > 0) {
        const attributedRaw = segments.reduce((a, s) => a + s.rawBytes, 0);
        segments.push({
            facility: "unattributed",
            scaling: "paid-once",
            band: "unattributed",
            rawBytes: Math.max(0, b.totals.rawBytes - attributedRaw),
            gzBytes: Math.round(c.unattributedShare * b.totals.gzipBytes),
            brotliBytes: Math.round(c.unattributedShare * b.totals.brotliBytes),
            share: c.unattributedShare,
        });
    }
    segments.sort((x, y) => BAND_ORDER[x.band] - BAND_ORDER[y.band] || y.rawBytes - x.rawBytes);
    return { ...base, hasComposition: true, note: null, segments };
}

export function buildSizeViewModel(data: SizeData): SizeViewModel {
    return { binaries: data.binaries.map(modelFor) };
}
```

- [ ] **Step 4: Run — pass.** `pnpm --filter @bench/reporter test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reporter/src/size-view-model.ts packages/reporter/tests/size-view-model.test.ts
git commit --no-gpg-sign -m "feat(reporter): size view-model (band grouping + segments) (P2 W2)"
```

### Task 2.2: `render-size.ts` — bars + контролы фильтров; клиентский JS

**Files:**
- Create: `packages/reporter/src/render-size.ts`
- Modify: `packages/reporter/src/render.ts` (заменить Size-placeholder + добавить SIZE_JS/SIZE_CSS)
- Modify: `packages/reporter/src/index.ts`
- Test: `packages/reporter/tests/render-size.test.ts`

**Interfaces:**
- Consumes: `type SizeViewModel`, `buildSizeViewModel` (из `./size-view-model.js`); `type SizeData`; `escape` (из `./render-perf.js`).
- Produces: `renderSizeView(data: SizeData): string` (контролы фильтров + per-workload группы баров). Клиентский JS (`SIZE_JS`) и CSS (`SIZE_CSS`) — экспортируемые строки для встраивания оболочкой.

- [ ] **Step 1: Падающий тест** (ассерты на markup + data-атрибуты)

`packages/reporter/tests/render-size.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { renderSizeView } from "../src/render-size.js";
import type { SizeData } from "../src/size-data.js";

const data: SizeData = {
    binaries: [
        {
            id: "hashmap_int", language: "rust", toolchain: "raw", profile: "size", label: "rust/raw/size",
            totals: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 450 }, isJs: false,
            composition: {
                source: "pre-opt-twiggy",
                productionTotal: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 450 },
                preOptTotalBytes: 1100, calibrationFactor: 0.9, unattributedShare: 0,
                facilities: [
                    { facility: "allocator", scaling: "paid-once", share: 0.6, approxBytes: 600 },
                    { facility: "observed", scaling: "observed", share: 0.4, approxBytes: 400 },
                ],
            },
        },
    ],
};

describe("renderSizeView", () => {
    it("renders a bar per binary with filter controls", () => {
        const html = renderSizeView(data);
        expect(html).toContain('class="size-controls"');
        expect(html).toContain('name="compression"');
        expect(html).toContain('name="observedOnly"');
        expect(html).toContain('class="size-bar"');
        expect(html).toContain('data-toolchain="raw"');
        expect(html).toContain('data-profile="size"');
    });

    it("emits floor and observed segments with byte data attributes", () => {
        const html = renderSizeView(data);
        expect(html).toContain('class="seg seg-floor"');
        expect(html).toContain('class="seg seg-observed"');
        expect(html).toContain('data-raw="600"');
        expect(html).toContain('data-raw="400"');
    });

    it("escapes the binary label", () => {
        const evil: SizeData = { binaries: [{ ...data.binaries[0]!, label: "<x>" }] };
        const html = renderSizeView(evil);
        expect(html).not.toContain("<x>");
        expect(html).toContain("&lt;x&gt;");
    });
});
```

- [ ] **Step 2: Run — fail.** `pnpm --filter @bench/reporter test` → FAIL.

- [ ] **Step 3: Реализовать `render-size.ts`**
```typescript
import type { SizeData } from "./size-data.js";
import { buildSizeViewModel, type BinaryViewModel, type Segment } from "./size-view-model.js";
import { escape } from "./render-perf.js";

export const SIZE_CSS = `
  .size-controls { display: flex; flex-wrap: wrap; gap: 1.2em; margin: 1em 0; font-size: 13px; align-items: center; }
  .size-controls fieldset { border: 1px solid #ccc; padding: 0.3em 0.6em; }
  .size-controls legend { font-size: 11px; color: #555; }
  .size-workload { margin: 1.2em 0; }
  .size-row { display: grid; grid-template-columns: 16em 1fr 8em; gap: 0.6em; align-items: center; margin: 0.3em 0; }
  .size-row .lbl { font-size: 12px; text-align: left; }
  .size-row .total { font-size: 12px; text-align: right; color: #333; }
  .size-bar { display: flex; height: 1.4em; background: #f6f6f6; border: 1px solid #ddd; overflow: hidden; }
  .seg { height: 100%; }
  .seg-floor { background: #b9c6d6; }
  .seg-observed { background: #2f6f4f; }
  .seg-unattributed { background: #e0a0a0; }
  .size-row.no-comp .size-bar { opacity: 0.6; }
  .size-note { font-size: 11px; color: #888; }
  .legend-band { display: inline-block; width: 0.9em; height: 0.9em; vertical-align: middle; margin-right: 0.3em; }
`;

export const SIZE_JS = `
  function fmtBytes(n) { return n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B'; }
  function segBytes(seg, comp) { return Number(seg.dataset[comp]); }
  function applySizeFilters() {
    var comp = document.querySelector('input[name="compression"]:checked').value;
    var profile = document.querySelector('input[name="sizeProfile"]:checked').value;
    var observedOnly = document.querySelector('input[name="observedOnly"]').checked;
    var checkedTc = Array.from(document.querySelectorAll('input[name="toolchain"]:checked')).map(function (c) { return c.value; });
    var key = comp === 'raw' ? 'raw' : (comp === 'gz' ? 'gz' : 'brotli');
    var rows = Array.from(document.querySelectorAll('.size-row'));
    var visible = [];
    rows.forEach(function (row) {
      var show = (profile === 'all' || row.dataset.profile === profile) && checkedTc.indexOf(row.dataset.toolchain) >= 0;
      row.style.display = show ? '' : 'none';
      if (show) { visible.push(row); }
    });
    var maxBar = 0;
    visible.forEach(function (row) {
      var segs = Array.from(row.querySelectorAll('.seg'));
      var sum = 0;
      segs.forEach(function (seg) {
        var hide = observedOnly && seg.dataset.band !== 'observed';
        sum += hide ? 0 : segBytes(seg, key);
      });
      if (sum > maxBar) { maxBar = sum; }
    });
    visible.forEach(function (row) {
      var segs = Array.from(row.querySelectorAll('.seg'));
      var sum = 0;
      segs.forEach(function (seg) {
        var hide = observedOnly && seg.dataset.band !== 'observed';
        seg.style.display = hide ? 'none' : '';
        if (!hide) { sum += segBytes(seg, key); }
      });
      var barPct = maxBar > 0 ? (sum / maxBar) * 100 : 0;
      row.querySelector('.size-bar').style.width = barPct.toFixed(3) + '%';
      segs.forEach(function (seg) {
        var b = segBytes(seg, key);
        seg.style.width = (sum > 0 && seg.style.display !== 'none') ? ((b / sum) * 100).toFixed(3) + '%' : '0';
      });
      row.querySelector('.total').textContent = fmtBytes(sum);
    });
  }
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.size-controls input').forEach(function (el) {
      el.addEventListener('change', applySizeFilters);
    });
    applySizeFilters();
  });
`;

function renderSegment(s: Segment): string {
    const title = `${s.facility} ≈${s.rawBytes} B (${(s.share * 100).toFixed(1)}%)`;
    return `<span class="seg seg-${s.band}" data-band="${s.band}" data-raw="${s.rawBytes}" data-gz="${s.gzBytes}" data-brotli="${s.brotliBytes}" title="${escape(title)}"></span>`;
}

function renderRow(b: BinaryViewModel): string {
    const noComp = b.hasComposition ? "" : " no-comp";
    const note = b.note ? ` <span class="size-note">${escape(b.note)}</span>` : "";
    return `<div class="size-row${noComp}" data-toolchain="${escape(b.toolchain)}" data-profile="${escape(b.profile)}" data-lang="${escape(b.language)}">
      <div class="lbl">${escape(b.label)}${note}</div>
      <div class="size-bar">${b.segments.map(renderSegment).join("")}</div>
      <div class="total"></div>
    </div>`;
}

function controls(toolchains: string[]): string {
    const tcBoxes = toolchains
        .map((t) => `<label><input type="checkbox" name="toolchain" value="${escape(t)}" checked> ${escape(t)}</label>`)
        .join(" ");
    return `<div class="size-controls">
    <fieldset><legend>compression</legend>
      <label><input type="radio" name="compression" value="raw" checked> raw</label>
      <label><input type="radio" name="compression" value="gz"> gzip</label>
      <label><input type="radio" name="compression" value="brotli"> brotli</label>
    </fieldset>
    <fieldset><legend>profile</legend>
      <label><input type="radio" name="sizeProfile" value="all" checked> all</label>
      <label><input type="radio" name="sizeProfile" value="size"> size</label>
      <label><input type="radio" name="sizeProfile" value="speed"> speed</label>
    </fieldset>
    <fieldset><legend>toolchains</legend>${tcBoxes}</fieldset>
    <label><input type="checkbox" name="observedOnly"> только наблюдаемое</label>
    <span class="size-note"><span class="legend-band" style="background:#b9c6d6"></span>floor (paid-once) <span class="legend-band" style="background:#2f6f4f"></span>observed/marginal — доли по raw, абсолют ≈</span>
  </div>`;
}

export function renderSizeView(data: SizeData): string {
    const vm = buildSizeViewModel(data);
    const toolchains = [...new Set(vm.binaries.map((b) => b.toolchain))].sort();
    const byWorkload = new Map<string, BinaryViewModel[]>();
    for (const b of vm.binaries) {
        const arr = byWorkload.get(b.id) ?? [];
        arr.push(b);
        byWorkload.set(b.id, arr);
    }
    const groups = [...byWorkload.entries()]
        .map(([id, bins]) => `<div class="size-workload"><h2>${escape(id)}</h2>${bins.map(renderRow).join("\n")}</div>`)
        .join("\n");
    return `${controls(toolchains)}\n${groups}`;
}
```

- [ ] **Step 4: Встроить в оболочку `render.ts`**

В `render.ts`: импорт `import { renderSizeView, SIZE_CSS, SIZE_JS } from "./render-size.js";`. В `SHELL_CSS` дописать `${SIZE_CSS}` (конкатенацией в шаблоне `<style>`). Заменить `sizePlaceholder` на `renderSizeView(sizeData)`. После `<script>${TABS_JS}</script>` добавить `<script>${SIZE_JS}</script>`. Конкретно:
```typescript
<style>${SHELL_CSS}${SIZE_CSS}</style>
...
<section id="tab-size" class="tab-panel">${renderSizeView(sizeData)}</section>
...
<script>${TABS_JS}</script>
<script>${SIZE_JS}</script>
```

- [ ] **Step 5: index.ts re-export.** Добавить `export * from "./render-size.js";` и `export * from "./size-view-model.js";`.

- [ ] **Step 6: Run — pass.** `pnpm --filter @bench/reporter test && pnpm --filter @bench/reporter typecheck` → PASS.

- [ ] **Step 7: Verify + РУЧНОЙ браузерный чек**

`dangerouslyDisableSandbox: true`:
```bash
pnpm report 2>&1 | tail -2
out=$(ls -td results/summarized/*/ | head -1); echo "open $out/index.html"
grep -c 'class="size-bar"' "$out/index.html"
```
Затем **открыть `$out/index.html` в браузере** и проверить (memory «Manual browser check»):
- вкладка Size активна по умолчанию, переключение Size↔Perf работает;
- бары рисуются, floor (серо-синий) + observed (зелёный) сегменты видны; rust/raw-бинари — многосегментные, cpp/bindgen/js — один сегмент с note;
- переключение raw→gz→brotli меняет длины баров и числа total;
- чекбоксы тулчейнов и radio профиля фильтруют строки;
- «только наблюдаемое» прячет floor и пере-масштабирует.

Per-task break-check: если шкала/фильтры не работают — смотреть консоль браузера; ≤2 итерации правки `SIZE_JS`, иначе STOP + доложить.

- [ ] **Step 8: Commit**

```bash
git add packages/reporter/src/render-size.ts packages/reporter/src/render.ts packages/reporter/src/index.ts packages/reporter/tests/render-size.test.ts
git commit --no-gpg-sign -m "feat(reporter): size composition bars + filters (P2 W2)"
```

- [ ] **GATE (W2):** Size-вкладка рисует композиционные bars с рабочими фильтрами; деградирует на null-composition; ручной браузерный чек пройден. Break-point — доложить.

---

## Wave 3 — Кросс-языковая таблица + финальные гейты

> Цель волны: добавить кросс-языковую таблицу по категориям (выравнивание facility по столбцам), прогнать все гейты, финальный ручной чек. Independently shippable.

### Task 3.1: Кросс-языковая таблица по категориям

**Files:**
- Modify: `packages/reporter/src/size-view-model.ts` (+ `buildCrossLangTables`)
- Modify: `packages/reporter/src/render-size.ts` (рендер таблиц под барами каждого workload)
- Modify: `packages/reporter/tests/size-view-model.test.ts` (тест builder'а)
- Modify: `packages/reporter/tests/render-size.test.ts` (ассерт таблицы)

**Interfaces:**
- Produces:
  - `interface CrossLangRow { id: string; label: string; byFacility: Record<string, number>; total: number }`.
  - `interface WorkloadTable { id: string; facilities: string[]; rows: CrossLangRow[] }`.
  - `buildCrossLangTables(vm: SizeViewModel, compression: "rawBytes" | "gzBytes" | "brotliBytes"): WorkloadTable[]`.

- [ ] **Step 1: Падающий тест builder'а** (в `size-view-model.test.ts`)
```typescript
import { buildCrossLangTables } from "../src/size-view-model.js";

describe("buildCrossLangTables", () => {
    it("aligns facilities into shared columns per workload", () => {
        const vm = buildSizeViewModel({ binaries: [
            bin({ composition }),
            bin({ language: "cpp", toolchain: "wasi-sdk", label: "cpp/wasi-sdk/size", composition: {
                source: "pre-opt-twiggy",
                productionTotal: { rawBytes: 800, gzipBytes: 400, brotliBytes: 360 },
                preOptTotalBytes: 850, calibrationFactor: 0.94, unattributedShare: 0,
                facilities: [{ facility: "allocator", scaling: "paid-once", share: 1, approxBytes: 800 }],
            } }),
        ] });
        const tables = buildCrossLangTables(vm, "rawBytes");
        expect(tables).toHaveLength(1);
        const t = tables[0]!;
        expect(t.id).toBe("hashmap_int");
        expect(t.facilities).toContain("allocator");
        expect(t.facilities).toContain("observed");
        expect(t.rows).toHaveLength(2);
        const cpp = t.rows.find((r) => r.label === "cpp/wasi-sdk/size")!;
        expect(cpp.byFacility["allocator"]).toBe(800);
        expect(cpp.byFacility["observed"] ?? 0).toBe(0);
    });
});
```

- [ ] **Step 2: Run — fail.** `pnpm --filter @bench/reporter test` → FAIL.

- [ ] **Step 3: Реализовать `buildCrossLangTables`** (добавить в `size-view-model.ts`)
```typescript
export interface CrossLangRow {
    id: string;
    label: string;
    byFacility: Record<string, number>;
    total: number;
}

export interface WorkloadTable {
    id: string;
    facilities: string[];
    rows: CrossLangRow[];
}

type CompKey = "rawBytes" | "gzBytes" | "brotliBytes";

export function buildCrossLangTables(vm: SizeViewModel, compression: CompKey): WorkloadTable[] {
    const byWorkload = new Map<string, BinaryViewModel[]>();
    for (const b of vm.binaries) {
        const arr = byWorkload.get(b.id) ?? [];
        arr.push(b);
        byWorkload.set(b.id, arr);
    }
    const tables: WorkloadTable[] = [];
    for (const [id, bins] of byWorkload) {
        const facilitySet = new Set<string>();
        const rows: CrossLangRow[] = bins.map((b) => {
            const byFacility: Record<string, number> = {};
            let total = 0;
            for (const s of b.segments) {
                const bytes = s[compression];
                byFacility[s.facility] = (byFacility[s.facility] ?? 0) + bytes;
                total += bytes;
                facilitySet.add(s.facility);
            }
            return { id, label: b.label, byFacility, total };
        });
        tables.push({ id, facilities: [...facilitySet].sort(), rows });
    }
    return tables;
}
```

- [ ] **Step 4: Run — pass.** `pnpm --filter @bench/reporter test` → PASS.

- [ ] **Step 5: Рендер таблицы под барами** (в `render-size.ts`)

Импорт `buildCrossLangTables`, `type WorkloadTable`. Добавить:
```typescript
function renderTable(t: WorkloadTable): string {
    const head = t.facilities.map((f) => `<th>${escape(f)}</th>`).join("");
    const rows = t.rows
        .map((r) => {
            const cells = t.facilities
                .map((f) => `<td>${r.byFacility[f] ?? 0}</td>`)
                .join("");
            return `<tr><td>${escape(r.label)}</td>${cells}<td>${r.total}</td></tr>`;
        })
        .join("\n");
    return `<table class="xlang"><thead><tr><th>impl</th>${head}<th>total</th></tr></thead><tbody>${rows}</tbody></table>`;
}
```
В `renderSizeView`: построить `const tables = buildCrossLangTables(vm, "rawBytes");` и в каждой workload-группе после баров добавить соответствующую таблицу (`tables.find((t) => t.id === id)`). Таблица помечена «байты по raw» через `<p class="size-note">кросс-языковая таблица — байты по raw</p>`.

- [ ] **Step 6: Ассерт таблицы** (в `render-size.test.ts`)
```typescript
    it("renders a cross-language facility table", () => {
        const html = renderSizeView(data);
        expect(html).toContain('class="xlang"');
        expect(html).toContain("<th>allocator</th>");
    });
```

- [ ] **Step 7: Run — pass + typecheck.** `pnpm --filter @bench/reporter test && pnpm --filter @bench/reporter typecheck` → PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/reporter/src/size-view-model.ts packages/reporter/src/render-size.ts packages/reporter/tests/size-view-model.test.ts packages/reporter/tests/render-size.test.ts
git commit --no-gpg-sign -m "feat(reporter): cross-language facility table (P2 W3)"
```

### Task 3.2: README + полные гейты + финальный ручной чек

**Files:**
- Modify: `README.md` (§ Отчёт)

- [ ] **Step 1: Обновить README § Отчёт**

Заменить абзац про «статичный HTML с таблицей по каждому benchmark'у» на описание вкладок. Вставить (после команды `pnpm report`):
```markdown
Создаёт `results/summarized/<ISO timestamp>/index.html` — одну статическую страницу с двумя вкладками:

- **Size** — композиция артефакта по facility-категориям (allocator / hash-map / string / panic-fmt / observed / …) композиционными bars на общей байтовой шкале: floor-band (paid-once, приглушённый) + observed-band (изучаемый код, акцент). Фильтры: сжатие raw/gzip/brotli, профиль, тулчейны, тумблер «только наблюдаемое». Под барами — кросс-языковая таблица по категориям. Доли считаются по raw, абсолют помечен ≈ (pre-opt композиция × калибровка к точному production-тоталу — байт-точная символьная атрибуция post-opt невозможна; подробнее — Plan 3/README).
- **Perf** — таблица таймингов по каждому benchmark'у + 2×2 grid для shape_dispatch. Строки шумных кейсов подсвечены жёлтым, упавшие correctness — красным.

Size читает `composition` из `dist/*/meta.json` (rust/raw покрыты; cpp/wasi-sdk, bindgen, emscripten, js деградируют до одного бара с пометкой — атрибуция расширяется в Plan 3).
```

- [ ] **Step 2: Полные гейты**

Чистые — sandbox; `pnpm report` — `dangerouslyDisableSandbox: true`:
```bash
pnpm typecheck && pnpm lint:all && pnpm test
```
Expected: всё зелёное (reporter-тесты: size-data, size-view-model, render-size, render, aggregate).

- [ ] **Step 3: Финальный отчёт + ручной браузерный чек**

`dangerouslyDisableSandbox: true`:
```bash
pnpm report 2>&1 | tail -2
out=$(ls -td results/summarized/*/ | head -1); echo "open $out/index.html"
```
Открыть в браузере: Size-вкладка с барами + кросс-языковой таблицей; все фильтры работают; Perf-вкладка корректна без size-колонок. (`pnpm smoke`/`build:all` НЕ требуются — Plan 2 не трогает production-сборку; reporter покрыт `pnpm test`.)

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit --no-gpg-sign -m "docs(report): document Size/Perf tabs (P2 W3)"
```

- [ ] **Break-point (конец W3 = конец Plan 2):** одна страница, вкладки Size/Perf, композиционные bars + фильтры + кросс-языковая таблица; гейты `typecheck`/`lint`/`test` зелёные; ручной браузерный чек пройден. Доложить сводку. Рекомендовать `/finish-session` ИЛИ перейти к Plan 3.

---

## Execution Protocol

**Routing (hybrid inline/subagent):**
- **W1 Task 1.1** (схема + унификация meta.ts) — `[I]` inline: кросс-пакетная, риск ripple на build-скрипты, нужен общий `pnpm typecheck`.
- **W1 Task 1.2** (`size-data`, чистая логика) — `[S]` subagent: self-contained TDD-юнит, полный код+тест, чистый `pnpm test` (sandbox).
- **W1 Tasks 1.3–1.4** (перенос perf + оболочка + `report.ts` глоб) — `[I]` inline: трогают существующие тесты, кросс-файловые, `report.ts` требует `dangerouslyDisableSandbox`.
- **W2 Task 2.1** (`size-view-model`, чистая логика) — `[S]` subagent: TDD-юнит, sandbox-ок.
- **W2 Task 2.2** (`render-size` + клиентский JS) — `[I]` inline: рендер + ручной браузерный чек интерактивности.
- **W3 Task 3.1** (кросс-языковая таблица) — `[S]`-friendly для builder'а (TDD), но рендер кросс-файловый → вести `[I]` целиком (один связный коммит).
- **W3 Task 3.2** (README + гейты + ручной чек) — `[I]` inline.

**Static break-points (3):**
1. **Конец W1** — `pnpm report` пишет HTML с рабочими вкладками, Perf без size-колонок, Size-данные загружены. Доложить.
2. **Конец W2** — композиционные bars + фильтры; ручной браузерный чек. Доложить.
3. **Конец W3** — кросс-языковая таблица + гейты зелёные + финальный ручной чек. Доложить; решить Plan 3 vs `/finish-session`.

**Per-task break-check:** после каждой задачи — результат соответствует ожиданию шага? Surface planned risks (НЕ обходить молча): (а) если унификация `meta.ts` (1.1) ломает типы build-скриптов — это реальное расхождение, чинить точечно/эскалировать, не ослаблять схему; (б) если глоб `dist` (1.4) даёт 0 бинарей — проверить `loadDistMetas`, не хардкодить; (в) если клиентский JS не работает в браузере (2.2/3.2) — консоль браузера, ≤2 итерации, иначе STOP.

**Retry budget:** ≤2 попытки на подход; затем STOP + rethink.

---

## Follow-on plan (фаза 1.3, Plan 3/3 — outline, расширяется в свой док перед исполнением)

- **Plan 3/3 — Дифференциал + guidelines + README + roadmap + расширение атрибуции.** Дифференциальные minimal-сборки на `-Oz` для headline-фактов (реальная цена allocator; «map<int,int> paid-once» 1-vs-N use-site; премия мономорфизации shape_dispatch static vs dyn). ID math-таблиц (`wasm-tools print` → `math-table:isqrt`/`:log`). bindgen/emscripten атрибуция + cpp/wasi-sdk name-section heisenbug (bug-report `2026-06-21-cpp-wasi-sdk-name-section-heisenbug.md`). Донастройка правил для interop_calls / shape_dispatch_*_dyn высокого unattr (tech-debt `size-attr-nonexemplar-unattr`). Обновить `docs/guidelines.md` (grounded floor-vs-marginal claims, заменяя handwave); `README.md` раздел «почему размеры приближённые и почему это ок»; `docs/roadmap.md` removal `wasm-size-floor-vs-marginal` + добавить `perf-view-redesign`.

---

## Self-review notes

- **Spec coverage (Plan 2 scope):** § Reporter-shell (вкладки Size/Perf + клиентские фильтры) = Tasks 1.4, 2.2; § Reporter-визуализация (композиционные bars, floor/observed-band, общая байтовая шкала) = Tasks 2.1–2.2; «вычесть floor»/«только наблюдаемое» = тумблер observedOnly (Task 2.2 — обе рамки, within-toolchain marginal и cross-lang observed-абсолюты, схлопываются в один механизм); кросс-языковой вид (выравнивание категорий + таблица) = Task 3.1; фильтры (raw/gz/brotli, профиль, тулчейны, observed-only) = Task 2.2; релокация perf минус size-колонки = Task 1.3; JS особый случай (один observed-бар) = Task 2.1; reporter читает composition из dist meta = Tasks 1.1–1.2, 1.4; README = Task 3.2. Дифференциал/guidelines/bindgen/emscripten/roadmap = Plan 3 (outlined). ✓
- **Out-of-scope соблюдён:** production-бинарь/perf-данные не трогаются (Size читает только dist-мету); богатый perf-редизайн не делается (только релокация минус size-колонки); S/M/L в Size отсутствует (size env/size-инвариантен — бары per binary×profile). ✓
- **Placeholder-scan:** все code-шаги несут полный код; «прочитать существующий блок X и добавить аналог» отсутствует (даже встраивание в оболочку 2.2-Step-4 дано конкретными строками). ✓
- **Type consistency:** `ArtifactMeta`/`ArtifactStat` (1.1) → `size-data` (1.2) → `SizeBinary`/`SizeData` → `size-view-model` `BinaryViewModel`/`Segment`/`SizeViewModel` (2.1) → `render-size` (2.2) → `WorkloadTable`/`CrossLangRow` (3.1). `renderHtml(agg, sizeData)` сигнатура единообразна (1.3 заглушка → 1.4 полная → 2.2 встраивает renderSizeView). `escape` экспортируется из `render-perf` и переиспользуется `render-size`/`render`. Компресс-ключи: data-атрибуты `data-raw/gz/brotli` ↔ `SIZE_JS` `key ∈ {raw,gz,brotli}` ↔ `Segment.{rawBytes,gzBytes,brotliBytes}`. band-классы `seg-floor/observed/unattributed` ↔ `Band`. ✓
