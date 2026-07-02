# perf-metric-explainers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reporter's Perf tab self-documenting — a clean color legend in the sticky tray plus an open-by-default "how to read this tab" glossary callout — so a product engineer can decode `mad`/`cv`/`relSem`, the amber/red rows, and the `<res` badge without external docs.

**Architecture:** Presenter-only change, entirely in `packages/reporter/src/render-perf.ts`. Two pure string-returning helpers (`renderPerfLegend()`, `renderPerfGuide()`) plus additive CSS in `PERF_CSS`; wired into `renderPerfView` (legend into the `.perf-tray` markup, glossary at the top of `.perf-body`). No schema, view-model, or data change. Copy verbatim from the approved spec.

**Tech Stack:** TypeScript (ESM, strict), vitest, static HTML string generation.

**Spec:** `docs/superpowers/specs/2026-07-02-perf-metric-explainers-design.md` (commit `b2e4321`).

## Global Constraints

- **TS style:** 4-space indent, double quotes, semicolons, trailing comma (multiline), `curly: all`, `verbatimModuleSyntax` + strict. Enforced by ESLint flat config.
- **Presenter-only:** no change to `perf-view-model.ts`, `render.ts`, schema, or any other package.
- **Copy is verbatim** from the spec — do not paraphrase the legend/glossary strings.
- **Palette reuse:** amber `#fdf6da`, red `#fbe4e4`, relSem-highlight `#f6dd86`, muted slate for chrome — no new colors.
- **Gate set (all must pass before close):** `pnpm typecheck && pnpm lint:all && pnpm test`.

---

### Task 1: Tray legend (decode amber / red / `<res`)

**Files:**
- Modify: `packages/reporter/src/render-perf.ts` (add `.perf-legend` CSS to `PERF_CSS`; add `renderPerfLegend()`; wire into `controls` in `renderPerfView`)
- Test: `packages/reporter/tests/render-perf.test.ts`

**Interfaces:**
- Produces: `renderPerfLegend(): string` — a static `<div class="perf-legend">…</div>` block; no arguments.
- Consumes: nothing (static copy).

- [ ] **Step 1: Write the failing test**

Add to `packages/reporter/tests/render-perf.test.ts` inside the `describe("renderPerfView", …)` block:

```ts
it("renders a clean tray legend decoding amber/red/<res (no word-labels)", () => {
    const html = renderPerfView(aggregate([fakeResult({}, 1.0, "node")]));
    expect(html).toContain('class="perf-legend"');
    expect(html).toContain("mean not pinned to 3% → see mad/cv");
    expect(html).toContain("correctness fail (ok ✗)");
    expect(html).toContain("below timer resolution — only the mean is reliable");
    expect(html).toContain("#fdf6da");   // amber swatch
    expect(html).toContain("#fbe4e4");   // red swatch
    // clean legend: the colour speaks, no "amber ="/"red =" word-labels
    expect(html).not.toContain("amber =");
    expect(html).not.toContain("red =");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — the new test errors (`class="perf-legend"` not found in output).

- [ ] **Step 3: Add the legend CSS to `PERF_CSS`**

In `packages/reporter/src/render-perf.ts`, append these rules to the `PERF_CSS` template literal (before the closing `` `.trim() ``). `flex-basis:100%` makes the legend wrap onto its own row inside the flex `.perf-tray`, below the controls:

```css
.perf-legend{flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:9px;font-size:10.5px;color:#56606e;align-items:center}
.pl-key{display:flex;align-items:center;gap:6px}
.pl-sw{width:14px;height:11px;border-radius:2px;display:inline-block;border:1px solid rgba(0,0,0,.08)}
.pl-badge{font:600 8px ui-monospace,monospace;color:#8a93a0;border:1px solid #cfd6de;border-radius:3px;padding:0 3px}
```

- [ ] **Step 4: Add the `renderPerfLegend()` helper**

In the "Helpers" section of `render-perf.ts` (e.g. just above `renderSegControl`), add:

```ts
function renderPerfLegend(): string {
    return `<div class="perf-legend">
  <span class="pl-key"><span class="pl-sw" style="background:#fdf6da"></span>mean not pinned to 3% → see mad/cv</span>
  <span class="pl-key"><span class="pl-sw" style="background:#fbe4e4"></span>correctness fail (ok ✗)</span>
  <span class="pl-key"><span class="pl-badge">&lt;res</span>below timer resolution — only the mean is reliable</span>
