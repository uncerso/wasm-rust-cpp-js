# Verification and Run Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standard checks cover root code, and each new result contains the complete metadata needed to generate its report independently of `dist`.

**Architecture:** First close the verification gap so new report CLI tests enter the normal gate. Then replace the v2 artifact projection with canonical `ArtifactMeta` in schema v3, capture it in both runners, and collect report sizes exclusively from those results.

**Tech Stack:** Existing TypeScript, Zod, Vitest, pnpm, Node and Selenium; no new dependencies.

**Spec:** [2026-10-09-verification-and-run-metadata-design.md](../specs/2026-10-09-verification-and-run-metadata-design.md)

## Global Constraints

- No legacy raw-result migration or fallback to `dist`; existing HTML is standalone.
- No fixture/binary archives, timing-loop changes, dependency upgrades, new workload, or automatic deletion of existing results.
- Strict bitwise checksums and subprocess/worker isolation remain unchanged.
- Schema changes belong to `packages/result-schema`; version becomes 3.
- Commit with `--no-gpg-sign`; push and PR are user actions. No session-state handoff.
- Use the prepared `feature/verification-and-run-metadata` checkout, based on `80febac`; preserve unrelated work.

## Execution Protocol

- Task 1 `[I]`: package scripts, discovery config and type-only fixes share one small context.
- Task 2 `[I]`: schema, both writers and report reader must move together; keep this single interface change inline.
- One independent whole-branch review follows both tasks and final validation. No per-task implementer agents.
- Static break-points: after planning and after Task 1, recommend `/finish-session` only if a break is useful; the user has requested continuing here without session transfer.
- Per-task break-check: below roughly 1/4 of context continue; around 1/3 recommend a break at an independent boundary; at 1/2 or after compaction pause at the next independent boundary. Never stop halfway through a file.
- Ledger: `.superpowers/sdd/2026-10-09-verification-and-run-metadata/progress.md`. Baseline logs: `.superpowers/verification-run-metadata-20261009/` (local, generated and gitignored).

## Review Focus

- Parity imports must not force weaker root type checking or change emitted benchmark JS.
- Full metadata must survive both worker transport and Zod parsing, including glue and composition.
- Repeated entries/sizes/environments refer to one Size row, while conflicting metadata fails rather than winning by file order.
- An absent or unrelated `dist` cannot change HTML size data; old-format input must fail before HTML is written.

### Task 1: Complete standard verification coverage

**Files:** Modify `package.json`, `tsconfig.json`, `benches/common/fixtures.test.ts`, both `benches/sorted_map_int/js/{idiomatic,typed-array}/{tsconfig.json,src/index.ts}`, and README verification guidance. Create `vitest.root.config.ts`. Remove the two resolved verification debt files and their live roadmap links.

**Interfaces:** `pnpm typecheck:root` runs `tsc --noEmit -p tsconfig.json`; `pnpm test:root` runs `vitest run --config vitest.root.config.ts`. Standard `typecheck` and `test` include them and retain all existing checks.

- [ ] Confirm baseline evidence at `80febac`: all five existing gates passed; omitted root tsc failed with 17 errors. Preserve pre-edit sorted-map emitted JS for comparison.
- [ ] Add the explicit root Vitest includes from the spec and include its config in root tsc. Wire both root scripts into standard commands.
- [ ] Fix only the exposed indexed reads using non-null assertions as in sorted-map reference code. Remove the two sorted-map `noUncheckedIndexedAccess: false` overrides.
- [ ] Run `pnpm typecheck`, `pnpm test:root`, and `pnpm lint:ts`. Expected: no type/lint errors; fixtures, shape reference, sorted-map reference/parity and pool suites are collected. Existing lint warnings may remain.
- [ ] Use a temporary failing root test to prove `pnpm test` propagates its failure, then remove only that probe. Compare esbuild output for sorted-map with preserved baseline bytes; expected identical.
- [ ] Document the added coverage, remove resolved debt records, commit, then run `task-done ... 1 BASE -- pnpm test`. Expected: all workspace, root and marker tests pass.

