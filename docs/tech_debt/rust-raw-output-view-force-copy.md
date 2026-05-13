---
id: rust-raw-output-view-force-copy
title: rust-raw output_view() возвращает Vec<u8> — force copy вместо pointer/length
created: 2026-05-14
source: docs/superpowers/session-state-2026-05-05-wave-3.md
category: nice-to-have
status: open
priority: low
---

## What

В rust-raw API `output_view()` возвращает `Vec<u8>` (или аналог с владением). Для
benchmark'а текущего, где output читается один раз и валидируется через checksum, это
fine. Но при future profiles, где output_view захочется передать в downstream worker'ы
или большее количество раз — лишний copy.

## Why it matters

Wasm-side allocation + memcpy для output, который reader мог бы прочитать direct из
linear memory. Минорный perf trade-off на M-size, могло бы быть значимым на L-size или
для streaming-style benchmarks.

## Possible fix

Добавить альтернативный API: `pub fn output_ptr_len() -> (u32, u32)` returning offset
в linear memory + length. Caller сам делает `new Float64Array(buf, offset, len/8)` без
copy. Сохранить старый `output_view()` для backward-compat в первой итерации.

Триггер: появление 2+ output_view profile или L-size benchmark где copy заметен.

## References

- `docs/superpowers/session-state-2026-05-05-wave-3.md` (M3 review note)
- `benches/matmul/rust/raw/src/lib.rs` (current API)
