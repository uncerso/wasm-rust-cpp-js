# Session state — 2026-05-26 Phase 1.1.2.1 closed

Phase 1.1.2.1 (bench-infra hardening + cross-runtime guidelines refresh) merged
on master. Next: Phase 1.1.3 (shape_dispatch) brainstorm.

## TL;DR

- Master HEAD: `5f76caf` (tag `phase-1-1-2-1` placed; pending push).
- `pnpm bench:all` reliable end-to-end на full Phase 1.1.x matrix
  (630 cases — 210 per env × 3 envs, eval mode, 0 failures).
- One long-lived browser session per env; retry-once-with-relaunch recovery;
  `--restart-every=N` hedge knob; `--benchmarks=<csv>` filter.
- `docs/guidelines.md` refined:
  - Hashmap claim split into 2: V8 (Node + Chromium) confirmed cross-runtime;
    Firefox tentative (inverted pattern — JS wins u64, Rust/CPP win string).
  - wasm-bindgen overhead claim: tentative → confirmed (direction consistent
    9/9 cross-runtime; magnitude +3% .. +94%, median ~+20%).
- `docs/tech_debt/chromedriver-session-retry.md` — deleted (resolved).
- `docs/tech_debt/firefox-emscripten-noop-5x-slowdown.md` — deleted (resolved;
  5× artifact gone в new long-lived session methodology).
- `docs/roadmap.md`: browser-driver-lifecycle-refactor retired;
  shape-dispatch entry expanded с 1.1.3 design direction sketch.
- Canonical results: `results/raw/2026-05-26-phase-1-1-2-1/` (630 JSON, gitignored
  per repo policy — paths referenced в guidelines.md как evidence).
- Gates green: typecheck + lint:all + test (40 tests across 5 packages) + smoke
  (90 results node-all + matmul × chromium+firefox).

## What the next session needs

- **Phase 1.1.3 brainstorm:** design shape_dispatch workload (substantial body,
  monomorphization bundle trade-off vs vtable indirection, JS path measures
  V8 IC state behavior). Predecessor design в `docs/roadmap.md` § Phase 1.1 >
  Workloads > shape-dispatch.
- **Canonical Phase 1.1.x results:** `results/raw/2026-05-26-phase-1-1-2-1/`
  (630 cases — local only, gitignored).
- **Updated guidelines:** `docs/guidelines.md` — 4 claims в § Toolchain choice
  (V8 hashmap, Firefox hashmap, wasm-bindgen overhead, thread_local→SyncCell).

## Done in this session

### W1 — driver refactor + recovery + tests (commits 15db30d..e8d9e74)

10 tasks; merge `e8d9e74` to master. Major decisions:

- `apps/runner-web/src/driver.ts` exports `createDriverSession`/`runCase`/`quit`
  module API; CLI main() — thin wrapper над module. Entry-point guard
  `if (argv[1] === __filename)` (без него vitest import триггерил CLI).
- `apps/runner-web/src/run-case-with-retry.ts` — unified retry-once-with-relaunch
  helper для per-case errors AND session crashes (Selenium error distinction
  unreliable). 4 unit tests (mock-based, deterministic).
- `apps/runner-web/tests/driver-quit-timeout.test.ts` — 3 tests для quitWithTimeout
  helper (resolves quick, resolves on hang via timeout, swallows rejection).
- `scripts/run-matrix.ts` — split node/browser loops; per-env long-lived session;
  retry integration; 3-consecutive-failures abort per env; `failures.txt`
  summary; `--restart-every=N` knob; `--benchmarks=<csv>` filter. Cross-workspace
  import к `apps/runner-web/src/driver.js` работает напрямую (moduleResolution:
  Bundler, no tsconfig.json edits required).
- Smoke extended: matmul × all combos × node + chromium + firefox = 90 results
  (was 70), total ~30s (well under 90s budget).
- README documents `--benchmarks`, `--restart-every`, long-lived session lifecycle.

Plan deviations (preserved):
- vitest `--passWithNoTests` (intermediate empty test state between Task 1 и 4).
- eslint test override: `@typescript-eslint/unbound-method: off` (vitest mock pattern).
- runner-web tsconfig.json: include `tests/**/*` для eslint project service.
- Stub createDriverSession: dropped `async` chimes from "throws" pattern to avoid
  `require-await` lint; passed args через error message для no-unused-vars.

### W2 — full Phase 1.1.x re-bench (commits 5b8ab24..)

