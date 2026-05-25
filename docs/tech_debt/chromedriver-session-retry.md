---
id: chromedriver-session-retry
title: Bench-runner architecture leaks chrome state — refactor to long-lived per-env driver
created: 2026-05-23
updated: 2026-05-26
source: docs/pitfalls/2026-05-23-phase-1-1-2-execution.md § Tooling
category: process-gap
status: deferred-to-roadmap
priority: medium
---

## What

`pnpm bench:all` падает mid-run на `SessionNotCreatedError: session not created from
chrome not reachable` после нескольких десятков successful browser cases (Phase 1.1.2
Wave 3: 334 results written до crash в чекпойнте `interop_calls_add_i32__cpp-wasi-sdk-speed__M__chromium`,
~85 chromium sessions в run'е). Failure not workload-specific; chromedriver / chrome
process state degrades across cumulative sessions.

Текущее поведение: bench-runner получает error, exit code 1, ELIFECYCLE, full run
aborted. Все subsequent cases (matmul / browsers tail end) теряются.

## Why it matters

- **Reliability:** full bench:all matrix unreliable для phase-close measurements.
  Каждый chromedriver crash требует manual intervention.
- **Phase 1.1.2 evidence-base incomplete:** browser data (chromium, firefox) для
  hashmap workloads не captured. Эти guidelines (`docs/guidelines.md` § Toolchain choice
  > Rust HashMap / JS Map cross-key-type) пока confirmed только на Node — browser-side
  confirmation deferred.
- **Symptom of accumulation:** долгие automation sessions exhaust chromedriver state.
  Будущие phase'ы с большим matrix'ом (Phase 1.1.3 shape_dispatch добавит 2 binaries
  × все 6 toolchains) пострадают сильнее.

## Investigation 2026-05-26 — findings

### Leaked chrome user-data-dirs (smoking gun)

В `$TMPDIR` накопилось **365 `org.chromium.Chromium.scoped_dir.*` директорий, total
~3.1 GB**. Это chrome user-data-dirs от сессий, где `driver.quit()` упал и был silently
проглочен `.catch(() => { /* best effort */ })` в `apps/runner-web/src/driver.ts:177`.

```bash
ls -d $TMPDIR/org.chromium.Chromium.scoped_dir.* | wc -l    # 365
du -shc $TMPDIR/org.chromium.Chromium.scoped_dir.*           # 3.1G total
```

Это не *причина* первого crash'а, но *симптом*: что-то регулярно ломается до или во время
cleanup'а на длинных runs.

### Architecture diagnosis

- `scripts/run-matrix.ts` спавнит fresh `tsx apps/runner-web/src/driver.ts` subprocess
  per case (per binary × entry × size × env).
- `driver.ts` создаёт fresh `chrome.ServiceBuilder(paths.chromedriver).build()` per
  invocation → fresh chromedriver process + fresh chrome process + temp user-data-dir.
- В `finally`: `await driver?.quit().catch(() => {})` — silently swallow.
- Если quit падает (race с chrome crash, network timeout к chromedriver), temp dir leak.
- Один WebDriver session per case ⇒ кумулятивные spawns ~80-100+ chromium sessions
  на full bench:all run.

### Не constraint

- FD ulimit 1M на этой машине.
- Disk: 429 GB free.
- Активные chrome/chromedriver processes: 0 в idle state (zombie аккумуляция отсутствует
  по факту проверки в момент investigation).

### Кандидаты в root cause первого SessionNotCreatedError (не верифицированы live —
требует ~80-100 sessions sequential, не делалось в investigation session)

1. **Cumulative system-level state**: macOS Mach ports, listening sockets, GPU contexts
   accumulate across many headless Chrome launches.
2. **chromedriver port pool**: каждый chromedriver слушает свой ephemeral port; macOS
   keeps в TIME_WAIT (~60s).
3. **Memory pressure**: eval-mode workload (особенно matmul) может trigger OOM на конкретном
   кейсе; chrome SIGKILL'ится, chromedriver loses connection.

## Decision (2026-05-26)

**Deferred to architectural refactor** на roadmap entry `browser-driver-lifecycle-refactor`
(Phase 1.2, cluster Browsers). Tactical fixes (retry-on-session-loss, periodic
cleanup, explicit user-data-dir) **не делаем** — они patch symptom, не root cause
(driver-per-case архитектура).

Refactor scope:
- One long-lived chromedriver + chrome process per browser env (chrome, firefox).
- Per-case dispatch — навигация по URL (case params в `?case=` уже работает) или
  postMessage в worker.
- Parallel envs (chrome + firefox concurrent) — независимые long-lived sessions.
- `worker.ts` accepts multiple cases via sequential onmessage; reset state между
  cases через iframe reload или explicit `__BENCH_RESET`.
- `scripts/run-matrix.ts` batches cases by (browser env), passes batch to one
  driver invocation per env.

Trade-offs (для будущего design phase):
- Pros: eliminates accumulation root-cause entirely; faster (no per-case browser
  cold start); естественный parallelism.
- Cons: bigger refactor of driver.ts + worker.ts + run-matrix.ts; one crash =
  all subsequent cases for that env lost (mitigatable via batch checkpoint to
  disk + restart-from-checkpoint protocol); fixture caching across cases may
  pollute V8 IC state — нужно verify не влияет на perf measurements.

Investigation findings (выше) — input для design spec.

## References

- `docs/pitfalls/2026-05-23-phase-1-1-2-execution.md` § Tooling > "pnpm bench:all browsers
  фрагменте fragile"
- `results/raw/2026-05-23T01-42-09-620Z/` — partial 334 results, salvageable. Last
  successful write: `interop_calls_add_i32__cpp-wasi-sdk-speed__S__firefox.json` at 04:47:12.
  Crash on next case (`interop_calls_add_i32__cpp-wasi-sdk-speed__M__chromium`).
- `apps/runner-web/src/driver.ts:141, 177` — current driver-per-case lifecycle.
- `scripts/run-matrix.ts:130-134` — per-case subprocess spawn.
- Roadmap entry: `docs/roadmap.md` § Phase 1.2 > Browsers > `browser-driver-lifecycle-refactor`.
