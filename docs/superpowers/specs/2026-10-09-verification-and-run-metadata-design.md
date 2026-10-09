# Complete verification and self-contained run metadata

## Outcome and scope

The user selected both deferred fixes: standard commands must cover the root TypeScript project and existing non-workspace tests; reports must take artifact sizes from the measured run. On 2026-10-09 the user explicitly rejected compatibility with old raw results. Generated HTML is already standalone; raw JSON is disposable after reporting.

No fixture or binary archives, legacy migration, dependency upgrades, timing-loop changes, new workload, automatic deletion of existing results, or session handoff files belong to this iteration.

## Verified baseline

At `80febac`, the worktree was clean. `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke` passed: 166 workspace tests, 3 marker tests, 179 smoke results; lint had 0 errors and 30 existing warnings. Logs are retained locally in `.superpowers/verification-run-metadata-20261009/` (generated, gitignored evidence).

The omitted `pnpm exec tsc --noEmit -p tsconfig.json` failed with 17 errors. One fixture-test read lacks a bounds assertion. The other 16 come from the sorted-map parity test importing implementations whose package configs disable `noUncheckedIndexedAccess`, while the root config enables it. Reference code already uses non-null assertions for the same bounded reads.

## Decisions

1. `pnpm typecheck` runs recursive package checks and the root project. `pnpm test` runs the existing workspace and marker suites plus a root Vitest config covering `scripts/**/*.test.ts`, `benches/common/**/*.test.ts`, and `benches/*/validate/**/*.test.ts`. The explicit config name avoids changing package-local Vitest discovery.
2. Fix the exposed reads with type-only assertions and enable indexed-access checking in the two sorted-map packages. Preserve emitted JS and strict checksum behavior. No runtime guards enter the measured loops.
3. Bump `BenchResult` to schema version 3. Replace its flattened `artifacts` projection with the full `ArtifactMeta` value: binary combination, wasm/JS module/glue stats and SHA-256 hashes, total gzip bytes, detected tool versions, and size composition. Reuse the canonical schema; do not duplicate these fields in another snapshot.
4. Node and web workers already read `meta.json` before loading a case. Validate that value and put it into the result. Individual CLI runs, matrix runs, retries, and browser transport therefore use the same format without new orchestration state or sidecar writes. Metadata describes the build read for the case; concurrent rebuilding during measurement remains unsupported.
5. The reporter reads only result JSON. Deduplicate identical metadata by `(source workload, language, toolchain, profile)` across entries, sizes and environments; reject conflicting metadata for that combination rather than choose a size arbitrarily. Deep equality must ignore object-key order. Include only combinations present in the run.
6. Remove `--dist` as an input to reporting, with an explicit error if supplied. Reject older or incomplete results through the versioned schema; do not infer missing metadata, read current `dist`, or add a migration path. Invalid/conflicting input must fail before writing HTML.
7. Preserve validation of SHA-256 syntax and require the primary artifact for the result's language. Match metadata language/toolchain/profile to the corresponding benchmark fields. Workload ID in metadata identifies the binary, while `benchmark.id` identifies an entry and need not equal it.

## Structure and alternatives

| Approach | Effect | Decision |
| --- | --- | --- |
| Full metadata in each result | Existing runner-to-JSON path owns the snapshot; individual files remain self-contained | Selected; modest repeated JSON is acceptable |
| One sidecar manifest per run | Less duplication but requires coordinated writes and handling interrupted/parallel runs and standalone runners | Unnecessary lifecycle complexity |
| Archive the complete `dist` | Can rerun old binaries but retains fixtures and binaries beyond reporting needs | Outside requested scope |

`packages/result-schema` owns the format and validation. A small `dimensions.ts` holds language/toolchain/profile enums to avoid a schema↔artifact-meta import cycle; existing exports remain reachable through `schema.ts`. Runners depend on these schemas. `scripts/report.ts` owns file I/O and metadata conflict checks, then feeds existing `buildSizeData`, `aggregate`, and `renderHtml`. Rendering and measurement APIs remain unchanged.

Dangerous transition: after a run, `dist` is rebuilt or deleted. Its saved JSON continues to produce the same Size values because report code no longer opens `dist`. Mixed build metadata in one input directory fails explicitly. A failed run can still leave partial result files as today; reporting validates every file it receives.

## Validation and firing surfaces

- `package.json` activates the added root checks in the documented all-gates command. Inventory the collected suites and prove a temporary failing root test reaches the standard command; remove the probe afterward.
- Root typecheck reproduces the 17 failures before the fix and passes afterward. Compare generated sorted-map JS bytes before/after the type-only edits.
- Schema tests pin metadata retention, required fields, old-version rejection, hashes, and dimension consistency. CLI tests generate actual HTML from controlled results without `dist`, with an unrelated `dist`, with repeated metadata, and with conflicting builds or removed `--dist` input.
- Run all gates after implementation, plus at least one eval case per workload. Smoke covers Node's complete S matrix and matmul in Chromium/Firefox. Check real output metadata against build metadata outside the measurement path.
- Open and inspect the generated report's Size and Perf tabs. Keep captured command output and review evidence locally; do not create a session-state document.
- Update README commands/report-format guidance, remove the two resolved verification debt files and the resolved snapshot roadmap item. Historical plans/session records remain historical.

Self-review: both selected outcomes are covered. No legacy compatibility or artifact storage is implied. Current consumers were enumerated across runners, schema tests, report CLI, aggregation, and four reporter fixtures; loader `wasmRawBytes` fields are a separate contract and remain unchanged.
