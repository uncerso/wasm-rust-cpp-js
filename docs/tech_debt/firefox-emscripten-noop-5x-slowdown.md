---
id: firefox-emscripten-noop-5x-slowdown
title: Firefox-specific 5-6x slowdown для emscripten glue на trivial wasm calls (interop_calls_noop)
created: 2026-05-23
source: results/raw/2026-05-22T21-06-13-615Z (Phase 1.1.1 bench:all)
category: investigation
status: open
priority: medium
---

## What

`pnpm bench:all` для Phase 1.1.1 показал, что `cpp-emscripten` на Firefox обрабатывает
1M вызовов `interop_calls_noop` за **~11 ms** vs **~1.96 ms** у `cpp-wasi-sdk` /
`rust/raw` / `rust/bindgen` на той же Firefox. На Chromium и Node V8 — все toolchain'ы
сходятся в ~1.7-2.5 ms. Эффект Firefox-specific, ~5-6x slowdown.

Surface measurements (`interop_calls_noop`, M=1M iters):

| toolchain (M, noop)       | node V8 | Chromium | Firefox |
|---------------------------|---------|----------|---------|
| cpp-emscripten-speed      | 1.65 ms | 1.76 ms  | **11.06 ms** |
| cpp-emscripten-size       | 1.69 ms | 2.23 ms  | **11.28 ms** |
| cpp-wasi-sdk-speed        | 1.68 ms | 1.80 ms  | 1.96 ms |
| rust-raw-speed            | 1.67 ms | 1.78 ms  | 1.94 ms |
| rust-bindgen-speed        | 2.21 ms | 2.49 ms  | 2.40 ms |

Странность: `cpp-wasi-sdk` и `rust/raw` строят минимальный `module.wasm` без JS glue,
а `cpp-emscripten` идёт через `glue.mjs` factory. Если glue добавляет
import marshalling shim на каждом вызове — это объяснило бы Firefox-specific cost.
Но Chromium тоже идёт через `glue.mjs` и не показывает такого спайка.

## Why investigate

1. Если эффект reproducible в Phase 1.1.2 (hashmap insert/lookup) — это **глобальная
   "не используй emscripten для high-frequency JS↔Wasm calls на Firefox"** guideline.
2. Если эффект тонет в bigger work loads — можно отметить как **tentative caveat**
   "trivial-only" и пометить как expected behaviour.
3. Возможно баг wasm-bindgen-free wrapper'а в emscripten glue + конкретно SpiderMonkey
   JIT path для wasm→JS→wasm trampolining (instrumented entry для emscripten runtime
   counters?).

## Suggested investigation steps

1. **Quick diff `glue.mjs`** — посмотреть, какие runtime checks выполняются per-call.
   Кандидаты: `assert()` calls, `_emscripten_throw_*` stubs, `dynCall` indirection.
2. **wasm-objdump на `glue.wasm`** — есть ли extra wrapper'ы для exported functions?
3. **Firefox profiler** — record one `pnpm exec tsx apps/runner-web/src/driver.ts --browser=firefox
   --entry=interop_calls_noop --benchmark=interop_calls --language=cpp --toolchain=emscripten
   --profile=speed --size=M ...`, посмотреть `performance.profile` / `about:performance`.
4. **Cross-check на других emscripten benches** — Phase 1.1.2 `hashmap` cpp-emscripten
   на Firefox. Если 5x persists для realistic workloads — claim промотится в `confirmed`.

## Disposition

- Park'нуто как `investigation` open. Не блокирует Phase 1.1.1 closure (single
  workload + Firefox-specific outlier — недостаточно для confirmed guideline).
- Если Phase 1.1.2 показывает тот же паттерн — escalate в `confirmed` claim в
  `docs/guidelines.md § Toolchain choice`.
- Если паттерн исчезает на realistic body sizes — закрыть как `resolved` (expected
  cost для trivial bodies, swamped by real work).