</div>`;
}
```

- [ ] **Step 5: Wire the legend into the tray**

In `renderPerfView`, extend the `controls` template so the legend renders as the last child of `.perf-tray`:

```ts
    const controls = `<div class="perf-tray">
  <div class="perf-grp"><span class="perf-gl">size</span>${sizeCtrl}</div>
  <div class="perf-div"></div>
  <div class="perf-grp"><span class="perf-gl">profile</span>${profileCtrl}</div>
  ${renderPerfLegend()}
</div>`;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS (new test green; all pre-existing render-perf tests still pass).

- [ ] **Step 7: Commit**

```bash
git add packages/reporter/src/render-perf.ts packages/reporter/tests/render-perf.test.ts
git commit --no-gpg-sign -m "feat(reporter): tray legend decoding amber/red/<res on the Perf tab"
```

---

### Task 2: Glossary callout ("how to read this tab")

**Files:**
- Modify: `packages/reporter/src/render-perf.ts` (add `.perf-guide`/`.gl2` CSS to `PERF_CSS`; add `renderPerfGuide()`; prepend into `.perf-body` in `renderPerfView`)
- Test: `packages/reporter/tests/render-perf.test.ts`

**Interfaces:**
- Produces: `renderPerfGuide(): string` — a static `<details class="perf-guide" open>…</details>` block; no arguments.
- Consumes: nothing (static copy).

- [ ] **Step 1: Write the failing tests**

Add to `packages/reporter/tests/render-perf.test.ts`:

```ts
it("renders the open-by-default 'how to read this tab' glossary callout", () => {
    const html = renderPerfView(aggregate([fakeResult({}, 1.0, "node")]));
    expect(html).toContain('class="perf-guide"');
    expect(html).toMatch(/<details class="perf-guide" open>/);   // open by default
    expect(html).toContain("how to read this tab");
    expect(html).toContain("timing · ms");
    expect(html).toContain("spread · precision");
    expect(html).toContain("correctness");
    // relSem line carries the precision-vs-spread insight + the highlight clause
    expect(html).toContain("cv / √n");
    expect(html).toContain("the row turns amber");
});

