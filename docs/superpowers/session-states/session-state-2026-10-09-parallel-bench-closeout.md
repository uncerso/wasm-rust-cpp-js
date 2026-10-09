# Session state — parallel-bench closeout, visual gate pending

## Current state

- Branch: `feature/phase-1.2-parallel-bench`. Production code validated at `4a61dea`.
- Continue Task 9 of `docs/superpowers/plans/2026-07-12-parallel-bench-execution.md`. The plan's unchecked boxes are stale; completed implementation is recorded in the August session-state, git history, and `.superpowers/sdd/progress.md`.
- Slice A is implemented with the accepted A1 adaptation and A2 revert. It is **not yet closed**: the mandatory visual check remains pending. Push, PR creation, and merge have not been performed.
- Pre-existing `.agents/` and `AGENTS.md` remain outside this delivery.

## Verification on 2026-10-09

- `pnpm build:all`, `pnpm typecheck`, `pnpm lint:all`, `pnpm test`, and `pnpm smoke`: exit 0.
- Lint: zero errors, 30 warnings. Standard tests: 144 passed; separate `scripts/lib/pool.test.ts`: 5 passed.
- Smoke: 179 validated results, all `env.parallel=false`.
- Scoped `matmul/S/quick` run with `--parallel-envs`: 30 validated results, 10 each in Node, Chromium, and Firefox; all `env.parallel=true`.
- The real parallel report was generated successfully. The prepared `scan-markers.mjs` change passed a temporary transcript check for plain, inline-code, and fenced markers (3/3).
- No new runtime changes were made during closeout. Historical build speedup (115.86 → 54.63 s, 2.12×) and 119 matching artifact hashes come from the implementation session; they were not remeasured here. Full machine-quiet `pnpm bench:all` remains a user action under Task 9.

Local, gitignored evidence: `.superpowers/sdd/parallel-bench-closeout-20261009/evidence.md`, `checks.json`, logs, source snapshot, PR draft, and `report/index.html`. These are retained local artifacts, not files available in a fresh checkout.

## Independent review

Final whole-branch review covered `bc5da96..4a61dea`, prepared unstaged changes, and the two August closeout documents. The reviewer verified all 34 source snapshot entries, including file modes.

- Requirements: met with the previously accepted A1/A2 deviations; visual QA unverified.
- Code quality: approved; no Critical or Important findings in the reviewed Slice A scope.
- Minor: an unexpected browser-stream rejection can stop shared Vite before sibling streams finish cleanup and skip `failures.txt`. The cleanup gap predates this work; concurrent sibling exposure is added by this slice. Surviving OS processes were not reproduced.
- Minor: an outer build `Promise.all` rejection reaches `process.exit(1)` before the other build stream drains. This is new behavior on an already failing build, not a false-success path.

Both minor observations remain deferred. Automatic separation of mixed sequential/parallel comparisons is optional in the spec; the required detail badge is implemented.

## Spec coverage and next step

- A1: fixture generation and JS/C++ jobs use a bounded pool; Rust runs as one serial stream alongside it because concurrent wasm-pack installation races. Previously user-approved.
- A2: deliberately reverted in `4a61dea`; subprocess isolation preserves init/memory semantics. Follow-up remains in roadmap `in-process-node-runner`.
- A3: opt-in concurrent environments, additive `env.parallel`, reporter badge, README, and measurement guideline are implemented. Sequential remains the default.
- Slice B / Mandelbrot: not started; separate branch after Slice A merges.

The visual gate requires opening the report and inspecting the badge and legend. CUA returned `No browser is available`; its inventory was `apps=[]`, `browsers=[]`. HTML tests and successful report generation do not satisfy this gate. Resolve browser access or obtain an explicit user decision on another viewing method before declaring the iteration closed.

After the visual gate, hand off the branch for the user's push and PR. Do not auto-run `/finish-session`.

## Agreed work after this iteration

The user explicitly accepted these three findings on 2026-10-09 and requested finishing the current iteration first. They are also saved in Codex memory:

1. Separate exact integer checksum validation from permitted floating-point tolerance. `hashmap_int_lookup/L` currently accepts an error of +100000 under the common relative tolerance.
2. Preserve immutable build/artifact metadata with each benchmark run and bind historical reports to that snapshot. Current reporting can combine old runtime data with current `dist` size data.
3. Complete standard verification coverage. Root `tsconfig.json` is omitted by `pnpm typecheck`; its direct check currently produces 17 errors, partly due to different indexed-access settings. Fixture/reference/parity tests and the pool suite are outside `pnpm test`.

These pre-existing issues were not fixed or reported as passing during this closeout.
