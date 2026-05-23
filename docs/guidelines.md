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

### Для u64-keyed hashmap'ов выбирай `rust/bindgen` (std HashMap); для string-keyed выбирай `js Map` — кросс-toolchain профайл инвертируется на key type
**Status:** confirmed
**Evidence:** Phase 1.1.2, `results/raw/2026-05-23T01-51-06Z/hashmap_{int,string}_lookup__*-speed__{S,M}__node.json`. Warm-median per `run(N)` call (lookup hot loop, N=1000 для S, N=10000 для M), Node v22.22.3 V8 12.4:

| key type | size | rust/bindgen | cpp/emscripten | js/idiomatic |
|---|---|---|---|---|
| u64 | S (N=1000) | **0.0042 ms** | 0.0062 ms | 0.0097 ms |
| u64 | M (N=10000) | **0.044 ms** | 0.081 ms | 0.174 ms |
| string | S (N=1000) | 0.017 ms | 0.016 ms | **0.0072 ms** |
| string | M (N=10000) | 0.188 ms | 0.209 ms | **0.089 ms** |

Воспроизводимо через ≥2 sizes (S, M) × 2 key types. Pattern: Rust HashMap winning u64 by ~2× over C++ и ~4× over JS; JS Map winning strings by ~2× over Rust/C++.

**Phase:** introduced 1.1.2

**Caveats:** Only lookup hot loop measured (insert/delete show similar но slightly compressed ratios — Rust string overhead is 2-4× vs u64, JS string overhead is <0.7× vs u64). Only Node V8 12.4 measured; browser-side numbers TBD (Phase 1.1.2 bench:all chromium part упал на SessionNotCreatedError mid-run). Fixture keys uniform random (no adversarial collision profile). Insert at size L for hashmap_int has ~0.6% collision rate due to 53-bit key space — affects checksum semantics, не runtime profile.

Mechanism (Rust on u64): std HashMap uses RandomState (SipHash) + Robin-Hood open addressing. u64 key path: hash via SipHash → probe via integer compare → branch-free hit path. Bindgen marshalling для primitive return f64 is zero-overhead (direct return).

Mechanism (Rust on String): wasm-bindgen marshals JS strings → wasm-side `String` allocation + UTF-8 copy per `load_input` pair, then SipHash<String> for lookup. Allocation pressure + dynamic-length hash dominates the loop.

Mechanism (JS on string): V8 Map<string, number> uses string interning + pointer equality for hash hits (fast string compare). Числовые keys в JS Map проходят through Number boxing + identity hashing — slower than V8's string fast path.

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

### Избегай `switch (entry)` over closure-constant в hot loop bodies для V8-targeted JS workloads — используй factory-time dispatch
**Status:** confirmed
**Evidence:** Phase 1.1.2, `docs/superpowers/bug-reports/2026-05-23-v8-deopt-switch-over-closure-const.md` + commit `0cc508b`. На Node v22.22.3 / V8 12.4, оригинальный паттерн в `benches/hashmap_{int,string}/js/idiomatic/src/index.ts`:

```ts
export default function create(entry: string): BenchModule {
    // ... state ...
    function run(iters) {
        switch (entry) {                              // ← closure-constant switch
            case "..._insert": { /* hot loop */ ... }
            case "..._lookup": { /* hot loop */ ... }
            case "..._delete": { /* hot loop */ ... }
            default: throw new Error(`unknown entry "${entry}"`);
        }
    }
    return { ..., run };
}
```

под `--mode=eval` (warmup=10, samples=30-100) у `*_lookup` entries при size S детерминированно падает в `default:` ветку через 30+ samples — turbofan deopt'ит switch'у на closure-constant и попадает в неправильную ветку. Воспроизводимо на обоих workload'ах (hashmap_string + hashmap_int) при eval+S+lookup. `--jitless` устраняет (подтверждение V8 JIT-cause). Manual repro вне harness не падает.

**Workaround в этом репо:** factory-time dispatch — `create(entry)` возвращает специализированные `runFn`/`resetFn` closures (один switch на factory call, никакого switch'а внутри hot loop). Bundle ~10% smaller, корректность восстановлена. Apply в commit `0cc508b` для hashmap_string + hashmap_int.

**Phase:** introduced 1.1.2

**Caveats:** Reproduced только на Node 22 / V8 12.4. Точный root cause не идентифицирован (см. bug report для hypotheses + V8 tracing commands). Manual repro вне harness не воспроизводится — что-то в harness/runner-node взаимодействии (likely performance.now() + await boundaries + size of pairs array) триггерит deopt. Pattern likely общий — switch over closure-const в hot V8 loops следует избегать заранее.

Mechanism (hypothesis): turbofan speculates тип `entry` based на frequent hits, инлайнит switch с предположением, что только один case срабатывает. При hot enough tier-up до maglev/turbofan, speculation расходится с bytecode-fallback (через soft-deopt trigger), и fallback path попадает в `default:`. Не root-caused; investigation deferred (см. bug branch `feature/phase-1.1.2-bug`).

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
