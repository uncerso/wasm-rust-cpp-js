# Pitfalls — reporter visual redesign execution (2026-06-26)

## Process

### Per-task tests verified units in isolation; the integration seam shipped broken

**What happened.** The redesign split the Perf tab across three subagent tasks (small-multiples,
detail table, shape heatmap). Each task created `PERF_CSS` in `render-perf.ts` and added per-task tests
asserting `renderPerfView()`'s *markup* (class names) in isolation — all green (42/42). But nobody wired
`PERF_CSS` into the assembled document: `render.ts`'s `<style>` block concatenated only
`SHELL_CSS + SHELL_LOCAL_CSS + SIZE_CSS`. The entire Perf tab — small-multiples bars, data-bar detail
table, hatching, segmented controls, shape heatmap — shipped with **zero CSS**. The green suite could not
see it because no test asserted that `renderHtml()` (the integration point) injects `PERF_CSS`. The
controller's own structural greps also missed it (they checked classes-in-markup + rules-in-source, never
`<style>` in the generated HTML). It was caught only by the final whole-branch review (commit `c51792c`).

**Root cause.** When a feature is decomposed so that separate tasks own separate *pieces* of one rendered
artifact (a CSS export, a JS export, the markup that uses them), each task's unit test naturally covers
only its own piece. The wiring that joins the pieces in the assembled output is owned by no single task,
so no per-task test asserts it — a structural blind spot that green gates actively disguise.

**Prevention.** When splitting a feature across tasks this way, the controller adds an **integration-seam
test on the assembled output**, not just per-unit markup: assert a sentinel from each contributing piece
reaches the final artifact (here: a CSS-only fragment like `repeating-linear-gradient` / `.em-trk` reaching
`renderHtml()`'s `<style>`). This now lives as a regression test in `packages/reporter/tests/render.test.ts`
("wires every view's CSS into the shell `<style>`"). Generalised: a all-green per-task suite is necessary
but not sufficient — the final whole-branch review (or an explicit seam test) is load-bearing precisely
because it sees the assembled whole that unit tests never exercise. See also
`docs/pitfalls/2026-06-22-phase-1-3-close-out-visual-deliverable.md` (gates don't catch render regressions).
