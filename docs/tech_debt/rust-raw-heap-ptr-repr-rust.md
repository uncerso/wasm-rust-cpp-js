---
id: rust-raw-heap-ptr-repr-rust
title: rust-raw heap pointer derivation полагается на repr(Rust)
created: 2026-05-14
source: docs/superpowers/session-state-2026-05-05-wave-3.md
category: known-limitation
status: open
priority: low
---

## What

В rust-raw для получения base address heap используется `(*HEAP.0.get()).as_ptr() as usize`.
Это полагается на repr(Rust) layout (что first field находится в начале struct'а). Сейчас
byte-identical wasm output подтверждает корректность, но формально это **не гарантировано**
языком — repr(Rust) layout implementation-defined.

## Why it matters

При rustc upgrade или некоторой комбинации flags layout может измениться. Wasm output
останется корректным byte-byte... до момента когда не останется. Bulletproof паттерн
существует.

## Possible fix

Использовать `core::ptr::addr_of!(HEAP) as usize` (или, для inner field, `addr_of!((*HEAP.0.get()).0)`).
`addr_of!` macro явно документирован как «not requiring valid reference», даёт стабильную
address derivation независимо от layout.

Триггер: при следующем rustc upgrade или если byte-identical output ломается из-за этого
конкретного места.

## References

- `docs/superpowers/session-state-2026-05-05-wave-3.md` (M5 review note)
- `benches/matmul/rust/raw/src/lib.rs` (HEAP definition + usage)
