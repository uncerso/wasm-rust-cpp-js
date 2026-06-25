# Guidelines

Actionable рекомендации для продуктовых команд, выбирающих wasm-пайплайн и пишущих
код под wasm. Каждая рекомендация привязана к evidence из этого репо: путь к
артефакту в `dist/` или к result JSON'у в `results/`, и phase, в которой она
появилась.

Файл наполняется по мере появления confirmed-выводов (на текущий момент — claims
с Phase 1.1.x). Формат каждого claim'а — ниже.

Source of truth для convention — этот файл (формат ниже).
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

## Artifact size

### Для минимального transfer size при простых экспортах выбирай no-glue (`rust/raw` extern "C" / `cpp/wasi-sdk`) — auto-glue добавляет фиксированный gzip-floor независимо от контейнера/ключа
**Status:** confirmed
**Evidence:** Phase 1.2, `results/raw/2026-06-13-phase-1-2-hashmap-no-glue/hashmap_{int,string}_*__{rust-raw,rust-bindgen,cpp-wasi-sdk,cpp-emscripten}-{speed,size}__*__node.json`. Artifact bytes (env/size-invariant). Total gzipped transfer (wasm.gz + glue.gz):

| workload | profile | rust/raw | rust/bindgen | Δ | cpp/wasi-sdk | cpp/emscripten | Δ |
|---|---|---|---|---|---|---|---|
| int | size | **7820** | 10173 | −23% | **5477** | 7695 | −29% |
| int | speed | **9708** | 11624 | −16% | **5745** | 9312 | −38% |
| str | size | **9159** | 11580 | −21% | **6507** | 8238 | −21% |
| str | speed | **12454** | 14303 | −13% | **6979** | 9949 | −30% |

Direction (no-glue < glue total transfer) consistent across 2 key-types × 2 profiles. JS-glue floor (gzipped) почти постоянен по key-type: wasm-bindgen ~1.6 KB (оба профиля); emscripten ~2.1 KB (size) / ~3.4 KB (speed). int≈str glue bytes (bindgen 1598≈1599; emscripten 2084≈2087) → floor зависит от toolchain+profile, НЕ от контейнера/ключа.

**Phase:** introduced 1.2

**Caveats:** Применимо когда не нужны фичи bindgen/emscripten за пределами простых numeric-экспортов — нет marshalling'а JS-строк/объектов per-call, нет DOM/FS/env-доступа, нет auto-managed памяти. no-glue требует ручных `alloc`/`load_input` + инстанцирования с пустыми импортами `{}`. Часть выигрыша — сам wasm (no-glue wasm обычно тоже чуть меньше: bindgen/emscripten вшивают marshalling-код); floor — это JS-glue файл, который no-glue устраняет целиком. Для cpp `string` no-glue выигрыш меньше (libc++ `string.cpp.o` монолитен — тянет dead `to_string`/`stoX`, см. pitfall).

Mechanism: wasm-bindgen генерит JS-shim per export (typeof-checks, arity-adjust, FinalizationRegistry для GC-aware refcells); emscripten — целый Module-runtime (HEAP views, env, fs-shims). Оба shippятся рядом с wasm. no-glue экспортирует через direct call ABI и инстанцируется с `{}` — нулевой JS-floor.

### Подтягивание stdlib-hashmap в no-glue wasm стоит multi-KB floor (~5 KB gz cpp libc++ / ~7–8 KB gz rust std) над no_std/no-container baseline
**Status:** confirmed
**Evidence:** Phase 1.2 (workload-level) + Phase 1.3 (контролируемый дифференциал, `scripts/size-diff.ts`). gzipped wasm, size profile.

Workload-level (no-glue, `results/raw/2026-06-13-phase-1-2-hashmap-no-glue/…`):

| crate | rust/raw (no_std→std) | cpp/wasi-sdk |
|---|---|---|
| interop_calls (trivial, no container) | 225 | 261 |
| matmul (FP math, no container) | 1098 | 546 |
| hashmap_int (+ std HashMap / libc++ unordered_map) | 7820 | 5477 |
| hashmap_string (+ String/std::string keys) | 9159 | 6507 |

Контролируемый дифференциал (rust/raw, `-Oz`, слоистые синтетические крейты `empty → +allocator → +HashMap → ×8 use-sites`) снимает workload-confound:

| слой | raw | gz |
|---|---|---|
| baseline (std, без heap) | 107 | 121 |
| + первая heap-аллокация (dlmalloc + panic/fmt, что она тянет) | +8 519 | +3 633 |
| + std `HashMap` (SipHash / `RandomState` / hash) | +1 971 | +1 168 |
| **8 use-site'ов HashMap против 1** | **+44** | **+16** |

