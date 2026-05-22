# Guidelines

Actionable рекомендации для продуктовых команд, выбирающих wasm-пайплайн и пишущих
код под wasm. Каждая рекомендация привязана к evidence из этого репо: путь к
артефакту в `dist/` или к result JSON'у в `results/`, и phase, в которой она
появилась.

**Этот файл seedless** — наполнение начнётся когда у фазы появится первый
confirmed вывод. До этого момента документ существует только как контракт формата.

Source of truth для convention — этот файл + `CLAUDE.md` § «Guidelines artifact».
Skill `/finish-session` напоминает обновлять файл при закрытии сессий, в которых
появилось что-то confirmed.

## Format

Каждая рекомендация — subsection (`###`) внутри topical бакета (`##`) с
обязательными полями:

```markdown
### <Imperative claim — одна строка>
**Status:** confirmed | tentative | needs-more-data
**Evidence:** <path-to-result-or-dist-artifact>
**Phase:** introduced 1.X / refined 1.Y
**Caveats:** <когда не применять>
```

Опционально может быть body параграф с numbers / rationale ниже полей.

### Status levels

- **confirmed** — reproducible measurement через ≥2 size'а или ≥2 workload'а (когда workload'ов станет >1). Рекомендация безопасно применима в продукте.
- **tentative** — single-workload или single-size observation. Полезно знать, но не закладываться без собственной проверки.
- **needs-more-data** — гипотеза с частичным evidence, ждёт expansion в следующей phase.

### When to add

- Confirmed reproducible measurement → новый `###` под подходящим бакетом.
- Tentative observation → тот же бакет со status `tentative`.
- Phase, рефайнящая старый claim → редактируется поле `**Phase:**` (e.g. `introduced 1.0 / refined 1.1`) + при необходимости body.
- Phase, invalidating старый claim → удалить subsection (история через git log).

### When NOT to add

- Single-run anecdote без воспроизводимости.
- Generic best practices без evidence из этого репо.
- Claim'ы, которые потенциально invalidate-ятся следующей phase'ой — дождаться её.

## Build flags

<!-- empty — заполнится при появлении первого confirmed вывода из phases -->

## Toolchain choice

### Для hot, sub-µs JS↔Wasm functions предпочитай `rust/raw extern "C"` или `cpp/wasi-sdk` — `wasm-bindgen` стабильно добавляет ~10-40% per-call overhead
**Status:** tentative
**Evidence:** Phase 1.1.1, `results/raw/2026-05-22T21-06-13-615Z/interop_calls_*__rust-{raw,bindgen}-speed__M__node.json` + соответствующие chromium/firefox. M-size (1M calls/sample), node v22.22.3 V8:
- `interop_calls_noop`: raw 1.67 ns/call vs bindgen 2.21 ns/call (**+33%**).
- `interop_calls_add_i32`: raw 2.13 vs bindgen 2.31 (**+9%**).
- `interop_calls_add_f64`: raw 2.99 vs bindgen 3.66 (**+22%**).
Cross-runtime consistency: chromium noop M raw 1.78 vs bindgen 2.49 (+40%); firefox noop M raw 1.94 vs bindgen 2.40 (+24%). Δ persists через speed/size profile.
**Phase:** introduced 1.1.1
**Caveats:** Single workload class (тривиальные сигнатуры — `()->()`, `(i32,i32)->i32`, `(f64,f64)->f64`). Overhead absolute small (~0.2-0.7 ns/call) и тонет в шуме при wasm body > ~50 ns (e.g. `matmul` где gap внутри CV). Для product code с редкими crossings (DOM events, RAF callbacks) разница не важна; для горячих циклов с миллионами JS↔Wasm calls — preferable. Confirmation expected в Phase 1.1.2 (hashmap insert/lookup — multi-arg calls с возвратом структур).

Mechanism: wasm-bindgen генерирует JS shim per export, который маршалит args/ret через shared memory + maintains FinalizationRegistry для GC-aware refcells. Для тривиальных primitive-only signatures shim просто forward'ит вызов, но добавляет typeof checks + arity adjust + (Rust-side) bindgen-instrumented entry. Raw `extern "C"` экспортирует через direct call ABI, no JS-side shim.

## Code patterns

### Не используй `thread_local!` для глобального состояния в wasm32 cdylib — бери `static SyncCell<T>` с vacuous `Sync` impl
**Status:** tentative
**Evidence:** Phase 1.1.0 W5.3, `benches/matmul/rust/bindgen/src/lib.rs` (commit `2dea1d5`). Замена `thread_local! { static STATE: RefCell<State> }` на `static STATE: SyncCell<State>` с `unsafe impl Sync` (single-threaded vacuous) дала -751 B (speed profile) / -689 B (size profile) на raw wasm.
**Phase:** introduced 1.1
**Caveats:** Применимо только для targets без реальных threads (wasm32-unknown-unknown). Для threads-enabled wasm или native targets — нужен реальный sync primitive (Mutex/OnceLock). Single workload пока — статус `tentative` до подтверждения в Phase 1.1.1+.

Mechanism: `thread_local!` разворачивается в `LocalKey<T>` с lazy-init shim'ом (atomic-guarded init state + `.with()` dispatch + panic paths для TLS destruction). На single-threaded wasm32 — pure overhead. `SyncCell<T>(RefCell<T>)` с `const fn new()` — обычная константная инициализация, прямой доступ через `STATE.0.borrow_mut()`. RefCell runtime borrow checks остаются (микроскопические).

### Не оставляй `#[wasm_bindgen]` exports «на будущее» — каждый dead export тянет свою call chain
**Status:** tentative
**Evidence:** Phase 1.1.0 W5.2, `benches/matmul/rust/bindgen/src/lib.rs` (commit `af475be`). Удаление dead `output_view() -> Vec<u8>` экспорта (никто не вызывал в production) уменьшило wasm на -716 B (speed) / -451 B (size).
**Phase:** introduced 1.1
**Caveats:** `tentative` до Phase 1.1.1+ workload'ов для cross-workload подтверждения. Effect масштабируется от complexity export'а (alloc + marshalling glue).

Mechanism: `#[wasm_bindgen]` export keeps его call chain alive — `Vec<u8>` тянет global allocator + growth/drop machinery, `slice::to_vec()` — wasm-side allocation + memcpy, wasm-bindgen glue marshal'ит `Vec<u8>` → JS `Uint8Array` через shared memory. LLVM DCE не может убрать code reachable from exported symbol.
