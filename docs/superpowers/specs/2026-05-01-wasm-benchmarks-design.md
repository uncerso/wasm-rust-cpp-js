# wasm-rust-cpp-js: дизайн benchmark suite

**Дата:** 2026-05-01
**Статус:** Дизайн утверждён, готов к написанию плана имплементации

## Цель

Создать набор бенчмарков, который сравнивает C++, Rust и JavaScript при компиляции в WebAssembly (для C++/Rust) и нативном исполнении (для JS) по двум осям:

1. **Размер артефактов** — `.wasm` модули относительно друг друга и относительно JS, с учётом JS-glue/loader-кода.
2. **Производительность** — раздельно для startup (fetch / compile / instantiate / first call) и steady-state runtime, плюс память и стоимость JS↔Wasm interop.

Сравнение должно быть полезно для **инженерного решения** «когда стоит брать какой язык», а не выдавать одно сводное число.

## Решения, принятые в брейнсторме

| Решение | Значение |
|---|---|
| Среда запуска | Браузеры (Chrome, Firefox, Safari) + Node |
| Тулчейны | Полная матрица: Rust × {wasm-bindgen, raw} × {speed, size}; C++ × {Emscripten, wasi-sdk} × {speed, size}; JS × {idiomatic, typed-array} |
| Workloads | Группы: алгоритмы, interop, stdlib-контейнеры, static-vs-dynamic dispatch. Phase 1 — узкая выборка |
| JS в группе dispatch | Baseline для dynamic (своего static dispatch у JS нет) |
| Формат результатов | JSON в `results/raw/`, статический HTML-отчёт в `results/summarized/` |

## Архитектура

Monorepo на pnpm workspaces. Три уровня:

1. **Декларативный источник правды.** Каждый workload — самостоятельный пакет `benches/<id>/` со `spec.json`, фикстурами и реализациями в `cpp/`, `rust/`, `js/`.
2. **Сборочный слой.** Скрипты `scripts/build-*.ts` обходят матрицу `<workload> × <язык> × <тулчейн> × <профиль>` и собирают артефакты в `dist/<workload>/<lang>-<toolchain>-<profile>/` с обязательным `meta.json` (raw/gzip/brotli размеры, hash, checksum входов).
3. **Слой запуска и сбора.** Два раннера используют общий `harness` и пишут JSON в `results/raw/<timestamp>/`. Отдельный `reporter` агрегирует JSON-ы в HTML.

```
bench-suite/
  benches/<id>/{spec.json, fixtures/, cpp/, rust/, js/, validate/}
  packages/
    harness/        # BenchModule contract, measure, validate
    loaders/        # один loader на (lang × toolchain): raw-wasm, wasm-bindgen, emscripten, plain JS
    result-schema/  # zod-схема + версия
    reporter/       # JSON → HTML
  apps/
    runner-web/     # Vite + Playwright headless: Chrome/Firefox/Safari
    runner-node/    # node + WebAssembly API
  scripts/          # build-rust, build-cpp, collect-sizes, run-matrix, smoke
  dist/             # собранные артефакты (gitignore)
  results/
    raw/<timestamp>/        # сырые JSON по одному на (workload, env, lang, toolchain, profile, size)
    summarized/<timestamp>/  # сгенерированный HTML
```

**Поток данных.** `scripts/run-matrix.ts` принимает фильтры (workload, env, lang, toolchain, profile, size) и mode (`quick`/`eval`), обходит комбинации, дёргает соответствующий runner, собирает JSON в одну папку, передаёт в reporter. Один прогон = одна папка под `results/raw/` с timestamp.

**Ключевое архитектурное решение.** `loaders` отделены от `harness`. Harness знает только про интерфейс `BenchModule`. Loader решает, как извлечь этот интерфейс из конкретного артефакта (raw wasm — через `WebAssembly.instantiate` руками; wasm-bindgen — через сгенерированные обёртки; Emscripten — через `Module.cwrap` поверх плоских C-экспортов; JS — через прямой импорт). Это позволяет менять тулчейн, не переписывая workload.