**Phase:** introduced 1.2 / refined 1.3

**Caveats:** Floor платится **один раз** — 8 мест использования HashMap добавили 44 B raw над одним (не ×8 от ~2 KB map-кода): не масштабируется ни с числом use-site'ов, ни с числом элементов. Дифференциал — rust/raw синтетика (изолирует use-site scaling); cpp/wasi-sdk per-facility композиция теперь first-class (Phase 1.4), но без контролируемого слоистого дифференциала. Floor доминируется allocator'ом (одна dlmalloc-аллокация ~3.6 KB gz, тянет panic/abort-инфру) + hash-machinery; для продукта: один hashmap в иначе-минимальном wasm → закладывай ~5–8 KB gz floor.

### Размер микро-wasm = floor (paid-once) + observed; floor доминирует, а observed (твой код) сопоставим между workload'ами — «X больше» обычно про floor, не про твой код
**Status:** confirmed
**Evidence:** Phase 1.3, `dist/*/meta.json` поле `composition` (twiggy pre-opt × калибровка к точному production-тоталу) — first-class в отчёте (`pnpm report`, вкладка Size). rust/raw, size profile:

| workload | total raw | observed raw | floor % |
|---|---|---|---|
| interop_calls | 302 | 74 | 75% |
| matmul (FP + isqrt-таблица) | 1 639 | 964 | 41% |
| shape_dispatch_homo_static | 1 522 | 963 | 37% |
| hashmap_int | 16 188 | 1 736 | 89% |
| hashmap_string | 18 938 | 2 374 | 87% |

Тоталы расходятся 0.3 KB ↔ 19 KB, но observed (наблюдаемый workload-код) держится в ~0.1–2.4 KB; разница почти вся — floor (allocator + hash + panic + primitive-таблицы), платящийся один раз. Compute-bound (matmul) — low-floor (~40%); container-bound (hashmap) — floor-dominated (~90%).

**Phase:** introduced 1.3 / refined 1.4 (cross-toolchain attribution)

**Caveats:** per-facility байты приближённые (`≈`, pre-opt доля × точный тотал; wasm-opt сжимает категории неравномерно) — порядок величины надёжен, production-тотал точен, headline-факты кросс-проверены production-точным дифференциалом (`scripts/size-diff.ts` — см. claim про std-container floor выше). Атрибутированы все wasm-тулчейны (rust/raw+bindgen, cpp/wasi-sdk+emscripten, 64 бинаря; Phase 1.4) — состав floor по тулчейнам см. в следующем claim'е. JS: floor ≈ 0 — весь bundle observed (движок не едет в артефакт). Доп.: static dispatch чуть **меньше** dynamic на rust/raw `-Oz` (homo_static 1522 < homo_dyn 1693 B: vtable-инфра дороже 3 монроморфных тел при K=3) — кросс-проверка дифференциалом; ось perf — отдельный dispatch-claim ниже.

### Состав floor — toolchain-специфичен: rust несёт 21–25% panic/fmt-налог, у cpp (`-fno-exceptions -fno-rtti`) его ~0%; у emscripten ~45% floor'а — собственный runtime; bindgen/emscripten добавляют paid-once JS-glue, которого нет у raw/wasi-sdk
**Status:** confirmed
**Evidence:** Phase 1.4, `dist/*/{rust-raw,rust-bindgen,cpp-wasi-sdk,cpp-emscripten}-*/meta.json` поле `composition` (twiggy name-bearing pre-opt × калибровка к точному production-тоталу; unattributed 0.0–3.0% на rich-workload'ах) — first-class в отчёте (`pnpm report`, вкладка Size; amber-band «glue (JS)» = измеренный `jsGlue`, не доля wasm). hashmap_string, size profile:

| toolchain | wasm raw/gz | доминантный floor-facility | panic-fmt | glue raw/gz |
|---|---|---|---|---|
| rust/raw | 18938 / 9153 | allocator 32% | **25%** | — |
| rust/bindgen | 21968 / 9981 | allocator 29% | **21%** | 5705 / 1599 |
| cpp/wasi-sdk | 16279 / 6507 | allocator 44% | **0%** | — |
| cpp/emscripten | 14786 / 6151 | emscripten-runtime 45% | **0%** | 4379 / 2087 |

Две toolchain-floor-сигнатуры: (1) **rust платит panic/fmt-налог** — 21–25% на rich-workload'е (даже 16% у крошечного matmul/bindgen), cpp с `-fno-exceptions -fno-rtti` несёт ~0% (нет unwind/fmt-инфры); (2) **доминантный facility различается** — rust + cpp/wasi-sdk дают allocator (dlmalloc 29–44%), cpp/emscripten — собственный runtime (стек-операции, ctors, `dynCall`) ~45% при allocator ~1%. **Glue — реальный paid-once расход**: bindgen ~1.6 KB gz, emscripten ~2.1 KB gz; raw/wasi-sdk его не несут (но требуют рукописного generic host-loader'а, пока не учтённого — → roadmap `size-attr-raw-host-glue`).