- Pre-bench housekeeping: cleared 3.1 GB / 736 leaked Chromium tmp dirs from prior sessions.
- `pnpm bench:all` (sizes=S,M,L × envs=node,chromium,firefox × mode=eval):
  - **630 cases** (210 per env × 3 envs). Plan predicted 810; actual math
    suggests 210/env was correct (matmul 1×10×3 + interop 3×10×3 + 2 hashmap workloads × 3×5×3 = 210).
  - **0 failures** (no `failures.txt`).
  - Total time ~50 min (within plan estimate 40-60 min).
- Sanity-diff vs Phase 1.1.2 baseline — **skipped**: `results/raw/2026-05-23T01-51-06Z/`
  не доступен на этой машине (`results/` gitignored, baseline был только локально
  на прошлой машине session'а). Primary success signal: 0 failures + reporter
  rendered 630 results без errors.
- Canonical rename: `results/raw/2026-05-26-phase-1-1-2-1/`. Per repo convention
  `results/` gitignored — пути referenced в guidelines.md как evidence без commit.

### W3 — guidelines harvest + close (commits 5b8ab24, b81f196, cc039e8, 5f76caf, this commit)

| commit | what |
|---|---|
| `5b8ab24` | retire chromedriver-session-retry tech-debt + roadmap entry |
| `b81f196` | capture 1.1.3 shape-dispatch design direction sketch в roadmap |
| `cc039e8` | guidelines: hashmap claim split → V8 confirmed + Firefox tentative |
| `5f76caf` | guidelines: bindgen overhead confirmed cross-runtime; ff-emscripten tech-debt deleted |
| (this)   | session-state snapshot + tag |

Cross-runtime patterns measured:

**Hashmap lookup (u64 vs string)**:
- V8 (Node + Chromium): rust/bindgen wins u64 (~2-3× over cpp, ~3-4× over JS);
  JS wins strings (~2× over rust/cpp). Confirmed across 2 envs × 2 sizes × 2 key types.
- Firefox M: **inverted** — JS wins u64 (0.06 vs rust 0.08); rust/cpp win string
  (0.24 vs JS 0.64). Firefox S sub-resolution (performance.now() ~20µs).

**wasm-bindgen overhead (interop_calls × 3 entries × 3 envs)**:
- Direction raw < bindgen consistent на 9/9 (env, entry) pairs.
- Magnitude +3% .. +94% (Chromium add_i32 outlier; median ~+20%).
- Phase 1.1.1 noop firefox 11 ms cpp-emscripten artifact GONE в 1.1.2.1 —
  likely artifact prior per-case driver spawn methodology.

## Deferred items

- **Push to origin:** master ahead by N commits включая phase tag. Не push'нуто
  (per convention agentic commits stay local пока user не review'нет).
- **Phase 1.1.3 brainstorm:** отдельная session.
- **Random untracked files:** `.claude/settings.local.json` (gitignored config) +
  `"Какие есть существующие бенчмарки wasm под браузер.md"` (random user file
  с прошлых session'ов) — не trogano.

## Workflow notes

- `--no-gpg-sign` на коммитах per repo директива.
- Sandbox: для tsx subprocess — `dangerouslyDisableSandbox: true`. /tmp denied
  в sandbox; use `$TMPDIR` ($TMPDIR=/var/folders/... outside sandbox vs
  $TMPDIR=/tmp/claude-501 inside; пути не совпадают).
- Pipe exit codes для gate chains — use `set -o pipefail` или капчуйте
  `${PIPESTATUS[0]}`, не полагайтесь на `cmd 2>&1 | tail`.
- Background long-running tasks (bench:all 40-60 min) — `run_in_background: true`,
  не sleep/poll, использовать time-of-completion notification.

## Полезные команды

```bash
# Где мы
git rev-parse HEAD                           # 5f76caf (+ session-state commit + tag)
git tag | grep phase-1-1-2-1                 # phase-1-1-2-1
git log --oneline -15                         # recent commits

# Phase 1.1.2.1 results (local only)
ls results/raw/2026-05-26-phase-1-1-2-1/ | wc -l    # 630
test -f results/raw/2026-05-26-phase-1-1-2-1/failures.txt || echo "clean"

# Reporter HTML
open results/summarized/_1-1-2-1/index.html

# Pre-flight (master green check)
pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke

# Phase 1.1.3 brainstorm prep
cat docs/roadmap.md   # § Phase 1.1 > Workloads > shape-dispatch (expanded)
```

## Stop point

- Phase 1.1.2.1 — **closed** (gates green, tag pending, 630-case dataset
  refreshes 2 guidelines claims + retires 2 tech-debt items).
- Phase 1.1.3 — **sketch captured** (roadmap), brainstorm pending.
