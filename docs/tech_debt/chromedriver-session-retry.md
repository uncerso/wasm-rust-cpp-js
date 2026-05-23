---
id: chromedriver-session-retry
title: Add retry-on-session-loss in bench-runner for chromedriver SessionNotCreatedError
created: 2026-05-23
source: docs/pitfalls/2026-05-23-phase-1-1-2-execution.md § Tooling
category: process-gap
status: open
priority: medium
---

## What

`pnpm bench:all` падает mid-run на `SessionNotCreatedError: session not created from
chrome not reachable` после нескольких сотен successful cases (Phase 1.1.2 Wave 3:
334 results written до crash, ~halfway через full matrix). Failure not workload-specific;
chromedriver / chrome process state degrades over time.

Текущее поведение: bench-runner получает error, exit code 1, ELIFECYCLE, full run
aborted. Все subsequent cases (matmul / browsers tail end) теряются.

User вынужден fallback к `pnpm bench --envs=node` или ручному restart с filter
к remaining cases.

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

## Possible fix

В `scripts/run-matrix.ts` или в `apps/runner-web/src/driver.ts`:

1. **Retry once per case** при SessionNotCreatedError или "chrome not reachable":
   - Kill any stale chromedriver / chrome process (sandbox-safe — но `ps` blocked,
     может нужен `killall` invocation через user shell).
   - Re-create session с свежим chromedriver invocation.
   - Re-run только текущий case.
2. **Bail после N consecutive failures** (e.g. 3) — если retry тоже падает, скорее
   всего proper restart нужен → user-visible STOP, не silent loop.
3. **Periodic restart between sizes/workloads** (optional, more conservative): создать
   fresh chromedriver session каждые ~50 cases (configurable) — preemptive cleanup.

Investigation needed: какой именно ресурс exhaust'ится (memory? file descriptors?
Selenium internal session map?). Можно проверить через `lsof` на chromedriver pid'е
ближе к failure point.

## References

- `docs/pitfalls/2026-05-23-phase-1-1-2-execution.md` § Tooling > "pnpm bench:all browsers фрагменте fragile"
- `results/raw/2026-05-23T01-42-09-620Z/` — partial 334 results captured до crash; salvageable.
- Failure stack trace: `Selenium-webdriver lib/error.js:521` → chromedriver pid'у.