**Phase:** introduced 1.4

**Caveats:** per-facility байты приближённые (pre-opt доля × точный production-тотал; wasm-opt сжимает категории неравномерно) — порядок надёжен, production-тотал точен. unattributed растёт на крошечных бинарях (interop_calls cpp/wasi-sdk ~24%, shape_dispatch 11–27%): мало именованных символов → структурный overhead занимает бóльшую долю; на rich-workload'ах <3%. `panic-fmt ~0%` у cpp — следствие флагов сборки ЭТОГО репо (`-fno-exceptions -fno-rtti`); cpp с включёнными исключениями понесёт свою долю. Glue gzip-floor почти не зависит от key-type (см. no-glue claim выше). Production-бинари byte-идентичны Phase 1.1–1.3 (атрибуция read-only; cpp wasm-opt сейчас неявный авто-пасс — → roadmap `cpp-wasm-opt-explicit`).

### Один примитив может молча залинковать multi-KB фиксированную таблицу, доминирующую над размером маленького wasm — аудируй примитивы, не алгоритм
**Status:** confirmed
**Evidence:** Phase 1.2, атрибуция через `wasm-tools objdump` (section-split) + `twiggy` (name-bearing analysis-build, `CARGO_PROFILE_RELEASE_STRIP=false`), `dist/{shape_dispatch_*,matmul}/{cpp-wasi-sdk,rust-raw}-size/`. Два независимых примера на двух языках:

| примитив | toolchain | таблица | доля бинаря |
|---|---|---|---|
| `__builtin_log` (bit-exact) | cpp/wasi-sdk | musl `__log_data` 4247 B | 70% от 6024 B (shape_dispatch_homo_static) |
| `usize::isqrt()` | rust/raw | core lookup 520 B | 32% от 1639 B (matmul) |

Обе — **фиксированный налог**: платится один раз за использование примитива, не масштабируется с объёмом данных/вызовов. Обе устранимы (polynomial log / Newton isqrt → таблица исчезает), но ценой: polynomial log даёт +21-23% warm на log-доминируемом цикле (wasi-sdk homo, node, `results/raw/2026-06-13-size-perf-{baseline,levers}`); Newton isqrt — без perf-цены, но оба — не-idiomatic ручная замена stdlib-примитива (рычаги откатлены, артефакты остаются idiomatic; находка задокументирована, не shipped).

**Phase:** introduced 1.2

**Caveats:** Размер маленьких synthetic-workload'ов доминируется фиксированным overhead'ом тулчейна + линковкой примитивов, НЕ структурой алгоритма: тот же `shape_dispatch_homo_static` — 1522 B (rust/raw) … 6024 B (cpp/wasi-sdk) … 12449 B (rust/bindgen, ~10 KB runtime), **8× разброс при ~1.5 KB реальной dispatch-логики**. Кросс-язычный вывод «язык X компактнее» из микро-workload'а НЕВАЛИДЕН — сравнивай within-toolchain либо декомпозируй floor-vs-marginal (теперь first-class в отчёте, вкладка Size — см. claim про floor-vs-marginal выше).

## Toolchain choice

### На V8 runtimes (Node + Chromium) для u64-keyed hashmap'ов выбирай `rust/bindgen` (std HashMap); для string-keyed выбирай `js Map` — кросс-toolchain профайл инвертируется на key type
**Status:** confirmed
**Evidence:** Phase 1.1.2.1, `results/raw/2026-05-26-phase-1-1-2-1/hashmap_{int,string}_lookup__*-speed__{S,M}__{node,chromium}.json`. Warm-median per `run(N)` call (lookup hot loop, N=1000 для S, N=10000 для M), eval mode:

| key | env | size | rust/bindgen | cpp/emscripten | js/idiomatic |
|---|---|---|---|---|---|
| u64 | node | S | **0.0043** | 0.0077 | 0.0093 |
| u64 | node | M | **0.044** | 0.107 | 0.181 |
| u64 | chromium | S | **0.005** | 0.010 | 0.015 |
| u64 | chromium | M | **0.060** | 0.165 | 0.200 |
| str | node | S | 0.017 | 0.017 | **0.0077** |
| str | node | M | 0.188 | 0.216 | **0.117** |
| str | chromium | S | 0.015 | 0.015 | **0.010** |
| str | chromium | M | 0.215 | 0.185 | **0.105** |

