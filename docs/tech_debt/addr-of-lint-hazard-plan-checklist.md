---
id: addr-of-lint-hazard-plan-checklist
title: Plan'ы с unsafe refactor должны учитывать dead_code lint при снятии dereference
created: 2026-05-22
source: docs/pitfalls/2026-05-21-phase-1-1-0-execution.md (§2)
category: process-gap
status: open
priority: low
---

## What

Когда plan говорит заменить `(*HEAP.0.get()).as_ptr() as usize` на
`core::ptr::addr_of!(HEAP) as usize` — поле `HEAP.0` перестаёт читаться и clippy
`dead_code` ловит ошибку. Pitfall 2 из Phase 1.1.0 зафиксировал: plan'овский комментарий
«UnsafeCell is repr(transparent), so addr of HEAP.0 == addr of HEAP» был partially
incorrect (верно только для `#[repr(transparent)]` outer struct); рабочее решение —
`addr_of!(STRUCT.field)` или `#[repr(transparent)]` на outer struct, или explicit
`#[allow(dead_code, reason = "...")]`.

## Why it matters

При следующем unsafe refactor'е в `benches/matmul/rust/raw/` (или новом crate'е с
`#[deny(warnings)]` + `clippy::all`) — без явного reminder'а в plan'е легко повторить:
лишний debug cycle когда clippy завалит build на ровном месте.

## Possible fix

Добавить в next plan-файл с unsafe refactor короткий paragraph (или общий checklist
для unsafe refactor'ов, если они станут частыми):

> При unsafe refactor'ах со снятием dereference — подумать, какое поле теперь не
> читается, и или (а) `#[repr(transparent)]` на outer struct, или (б) брать addr
> через field (`addr_of!(STRUCT.field)`), или (в) `#[allow(dead_code, reason = "...")]`
> с явным rationale.

Альтернатива: capture как memory feedback entry, чтобы reminder всплывал при любом
unsafe refactor'е независимо от plan/spec.

## References

- `docs/pitfalls/2026-05-21-phase-1-1-0-execution.md` §2.
- `benches/matmul/rust/raw/src/lib.rs` (current code с `addr_of!(HEAP.0)`).