it("glossary defines every metric column in the detail table", () => {
    const html = renderPerfView(aggregate([fakeResult({}, 1.0, "node")]));
    // identifier columns (impl, env) are self-evident and intentionally excluded
    for (const m of ["init", "first", "warm med", "p95", "mad", "cv", "relSem", "ok"]) {
        expect(html).toContain(`<dt>${m}</dt>`);
    }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `class="perf-guide"` / `<dt>init</dt>` not found.

- [ ] **Step 3: Add the glossary CSS to `PERF_CSS`**

Append to the `PERF_CSS` template literal in `render-perf.ts`:

```css
.perf-guide{margin:2px 0 8px;border:1px solid #cdd9e6;background:#f3f8fc;border-radius:9px}
.perf-guide>summary{font:700 10px ui-monospace,monospace;letter-spacing:.05em;text-transform:uppercase;color:#4a6c90;cursor:pointer;list-style:none;padding:10px 14px}
.perf-guide>summary::before{content:"ⓘ "}
.perf-guide>summary::after{content:" ▾";color:#9fb3c8}
.perf-guide[open]>summary{border-bottom:1px solid #e0e9f1;padding-bottom:8px}
.pg-in{padding:11px 14px 13px}
.grp-lab{font:700 8.5px ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:#8a93a0;margin:11px 0 4px}
.grp-lab:first-child{margin-top:0}
.gl2{display:grid;grid-template-columns:92px 1fr;gap:4px 12px;align-items:baseline;margin:0}
.gl2 dt{font:700 10.5px ui-monospace,monospace;color:#2f3a49;text-align:right;margin:0}
.gl2 dd{margin:0;font-size:11px;color:#4a5563;line-height:1.5}
.gl2 dd em{color:#6e5208;font-style:normal;font-weight:600}
```

- [ ] **Step 4: Add the `renderPerfGuide()` helper**

Add near `renderPerfLegend()` in the "Helpers" section:

```ts
function renderPerfGuide(): string {
    return `<details class="perf-guide" open>
  <summary>how to read this tab</summary>
  <div class="pg-in">
    <div class="grp-lab">timing · ms</div>
    <dl class="gl2">
      <dt>init</dt><dd>load + compile + instantiate (cold start)</dd>
      <dt>first</dt><dd>first call, incl. JIT warm-up</dd>
      <dt>warm med</dt><dd>median of warm calls — <em>the headline</em>, lower = faster</dd>
      <dt>p95</dt><dd>95th percentile (tail)</dd>
    </dl>
    <div class="grp-lab">spread · precision</div>
    <dl class="gl2">
      <dt>mad</dt><dd>median absolute deviation, ms — spread, robust to outliers</dd>
      <dt>cv</dt><dd>coefficient of variation = σ / mean — relative run-to-run spread</dd>
      <dt>relSem</dt><dd>rel. standard error of the mean = cv / √n — precision of the mean; accept gate ≤ 3% (above it, the cell is highlighted and the row turns amber)</dd>
    </dl>
    <div class="grp-lab">correctness</div>
    <dl class="gl2">
      <dt>ok</dt><dd>reference checksum matched (✓ / ✗)</dd>
    </dl>
  </div>
</details>`;
}
```

- [ ] **Step 5: Wire the glossary into `.perf-body`**

In `renderPerfView`, prepend the guide to the body content (before `workloadSections`):

```ts
    return `${controls}
<div class="perf-body">
${renderPerfGuide()}
${workloadSections}
${shapeSection}
</div>`;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS (both new tests green; all pre-existing tests still pass).

- [ ] **Step 7: Commit**

```bash
git add packages/reporter/src/render-perf.ts packages/reporter/tests/render-perf.test.ts
git commit --no-gpg-sign -m "feat(reporter): 'how to read this tab' metric glossary callout on the Perf tab"
```

---

### Task 3: Roadmap housekeeping (close-out)

**Files:**
- Modify: `docs/roadmap.md` (TBD bucket)

No test — documentation edit only.

- [ ] **Step 1: Remove the completed CV-stabilization item**

In `docs/roadmap.md § TBD`, delete the entire `- **benchmark-cv-stabilization** — …` bullet (merged in PR #10; per the roadmap "Removal" convention, completed items are deleted, history lives in git).

- [ ] **Step 2: Remove the perf-metric-explainers item**

In the same `§ TBD` bucket, delete the entire `- **perf-metric-explainers** — …` bullet (implemented by this branch).

- [ ] **Step 3: Verify no dangling references**

Run: `grep -rn "benchmark-cv-stabilization\|perf-metric-explainers" docs/roadmap.md`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add docs/roadmap.md
git commit --no-gpg-sign -m "docs(roadmap): drop completed benchmark-cv-stabilization + perf-metric-explainers"
```

---

### Task 4: Full-gate + visual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate set**

Run: `pnpm typecheck && pnpm lint:all && pnpm test`
Expected: typecheck clean; lint 0 errors; all vitest suites pass (reporter suite now includes the 3 new tests).

- [ ] **Step 2: Render the Perf tab and eyeball it (visual-deliverable check)**

Gates do not catch render/layout regressions. Produce the real HTML and open it:

- If a schema-v2 results directory exists on disk, render it:
  ```bash
  ls results/raw/ 2>/dev/null
  pnpm report --in=results/raw/<newest-v2-dir>   # tsx orchestrator → run with sandbox disabled
  open results/report/index.html                 # macOS
  ```
- Otherwise render a minimal preview from fake data. Write `scratchpad/preview.mts`:
  ```ts
  import { writeFileSync } from "node:fs";
  import { aggregate } from "./packages/reporter/src/aggregate.js";
  import { renderPerfView, PERF_CSS } from "./packages/reporter/src/render-perf.js";
  import type { BenchResult } from "@bench/result-schema";
  // reuse the test's fakeResult shape; build 3 rows: normal, amber (meanImprecise), fail
  const base = (over: Partial<BenchResult["benchmark"]>, wm: number, env: string): BenchResult => ({
      schemaVersion: 2, timestamp: "2026-07-02T00:00:00.000Z",
      machine: { os: "linux", cpu: "x", memoryGb: 32 },
      env: { kind: "node", name: env, version: "v22", engine: "V8" },
      benchmark: { id: "hashmap_string", inputSize: "L", fixtureBytes: 0, fixtureSha256: "x".repeat(64), language: "rust", toolchain: "raw", profile: "speed", postprocess: [], ...over },
      artifacts: { wasmRawBytes: 0, wasmGzipBytes: 0, wasmBrotliBytes: 0, jsGlueRawBytes: 0, jsGlueGzipBytes: 0, totalTransferGzipBytes: 0, artifactHash: `sha256:${"a".repeat(64)}` },
      timingsMs: { fetch: 0, compile: 0, instantiate: 0, initTotal: 3, firstCall: 0.1, warmMedian: wm, warmP95: wm * 1.4, warmP99: wm * 1.6, warmStddev: 0.05, warmMin: wm * 0.9, warmMax: wm * 1.6, warmMad: 0.01, endToEndMedian: wm },
      memory: { wasmMemoryBytesPeak: 0, wasmMemoryDeltaBytes: 0, jsHeapUsedAfter: null },
      stats: { nSamples: 30, cv: 0.05, relSem: 0.02, meanImprecise: false, subResolution: false },
      quality: { checksum: 0, validated: true, correctnessFailed: false },
      notes: { streamingInstantiation: false, worker: true, wasmFeatures: [] },
  });
  const rows = [base({}, 0.014, "node"), base({ toolchain: "bindgen" }, 0.02, "node"), base({ language: "cpp", toolchain: "emscripten" }, 0.019, "firefox")];
  rows[1]!.quality.correctnessFailed = true;      // red
  rows[2]!.stats.meanImprecise = true;            // amber
  rows[2]!.stats.subResolution = true;            // <res
  const html = `<!doctype html><meta charset="utf-8"><style>${PERF_CSS}</style>${renderPerfView(aggregate(rows))}`;
  writeFileSync("scratchpad/perf-preview.html", html);
  console.log("wrote scratchpad/perf-preview.html");
  ```
  Run (tsx binds a pipe → sandbox disabled): `pnpm tsx scratchpad/preview.mts && open scratchpad/perf-preview.html`

  Confirm by eye: (a) the legend sits on its own row **below** the size/profile controls in the tray; (b) the glossary callout renders **open** at the top of the body with the three group labels and all metric rows; (c) the amber/red rows and `<res` badge in the detail table match the legend's colours.

- [ ] **Step 3: Clean up the scratch preview**

```bash
rm -f scratchpad/preview.mts scratchpad/perf-preview.html
```

(Scratch files live under the session scratchpad; nothing to commit.)

---

## Execution Protocol

### Hybrid routing map

| Task | Route | Reason |
|---|---|---|
| 1 — Tray legend | `[I]` inline | Small, single-file presenter edit with high context locality; TDD loop is fast. |
| 2 — Glossary callout | `[I]` inline | Same file as Task 1, static copy already fixed in spec; no research needed. |
| 3 — Roadmap housekeeping | `[I]` inline | Two-line doc deletion. |
| 4 — Full-gate + visual verify | `[I]` inline | Requires running gates + eyeballing rendered HTML in this session. |

All-`[I]` ⇒ execute inline (per `docs/workflow.md`, do NOT re-ask the harness). Use `superpowers:executing-plans` (batch with checkpoints) rather than subagent dispatch — the whole plan is one small file plus a doc edit.

### Static break-points

Single short session — the entire plan is a presenter-only change plus a doc edit. Recommend `/finish-session` **once, after Task 4 passes and the branch is pushed / PR opened** (Phase 7 close-out). No mid-plan break needed.

### Per-task break-check

After each task's commit, apply the standing Break-thresholds rule from `docs/workflow.md`: if the gate set is red twice on the same approach, or a task uncovers spec drift (e.g. the tray legend does not wrap as designed and needs a tray restructure), STOP and surface to the user with options rather than improvising.

## Self-Review

- **Spec coverage:** legend (spec §Design.1) → Task 1; glossary callout (spec §Design.2) → Task 2; verbatim copy (spec §Final copy) → Tasks 1–2 code; integration points (spec §Integration) → Tasks 1–2; testing (spec §Testing) → Tasks 1, 2 tests + Task 4 gates; housekeeping roadmap prune (spec §Housekeeping) → Task 3; visual check (iterate Phase 7) → Task 4. No gaps.
- **Placeholder scan:** none — all steps carry real code/commands.
- **Type consistency:** helpers `renderPerfLegend()` / `renderPerfGuide()` are referenced in `renderPerfView` exactly as defined; CSS class names (`perf-legend`, `pl-key`, `pl-sw`, `pl-badge`, `perf-guide`, `pg-in`, `grp-lab`, `gl2`) match between CSS, helper markup, and test assertions.