Воспроизводимо через 2 sizes (S, M) × 2 key types × 2 V8 runtimes. Pattern: Rust HashMap winning u64 by ~2× over C++ и ~3-4× over JS; JS Map winning strings by ~2× over Rust/C++.

**Phase:** introduced 1.1.2 (Node only) / refined 1.1.2.1 (V8 cross-runtime confirmation, +chromium)

**Caveats:** Only lookup hot loop measured (insert/delete показывают similar profile). На Firefox (SpiderMonkey) pattern инвертируется — см. отдельный claim ниже. Fixture keys uniform random (no adversarial collision profile). Insert at size L for hashmap_int has 4 duplicate keys (0.004%, checksum 99996<100000) из-за 53-bit key space — affects checksum semantics (dup-key value policy, теперь last-wins; fixed Phase 1.2 `8cf09e3`), не runtime profile.

Mechanism (Rust on u64): std HashMap uses RandomState (SipHash) + Robin-Hood open addressing. u64 key path: hash via SipHash → probe via integer compare → branch-free hit path. Bindgen marshalling для primitive return f64 is zero-overhead (direct return).

Mechanism (Rust on String): wasm-bindgen marshals JS strings → wasm-side `String` allocation + UTF-8 copy per `load_input` pair, then SipHash<String> for lookup. Allocation pressure + dynamic-length hash dominates the loop.

Mechanism (JS on string): V8 Map<string, number> uses string interning + pointer equality for hash hits (fast string compare). Числовые keys в JS Map проходят through Number boxing + identity hashing — slower than V8's string fast path.

### На Firefox (SpiderMonkey) hashmap toolchain choice инвертирован vs V8: для u64 предпочитай `js Map`, для string — `rust/bindgen` или `cpp/emscripten`
**Status:** tentative
**Evidence:** Phase 1.1.2.1, `results/raw/2026-05-26-phase-1-1-2-1/hashmap_{int,string}_lookup__*-speed__M__firefox.json`. Warm-median, Firefox stable (geckodriver):

| key | size | rust/bindgen | cpp/emscripten | js/idiomatic |
|---|---|---|---|---|
| u64 | M | 0.080 | 0.120 | **0.060** |
| str | M | **0.240** | **0.240** | 0.640 |

Firefox S size sub-resolution: `performance.now()` precision в Firefox ~20µs (vs Node/Chromium ~1-5µs), lookup loops при S < 30µs → median rounds to 0. Только M informative.

**Phase:** introduced 1.1.2.1

**Caveats:** Single-size observation — single-runtime tentative до cross-size confirmation (нужны увеличенные N для S чтобы преодолеть Firefox `performance.now()` precision floor, либо L-size data за пределами текущего eval budget). Mechanism uncertain: SpiderMonkey hashmap implementation, JIT inlining behavior, или string interning trade-offs differ от V8 — investigation backlog item. Pattern не следует слепо переносить на Safari (WebKit) без отдельных измерений.

### Для hot, sub-µs JS↔Wasm functions предпочитай `rust/raw extern "C"` или `cpp/wasi-sdk` — `wasm-bindgen` добавляет per-call overhead в диапазоне +3% .. +94% (median ~+20%)
**Status:** confirmed
**Evidence:** Phase 1.1.2.1, `results/raw/2026-05-26-phase-1-1-2-1/interop_calls_*__rust-{raw,bindgen}-speed__M__{node,chromium,firefox}.json`. M-size (1M calls/sample), warm-median ns/call (eval mode):

| env | entry | raw | bindgen | Δ |
|---|---|---|---|---|
| node | noop | 1.82 | 2.06 | +13% |
| node | add_i32 | 1.86 | 2.27 | +22% |
| node | add_f64 | 2.96 | 3.58 | +21% |
| chromium | noop | 2.24 | 2.32 | +4% |
| chromium | add_i32 | 2.49 | 4.83 | **+94%** |
| chromium | add_f64 | 2.49 | 3.58 | +44% |
| firefox | noop | 1.94 | 2.40 | +24% |
| firefox | add_i32 | 3.90 | 4.00 | +3% |
| firefox | add_f64 | 2.74 | 2.86 | +4% |

Direction (raw < bindgen) consistent across 9/9 (env, entry) pairs. Magnitude varies широко — Chromium add_i32 +94% — outlier; medianный overhead ~+20%.

**Phase:** introduced 1.1.1 / refined 1.1.2.1 (cross-runtime confirmation, magnitude range widened)

