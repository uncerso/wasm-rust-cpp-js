---
id: clangd-config-cpp23
title: Add .clangd config so IDE diagnostics on benches/*/cpp/src/*.cpp use C++23 mode
created: 2026-05-23
source: docs/pitfalls/2026-05-23-phase-1-1-2-execution.md § Tooling
category: nice-to-have
status: open
priority: low
---

## What

Clangd defaults to pre-C++11 mode при отсутствии `compile_commands.json` или `.clangd`
config в репозитории. На Phase 1.1.2 Tasks 19/20 (new C++ workloads с
`std::unordered_map`, `constexpr size_t`, nested template angle brackets) IDE начал
показывать «false positive» errors:

- «right angle brackets need space» (pre-C++11)
- «Unknown type name 'constexpr'»
- «Unknown size_t»
- «no member 'emplace' in `std::unordered_map<...>`»

Реальный emcc build с `-std=c++23 -Werror` passes clean. Это чистый IDE noise.

Существующий `benches/interop_calls/cpp/src/interop_calls.cpp` использует простые
patterns без nested templates, поэтому не триггерил этот noise раньше.

## Why it matters

- Code-review friction: AI reviewer и user видят красные squiggles на корректном коде,
  тратят время выясняя что это false positive.
- Future C++ workloads (Phase 1.1.3 shape_dispatch может использовать polymorphism /
  vtables / dynamic_cast) — паттерны более сложные → больше noise.

## Possible fix

Создать `.clangd` в корне репо с примерно таким содержимым:

```yaml
CompileFlags:
  Add: [-std=c++23, -Wall, -Wextra]
  CompilationDatabase: .
```

Или подходит `compile_commands.json` generator script, который читает все
`benches/*/cpp/build-emscripten.sh` и создаёт canonical compile commands. Sketch — не
investigated.

Альтернативно — `compile_flags.txt` (простой одно-flag-per-line file).

Проверить, что после fix:
- `benches/hashmap_int/cpp/src/hashmap_int.cpp` не показывает «false positive» errors
  в clangd.
- `benches/interop_calls/cpp/src/interop_calls.cpp` всё так же чист.

## References

- `docs/pitfalls/2026-05-23-phase-1-1-2-execution.md` § Tooling > "Clangd diagnostics noise"
- `benches/hashmap_int/cpp/src/hashmap_int.cpp` (Task 20)
- `benches/hashmap_string/cpp/src/hashmap_string.cpp` (Task 19)
