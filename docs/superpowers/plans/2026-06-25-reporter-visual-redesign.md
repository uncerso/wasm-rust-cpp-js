# Reporter Visual Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the static HTML report (Size + Perf tabs) to the approved "measurement-instrument" design — facility-colored size bars, env small-multiples + data-bar perf table, shape_dispatch heatmap — without changing any measured data.

**Architecture:** Presentation-only rewrite inside `packages/reporter/src`. Pure view-models (`size-view-model.ts` exists; add `perf-view-model.ts`) transform the already-aggregated data into render-ready structures; `render-*.ts` build HTML+CSS strings; a new `theme.ts` centralizes tokens and the segment/band/facility → color maps. Runtime filtering stays client-side via embedded JS (show/hide on `data-*` attributes), as today.

**Tech Stack:** TypeScript (ESM, strict, `verbatimModuleSyntax`), zod (`@bench/result-schema`), vitest. No web fonts, no runtime deps added. HTML is generated as template strings; styling is inline `<style>`.

## Global Constraints

- TS: 4-space indent, double quotes, semicolons, trailing comma (multiline), `curly: all`, strict + `verbatimModuleSyntax`. Enforced by ESLint flat config.
- No `BenchResult` schema change; do **not** touch `packages/result-schema`, `harness`, `loaders`, `size-attr`, `scripts`, build pipeline.
- Zero web-font dependency — system stacks only (`ui-sans-serif, system-ui` / `ui-monospace`).
- All exact color hexes, geometry, and identity rules come **verbatim from the spec §2** (`docs/superpowers/specs/2026-06-25-reporter-redesign-design.md`). Mockups with the exact CSS live at `.superpowers/brainstorm/*/content/` (final: size `s9-assembled.html`; perf `p5-perf-assembled.html` + `f-fail-hatch.html` + `p4b-multiples.html`).
- Reuse existing quality flags: `result.stats.noisy`, `result.quality.correctnessFailed`, `result.quality.validated`. Do NOT invent a CV threshold.
- Reporter tests are string-contains on rendered HTML (vitest). `pnpm test` / `typecheck` / `lint:all` run in the sandbox; `pnpm build:all` / `report` / `smoke` need `dangerouslyDisableSandbox: true` (tsx pipe bind).
- CSS gotchas (verified in this session's mockups): (a) the companion frame is irrelevant in production, but inline-`<span>` fills need `display:block` for `width/height`; (b) `:nth-child` zebra must be declared **before** `.noisy`/`.fail` row rules (equal specificity → source order wins); (c) cell-state color/bg must out-specify the base `td` rule (e.g. `.t td.bad`, not `.bad`).

---

## File Structure

- Create `packages/reporter/src/theme.ts` — tokens (`SHELL_CSS` shared chrome), `segmentColor(segment)` (floor facility → slate shade ramp; glue/observed/unattr → accent), and named hex constants. One responsibility: the design system in code.
- Create `packages/reporter/src/perf-view-model.ts` — pure `Aggregated → PerfModel` transform (env small-multiples rows, node detail rows, shape_dispatch grid, available size/profile slices). Mirrors `size-view-model.ts`.
- Modify `packages/reporter/src/render.ts` — shell: header (title left, tabs right), sticky filter-tray scaffolding, include `SHELL_CSS`.
- Modify `packages/reporter/src/render-size.ts` — facility-colored bars + inline labels; cross-lang table → collapsible `<details>` + zebra + muted zeros + heatmap cell tint.
- Modify `packages/reporter/src/render-perf.ts` — consume `perf-view-model`: size/profile segmented controls, per-workload env small-multiples + node detail table (data bars + quality states), shape_dispatch heatmap; `PERF_JS` slice toggling.
- Modify `packages/reporter/src/index.ts` — export `theme`, `perf-view-model`.
- Modify tests: `tests/render.test.ts`, `tests/render-size.test.ts`, add `tests/theme.test.ts`, `tests/perf-view-model.test.ts`.

---

## Wave 0 — baseline gate (do first, no commit)

- [ ] Confirm a clean green baseline on the branch before any change.

Run (sandbox): `pnpm typecheck && pnpm lint:all && pnpm test`
Expected: all pass. If red, STOP and fix the baseline before starting.

---

### Task 1: Theme module — tokens + segment color map  `[S]`

**Files:**
- Create: `packages/reporter/src/theme.ts`
- Test: `packages/reporter/tests/theme.test.ts`
- Modify: `packages/reporter/src/index.ts` (add `export * from "./theme.js";`)

**Interfaces:**
- Consumes: `Segment`, `Band` from `./size-view-model.js`.
- Produces:
  - `export function segmentColor(seg: { band: Band; facility: string }): string` — returns a CSS hex.
  - `export const FLOOR_FACILITY_ORDER: string[]` — ordered floor facilities (darkest→lightest).
  - `export const SHELL_CSS: string` — shared chrome CSS (header, tabs, sticky tray, app container).

- [ ] **Step 1: Write the failing test**

```ts
// packages/reporter/tests/theme.test.ts
import { describe, expect, it } from "vitest";
import { segmentColor } from "../src/theme.js";

describe("segmentColor", () => {
    it("maps accent bands to fixed accents", () => {
        expect(segmentColor({ band: "glue", facility: "glue (JS)" })).toBe("#d8be73");
        expect(segmentColor({ band: "observed", facility: "observed" })).toBe("#34b88a");
        expect(segmentColor({ band: "unattributed", facility: "unattributed" })).toBe("#e0a8a8");
    });
    it("maps floor facilities to distinct slate shades", () => {
        const alloc = segmentColor({ band: "floor", facility: "allocator" });
        const struct = segmentColor({ band: "floor", facility: "structural" });
        expect(alloc).toBe("#6e7b8c");
        expect(struct).not.toBe(alloc);
    });
    it("falls back to a mid slate for unknown floor facilities", () => {
        expect(segmentColor({ band: "floor", facility: "mystery" })).toBe("#a8b2bf");
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @bench/reporter test theme` (or `pnpm test`)
Expected: FAIL — cannot find `../src/theme.js`.

- [ ] **Step 3: Implement `theme.ts`**

Build `segmentColor`: for `band !== "floor"` return the band accent (`glue #d8be73`, `observed #34b88a`, `unattributed #e0a8a8`, `unknown #cfcfcf`); for `band === "floor"` look the facility up in an ordered slate ramp and return its shade, falling back to `#a8b2bf`. Ramp (verbatim spec §2): `allocator #6e7b8c`, `toolchain-runtime`/`emscripten-runtime` #828f9f, `hash-map #96a1af`, `panic-fmt #a8b2bf`, `compiler-rt` #bac2cd, `data #bac2cd`, `dynamic-array #c8cfd7`, `structural #c8cfd7`. Export `SHELL_CSS` with the chrome from spec §3 (copy exact values from mockup `s9-assembled.html` `.fin-*` / `p5-perf-assembled.html` `.pf-*`: app container white + 1px rule + radius 9; header flex with title-left/tabs-right; `.tab.on` underline `#36506e`; sticky tray `#f6f8fb` bordered).

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm test theme`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reporter/src/theme.ts packages/reporter/tests/theme.test.ts packages/reporter/src/index.ts
git commit --no-gpg-sign -m "feat(reporter): theme tokens + facility/band color map"
```

---

### Task 2: Shell — header, tabs-right, sticky tray  `[I]`

**Files:**
- Modify: `packages/reporter/src/render.ts`
- Test: `packages/reporter/tests/render.test.ts`

**Interfaces:**
- Consumes: `SHELL_CSS` from `./theme.js`; existing `renderSizeView`, `renderPerfView`.
- Produces: unchanged signature `renderHtml(agg, sizeData): string`.

- [ ] **Step 1: Add failing assertions** to `render.test.ts` existing `renderHtml` test:

```ts
expect(html).toContain('class="app"');           // new container
expect(html).toContain('class="tabbar"');         // tabs live top-right in header
expect(html).toContain('data-tab="size"');
expect(html).toContain('data-tab="perf"');
expect(html).not.toContain("font-family: ui-monospace, monospace; max-width"); // old body style gone
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test render.test`
Expected: FAIL on the new `class="app"` assertion.

- [ ] **Step 3: Rewrite the shell** in `render.ts`: replace `SHELL_CSS` body styles with the spec §3 chrome (import `SHELL_CSS` from theme; keep a thin local `body` reset). Markup: `<div class="app"><header>… title left … <nav class="tabbar"> Size / Perf </nav></header> <section id="tab-size" class="tab-panel">…size…</section> <section id="tab-perf" class="tab-panel">…perf…</section></div>`. Keep `TABS_JS` but update selectors to `.tabbar button`. Default-show `size`.

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test render.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reporter/src/render.ts packages/reporter/tests/render.test.ts
git commit --no-gpg-sign -m "feat(reporter): redesigned shell — header + tabs-right + sticky tray"
```

---

### Task 3: Size bars — facility colors + inline labels + form  `[S]`

**Files:**
- Modify: `packages/reporter/src/render-size.ts` (`renderSegment`, `renderRow`, `SIZE_CSS`)
- Test: `packages/reporter/tests/render-size.test.ts`

**Interfaces:**
- Consumes: `segmentColor` from `./theme.js`; `Segment`/`BinaryViewModel` from `./size-view-model.js`.

Notes: `size-view-model.ts` already emits one `Segment` per facility (floor facilities are separate segments). So per-facility color = map each segment through `segmentColor`. Inline label = raw-bytes-based, static (composition is raw-based; the "доли по raw" note already exists). `overflow:hidden` clips labels on narrow segments (tooltip carries full detail). Keep the existing per-workload bar-scaling JS in `SIZE_JS` (unchanged width math).

- [ ] **Step 1: Add failing assertions** to `render-size.test.ts`:

```ts
const html = renderSizeView(data);
// per-facility color comes from theme, not a single seg-floor class:
expect(html).toContain("background:#6e7b8c");   // allocator floor shade
expect(html).toContain("background:#34b88a");   // observed accent
// inline label on a wide segment (raw bytes + facility):
expect(html).toContain("600 B");                 // allocator approxBytes label (from test fixture: share .6 * 1000)
// tooltip still present:
expect(html).toContain("title=");
```

(Adjust the fixture: the existing `render-size.test.ts` fixture has `allocator` 600 / `observed` 400 — labels `600 B allocator` / `400 B observed`.)

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test render-size`
Expected: FAIL on `background:#6e7b8c`.

- [ ] **Step 3: Reimplement `renderSegment`/`renderRow`/`SIZE_CSS`:**
  - `renderSegment(s)`: emit `<span class="seg" data-band data-raw data-gz data-brotli style="background:${segmentColor(s)}" title="${facility} ≈${rawBytes} B (${share%})"><span class="seg-lbl">${fmt(rawBytes)} ${shortFacility}</span></span>`. `.seg-lbl` is `overflow:hidden; white-space:nowrap; font: mono`. Drop `seg-${band}` background classes (color now inline).
  - `SIZE_CSS`: bar 26px, radius 5px, light track `#eef2f6`, segment hairline `1px #fff`, no gridlines. Copy exact values from mockup `s9-assembled.html` `.fin-bar`/`.fin-seg`.
  - Legend swatches use `segmentColor` outputs.

- [ ] **Step 4: Run, verify pass** — `pnpm test render-size` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reporter/src/render-size.ts packages/reporter/tests/render-size.test.ts
git commit --no-gpg-sign -m "feat(reporter): facility-colored size bars + inline labels"
```

---

### Task 4: Size cross-lang table — collapsible + zebra + heatmap  `[I]`

**Files:**
- Modify: `packages/reporter/src/render-size.ts` (`renderTable`, `cell`, `SIZE_CSS`)
- Test: `packages/reporter/tests/render-size.test.ts`

Notes: collapse via native `<details>` (no JS). Heatmap tint computed on **raw** bytes per column (static, deterministic); numbers still recolor by compression via the existing `.xlang-cell` JS — note the heatmap bucket stays raw-based (acceptable v1; JS recolor deferred). Muted zeros: render `0`/`—` with a `z` class.

- [ ] **Step 1: Add failing assertions:**

```ts
expect(html).toContain("<details");                 // collapsible
expect(html).toContain("<summary");
expect(html).toContain('class="xlang-heat');        // heatmap bucket class on cells
```

- [ ] **Step 2: Run, verify fail** — `pnpm test render-size` → FAIL on `<details`.

- [ ] **Step 3: Reimplement `renderTable`:** wrap table in `<details><summary class="xlang-toggle">таблица · ${id} · байты</summary> … </details>`. In `cell`, compute a bucket 1..5 from `rawBytes / columnMaxRaw` and add `class="xlang-cell xlang-heat-${bucket}"`; muted zero → add `z`. `SIZE_CSS`: `.xlang-heat-1..5` slate ramp (spec §2 `#f3f5f8 … #6e7d92`), `td.z` color `#c4ccd6`, `td.tot` bold + left rule, zebra even `#fafbfc`.

- [ ] **Step 4: Run, verify pass** — `pnpm test render-size` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reporter/src/render-size.ts packages/reporter/tests/render-size.test.ts
git commit --no-gpg-sign -m "feat(reporter): collapsible heatmap cross-lang size table"
```

---

### Task 5: Perf view-model  `[S]`

**Files:**
- Create: `packages/reporter/src/perf-view-model.ts`
- Test: `packages/reporter/tests/perf-view-model.test.ts`
- Modify: `packages/reporter/src/index.ts`

**Interfaces:**
- Consumes: `Aggregated`, `AggregatedBenchmark` from `./aggregate.js`; `BenchResult` from `@bench/result-schema`.
- Produces:

```ts
export const ENV_ORDER: readonly string[];      // ["node","chromium","firefox"]
export const SIZE_ORDER: readonly string[];     // ["S","M","L"]

export interface PerfImplMultiple {
    impl: string;                                // `${language}/${toolchain}/${profile}`
    byEnv: Record<string, number | null>;        // env -> warmMedian ms (null = not run)
}
export interface PerfDetailRow {
    impl: string;
    initTotal: number; firstCall: number; warmMedian: number; warmP95: number;
    cv: number; noisy: boolean; correctnessFailed: boolean; validated: boolean;
}
export interface PerfSlice {
    size: string; profile: string;
    envs: string[];                              // envs present in this slice, ENV_ORDER-sorted
    multiples: PerfImplMultiple[];               // warm-median per impl across envs (global-max scaled at render)
    detail: PerfDetailRow[];                     // env === "node" rows (fallback: first env present)
}
export interface PerfWorkload { id: string; slices: PerfSlice[]; }
export interface ShapeCell { layout: string; dispatch: string; warmMedian: number | null; }
export interface PerfModel {
    workloads: PerfWorkload[];                    // excludes shape_dispatch_* ids
    sizes: string[]; profiles: string[];          // union across all, for the controls
    shapeDispatch: ShapeCell[] | null;            // pinned node/rust/raw/speed/L grid (4 cells) or null
}
export function buildPerfModel(agg: Aggregated): PerfModel;
```

- [ ] **Step 1: Write the failing test** (use the `fakeResult` helper pattern already in `aggregate.test.ts`; build 2 impls × 2 envs for `hashmap_int` at size L / speed):

```ts
// packages/reporter/tests/perf-view-model.test.ts
import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregate.js";
import { buildPerfModel } from "../src/perf-view-model.js";
import type { BenchResult } from "@bench/result-schema";
// (reuse a local fakeResult(over, warmMedian) like aggregate.test.ts, with env override)

describe("buildPerfModel", () => {
    it("groups warm-median per impl across envs into a slice", () => {
        const results = [
            fakeResult({ id: "hashmap_int", language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, 0.051, "node"),
            fakeResult({ id: "hashmap_int", language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, 0.072, "chromium"),
        ];
        const m = buildPerfModel(aggregate(results));
        const wl = m.workloads.find((w) => w.id === "hashmap_int")!;
        const slice = wl.slices.find((s) => s.size === "L" && s.profile === "speed")!;
        const row = slice.multiples.find((x) => x.impl === "rust/raw/speed")!;
        expect(row.byEnv.node).toBeCloseTo(0.051);
        expect(row.byEnv.chromium).toBeCloseTo(0.072);
        expect(slice.envs).toEqual(["node", "chromium"]);
    });
    it("isolates shape_dispatch into the pinned 2x2 grid", () => {
        const mk = (id: string, wm: number) => fakeResult({ id, language: "rust", toolchain: "raw", profile: "speed", inputSize: "L" }, wm, "node");
        const m = buildPerfModel(aggregate([
            mk("shape_dispatch_homo_static", 0.58), mk("shape_dispatch_homo_dyn", 0.74),
            mk("shape_dispatch_mixed_static", 0.61), mk("shape_dispatch_mixed_dyn", 1.31),
        ]));
        expect(m.workloads.some((w) => w.id.startsWith("shape_dispatch"))).toBe(false);
        expect(m.shapeDispatch).toHaveLength(4);
        expect(m.shapeDispatch!.find((c) => c.layout === "mixed" && c.dispatch === "dynamic")!.warmMedian).toBeCloseTo(1.31);
    });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm test perf-view-model` → FAIL (module missing).

- [ ] **Step 3: Implement `buildPerfModel`:** iterate `agg.benchmarks`; split `shape_dispatch_*` (the 4 ids → `ShapeCell[]` from the pinned key `node|rust|raw|speed|L`, layout/dispatch parsed from id) from the rest. For each non-shape workload: group cases by `(size,profile)` → slice; within a slice group by impl `${language}/${toolchain}/${profile}` → `PerfImplMultiple.byEnv[env] = warmMedian`; `envs` = ENV_ORDER-filtered present set; `detail` = rows where `env === "node"` (else first env), one per impl, pulling `timingsMs.*`, `stats.cv/noisy`, `quality.*`. Sort slices by SIZE_ORDER then profile; sort multiples/detail by warmMedian asc. `sizes`/`profiles` = unions.

- [ ] **Step 4: Run, verify pass** — `pnpm test perf-view-model` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reporter/src/perf-view-model.ts packages/reporter/tests/perf-view-model.test.ts packages/reporter/src/index.ts
git commit --no-gpg-sign -m "feat(reporter): perf view-model (env multiples + node detail + shape grid)"
```

---

### Task 6: Perf env small-multiples + slice controls  `[S]`

**Files:**
- Modify: `packages/reporter/src/render-perf.ts` (new `renderPerfView` body, `PERF_JS`, `PERF_CSS`)
- Test: `packages/reporter/tests/render-perf.test.ts` (create)

**Interfaces:**
- Consumes: `buildPerfModel`, `PerfModel` from `./perf-view-model.js`; `escape` (keep in render-perf or move to theme — keep export stable).

Notes: render size/profile **segmented controls** (default = `L`/`speed` if present, else first). Per workload, render one small-multiples block **per slice** tagged `data-size`/`data-profile`, hidden unless active; `PERF_JS` toggles active slice on control change. Each block: header row (env columns) + impl rows; each env cell is a bounded box `[track+fill | value-right]`; **global scale** = max warmMedian across the slice's multiples; `null` env → empty box "—".

- [ ] **Step 1: Write failing test:**

```ts
import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregate.js";
import { renderPerfView } from "../src/render-perf.js";
// build agg with hashmap_int rust/raw speed L node+chromium (fakeResult)
it("renders env small-multiples with a column per env", () => {
    const html = renderPerfView(aggregate(results));
    expect(html).toContain('class="em-row"');
    expect(html).toContain('data-size="L"');
    expect(html).toContain('data-profile="speed"');
    expect(html).toContain(">node<");
    expect(html).toContain(">chromium<");
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** small-multiples render + `perfControls` (segmented size/profile) + `PERF_JS` slice toggle (show block whose `data-size`+`data-profile` match active). CSS classes from mockup `p4b-multiples.html`/`p5-perf-assembled.html` `.em-*` (exact values). Bar fill `#a7c8e3`, value mono right, env header centered, shared impl label left.

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reporter/src/render-perf.ts packages/reporter/tests/render-perf.test.ts
git commit --no-gpg-sign -m "feat(reporter): perf env small-multiples + size/profile controls"
```

---

### Task 7: Perf detail table — data bars + quality states  `[S]`

**Files:**
- Modify: `packages/reporter/src/render-perf.ts` (`renderPerfDetail`, `PERF_CSS`)
- Test: `packages/reporter/tests/render-perf.test.ts`

Notes: per slice, a collapsible `<details>` node detail table. `init` and `warm med` are **data bars**: bounded track + fill `#cfe1f0` + value **beside (right)** + column dividers. Quality: `noisy` row → `tr.noisy` + `td.bad` on cv + warm bar fill class `hatch`; `correctnessFailed` → `tr.fail` + `td.failx` on ok + warm bar fill class `hatch-fail`. Hatch = 45° `repeating-linear-gradient` (blue/yellow for noisy, blue/red for fail) with `!important`. Zebra declared before `.noisy`/`.fail`.

- [ ] **Step 1: Write failing test** (one noisy + one fail row via `stats.noisy=true` / `quality.correctnessFailed=true` in fakeResult):

```ts
it("flags noisy and fail rows", () => {
    const html = renderPerfView(aggregate(results));
    expect(html).toContain('class="cbox"');           // data-bar box
    expect(html).toContain('tr class="noisy"');
    expect(html).toContain('class="hatch"');           // hatched warm bar
    expect(html).toContain('tr class="fail"');
    expect(html).toContain('class="hatch-fail"');
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** `renderPerfDetail(slice)`: table `impl | init(bar) | first | warm med(bar) | p95 | cv | ok`; init/warm cells = `.cbox` `[track>i | value]`; apply `hatch`/`hatch-fail` to the warm `i` and `noisy`/`fail` to `<tr>` and `bad`/`failx` to cv/ok. CSS from mockup `f-fail-hatch.html` + `p5-perf-assembled.html` (`.cbox`, `.hatch`, `.hatch-fail`, `.pf-t tr.noisy/.fail`, `td.bad/.failx`). Global-scale init/warm bars per column max in the slice.

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reporter/src/render-perf.ts packages/reporter/tests/render-perf.test.ts
git commit --no-gpg-sign -m "feat(reporter): perf detail table — data bars + noisy/fail signaling"
```

---

### Task 8: Perf shape_dispatch heatmap  `[I]`

**Files:**
- Modify: `packages/reporter/src/render-perf.ts` (`renderShapeHeatmap`, `PERF_CSS`)
- Test: `packages/reporter/tests/render-perf.test.ts`

Notes: replace the old 2×2 plain grid with a heatmap. Cell bucket 1..5 by warmMedian over the 4 cells; **adaptive text** — dark cells (bucket ≥4) get white text via `td.cell.a4/.a5` (out-specify base). Corner deltas: `dynamic vs static` per row (`+NN%`). Caption line.

- [ ] **Step 1: Write failing test:**

```ts
it("renders shape_dispatch as a 2x2 heatmap with deltas", () => {
    const html = renderPerfView(aggregate(shapeResults));
    expect(html).toContain('class="shape-heat"');
    expect(html).toContain("static");
    expect(html).toContain("dynamic");
    expect(html).toMatch(/\+\d+%/);     // a delta annotation
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement** `renderShapeHeatmap(cells)`: 2×2 table (rows homo/mixed, cols static/dynamic), cell class `a${bucket}` + adaptive text rule, `.dlt` corner delta computed `(dyn-static)/static`. CSS from mockup `p3b-contrast.html` variant A + `p5-perf-assembled.html` `.sg`. Render only when `model.shapeDispatch` is non-null.

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reporter/src/render-perf.ts packages/reporter/tests/render-perf.test.ts
git commit --no-gpg-sign -m "feat(reporter): shape_dispatch 2x2 heatmap + deltas (adaptive text)"
```

---

### Task 9: Full-gate + visual deliverable check  `[I]`

**Files:** none (verification + any fixups).

- [ ] **Step 1: Run all gates**

Run (sandbox): `pnpm typecheck && pnpm lint:all && pnpm test`
Expected: all green. Fix any fallout (stale snapshot strings in old tests).

- [ ] **Step 2: Regenerate the report from existing results** (no re-bench)

Run (`dangerouslyDisableSandbox: true`): `pnpm report --in=results/raw/<latest-run>`
Expected: writes `results/summarized/<ts>/index.html` with no errors.

- [ ] **Step 3: Eyeball both tabs** — open the generated `index.html` (per `docs/pitfalls/2026-06-22-phase-1-3-close-out-visual-deliverable.md`, gates do NOT catch render/UX regressions). Verify on real data:
  - Size: facility-colored bars (floor slate ramp, not rainbow), per-workload scaling holds for tiny + large workloads, inline labels readable, collapsible heatmap table.
  - Perf: env small-multiples render all present envs (and degrade if an env is missing — spec §9.1), size/profile controls switch slices, detail table data bars + any real noisy/fail rows flagged, shape_dispatch heatmap with adaptive text + deltas.
  - Tabs switch; sticky tray pins on scroll.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit --no-gpg-sign -m "fix(reporter): redesign visual-check fixups"
```

---

## Self-Review (done at authoring)

- **Spec coverage:** §2 tokens → Task 1; §3 shell → Task 2; §4 size bars/labels → Task 3, size table → Task 4; §5 perf model → Task 5, small-multiples → Task 6, detail table+quality → Task 7, shape heatmap → Task 8; §6 behaviour (collapsible/tooltips) → Tasks 4/7; §9 risks (env degrade, per-facility floor, global scale, heatmap buckets, visual check) → Tasks 5/6/9. No spec section left without a task.
- **Type consistency:** `PerfModel`/`PerfSlice`/`PerfImplMultiple`/`PerfDetailRow`/`ShapeCell` names are used identically in Tasks 5–8; `segmentColor` signature identical in Tasks 1 & 3.
- **Deferred (spec §8), intentionally not tasks:** perf detail env-selector, shape impl-selector, JS heatmap recolor on compression switch, richer init-phase breakdown.

---

## Execution Protocol

**Routing (hybrid inline/subagent):**
- `[S]` (dispatch a subagent — non-trivial logic/CSS): Tasks 1, 3, 5, 6, 7.
- `[I]` (inline — mechanical/contained): Tasks 2, 4, 8, 9.
- Routing is fixed by the tags above; do NOT re-ask. All-`[I]` waves run inline.

**Subagent dispatch:** give the subagent the FULL gate set (`pnpm typecheck && pnpm lint:all && pnpm test`), the task's Files/Interfaces/Steps verbatim, and the spec + mockup paths for exact CSS. Require the failing-test-first cycle.

**Static break-points (recommend `/finish-session`, user decides):**
- After **Task 4** (Size tab complete) — natural review boundary; eyeball Size before perf.
- After **Task 8** (Perf tab complete, before the final gate/visual task).

**Per-task break-check:** after every task, run the task's gate. If RED → STOP, do not advance (≤2 attempts at the same approach, then rethink — CLAUDE.md cost discipline). After Task 9 green + visual check, the phase is closeable.

**Wave-0 gate:** the baseline gate above MUST be green before Task 1.

**Landing audit (before declaring done):** spec-coverage diff (name any §item not implemented) + visual-deliverable check (Task 9 Step 3) are mandatory, not optional.