**Caveats:** Single workload class (тривиальные сигнатуры — `()->()`, `(i32,i32)->i32`, `(f64,f64)->f64`). Overhead absolute small (~0.05-2.3 ns/call) и тонет в шуме при wasm body > ~50 ns (e.g. `matmul` где gap внутри CV). Для product code с редкими crossings (DOM events, RAF callbacks) разница не важна; для горячих циклов с миллионами JS↔Wasm calls — preferable. Magnitude variance high (especially Chromium add_i32 +94% outlier) — для product decision проверь на target signature shape.

Mechanism: wasm-bindgen генерирует JS shim per export, который маршалит args/ret через shared memory + maintains FinalizationRegistry для GC-aware refcells. Для тривиальных primitive-only signatures shim просто forward'ит вызов, но добавляет typeof checks + arity adjust + (Rust-side) bindgen-instrumented entry. Raw `extern "C"` экспортирует через direct call ABI, no JS-side shim.

### Для bulk-data контейнеров (данные пересекают boundary один раз через `load_input`) выбор `rust/raw` над `rust/bindgen` — чистый size-выигрыш, не runtime: warm per-op throughput совпадает в пределах шума
**Status:** confirmed
**Evidence:** Phase 1.2, `results/raw/2026-06-13-phase-1-2-hashmap-no-glue/hashmap_{int,string}_{insert,lookup,delete}__rust-{raw,bindgen}-speed__M__node.json`. Warm-median per `run(N)` @M node (N=10000), eval mode:

| workload | op | rust/raw | rust/bindgen | Δ |
|---|---|---|---|---|
| int | insert | 0.0726 | 0.0749 | −3% |
| int | lookup | 0.0489 | 0.0503 | −3% |
| int | delete | 0.0629 | 0.0667 | −6% |
| str | insert | 0.2390 | 0.2392 | ~0 |
| str | lookup | 0.2126 | 0.2111 | +1% |
| str | delete | 0.5266 | 0.4867 | +8% |

Все Δ в пределах measurement noise (±8%, без consistent direction по 2 key-types × 3 ops). glue сидит на boundary `load_input` (одноразовый marshalling фикстуры), не в `run()` hot loop → стрип glue не трогает warm-throughput, только artifact size (см. Artifact size § glue-floor).

**Phase:** introduced 1.2

**Caveats:** Чистый A/B только для **Rust** (rust/raw vs rust/bindgen: тот же rustc/std/HashMap/SipHash, отличие лишь glue). cpp/wasi-sdk vs emscripten — НЕ чистый glue-A/B (разные libc/optimizer): e.g. int lookup @M wasi 0.055 vs emscripten 0.111 (2×) — это toolchain/libc артефакт, не glue. Claim — про raw-vs-bindgen ВНУТРИ Rust. Для workload'ов, пересекающих JS↔wasm boundary **per-call** (тривиальные горячие функции — см. interop claim выше), glue добавляет per-call overhead — там runtime отличается. Здесь данные грузятся один раз, hot loop целиком wasm-side.

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

под `--mode=eval` (warmup=10, samples=30-100) у `*_lookup` entries при size S детерминированно падает в `default:` ветку на первом optimized run-call. Воспроизводимо на обоих workload'ах (hashmap_string + hashmap_int) при eval+S+lookup. `--jitless` устраняет (подтверждение V8 JIT-cause).

