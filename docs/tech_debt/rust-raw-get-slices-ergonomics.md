---
id: rust-raw-get-slices-ergonomics
title: rust-raw get_slices() returns slice с caller-chosen lifetime — type-safety gap
created: 2026-05-14
source: docs/superpowers/session-state-2026-05-05-wave-3.md
category: nice-to-have
status: open
priority: low
roadmap: phase-1.1-candidate
---

## What

В `benches/matmul/rust/raw/` есть `unsafe fn get_slices<'a>() -> (&'a [f64], &'a [f64], &'a mut [f64])`.
Сигнатура позволяет caller'у выбирать lifetime, что compiler не сможет проверить против
actual storage lifetime. YAGNI argument был принят (один caller, один use site), но это
latent type-safety gap.

## Why it matters

Если в Phase 1.1+ workloads появится 2+ callers — текущая сигнатура легко даст UAF
(use-after-free) или borrow conflicts, которые compiler не поймает (всё `unsafe`).

## Possible fix

Заменить на CPS-style API: `with_slices<R>(f: impl FnOnce(&[f64], &[f64], &mut [f64]) -> R) -> R`.
Lifetime закрыт в closure scope, compiler enforces. Performance equivalent (closure
inlined в wasm).

Триггер: когда появляется 2-й caller для get_slices.

## References

- `docs/superpowers/session-state-2026-05-05-wave-3.md` (M3 review note)
- `benches/matmul/rust/raw/src/lib.rs` (current API)

## Roadmap

Triage 2026-05-15: marked **phase-1.1-candidate**. Group с
[[rust-raw-heap-ptr-repr-rust]] для bundle'а «rust-raw API hardening» при добавлении
новых workloads в Phase 1.1.
