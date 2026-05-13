---
id: bindgen-size-regression-investigation
title: bindgen size regression +0.9-1.0 KB в Wave 3 — root cause не найден
created: 2026-05-14
source: docs/superpowers/session-state-2026-05-05-wave-3.md
category: investigation
status: open
priority: low
---

## What

В Phase 1.0.5 Wave 3 (Rust raw refactor) размер `rust-bindgen-*` артефактов вырос на
~0.9-1.0 KB по сравнению с pre-Wave-3 baseline. Изменения должны были касаться только
raw-крейта, но bindgen-output изменился тоже. Гипотезы (см. wave-3 session-state) не
проверены.

## Why it matters

Размер артефакта — одна из двух основных метрик проекта. Untracked drift в bindgen
скейте размывает size baseline для всех будущих сравнений. Также: если регрессия из-за
toolchain (rustc/wasm-bindgen update), полезно понять mechanism для future debugging.

## Possible fix

Investigation steps:
- LLVM IR diff (rustc --emit=llvm-ir до/после).
- `wasm2wat` diff bindgen-выхода.
- `wasm-objdump -h` (section sizes) — где конкретно прирост.
- Проверить thread_local init shim overhead (см. отдельный `bindgen-thread-local-init-shim-overhead.md` item).

## References

- `docs/superpowers/session-state-2026-05-05-wave-3.md` (hypotheses + drift numbers)
- `benches/matmul/rust/bindgen/` (crate)
- Related debt: `bindgen-thread-local-init-shim-overhead.md`
