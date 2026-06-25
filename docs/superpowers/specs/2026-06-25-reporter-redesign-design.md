# Reporter visual redesign — design spec

**Date:** 2026-06-25
**Status:** approved (brainstorm via visual companion), pre-plan
**Scope:** presentation-only overhaul of `packages/reporter` (Size + Perf tabs). No `BenchResult` schema change, no new measurements, no change to `size-attr`/`harness`/loaders. Data flow (`Aggregated`, `SizeData`) is unchanged; this rewrites how that data is rendered to HTML/CSS.

## 1. Goal & motivation

The shipped report is functional but utilitarian (monospace tables, plain bordered bars, fieldset filters). The data and its decomposition are good; the **presentation** is not. This redesign gives the report a deliberate visual identity, makes both axes legible at a glance, and brings the Perf tab up from "relocated table" to a first-class view — without changing what is measured.

Subsumes roadmap items: `size-bar-per-facility-color`, `perf-view-redesign`, and the size-view polish cluster. Advances north-star goal #1 (evidence base presented for product engineers).

**Design identity:** "measurement instrument / data-sheet." Monospace for *all* numbers (meaningful alignment of bytes/ms, not decoration); system sans for chrome; one restrained accent. Bars/graphs are primary (relative comparison, low cognitive load); exact numbers are secondary (read on demand).

## 2. Design system (tokens)

Zero web-font dependency — system stacks only (the report is a self-contained generated artifact; no CDN/bundled font).

**Typography**
- Display / headings: `system-ui, -apple-system, sans-serif`, weight 700–800, tight tracking.
- Body / labels / legend: `ui-sans-serif, system-ui, sans-serif`.
- Data (every number — bytes, ms, %, cv, totals) + eyebrows/captions: `ui-monospace, SFMono-Regular, Menlo, monospace`.
- Eyebrow pattern: mono, ~9px, uppercase, letter-spacing ~0.1em, muted (`#9aa3b0`).

**Palette**
- Ink `#1f2530`; muted text `#6b7480` / `#8a93a0` / `#9aa3b0`; paper `#ffffff`; tray `#f6f8fb`; track `#eef2f6`; rules `#e7eaef` / `#d8dce3`.
- Active control / tab accent (one): `#36506e`.
- **Size bands:** floor = SLATE gray-ramp by facility (allocator darkest `#6e7b8c` → runtime `#828f9f` → hash-map `#96a1af` → panic/fmt `#a8b2bf` → data `#bac2cd` → structural `#c8cfd7`); glue (JS) = amber `#d8be73`; observed/marginal = emerald `#34b88a`; unattributed = rose `#e0a8a8`. Floor stays "one gray family" (not a rainbow) — sub-facilities are shades, not hues.
- **Perf accent:** steel-blue. Bar fill (pale, so a dark number reads over/beside it) `#cfe1f0`; small-multiples fill `#a7c8e3`; heatmap ramp light→dark `#e9f0f6 / #cfe0ee / #a7c4dd / #7aa0c2 / #4f7ea6`.
- **Quality states:** noisy row tint `#fdf6da` + CV cell `#f6dd86` (bold `#6e5208`); fail row tint `#fbe4e4` + ✗ cell `#f1b6b6` (bold `#7e2626`).

**Geometry:** bars 24–26px tall, radius 5px; small radii (3–7px) throughout; hairline separators `1px` white between bar segments; light track behind every bar.

## 3. Shell / layout (shared by both tabs)

- White page. Single app container (`#fff`, 1px rule border, radius 9px).
- **Header:** decluttered — title left (`wasm-rust-cpp-js`, small mono `generated <ts>`), **tabs top-right** (`Size` / `Perf`), accent underline on active. No oversized title, no eyebrow strip.
- **Sticky filter tray** (`#f6f8fb`, bordered top/bottom) directly under the header — pinned on scroll. Filters are global to the tab.
- **Body:** single column. Workload sections stacked, separated by a **hairline rule** between sections (no cards, no tinted page).
- A single **global legend** lives in the filter tray (not repeated per workload).

