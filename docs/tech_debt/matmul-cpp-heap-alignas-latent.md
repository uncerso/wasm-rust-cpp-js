---
id: matmul-cpp-heap-alignas-latent
title: alignas(8) static heap в matmul.cpp — latent absolute-alignment gap
created: 2026-05-14
source: docs/superpowers/session-state-2026-05-05-wave-2.md + session-state-2026-05-05-wave-3.md
category: latent-bug
status: open
priority: low
roadmap: phase-1.1-candidate
---

## What

В `benches/matmul/cpp/src/matmul.cpp` heap-буфер объявлен как `alignas(8) static uint8_t heap[HEAP_SIZE]`.
Это relative alignment к началу буфера, не absolute alignment адреса памяти. При определённых
сборках или другом toolchain'е реальный адрес может не быть 8-aligned, и f64-доступ через
reinterpret_cast<double*> станет UB.

## Why it matters

На emcc 5.0.x не firing — wasi-sdk и emscripten оба дают 8-aligned адреса для static storage.
Но при tooling change (new clang version, new wasm-ld behavior) может проявиться. Найти
будет тяжело: UB на f64 read/write часто silent corruption, не crash.

## Possible fix

- Использовать `alignas(8) static double heap_d[HEAP_SIZE/8]` (тип-aligned).
- Или std::aligned_storage_t (deprecated в C++23 но работает).
- Или std::byte с `std::launder` (modern way).
- Или runtime-assert при первом доступе: `assert((reinterpret_cast<uintptr_t>(heap) & 7) == 0)`.

## References

- `benches/matmul/cpp/src/matmul.cpp` (поиск `alignas`)
- `docs/superpowers/session-state-2026-05-05-wave-2.md` (initial discovery)
- `docs/superpowers/session-state-2026-05-05-wave-3.md` (re-noted as low priority)

## Roadmap

Triage 2026-05-15: marked **phase-1.1-candidate**. Включить в Phase 1.1+ C++ hardening pass
(возможно объединить с clang-tidy-cpp если последний будет двинут в roadmap). При создании
plan-файла переместить в `resolved/` со ссылкой.
