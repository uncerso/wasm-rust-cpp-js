---
id: bindgen-thread-local-init-shim-overhead
title: thread_local!{RefCell<State>} lazy-init shim добавляет фиксированный overhead
created: 2026-05-14
source: docs/superpowers/session-state-2026-05-05-wave-3.md
category: investigation
status: open
priority: low
---

## What

В `benches/matmul/rust/bindgen/` для глобального state используется `thread_local!{RefCell<State>}`.
Rust компилирует это в lazy-init shim, который при каждом access проверяет initialization
flag. Гипотеза (wave-3 session-state) — этот shim contributes к size regression и/или
runtime overhead bindgen-варианта.

## Why it matters

Если overhead значимый — стоит рассмотреть `OnceCell` или `std::sync::OnceLock` (no
lazy-init check после первого access). Для wasm single-thread context это безопасно.

## Possible fix

Investigation:
- Заменить `thread_local!` на `OnceCell` / `OnceLock` в experimental branch.
- Сравнить size + runtime metrics до/после.
- Если win'значимый — оформить в плановый refactor.

## References

- `docs/superpowers/session-state-2026-05-05-wave-3.md` (hypothesis)
- `benches/matmul/rust/bindgen/src/` (поиск thread_local!)
- Related: `bindgen-size-regression-investigation.md`