**Filter controls** (shared vocabulary):
- Mutually-exclusive groups → connected **segmented control** (active filled with accent).
- Multi-select groups → individual **toggle-pills** (active filled).
- Boolean → **switch**.
- Groups separated by **thin vertical dividers**.

## 4. Size tab

**Filters:** compression (segmented: raw / gzip / brotli) · profile (segmented: all / size / speed) · toolchains (toggle-pills, multi) · "только наблюдаемое" (switch). (Size is env- and input-size-invariant → no env/S-M-L here. Matches current semantics.)

**Per-workload bars** (one row per binary = language/toolchain/profile):
- Layout `[impl label | plot | total]`. Plot is a fixed track region; the bar's **length varies** = total / (largest visible binary in *this* workload) — per-workload scaling (small workloads stay readable). Total bytes right-aligned, mono.
- Bar: 26px, radius 5px, light track, segments split by 1px white hairlines, **no gridlines/ruler**.
- **Segments colored by facility** per §2: floor sub-segments in the slate-ramp, then glue / observed / unattributed accents.
- **Labels:** key segments carry `value + name`, left-aligned, clipped (e.g. `3.1K alloc`, `1.4K glue`, `1.5K observed`); narrow segments are unlabeled with the full `facility ≈bytes (share%)` in a tooltip. Glue/observed/unattr (the "story") and the largest floor facility get labels.
- Tooltips on every segment (exact bytes + facility), as today.

**Cross-language table** (per workload): the existing `impl × facility` matrix, **restyled and collapsible** (`▸ таблица`, collapsed by default; bars are the headline, table is drill-down). Zebra rows, mono right-aligned, muted zeros (`0`/`—` in light gray), `total` column emphasized (bold + left rule). **Heatmap cell fill**: each cell tinted by magnitude (slate ramp) so hot contributors are found without reading numbers.

**Compression / observed-only behaviour:** as today — compression switches the byte basis (shares computed on raw; gz/brotli relabel the total); "только наблюдаемое" collapses floor/glue and rescales bars to observed only.

## 5. Perf tab

Perf is multi-dimensional (env × size × profile × impl × {init, first, warmMedian, warmP95, cv}); Size was invariant. Resolution:

**Filters:** size (segmented: S / M / L) · profile (segmented: speed / size). **env is NOT a filter** — all three environments are shown side-by-side (small multiples). Principle: moving the eye across columns beats clicking to switch.

**Per-workload headline — env small-multiples** (warm-median, the primary metric):
- Matrix: impl rows (shared labels on the left) × env columns (`node` / `chromium` / `firefox`).
- Each env cell is a **bounded box** containing `[bar | value-right]` (graphs primary, number secondary). Bar uses a bounded track + pale steel fill; value mono, right.
- **Global scale per workload** (same max across all env columns) → a longer bar genuinely means slower, both across impls and across envs.

**Per-workload detail (collapsible) — metric table** (`▾ детали`, env = **node** reference; cross-env warm already lives in the small-multiples above):
- Columns: `impl · init · first · warm med · p95 · cv · ok`.
- `init` and `warm med` cells are **data bars**: bounded track, **value beside the bar (right), not overlaid**, pale fill (`#cfe1f0`), with **column dividers** delimiting cells. `first` / `p95` are plain mono numbers.
- **Quality signaling (hybrid):**
  - noisy (`stats.noisy`): row tint `#fdf6da` + CV cell highlighted `#f6dd86` bold + the warm-median bar fill **hatched** (45° blue/yellow stripes).
  - correctness-fail (`quality.correctnessFailed`): row tint `#fbe4e4` + `ok` ✗ cell `#f1b6b6` bold + the warm-median bar fill **hatched red** (45° blue/red stripes).
  - (Reuse existing `stats.noisy` / `quality.correctnessFailed`; do not invent a new threshold.)
  - CSS note: define zebra (`:nth-child(even)`) **before** the `.noisy`/`.fail` row rules (equal specificity → source order decides); cell highlights must out-specify row tint.