### Task 2: Capture complete metadata and report from it

**Files:** Create `packages/result-schema/src/dimensions.ts` and `scripts/report.test.ts`. Modify `packages/result-schema/src/{schema,artifact-meta,version}.ts`, schema tests, `apps/runner-node/src/run-case.ts`, `apps/runner-web/src/{worker,driver}.ts`, `scripts/report.ts`, four reporter result fixtures, README, AGENTS.md, the main design's result example, and the snapshot roadmap item.

**Interfaces:** `BenchResult.artifacts: ArtifactMeta` is required under schema v3. Existing language/toolchain/profile exports remain available through `schema.ts`. `buildSizeData(ArtifactMeta[])`, `aggregate(BenchResult[])`, and `renderHtml` remain unchanged. Report CLI loses `--dist` and rejects its use explicitly.

- [ ] Add schema regression cases before implementation: full metadata survives parsing; missing metadata, v2 input, invalid artifact hash, missing primary artifact, and metadata dimension mismatch fail. Run result-schema tests and observe the expected failures against v2.
- [ ] Add actual CLI tests with self-contained temporary result directories: without `dist`, unrelated `dist`, identical metadata across entries/size/env (one binary row), changed main hash/glue hash/composition (error, no HTML), metadata key-order difference (accepted), old/missing metadata and `--dist` (error). Assert actual generated Size bytes and a Perf value. Run and observe failure before the report change; no production seam solely for tests.
- [ ] Move shared dimension enums to break the import cycle, replace `ArtifactsSchema` with `ArtifactMetaSchema`, bump the version, and retain boundary validation described in spec § Decisions 7. Update existing result fixtures for v3.
- [ ] Replace runner-local metadata interfaces and flattened projections with the canonical parsed metadata. Remove obsolete hash-prefix helpers. Both writers continue using existing JSON output paths; have the browser encode the result as JSON before WebDriver transport to preserve exact doubles (verified smoke regression and native probe).
- [ ] Delete report `dist` scanning. Parse all input results, collect metadata by binary combination with `isDeepStrictEqual`, reject conflicting values, and render only after validation succeeds.
- [ ] Run focused schema and root CLI tests. Expected: all new cases pass; no filesystem access to `dist` is needed by reporting.
- [ ] Update README and the canonical design's result example; remove resolved snapshot roadmap item. Check all current consumers via repository search; leave separate loader byte-count contracts untouched.
- [ ] Run `pnpm build:all`, `pnpm typecheck`, `pnpm lint:all`, `pnpm smoke`, and at least one Node eval case per workload. Expected: all pass with validated schema-v3 results; inspect Node/Chromium/Firefox metadata against build meta. The changed surface is serialization/report input across every artifact family; no performance improvement is claimed.
- [ ] Generate a report from copied real result JSON with an empty working-directory `dist`, inspect Size and Perf in a browser, and retain screenshots. Expected: both tabs render real data, with no console errors or missing size rows.
- [ ] Commit and run `task-done ... 2 BASE -- pnpm test`. Expected: full standard tests pass. Request independent whole-branch review, fix any material in-scope findings and revalidate affected claims.

## Self-review and coverage

Spec decisions 1–2 fire through Task 1's package scripts; 3–4 and 7 through Task 2's schema and runner parsing; 5–6 through report CLI. Task 1 supplies the test gate used by Task 2. Its signatures match the plan's commands; no cross-task production API is introduced.

All shared-shape consumers were searched: node run-case, web worker/driver/page, report CLI, result-schema tests and reporter fixtures in `aggregate`, `render`, `render-perf`, and `perf-view-model`. README and the main design contain user-facing descriptions. Loader `wasmRawBytes` is unrelated to `BenchResult.artifacts`.

Validation checklist: confirm the tested commit/tree, complete task checkboxes from observed evidence, inspect final status/diff, retain review verdict, and hand off the branch plus PR text without pushing.