Embind для Emscripten в Phase 1 не используется — он генерирует C++-стиль API в JS, что превращается в сравнение «Embind binding generation» вместо «языков». Если Embind интересен сам по себе, он добавляется в Phase 2 как отдельная ось `cpp-embind`.

## Контракт BenchModule и методология измерений

### Интерфейс

```ts
interface BenchModule {
  loadInput(input: Uint8Array): void;     // подготовка, не входит в run()
  run(iterations: number): RunResult;     // ТОЛЬКО compute
  readOutput(): TypedArray | Uint8Array;  // материализация результата
  reset?(): void;
  dispose?(): void;
}
interface RunResult {
  checksum: number | string;
  logicalOps?: number;
}
```

`init()` — забота loader'а: `loader.load(): Promise<{module: BenchModule, timings: InitTimings}>`. Loader разделяет init на четыре фазы:

- **fetch** — получение байт артефакта (для wasm и JS вместе с loader-glue);
- **compile** — `WebAssembly.compile()` либо парс JS;
- **instantiate** — `WebAssembly.instantiate()` либо JS module init;
- **firstCall** — первый вызов `run(1)` (засекает tier-up V8/SM/JSC).

### Цикл измерения одного кейса

1. `loader.load()` → получить модуль + `initTimings`.
2. `module.loadInput(fixture)` — не мерится, но логируется.
3. `firstCall = module.run(1)` — отдельная метрика. **Checksum от `run(1)` НЕ валидируется** (см. § «Checksum-семантика workload'а» ниже): он нужен только для timing'а tier-up'а.
4. **Warmup**: фиксированное число итераций (≥10× для V8 tier-up до Turbofan), результаты выкидываются.
5. **Sample loop**: повторяющиеся блоки `module.run(N)`, где `N = spec.inputSizes[size].innerIterations ?? config.innerIterations`; между блоками `reset?()`. Минимум 30 sample'ов в Phase 1, авто-расширение до 100 при CV>5%.
6. После каждого блока валидация checksum против `spec.expectedChecksums[entry][size]`.
7. Агрегация: median, p95, p99, stddev, min, max, n_samples, CV.

### Checksum-семантика workload'а

Spec нового workload'а **обязан** явно проговорить три инварианта, иначе harness и loaders могут давать ложно-валидные или ложно-невалидные результаты. Эти инварианты исторически были implicit (matmul их удовлетворял случайно) и attributed к surprise в Phase 1.1.1 (interop_calls).

1. **Iter-семантика checksum'а.** Один из двух режимов, прописывается в `spec.json § ioContract` / spec description:
   - **Iter-invariant** (matmul-style): `run(N)` делает N полных «единиц работы», но результат каждой единицы НЕ зависит от N (например, matmul reset'ит C[] перед каждой итерацией → `abs_sum(C)` инвариантен). `expectedChecksum` валиден для любого N.
   - **Iter-dependent** (interop_calls-style): `run(N)` — это N маленьких операций, checksum накапливается (counter, JS-accumulator). `expectedChecksum` определён для **конкретного N = innerIterations**, который объявлен в `spec.inputSizes[size].innerIterations`.

2. **Per-call state leakage.** Есть ли state в wasm/JS module, который persist'ит между двумя `run()` вызовами одного modulа? Если да (например, noop counter в interop_calls) — loader должен возвращать **delta** на одном вызове (counter_after − counter_before), а не absolute. Иначе harness'овский cycle `loadInput → run(1) → warmup → samples` корраптит checksum накопленным history.

3. **`innerIterations` ratio.** Для iter-dependent workload'ов: какое N для каждого размера (S/M/L) даёт «человекомерное» время (>>100× resolution `performance.now()`, но <<10 секунд per sample)? Записывается в `spec.inputSizes[size].innerIterations` (optional field, fallback на CLI `--mode` default = 1).

**Harness contract follow-up.** `packages/harness/src/measure.ts` валидирует checksum **только** в warm-samples loop (`module.run(innerIterations)`), не на `run(1)`. Runner-node/web переопределяют `MeasureConfig.innerIterations` из spec'а, если поле объявлено. Loaders для arity-0 noop pattern (`<entry>_counter` companion) **обязаны** возвращать delta. См. `docs/pitfalls/2026-05-23-phase-1-1-1-execution.md` § P1 для full incident write-up.

### Метрики

| Категория | Метрики |
|---|---|
| Размер | `wasm_raw_bytes`, `wasm_gzip_bytes`, `wasm_brotli_bytes`, `js_glue_raw_bytes`, `js_glue_gzip_bytes`, `total_transfer_gzip_bytes`, `artifact_hash` |
| Startup | `fetch_ms`, `compile_ms`, `instantiate_ms`, `init_total_ms`, `first_call_ms` |
| Hot runtime | `warm_median_ms`, `warm_p95_ms`, `warm_p99_ms`, `warm_stddev_ms`, `warm_min_ms`, `warm_max_ms`, `n_samples`, `cv` |
| End-to-end | `e2e_median_ms` (init_total + first_call + один представительный run) |
| Память | `wasm_memory_bytes_peak`, `wasm_memory_delta_bytes` (after − before), `js_heap_used_after` (где доступно) |

### Антишум

- Все прогоны в браузере — внутри Web Worker (UI thread не вмешивается).
- В Node — без флагов `--jitless` для Phase 1; добавить можно позже отдельной осью.
- CV > 5% → результат помечается `noisy: true` в JSON и желтеет в HTML. Цифры не выкидываются — пользователь сам решает, что делать.
- Машинная инфа в каждом JSON: CPU, OS, RAM, browser version, node version, активные wasm features.

### Размер артефакта

Считается отдельным проходом `scripts/collect-sizes.ts` после билда — не зависит от рантайма. На каждый артефакт пишется `meta.json` с raw/gzip/brotli и hash. Размер JS-glue для wasm учитывается **отдельной строкой** — иначе wasm-bindgen и Emscripten кажутся «маленькими», но тащат 15-50 КБ JS.

### Память

- **Браузер:** `performance.measureUserAgentSpecificMemory()` где доступно (Chrome), `WebAssembly.Memory.buffer.byteLength` для linear memory, счётчик `memory.grow`.
- **Node:** `process.memoryUsage()` + linear memory.
- Снапшоты: после warmup и после steady-state (peak).

### Что НЕ мерим в Phase 1

- SIMD / threads — отдельная ось, отложена до Phase 2+.
- ICache / branch миссы — требуют perf-counter профайлера, не браузерная задача.
- GC pauses в JS — отдельная история, не нужна для Phase 1.

## Build-матрица

### Языки и тулчейны

| Язык | Тулчейн | Loader | Особенности |
|---|---|---|---|
| Rust | `wasm-bindgen` (через `wasm-pack`) | `loaders/rust-bindgen` | Сгенерированный JS-glue, удобный interop |
| Rust | `raw` (cargo + `wasm32-unknown-unknown`) | `loaders/raw-wasm` | Без bindgen, экспорты руками, минимальный размер |
| C++ | Emscripten (`emcc`) | `loaders/emscripten` | Стандартный путь, тащит libc/runtime |
| C++ | wasi-sdk (`clang + wasm-ld`) | `loaders/raw-wasm` | Минимальный, freestanding или с wasi-libc — выбирается per workload |

### JS-варианты

В каждом workload'е в `js/`:

- `idiomatic` — обычный JS с `Array`, `Map`, объектами. «Честная JS-сторона» для алгоритмических и stdlib-тестов.
- `typed-array` — оптимизированная версия на `Float64Array`/`Int32Array`/`Uint8Array`. Сильный baseline для compute-bound. Без него wasm выиграет «бумажно» против слабого JS.

Какой baseline применим — решается per workload в `spec.json`. Stdlib-тесты используют только `idiomatic` (там и тестируем `Array`/`Map`); compute-тесты — оба.

### Профили сборки

| Язык/тулчейн | `speed` | `size` |
|---|---|---|
| Rust (оба тулчейна) | `opt-level=3`, LTO=fat, `codegen-units=1`, `panic=abort` | `opt-level="z"`, LTO=fat, `codegen-units=1`, `panic=abort`, strip, `wasm-opt -Oz` |
| C++ Emscripten | `-O3 -flto`, `-fno-exceptions -fno-rtti`, `-s MODULARIZE=1 -s ENVIRONMENT=web,worker,node` | `-Oz -flto`, `-fno-exceptions -fno-rtti`, `--closure 1`, `wasm-opt -Oz` |
| C++ wasi-sdk | `-O3 -flto`, `-fno-exceptions -fno-rtti` | `-Oz -flto`, `--strip-all`, `wasm-opt -Oz` |
| JS | `esbuild --minify --target=es2022 --format=esm` (один профиль) | — |

### Жёсткие правила

- Версии тулчейнов пиннятся в `tool-versions.json` (rustc, emsdk, wasi-sdk, wasm-opt, esbuild) + `rust-toolchain.toml` + `.nvmrc` для node. Без этого результаты невоспроизводимы.
- Одна и та же версия `wasm-opt` для всех wasm-артефактов — иначе сравнение size-профилей лжёт.
- Все wasm-модули таргетят одинаковый набор features: MVP + bulk-memory + sign-ext + non-trapping-fp-to-int. Стабильно поддерживается всеми браузерами на 2026.
- Размер `dist/<workload>/<lang>-<toolchain>-<profile>/` мерится целиком (`.wasm` + JS-glue + всё, что грузится в браузере) **и** отдельно `.wasm`-байты — оба в meta.

### Ограничение wasi-sdk freestanding

Для C++/wasi-sdk без libc не скомпилируются stdlib-контейнеры (`std::unordered_map`, `std::vector` etc.) без подсадки аллокатора и `memcpy`/`memset`. Решение:

- Для **stdlib-группы** wasi-sdk собирается **с wasi-libc** + JS-шим в браузере (`@bjorn3/browser_wasi_shim` или эквивалент).
- Для **алгоритмики и dispatch** wasi-sdk собирается **freestanding** (без libc) — там видно «голый язык».
- Поддержка тулчейна декларируется в `spec.json`: `supported_toolchains: [...]`. Если тулчейн не указан, workload его пропускает.

### Объём матрицы

На один workload: до 8 wasm-вариантов (Rust×2×2 + C++×2×2) + 1-2 JS-варианта = до 10 артефактов. На 4 workload'а Phase 1 — до 40. Build-граф решается простой `make`-подобной таской `scripts/build-all.ts` с проверкой по hash входов.

## Phase 1: что делаем в первой итерации

Phase 1 разбит на 1.0 (vertical slice) и 1.1 (расширение по группам). Первый прогон — один workload во всей матрице, чтобы зафиксировать harness до того, как множить workloads.

### Phase 1.0 — Vertical slice: `matmul`

Один workload — наивный dense matrix multiply (`f64`, классический O(n³), без cache-blocking; размеры S=64×64, M=256×256, L=1024×1024). Простой, без аллокаций в горячем пути.

I/O-контракт для совместимости с wasi-sdk freestanding: harness аллоцирует входные матрицы A, B и выходную C в linear memory wasm-модуля до запуска (через экспорт `alloc_buffer(size)` или фиксированные смещения). C++/Rust-имплементации работают с этими буферами напрямую — никаких аллокаций в самих модулях, libc не нужен.

Готовность Phase 1.0:

- Полная матрица сборки: 8 wasm-вариантов + 2 JS-варианта собираются одной командой, попадают в `dist/` с `meta.json`.
- Оба раннера: `runner-node` и `runner-web` пишут корректные JSON. Web покрывает Chrome + Firefox через Playwright headless. Safari — опционально (требует macOS-specific webkit driver, можно отложить в Phase 1.1).
- Все ключевые метрики работают: размеры (raw/gzip/brotli), все четыре фазы init, warm-runtime со статистикой, peak linear memory.
- Reporter генерирует HTML с одной страницей matmul: таблица «(lang, toolchain, profile) × метрики», bar-chart размеров, time-series для warm-runtime.
- Валидация: ожидаемая checksum (например, `sum(abs(C))`) в `spec.json`, harness фейлит прогон при расхождении.

### Phase 1.1 — Расширение по группам

Добавляются три workload'а, по одному из каждой оставшейся группы:

| Workload | Группа | Что проверяет |
|---|---|---|
| `interop_calls` | Interop | 100k–1M коротких вызовов JS↔Wasm. Для wasm-bindgen vs raw — стоимость границы. |
| `hashmap_workload` | Stdlib | `std::unordered_map` / `Rust HashMap` / `JS Map` — insert + lookup + delete. Главный сигнал: размер артефакта (libc++ против rust-std против JS). |
| `shape_dispatch` | Dispatch | Обход коллекции «фигур» (circle/square/triangle), вычисление area. Static: templates / generics + monomorphization. Dynamic: `virtual` / `dyn Trait` / JS class hierarchy. По два бинарника на C++/Rust (static и dynamic), JS — один. |

Phase 1.1 фиксирует:

- Workload-специфичные нюансы тулчейнов в `spec.json` (`supported_toolchains`).
- HTML-репорт получает страницу-сводку с cross-workload comparison: лидеры по группам.
- Заметные несовпадения с интуицией попадают в секцию «Findings» в HTML с короткой заметкой.

### Что НЕ входит в Phase 1

- SIMD / threads.
- Safari, если нет macOS-машины (включается, как только она появится).
- Node `--jitless` или другие low-level флаги.
- Алгоритмы из академического набора кроме matmul (sort, parsing, mandelbrot — Phase 2+).
- CI-интеграция и tracking результатов через время — пока локальные прогоны.

### Критерий «Phase 1 готов»

Один человек на чистой машине после `pnpm install && pnpm bench:all` через ~30-60 минут получает `results/summarized/<timestamp>/index.html`, в котором понятен ответ: «как 4 workload'а × 4 тулчейна × 2 профиля × 3 размера ведут себя в Chrome, Firefox, Node».

## Тестирование, валидация, идемпотентность

### Корректность результатов

Каждый `spec.json` содержит ожидаемый checksum для каждой комбинации `(workload, input_size)`. Checksum — функция от output'а (не времени). Например: для matmul — `sum(abs(C))`, для hashmap — финальный `size()` + хэш ключей.

- Checksum валидируется **на каждом sample** (не только в конце).
- При расхождении прогон фейлится с маркером `correctness_failed: true`.
- **Некорректный прогон не публикуется в HTML как победитель.**
- Источник правды: JS-реализация (проще всего отлаживается). Checksum один раз генерируется и коммитится в `spec.json`. Все остальные реализации обязаны давать ту же checksum bit-for-bit.

Это автоматически ловит:
- неправильную семантику в C++/Rust порте,
- проблемы с endianness в загрузке fixtures,
- забытый `reset()` между sample'ами.

### Тесты harness'а

`packages/harness` — код, без которого все измерения мусор. Юнит-тесты на `vitest`:
- `measure.ts`: формулы median/p95/CV, прогрев, пороги «noisy».
- `validation.ts`: проверка checksum-механики на синтетических BenchModule.
- Интеграционный тест: `MockBenchModule`, который врёт по времени детерминистично — harness должен выдать ожидаемые цифры с допуском.

### Тесты loader'ов

`packages/loaders` тестируется на минимальном «hello-bench» wasm/JS-модуле, который возвращает фиксированную checksum. Ловит:
- сломанный glue (wasm-bindgen меняет API между версиями),
- неправильные init-фазы (compile/instantiate перепутаны),
- забытые экспорты в raw-wasm.

### Smoke-тест полной матрицы

`scripts/smoke.ts` собирает и запускает только S-размер `matmul` через всю матрицу + оба раннера. Прогон ~2 минуты. Запускается перед каждым полным прогоном — гарантирует, что инфра не сломана. Если smoke упал — полный прогон не стартует.

### Воспроизводимость

- Версии тулчейнов: `tool-versions.json`, `rust-toolchain.toml`, emsdk version, wasi-sdk version, `.nvmrc`.
- Checksum входных fixtures (sha256) в `spec.json`. Harness валидирует, что прочитал ровно ту fixture.
- JSON содержит **всё** для дешифровки прогона: версии тулчейнов, hash артефактов (`.wasm` + glue), browser version, machine info, флаги. Один JSON — самодостаточная карточка.
- Reporter без state'а: одна и та же папка `results/raw/<timestamp>` всегда даёт идентичный HTML.

### Статистическая дисциплина

- CV > 5% → `noisy: true`, жёлтый цвет в HTML. Сигнал «не делайте выводов, увеличьте sample count».
- Минимум 30 samples в Phase 1, авто-увеличение до 100 при CV>5%, дальше harness сдаётся.
- Cold-start метрики (`fetch`/`compile`/`instantiate`/`first_call`) — отдельно, у них p95 важнее median'а.
- Два режима в `run-matrix.ts`: `--mode=quick` (для разработки workload) vs `--mode=eval` (медленный, многократный, перед публикацией HTML).

### Что НЕ покрываем

- Стабильность системы пользователя (термальный throttle, фоновые процессы) — ответственность того, кто запускает. Harness пишет CPU-загруженность и memory pressure в `notes` JSON, чтобы потом было понятно, откуда выбросы.
- Кросс-машинное сравнение — нет смысла. JSON содержит machine fingerprint, reporter группирует по машине.

## Открытые вопросы (для Phase 2)

- Включить SIMD/threads как отдельную ось матрицы.
- Расширить алгоритмический набор (sort, parsing, mandelbrot, hash).
- Добавить остальные stdlib-контейнеры (vector/string, sorted map, set).
- CI-интеграция и tracking результатов во времени.
- Возможный `--jitless` режим для Node как контрольная точка «без JIT».

## Приложение: схема результата (выдержка)

```json
{
  "schemaVersion": 1,
  "timestamp": "2026-05-01T00:00:00Z",
  "machine": { "os": "macOS 15.4", "cpu": "Apple M3 Pro", "memoryGb": 36 },
  "env": { "kind": "browser", "name": "Chrome", "version": "136.0.x", "engine": "V8" },
  "benchmark": {
    "id": "matmul",
    "inputSize": "M",
    "fixtureBytes": 524288,
    "fixtureSha256": "...",
    "language": "rust",
    "toolchain": "raw",
    "profile": "size",
    "postprocess": ["wasm-opt -Oz"]
  },
  "artifacts": {
    "wasmRawBytes": 0, "wasmGzipBytes": 0, "wasmBrotliBytes": 0,
    "jsGlueRawBytes": 0, "jsGlueGzipBytes": 0,
    "totalTransferGzipBytes": 0,
    "artifactHash": "sha256:..."
  },
  "timingsMs": {
    "fetch": 0, "compile": 0, "instantiate": 0, "initTotal": 0,
    "firstCall": 0,
    "warmMedian": 0, "warmP95": 0, "warmP99": 0, "warmStddev": 0,
    "warmMin": 0, "warmMax": 0,
    "endToEndMedian": 0
  },
  "memory": {
    "wasmMemoryBytesPeak": 0,
    "wasmMemoryDeltaBytes": 0,
    "jsHeapUsedAfter": 0
  },
  "stats": { "nSamples": 30, "cv": 0.02, "noisy": false },
  "quality": { "checksum": "abc123", "validated": true, "correctnessFailed": false },
  "notes": { "streamingInstantiation": false, "worker": true, "wasmFeatures": ["bulk-memory", "sign-ext", "non-trapping-fp-to-int"] }
}
```
