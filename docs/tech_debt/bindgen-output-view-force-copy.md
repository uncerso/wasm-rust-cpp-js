---
id: bindgen-output-view-force-copy
title: rust-bindgen output_view() возвращает Vec<u8> — wasm-side alloc + force copy
created: 2026-05-14
updated: 2026-05-15
source: docs/superpowers/session-state-2026-05-05-wave-3.md; renamed/refocused during /tech-debt-review 2026-05-15 (original item incorrectly attributed to rust-raw)
category: nice-to-have
status: open
priority: low
roadmap: phase-1.1-candidate
---

## What

В `benches/matmul/rust/bindgen/src/lib.rs:78` API `output_view() -> Vec<u8>` делает
wasm-side allocation + copy для возврата output buffer. Bindgen layer затем оборачивает
это в Uint8Array, и loader делает ещё `.slice()` (`packages/loaders/src/rust-bindgen.ts:52`).

Contrast: `rust-raw` уже использует zero-copy approach через `output_ptr()` + `output_len()`
(`benches/matmul/rust/raw/src/lib.rs:120,127`), JS side просто `new Uint8Array(memBuffer, ptr, len)`.

## Why it matters

1. **Bindgen size baseline:** wasm-side `Vec<u8>` alloc может contributing к size regression
   (см. [[bindgen-size-regression-investigation]]).
2. **Runtime overhead:** на L-size workloads или streaming-style benchmarks unneeded copy
   будет заметен.
3. **API asymmetry:** raw vs bindgen unnecessarily differ — лучше унифицировать.

**Caveat:** `readOutput()` сейчас вообще не вызывается в production hot path
(`packages/harness/src/measure.ts` верифицирует через `checksum` из `run()`, не через
байты output). Так что perf overhead сейчас 0 — но API existence + Vec alloc на wasm
стороне ещё компилируются в артефакт.

## Possible fix

Заменить `pub fn output_view() -> Vec<u8>` на pair `output_ptr() -> u32` + `output_len() -> u32`
(mirror rust-raw API). Loader `rust-bindgen.ts:52` обновить: `() => new Uint8Array(memBuffer, ptr, len)`
без `.slice()` (если consumer не нужно owned).

Альтернатива: вообще удалить `readOutput()` API из interface — он dead, верификация уже
через `checksum`. Тогда и `output_view()` можно удалить.

Триггер: при следующем refactor bindgen или Phase 1.1 размер-investigation.

## References

- `benches/matmul/rust/bindgen/src/lib.rs:78` (output_view definition)
- `packages/loaders/src/rust-bindgen.ts:52` (loader-side .slice())
- `packages/harness/src/types.ts:6` (readOutput interface — possibly dead)
- `packages/harness/src/measure.ts` (only consumer path, uses checksum not bytes)
- Related: [[bindgen-size-regression-investigation]], [[bindgen-thread-local-init-shim-overhead]]
- Discovery: /tech-debt-review session 2026-05-15 (original item был attribut'ован к rust-raw, неверно)

## Roadmap

Triage 2026-05-15: marked **phase-1.1-candidate**. Group с другими bindgen items
([[bindgen-size-regression-investigation]], [[bindgen-thread-local-init-shim-overhead]])
для «bindgen size deep-dive» mini-sprint в Phase 1.1. Дополнительно — если readOutput API
будет удалён, item частично разрешается «бесплатно».
