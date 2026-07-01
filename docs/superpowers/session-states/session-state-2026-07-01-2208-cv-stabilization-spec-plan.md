# Session state — CV stabilization: spec redesigned + plan written

## TL;DR
- HEAD: `8af41c4` (plan) on branch `feature/benchmark-cv-stabilization` (not pushed).
- Status: spec + plan committed, docs-only. **No code changed** — implementation not started.
- Prior on branch: `ae35b4d` (redesigned spec), `cd20f2a` (original batching spec, superseded).

## What the next session needs
- Execute `docs/superpowers/plans/2026-07-01-benchmark-cv-stabilization.md` — 9 tasks,
  all `[I]` inline, TDD, 4 waves. Break-point after Wave 2 (schema+assemblers+config,
  first end-to-end `build:all && smoke`).
- The design in one line: replace the CV-of-spread acceptance gate with an SEM-of-mean
  gate (`relSem = cv/√n ≤ 3%`), report variance (median+MAD) as a finding not a failure,
  flag sub-resolution cells, and give the reporter a stable canonical `IMPL_ORDER`
  (js→rust→cpp). No batching. Rationale + measured timer facts are in the spec.

## Deferred / open-loops
- **Re-bench** (heavy full run — user action) AFTER implementation: needed to confirm the
  offline projection (47% CV-flagged → ~16% at 3% SEM, converging to ~8% sub-resolution
  floor with raised maxSamples) on live data, and to fill the **quantitative** guideline
  numbers. Plan Task 9 deliberately ships only *qualitative* guidelines pre-re-bench.
- **Post-implementation check** (spec § "Why semThreshold = 3%"): confirm 3% is adequate
  (intended toolchain gaps distinguishable, runtime acceptable); revisit by discussion,
  not a silent change. `relSem` is stored per cell to assess this from data.
- **Schema break:** plan bumps `SCHEMA_VERSION` 1→2 → reporter will reject existing v1
  `results/raw/` JSON; the re-bench regenerates them (expected, per spec).
- Two capture markers dropped as redundant (spec/plan already cover them):
  `inneriterations-selection`, `cv-spread-vs-sem-of-mean`.

## Resume
```
# route via the pipeline (Phase 0 → CONTINUE: reads the in-flight plan's unchecked tasks)
/iterate
# or directly:
#   read docs/superpowers/plans/2026-07-01-benchmark-cv-stabilization.md
#   Wave-0 baseline gate (sandbox-OK):
pnpm typecheck && pnpm lint:all && pnpm test
#   then Task 1 (harness stats: mad + relSem)
# build:all / smoke need dangerouslyDisableSandbox: true (tsx pipe)
```

## Stop point
Spec (`ae35b4d`) + plan (`8af41c4`) committed on `feature/benchmark-cv-stabilization`.
Also this session (uncommitted): `docs/pitfalls/2026-07-01-spec-premises-unmeasured.md`
+ one-line addition to `.claude/skills/iterate/SKILL.md` Design phase. Push + PR are the
user's action.
