---
id: clang-tidy-cpp
title: clang-tidy для C++ кода не настроен
created: 2026-05-14
source: docs/superpowers/specs/2026-05-04-housekeeping-design.md
category: nice-to-have
status: open
priority: low
---

## What

В Phase 1.0.5 Housekeeping добавлены ESLint flat config (TypeScript) и Rust toolchain
discipline. Для C++ компонент (matmul.cpp + build scripts) аналогичного linter'а нет.
Открытый тикет с Phase 1.0.5 carry-over.

## Why it matters

C++ код узкий (один файл), но используется в performance-critical path. Без linter'а
легко допустить subtle UB, missed const, неоптимальные patterns. Также: при добавлении
новых benchmarks (Phase 1.1+ workloads) количество C++ кода вырастет.

## Possible fix

Добавить `.clang-tidy` config (modernize-*, performance-*, bugprone-*, readability-*) и
pnpm script `"lint:cpp": "clang-tidy benches/matmul/cpp/src/*.cpp -- -I... -std=c++20"`.
Включить в `pnpm lint` композитный target.

## References

- `docs/superpowers/specs/2026-05-04-housekeeping-design.md` (carry-over note)
- `benches/matmul/cpp/src/matmul.cpp`
