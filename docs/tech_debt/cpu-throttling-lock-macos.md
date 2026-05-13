---
id: cpu-throttling-lock-macos
title: На macOS нет CPU throttling lock — cv может вылетать выше порога на батарее
created: 2026-05-14
source: docs/superpowers/specs/2026-05-04-housekeeping-design.md + README «Известные ограничения»
category: known-limitation
status: open
priority: medium
---

## What

Никаких `cpuset`/`taskset`/turbo-boost lock'ов не делается перед бенчмарками. На лэптопе
на батарее (или при тепловом throttling'е) cv может вылетать выше 5% threshold, runner
тогда отметит cell как noisy.

## Why it matters

Snoise влияет на достоверность сравнений между разными запусками. На stationary AC-powered
machine редко проблема, на любом laptop'е run-to-run — реальный риск. Особенно для
Phase 1.1+ workloads где нужны более тонкие perf-сравнения.

## Possible fix

Investigate macOS options:
- `taskpolicy -c utility` или `-c background` (priority hint).
- `caffeinate -d -i -m -s` (предотвратить sleep, не throttling per se).
- App Nap / performance-mode hint через mach APIs (overkill).
- Простейший: pre-flight warning «running on battery, expect noisy results» через
  `pmset -g batt` check.

Long-term: возможно `taskpolicy` достаточно для wasm benchmarks (compute-bound,
single-threaded).

## References

- `docs/superpowers/specs/2026-05-04-housekeeping-design.md` (Phase 1.0.5 carry-over)
- README.md «Известные ограничения» секция (user-facing acknowledgement)
- `scripts/run-matrix.ts` (где можно добавить pre-flight)