**shape_dispatch (2×2 factorial) — special view** instead of plain bars:
- A **2×2 heatmap grid**: rows = layout (homo / mixed), cols = dispatch (static / dynamic); cell = warm-median for the pinned config (node · rust/raw · speed · L, as today's `SHAPE_DISPATCH_PINNED_KEY`).
- Cell tinted by value (darker = slower); **adaptive text color** (white on dark cells — fix specificity so the cell-state color beats the base `td` color). Corner **delta** annotations (e.g. `+28%`, `+115%`) make the dispatch overhead and megamorphism jump out.
- A one-line caption states the read ("dynamic cheap on homo, explodes on mixed").

## 6. Behaviour / interaction

- All filtering is client-side (no rebuild), as today.
- Collapsible tables (size cross-lang table, perf detail table) via `▸/▾` toggles.
- Tooltips for exact values on bar segments.
- Quality floor: responsive down to a normal laptop width, visible focus, `prefers-reduced-motion` respected (there is essentially no motion). Wide tables get `overflow-x:auto`.

## 7. Architecture / implementation notes

Presentation layer only, in `packages/reporter/src`:
- `render.ts` — shell: header, tabs-right, sticky tray, shared CSS tokens. Consider extracting shared tokens/CSS into one module consumed by both views.
- `render-size.ts` — facility-colored bars (slate-ramp), key-segment labels, collapsible heatmap cross-lang table.
- `render-perf.ts` — split into: env small-multiples renderer, detail metric-table renderer (data bars + quality states), shape_dispatch heatmap renderer. (May warrant a `render-perf-*.ts` split given size.)
- `size-view-model.ts` — likely needs the floor decomposed into ordered facility sub-segments for the bar (today the bar may collapse floor into one band; the table already has per-facility bytes). Verify the view-model exposes per-facility floor segments; extend if not.
- View-models stay pure; HTML/CSS string-building stays in the `render-*` files.
- Update reporter tests (`tests/render*.test.ts`, `size-view-model.test.ts`) to the new markup/classes.

No change to: `result-schema`, `harness`, `loaders`, `size-attr`, scripts, build pipeline.

## 8. Out of scope / deferred (surface, don't silently drop)

- **Perf detail table env selector** — table is node-only for now; a per-table env switch is deferred (small-multiples already cover cross-env warm).
- **shape_dispatch impl selector** — heatmap stays pinned to node·rust/raw·speed·L (as today); making the pinned impl selectable is deferred.
- **Richer perf** (init-phase sub-breakdown compile/instantiate, CV-heatmap across the matrix, env-delta callouts beyond firefox/node) — not in this redesign.
- **size axis selectors** unchanged from current semantics.

## 9. Open questions / risks

1. **Env data availability** — env small-multiples assume node/chromium/firefox results exist for the (workload, size, profile) slice. If a slice ran in fewer envs, the small-multiples must **degrade gracefully** (render only the available env columns; do not leave empty boxes). Confirm against real `Aggregated` data before Wave-0.
2. **Per-facility floor in the bar** — needs the view-model to emit ordered floor facilities per binary at the chosen compression. If only an aggregate floor band exists today, extending the view-model is the first implementation task (and a test target).
3. **Global perf scale** — "global per workload" max must be computed over the visible (size, profile) slice across all envs; verify outliers (e.g. js) don't crush the wasm bars (they didn't in mockups, but confirm on real data; per-workload scaling already mitigates).
4. **Heatmap thresholds / ramp bucketing** — choose deterministic bucket boundaries (e.g. relative to column max or fixed) for both the size cross-lang heatmap and the shape_dispatch grid; document the chosen rule.
5. **Visual-deliverable check** — gates (typecheck/lint/test) will not catch render/UX regressions; the phase MUST open the generated report and eyeball both tabs before close (per `docs/pitfalls/2026-06-22-phase-1-3-close-out-visual-deliverable.md`).

## 10. Reference mockups

Brainstormed via the visual companion; mockups persisted under `.superpowers/brainstorm/*/content/` (gitignored): size aspects `s1`–`s9` (layout, filters, bar form, colors, labels, table, type, polish, assembled+heatmap), perf aspects `p1`–`p5` (concept/hybrid, table data-bars + bounded track, CV signal, shape_dispatch heatmap, env small-multiples, assembled). Final Size assembly = `s9-assembled.html` (table variant B/heatmap); final Perf assembly = `p5-perf-assembled.html` + `f-fail-hatch.html`.
