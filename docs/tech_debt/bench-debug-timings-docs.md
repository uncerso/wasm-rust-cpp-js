---
id: bench-debug-timings-docs
title: BENCH_DEBUG_TIMINGS=1 + ?debug=1 не задокументированы
created: 2026-05-14
source: docs/superpowers/notes/2026-05-05-perf-now-precision.md
category: open-review-ticket
status: open
priority: low
---

## What

Environment variable `BENCH_DEBUG_TIMINGS=1` (Node-side) и URL param `?debug=1` (browser-side)
включают подробные per-sample timing логи в worker. Удобный debug aid для FF/Chrome
разбирательств. Но нигде не документированы — только в коде page.ts/worker.ts.

## Why it matters

Useful feature без discoverability. В будущих investigations (Phase 1.1+ workloads,
runtime regressions) кто-то будет «изобретать заново».

## Possible fix

Добавить sub-section в README «Запуск бенчмарков»: «Debug timings — как включить, что
показывает, как читать». Альтернативно — создать internal debugging guide
`docs/debugging.md`.

## References

- `docs/superpowers/notes/2026-05-05-perf-now-precision.md` (TODO mention)
- `apps/runner-web/src/worker.ts`, `apps/runner-web/src/page.ts`, `apps/runner-web/src/driver.ts` (где env var/URL param консюмятся)
