# Session state — 2026-06-13 2025 · phase-1-2 rust-vs-cpp-size — executed, awaiting push/PR

## TL;DR

- Branch `feature/phase-1-2-rust-vs-cpp-wasm-size`, HEAD `9e59729`. Master untouched. Gates all green (build/typecheck/lint/test/smoke — smoke 149 results, 0 failures).
- **Phase 1.2 `rust-vs-cpp-wasm-size` исполнена + закрыта (pending push/PR).** Атрибуция (wasm-tools section-split + twiggy) выполнена. Захваченная гипотеза «rust стабильно крупнее cpp» **опровергнута** — направление workload-зависимо, а для маленьких workload'ов size доминируется фиксированным налогом тулчейна + линковкой примитивов, НЕ структурой алгоритма (8× кросс-toolchain разброс на одной задаче).
- **3 рычага как контролируемые эксперименты:** A (cpp shape `__builtin_log`→polynomial, −76% size но +21-23% warm) — **откатлен** (size↔perf трейд, находка задокументирована); B (matmul `usize::isqrt()`→Newton, −49% size, подтвердил что 520B `.rodata` = isqrt-таблица) — **откатлен** (консистентность + idiomatic-артефакт); C (hashmap drop 4 MiB static STAGING) — **adopt** (`ce30f71`: obsolete loader-workaround, init-mem −64 стр./−4 MiB, file ~0, восстанавливает idiomatic global-alloc).
- **Deliverables:** 1 confirmed guideline (primitive-linking fixed tax: bit-exact `log`→4.2KB musl table; `isqrt`→520B table) + roadmap-преемник `wasm-size-floor-vs-marginal` (`9e59729`). Spec twiggy-version pin (`8b43312`).

## What the next session needs

1. **Push + PR — действие пользователя** (Yubikey SSH, `gh` нет). 7 коммитов на ветке.
2. После merge — `wasm-size-floor-vs-marginal` (roadmap TBD) — естественный преемник: метод декомпозиции size на амортизируемый fixed-floor (allocator/container/primitive-таблицы/panic-инфра) vs маржинальный (generic-инстансы + workload-код). Уже framed в roadmap + guideline-caveat.

## Deferred / open-loops

- **Push + PR** — НЕ сделано; действие пользователя. `git push -u origin feature/phase-1-2-rust-vs-cpp-wasm-size` + compare-ссылка ниже.
- **twiggy 0.8.0** установлен глобально (`~/.cargo/bin`, analysis-only, ноль следов в репо) — остаётся.
- **Ephemeral бенч-прогоны** `results/raw/2026-06-13-{size-perf-baseline,size-perf-levers,logcheck,isqrtcheck,stagingcheck}` — gitignored, можно удалить.
- **Два pre-existing stray'я** (`.claude/skills/skill-constructor-v5/`, `Какие есть…md`) — НЕ коммитить (intentional).

## Resume

```bash
git checkout feature/phase-1-2-rust-vs-cpp-wasm-size
git push -u origin feature/phase-1-2-rust-vs-cpp-wasm-size
# PR: https://github.com/uncerso/wasm-rust-cpp-js/compare/master...feature/phase-1-2-rust-vs-cpp-wasm-size
```

## Stop point

Гейты зелёные, готово к push+PR. Единственное source-изменение vs master — рычаг C (hashmap staging removal, `ce30f71`); рычаги A/B откатлены (нулевой net source-diff, находки в guideline+roadmap). `/finish-session` отработал: applied README build-команды fix (`<bench-id>` арг) + MEMORY.md counter removal; planning-урок = link-only (покрыт guideline+roadmap+памятью, новой прозы не плодили); pitfall-док не писали (near-miss пойман на review). Spec: `docs/superpowers/specs/2026-06-13-rust-vs-cpp-wasm-size-design.md`; plan: `docs/superpowers/plans/2026-06-13-rust-vs-cpp-wasm-size.md`.