**Workaround в этом репо:** factory-time dispatch — `create(entry)` возвращает специализированные `runFn`/`resetFn` closures (один switch на factory call, никакого switch'а внутри hot loop). Корректность восстановлена; bundle marginally smaller (~7% raw). Apply в commit `0cc508b` для hashmap_string + hashmap_int.

**Phase:** introduced 1.1.2 / root-caused 2026-05-26 (post-phase investigation)

**Caveats:** Bug строго **V8 12.4-only** (Node 22.x). Verified clean на Node 20.19.5 (V8 11.3) и Node 24.14.1 (V8 13.6) — то есть исправлено upstream между V8 minor releases. Workaround сохраняем permanent: Node 22 — current LTS до 2027-04, и pattern-class общий (любой closure-const switch с default-branch template-literal в hot loop потенциально fragile через JIT codegen bugs аналогичного класса). Repro требует ОБА триггера: (1) tsx CLI invocation (`pnpm exec tsx` ⇔ `node --require preflight.cjs --import loader.mjs`) — bare `node script.mjs` без preflight НЕ воспроизводит; (2) full harness "competing work" volume — изолированный minimal repro под тем же tsx invocation тоже НЕ воспроизводит. Preflight.cjs + Zod parses + multi-module import graph совместно сдвигают turbofan tier-up timing в момент пустого feedback slot [67]. См. bug-report § Heisenbug attribution.

Mechanism (confirmed, V8 12.4 deopt-eager codegen bug): turbofan компилирует `run` ("hot and stable"). Default branch содержит template literal `` `...${entry}` `` — его string-concat `Add` instruction (bytecode offset 427) имеет пустой feedback slot [67], т.к. default never executed. Turbofan ставит deopt-eager guard, но deopt continuation point miscomputed — interpreter резюмит выполнение с bytecode offset 427 (`Add r10 [67]` → `Construct Error` → `Throw`) вместо корректного location в lookup-ветке. Trace: `[bailout deopt-eager, reason: Insufficient type feedback for binary operation, bytecode offset 427]`. Bug class — недостаточная feedback в never-executed branch заставляет turbofan deopt'ить, но resume-point вычислен неправильно.

### При портировании hashmap/словаря между языками явно фиксируй duplicate-key policy — last-wins (`operator[]=`/`Map.set`/`HashMap::insert`), не first-wins (`emplace`/`entry().or_insert()`)
**Status:** confirmed
**Evidence:** Phase 1.2, `docs/superpowers/bug-reports/2026-06-13-hashmap-int-emplace-dupkey.md`; fix `benches/hashmap_int/cpp/src/hashmap_int.cpp` (commit `8cf09e3`); reference `benches/hashmap_int/validate/reference.ts`. C++ `unordered_map::emplace` тихо расходился с JS `Map.set` / Rust `HashMap::insert` на 4 дубль-ключах L-fixture → lookup checksum `213953188581571` вместо `213944096178963`.
**Phase:** introduced 1.2
**Caveats:** Проявляется только когда ключ повторяется во входе — на uniform/малых fixtures дубликатов может не быть (hashmap_int: дубли только на L, N=100k; S/M чисты). first-wins контейнеры: C++ `emplace`/`insert`, Rust `entry().or_insert()`. last-wins: C++ `operator[]=`/`insert_or_assign`, Rust `HashMap::insert`, JS `Map.set`. Расхождение тихое (нет ошибки) — результат отличается лишь на дубль-ключах, потому всплывает только на больших N.

Mechanism: `std::unordered_map::emplace` по стандарту НЕ перезаписывает существующий ключ (no-op, если ключ уже есть) — остаётся первое вставленное значение. Reference-контейнеры (last-wins) перезаписывают. Отсюда тихое расхождение значений строго на повторяющихся ключах; на L каждый дубль-ключ читается дважды при lookup, но удаляется один раз при delete (lookup-diff = 2× delete-diff).

### Не используй `thread_local!` для глобального состояния в wasm32 cdylib — бери `static SyncCell<T>` с vacuous `Sync` impl
**Status:** tentative
**Evidence:** Phase 1.1.0 W5.3, `benches/matmul/rust/bindgen/src/lib.rs` (commit `2dea1d5`). Замена `thread_local! { static STATE: RefCell<State> }` на `static STATE: SyncCell<State>` с `unsafe impl Sync` (single-threaded vacuous) дала -751 B (speed profile) / -689 B (size profile) на raw wasm. Phase 1.1.2 подтвердила pattern на 2 новых workload'ах (hashmap_string, hashmap_int) — но для типов с non-const init (e.g. `HashMap::new()` нельзя в `const fn`) нужен wrapper `static STATE: LazyLock<SyncCell<State>>` вместо прямого `static`.
**Phase:** introduced 1.1 / refined 1.1.2
**Caveats:** Применимо только для targets без реальных threads (wasm32-unknown-unknown). Для threads-enabled wasm или native targets — нужен реальный sync primitive (Mutex/OnceLock). Если state type содержит non-const constructors (e.g. `HashMap` с default RandomState hasher) — оборачивай в `LazyLock` (`use std::sync::LazyLock`); LazyLock инициализируется лениво при первом обращении.

Mechanism: `thread_local!` разворачивается в `LocalKey<T>` с lazy-init shim'ом (atomic-guarded init state + `.with()` dispatch + panic paths для TLS destruction). На single-threaded wasm32 — pure overhead. `SyncCell<T>(RefCell<T>)` с `const fn new()` — обычная константная инициализация, прямой доступ через `STATE.0.borrow_mut()`. RefCell runtime borrow checks остаются (микроскопические). Под `LazyLock` — добавляется один atomic-guarded init check at first access, после прогрева indistinguishable от direct static.

### Не оставляй `#[wasm_bindgen]` exports «на будущее» — каждый dead export тянет свою call chain
**Status:** tentative
**Evidence:** Phase 1.1.0 W5.2, `benches/matmul/rust/bindgen/src/lib.rs` (commit `af475be`). Удаление dead `output_view() -> Vec<u8>` экспорта (никто не вызывал в production) уменьшило wasm на -716 B (speed) / -451 B (size).
**Phase:** introduced 1.1
**Caveats:** `tentative` до Phase 1.1.1+ workload'ов для cross-workload подтверждения. Effect масштабируется от complexity export'а (alloc + marshalling glue).

Mechanism: `#[wasm_bindgen]` export keeps его call chain alive — `Vec<u8>` тянет global allocator + growth/drop machinery, `slice::to_vec()` — wasm-side allocation + memcpy, wasm-bindgen glue marshal'ит `Vec<u8>` → JS `Uint8Array` через shared memory. LLVM DCE не может убрать code reachable from exported symbol.

### В hot dispatch loops предпочитай static dispatch (generics/templates, enum `match`, `switch(tag)`) над dynamic (vtable / `dyn Trait` / virtual) — на native wasm overhead зависит от monomorphic-ности call site: +8…29% когда один тип на цикл, +50…130% когда типы interleaved
**Status:** confirmed
**Evidence:** Phase 1.1.3, `results/raw/2026-06-02-phase-1-1-3/shape_dispatch_{homo,mixed}_{static,dyn}__*-speed__{M,L}__{node,chromium,firefox}.json`. Warm-median per `run(N)` call (N = innerIterations: M=10000, L=100000 shapes), eval mode. Headline — env=node, size=L (наиболее reliable; sub-ms medians на S и на Firefox тонут в timer-quantization):

| toolchain | layout | static (ms) | dynamic (ms) | Δ% |
|---|---|---|---|---|
| cpp-emscripten | homo | 0.350 | 0.447 | +28% |
| cpp-wasi-sdk | homo | 0.389 | 0.496 | +27% |
| rust-raw | homo | 0.580 | 0.699 | +20% |
| rust-bindgen | homo | 0.542 | 0.655 | +21% |
| cpp-emscripten | mixed | 0.607 | 1.194 | **+97%** |
| cpp-wasi-sdk | mixed | 0.562 | 1.154 | **+105%** |
| rust-raw | mixed | 0.878 | 1.323 | +51% |
| rust-bindgen | mixed | 0.827 | 1.261 | +53% |

Direction (static < dynamic) consistent across 4 native toolchains × {M, L} sizes × {node, chromium, firefox}. M-size corroborates (homo +15…43%, mixed +56…235%). Chromium/Firefox L corroborate direction (mixed +63…127%); единственные инверсии — Chromium homo M/L где значения квантуются в один 5µs bin (e.g. 0.05 vs 0.04).

**Phase:** introduced 1.1.3

**Caveats:** Single workload (`shape_dispatch`). Per-shape body — ~12 FP ops + sqrt + ln (~3.5–13 ns/shape native). Для тяжелее тел relative overhead падает (dispatch тонет в работе); для тривиальных тел — растёт. **Mixed-dynamic penalty confounded**: mixed_dyn платит ОДНОВРЕМЕННО за (a) непредсказуемый indirect-call/vtable (BTB miss на interleaved типах) и (b) pointer-chasing по heap-allocated объектам (cache misses), тогда как homo_dyn — monomorphic per-loop (BTB predicts) + per-type contiguous storage. Поэтому mixed-dynamic — самый дорогой угол suite (~13 ns/shape vs ~3.5–8.8 для static). Не translate'ится на JS — см. отдельный claim ниже. C++ показывает больший mixed-dispatch penalty чем Rust на L (~+100% vs ~+51%), вероятно из-за разницы в codegen vtable thunks.

Mechanism: static dispatch резолвится на compile-time — call inlines, no indirection. `homo_dyn` сохраняет vtable (`call_indirect` в wasm, verified > 0 во всех `*_dyn` артефактах), но call site monomorphic (один concrete тип на цикл) → BTB предсказывает target, cache locality сохранена. `mixed_dyn` — polymorphic-3 call site над interleaved heap objects: indirect-call target меняется per-iteration (BTB misses) + objects разбросаны по heap (worst-case Triangle-stride slots + pointer array → cache-line waste). Anti-devirt friction (`core::hint::black_box` / volatile sink) preventing compiler от devirtualizing обратно в static.

### Monomorphization (N специализированных циклов под N типов) vs single tag-`switch`/enum-`match` loop — это size-за-locality trade: +440…540 B (cpp + rust/raw) .. +1.0–1.6 KB (rust/bindgen) на raw wasm
**Status:** confirmed
**Evidence:** Phase 1.1.3, `dist/shape_dispatch_{homo,mixed}_static/*/` meta (artifact size env/size-invariant). `homo_static` эмитит 3 мономорфизированных копии loop body (по одной на Circle/Square/Triangle); `mixed_static` — один `switch(tag)`/`match` loop. Raw wasm bytes:

| toolchain | profile | homo_static | mixed_static | Δraw | Δ% |
|---|---|---|---|---|---|
| cpp-emscripten | speed | 6246 | 5802 | +444 | +7.7% |
| cpp-emscripten | size | 1659 | 1178 | +481 | +41% |
| cpp-wasi-sdk | speed | 6155 | 5661 | +494 | +8.7% |
| cpp-wasi-sdk | size | 6024 | 5491 | +533 | +9.7% |
| rust-raw | speed | 1839 | 1401 | +438 | +31% |
| rust-raw | size | 1522 | 1057 | +465 | +44% |
| rust-bindgen | speed | 15027 | 13458 | +1569 | +12% |
| rust-bindgen | size | 12449 | 11392 | +1057 | +9.3% |

Direction (monomorphized > switch) consistent across 4 toolchains × 2 profiles. Absolute Δraw стабилен (~440–540 B для cpp + rust/raw; bindgen +1.0–1.6 KB на своём большем baseline). `homo_dyn` vs `mixed_dyn` показывает тот же паттерн.

**Phase:** introduced 1.1.3

**Caveats:** Single workload, K=3 типа. Δ% наибольший на малых baselines (rust/raw size +44%, cpp-emscripten size +41%) — fixed monomorphization cost доминирует tiny binaries; на больших baselines +7…12%. gzip/brotli premium меньше raw (компрессор folds duplicated loop bodies → для transfer-size бюджета эффект слабее). Trade важен когда K растёт ИЛИ per-type body большой; для K=2–3 малых тел дешевле один switch. Runtime homo_static vs mixed_static **не** clean A/B (отличаются и layout, и dispatch — см. dispatch claim выше); этот claim строго про artifact size.

Mechanism: generic `process<S>` (Rust) / `template process<S,FN>` (C++) монорфизируется в отдельную функцию per type — N копий identical-shaped loop с разными inlined score-телами. Single `switch(tag)` loop — один code path с branch per iteration. Compile-time дешевле в байтах при тех же типах; ценой per-iteration branch (который и есть mixed_static's slight runtime cost vs monomorphized).

### В JS dynamic dispatch почти бесплатен (polymorphic-3 IC vs monomorphic: +0.6…9% на L) — в отличие от native wasm (+50…130%); не реструктурируй JS object models ради IC monomorphism
**Status:** tentative
**Evidence:** Phase 1.1.3, `results/raw/2026-06-02-phase-1-1-3/shape_dispatch_{mixed_static,mixed_dyn,homo_dyn}__js-idiomatic-speed__L__{node,chromium,firefox}.json`. Warm-median, L (N=100000):

| env | mixed_static (mono IC) | mixed_dyn (poly-3 IC) | Δ% | homo_dyn (3 mono loops) |
|---|---|---|---|---|
| node | 4.500 | 4.674 | +3.9% | **4.132** |
| chromium | 3.118 | 3.135 | +0.6% | **3.025** |
| firefox | 2.180 | 2.380 | +9.2% | **1.840** |

mixed_static = единый `TaggedShape` class (один hidden class → monomorphic property access + top-level `switch(kind)`); mixed_dyn = 3 classes в одном массиве (polymorphic-3 megamorphic-ish call site). Gap всего +0.6…9.2% — на порядок меньше native dynamic-dispatch penalty (+50…130% те же binaries). `homo_dyn` (3 monomorphic per-class loops) consistently самый быстрый JS вариант.

**Phase:** introduced 1.1.3

**Caveats:** `tentative` — single workload, single JS toolchain (idiomatic), и effect местами у timer-quantization floor (Chromium +0.6% — в пределах 5µs bin). JS absolute ~5–7× slower native static (node L 4.5 ms vs 0.58–0.88 ms) — IC-tuning не закрывает этот gap. Top-level `score()` function (не closure-const switch в hot loop) обязателен независимо — см. V8-deopt claim выше. Не переносить на не-V8/SpiderMonkey движки без проверки.

Mechanism: V8/SpiderMonkey хранят inline-cache state per call site; polymorphic IC (≤4 hidden classes) резолвится через small dispatch table — cheap relative к wasm `call_indirect` (нет cross-table bounds check + indirect branch misprediction той же стоимости). Object-graph indirection присутствует в JS в обоих вариантах (всё heap-allocated boxed), поэтому mixed-vs-homo layout difference washed out — в противоположность native, где inline enum array (contiguous) vs boxed pointers (chase) даёт +50…105% (тот же layout-эффект, что доминирует native suite, в JS ≈ 0).
