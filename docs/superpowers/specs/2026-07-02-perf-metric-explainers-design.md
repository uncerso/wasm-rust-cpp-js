# perf-metric-explainers — design

**Date:** 2026-07-02
**Status:** design (approved via visual-companion brainstorm)
**Phase:** 1.5 follow-up (post CV-stabilization, PR #10)
**Branch:** `feature/perf-metric-explainers`

## Problem

The CV-stabilization work (PR #10) added a cluster of statistics to the Perf tab's
detail table — `mad`, `cv`, `relSem` — plus three visual codes the reader cannot decode
without prior context:

- **amber row** (`tr.noisy`, `#fdf6da`) — the mean's SEM exceeds the 3 % accept gate.
- **red row** (`tr.fail`, `#fbe4e4`) — a correctness (checksum) failure.
- **`<res` badge** (`.subres`) — the warm-median sits below the timer's resolution floor.
- **highlighted `relSem` cell** (`td.bad`, `#f6dd86`) — the metric that tripped the amber gate.

A product engineer opening the report has no way to learn what `relSem` is, why a row is
amber (a *finding about variance*, not a measurement error), or what `<res` means. The
canonical framing already exists in prose in `docs/guidelines.md § Measurement`; it is not
surfaced in the artifact the reader actually looks at.

## Goals

- Make the Perf tab **self-documenting**: every metric column and every visual code is
  explained inside the rendered HTML, with no external doc required.
- **Screenshot-safe**: the explanations survive when the report is shared as an image — no
  hover-only tooltips as the sole channel.
- Reuse the existing reporter design system (PR #9) — no new visual language.
- Presenter-only: static authored strings; no schema, view-model, or data change.

## Non-goals

- No new data or `BenchResult` fields; no `perf-view-model.ts` change.
- No interactive tooltips (`title=`) — rejected in brainstorm (hover-only fails in
  screenshots and the detail table is itself collapsed behind `<details>`).
- Size tab is untouched (it already carries `.sh-legend` + `.size-note`).

## Design

Two components, mirroring patterns already in the reporter:

### 1. Legend — in the sticky tray (always on screen)

The three visual codes are decoded by a compact legend rendered as a second block inside
`.perf-tray` (which is `position:sticky;top:0`), directly under the size/profile controls —
the same structural pattern as the Size tab's `.sh-legend`. Because the tray is sticky, the
legend stays visible while the reader scrolls the workload sections.

Clean style: **no word-labels** ("amber ="/"red ="). A colored swatch matching the row
background carries the color; the text states only the meaning.

Legend content (verbatim):

| swatch / badge | text |
| --- | --- |
| `#fdf6da` swatch | `mean not pinned to 3 % → see mad/cv` |
| `#fbe4e4` swatch | `correctness fail (ok ✗)` |
| `<res` badge | `below timer resolution — only the mean is reliable` |

The highlighted `relSem` cell is not a separate legend entry; it is explained in the
glossary's `relSem` definition (below).

### 2. Glossary — open-by-default callout at top of `.perf-body`

The metric definitions live in one collapsible callout (`<details open>`) placed once at the
top of `.perf-body`, before the workload sections. Open by default so it is noticeable on
arrival; collapsible so a returning reader can hide it. Rendered once (not per-workload).

Layout **C1**: three group sub-labels, each a stacked `metric — definition` grid (one metric
per line). Copy (verbatim):

**timing · ms**
- `init` — load + compile + instantiate (cold start)
- `first` — first call, incl. JIT warm-up
- `warm med` — median of warm calls — *the headline*, lower = faster
- `p95` — 95th percentile (tail)

**spread · precision**
- `mad` — median absolute deviation, ms — spread, robust to outliers
- `cv` — coefficient of variation = σ / mean — relative run-to-run spread
- `relSem` — rel. standard error of the mean = cv / √n — precision of the mean; accept gate ≤ 3 % (above it, the cell is highlighted and the row turns amber)

**correctness**
- `ok` — reference checksum matched (✓ / ✗)

The `relSem` line carries the key precision-vs-spread insight from
`guidelines.md § Measurement` (a noisy operation with high `cv` can still have a precise
mean), so no separate lead paragraph is needed.

### Source of truth

Copy is authored to agree with `docs/guidelines.md § Measurement` (the two confirmed claims:
sub-resolution → `<res`; read SEM separately from spread → amber/relSem). The reporter does
not import the markdown; the strings are the reporter's own, kept consistent by review.

## Integration points

All changes in `packages/reporter/src/render-perf.ts` (presenter only):

- **`PERF_CSS`** — add classes: `.perf-legend` / `.pl-key` / `.pl-sw` / `.pl-badge` (legend);
  `.perf-guide` + `summary` / `.pg-in` / `.grp-lab` / `.gl2` (`dt`/`dd`) (glossary callout).
  Colors reuse the existing row/badge palette (`#fdf6da`, `#fbe4e4`, `#f6dd86`, muted slate).
- **`renderPerfView`** — (a) append the legend block to the `.perf-tray` markup after the
  controls; (b) prepend the glossary `<details open>` callout to the `.perf-body` content,
  before `workloadSections`.
- Two small pure helpers (`renderPerfLegend()`, `renderPerfGuide()`) return static strings —
  no arguments, no data dependency — keeping `renderPerfView` readable.

No change to `perf-view-model.ts`, `render.ts` shell, schema, or any other package.

## Testing

Extend `packages/reporter/tests/render-perf.test.ts`:

- Legend: output contains each legend string; swatch colors present; no literal
  "amber ="/"red =" word-labels.
- Glossary: `<details` callout is present with the `open` attribute; contains each group
  label (`timing · ms`, `spread · precision`, `correctness`) and each metric term
  (`init`, `first`, `warm med`, `p95`, `mad`, `cv`, `relSem`, `ok`).
- Consistency guard: every **metric** `<th>` term in the detail table
  (`init`, `first`, `warm med`, `p95`, `mad`, `cv`, `relSem`, `ok`) has a matching glossary
  entry — the two identifier columns (`impl`, `env`) are self-evident and intentionally
  excluded. Catches future column additions that skip the glossary.

Existing render/aggregate snapshot-style tests continue to pass; the additions are additive
markup.

## Out of scope / deferred

- `title=` hover tooltips on `<th>` (rejected).
- Explaining small-multiples semantics beyond the existing `warm-median (ms) · lower =
  faster · shared scale` eyebrow (already self-describing).
- Size tab explainers (already covered by `.sh-legend` / `.size-note`).

## Housekeeping (same branch, separate commit)

Roadmap close-out for the merged CV-stabilization phase, deferred from PR #10:
- Remove the completed `benchmark-cv-stabilization` item from `docs/roadmap.md` (TBD bucket).
- Remove `perf-metric-explainers` from `docs/roadmap.md § TBD` on completion of this phase.
