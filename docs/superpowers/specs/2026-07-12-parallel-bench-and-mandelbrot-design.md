# Phase 1.2 — parallel-bench-execution + mandelbrot workload — design

**Status:** ready for implementation plans
**Date:** 2026-07-12
**Branches:** `feature/phase-1.2-parallel-bench` (Slice A) → merge → `feature/phase-1.2-mandelbrot` (Slice B)
**Refines roadmap:** `parallel-bench-execution` (TBD → Slice A), `academic-algos` (§ Workload expansion → Slice B, mandelbrot ветка) ([→ roadmap](../../roadmap.md))
**Empirical premises:** все числа ниже **измерены на этой машине** (14 ядер, Apple Silicon P/E), не взяты из общих знаний — по правилу `docs/pitfalls/2026-07-01-spec-premises-unmeasured.md`.

## Overview

Две **независимых** нарезки, спланированные одной последовательностью:

- **Slice A — parallel-bench-execution.** Ускорить `bench:all`, используя все ядра там, где это **не портит замеры**. Три механизма: параллельные сборки (always), снижение node per-case startup (always), cross-env параллелизм (opt-in, default off).
- **Slice B — mandelbrot.** Новый compute-bound workload — первый academic-algo, комплементарный container-heavy текущему набору.

Slice B **не зависит** от Slice A (mandelbrot собирается/меряется и без параллельной инфры; A лишь ускоряет его будущие прогоны). Порядок A→B — из удобства (инфра раньше → бенч mandelbrot дешевле), не из зависимости. Отсюда две ветки / два PR (конвенция one-PR-per-slice), но один общий спек (единый контекст решений).

---

## Slice A — parallel-bench-execution

### Problem — где уходит время (измерено)

`bench:all` = `setup-tools → build:all → bench (run-matrix) → report`, строгая цепочка барьеров.

| Фаза | Стоимость (измерено) | Загрузка CPU | Параллелизуема? |
|------|----------------------|--------------|-----------------|
| `build:all` (warm rebuild) | **106s** wall (75s user + 15s sys) | **≈0.85 ядра** — фактически однопоточно | **Да** — CPU-bound, не perf-measured |
| node bench (477 кейсов) | ~130s чистого per-case startup + measurement тяжёлых | 1 ядро | startup убирается; measurement остаётся sequential |
| browser bench (~954 кейсов) | доминирующая (минуты) | 1 ядро (на env) | только через cross-env (opt-in, см. A3) |
| `report` | быстро | — | — |

Опорный прогон 2026-07-12: 1431 result-файл, из них 477 node + ~954 browser (chromium + firefox).

**node per-case startup.** node-ветка `run-matrix.ts` спавнит **свежий `tsx apps/runner-node/src/main.ts` на каждый кейс**. Измерено: bare `tsx` cold-start ≈ 0.27s; лёгкий кейс (hashmap lookup L) целиком 0.34s (≈0.27 старт + ~0.07 measurement). 477 × 0.27s ≈ **130s чистого process-startup**. Браузерная ветка этого оверхеда НЕ имеет — она уже гоняет все кейсы через один long-lived `DriverSession`.

**Measurement НЕ равномерна.** Честные замеры node eval (S/M/L) показали разброс на 2 порядка: matmul js L = **25.2s/кейс** (warmMedian 604ms × 30 samples + warmup), matmul rust-raw L = 20.5s, matmul cpp-emscripten L = 12s; при этом hashmap lookup L = 0.34s, sorted_map range L = 0.85s, interop add_f64 L = 1.48s. Вывод: measurement-стоимость node-фазы концентрируется в нескольких тяжёлых кейсах (в основном matmul); in-process цикл убирает startup, но НЕ measurement.

> **NB (методологическая ловушка, зафиксирована при дизайне).** Первичные «замеры» показывали 0.27s для всех кейсов — это были **молчаливые падения** (`set -- $cfg` в zsh не делает word-splitting → битые аргументы; stderr был сре­директен, `time` печатал `real` упавшего процесса). Урок: при измерении верифицировать успех (rc + записанный файл + осмысленный warmMedian), а не только wall-time. Правильный split в zsh — `${=cfg}`.

### A1 — параллельные сборки (always on)

**Подход.** Bounded worker-pool (cap = `os.cpus().length`) поверх **build-unit'ов** (bench × language × toolchain × profile) + параллельная генерация fixtures.

- **cpp / js / rust-bindgen** combos независимы (свои `dist/<...>` + `target/attr-cpp/<...>` каталоги) → параллелятся полностью.
- **rust-raw** combos сериализуются на cargo workspace build-lock (`target/`): concurrent `cargo build` блокируется на локе — **безопасно** (cargo ждёт, не портит артефакты), но ограничивает выигрыш по rust-raw. Это принимаем (не оптимизируем cargo-инвокации в этой нарезке).
- **Детерминизм гарантирован:** per-combo выходные каталоги уже изолированы; wasm-opt детерминирован (build-hygiene PR #12, `scripts/lib/wasm-opt.ts`); attribution пишет в per-combo `attr`-каталоги (без коллизий).

**Ожидаемо:** ~106s → ~25–35s (bounded max(rust-lock-serialized-chain, самый длинный cpp-combo)).

**Реализация:** `scripts/build-all.ts` оркеструет пул; `build-js.ts` / `build-rust.ts` / `build-cpp.ts` рефакторятся так, чтобы их per-combo сборочные функции вызывались из пула (сейчас у каждого свой sequential `for`-цикл). Нужен маленький `p-limit`-подобный helper в `scripts/lib/` (или зависимость), без внешней сети в рантайме.

### A2 — снижение node per-case startup (always on)

Два кандидата; **Wave-0 parity-gate выбирает**:

- **A2a (рекомендуется): in-process цикл.** node-ветка `run-matrix.ts` импортирует `runCase` (из `apps/runner-node/src/run-case.ts`) и гоняет кейсы **в одном процессе**, как браузерная session уже делает. Замеры остаются **строго sequential**. Экономит ~130s startup.
  - **Риск:** shared-VM между кейсами (накопление JIT/GC-состояния) против текущего pristine-VM-per-subprocess. Митигация: per-case warmup (10 iter) пере-прогревает JIT под конкретный модуль; опциональный `restartEvery` (механизм уже есть для браузерных session) периодически освежает VM. Это **консистентно** с уже доверяемой браузерной методологией (cv-stabilization PR #10 мерил через shared browser-session).
- **A2b (fallback): prebuilt-JS subprocess.** Гонять `node dist/runner-node/main.js` вместо `tsx apps/runner-node/src/main.ts` — **pristine VM сохраняется**, старт ~0.27→~0.08s (bare `node` ≈ 0.03–0.05s против tsx ≈ 0.27s), экономит ~90s. Цена: build-шаг для runner-node (tsc/esbuild → `dist/`).

**Wave-0 parity-gate:** замерить warmMedian репрезентативного набора (тяжёлый matmul L + лёгкие hashmap/sorted_map/interop L, оба профиля, node) **per-subprocess vs in-process**; если max-отклонение ≤ ~3% → A2a; иначе A2b. Результат фиксируется в плане.

### A3 — cross-env параллелизм (opt-in `--parallel-envs`, default off)

**Подход.** При флаге node / chromium / firefox measurement-стримы гоняются конкурентно (`Promise.all` вместо текущего sequential `for env of envs`). Один общий `vite preview` сервер обслуживает оба браузера (статика, safe). Без флага — текущий sequential порядок.

**Измеренная контенция (3 копии одного кейса одновременно = сценарий «3 env», 14 ядер):**

| Класс workload'а | Пример | Инфляция warmMedian под 3× | CV |
|------------------|--------|----------------------------|-----|
| compute / bandwidth-bound | matmul cpp L (WS 16 MB) | **+2.2…+2.4%** | <1% |
| **memory-latency-bound** | sorted_map range rust L | **+7.4…+9.0%** | ~2% |
| call-overhead-bound | interop add_f64 rust L | ~0% (шум, −3…+1.5%) | <1% |

Инфляция **~одинакова** для одновременно бегущих копий (все 3 копии sorted_map замедлились симметрично) → within-env **отношения** тулчейнов сохраняются при равном overlap. Но за полный прогон overlap меняется (старт: 3 env активны; конец: 1) → неравномерно между кейсами → потенциальное размывание сравнения для cache-bound workload'ов. bias ограничен (~9% worst), но лежит на границе разрешения SEM-гейта (relSem 3% различает gap'ы >~8%, cv-stabilization spec).

**Политика (решение пользователя 2026-07-12):**

- Default `bench:all` — **sequential** (guideline-grade числа без bias).
- `--parallel-envs` — opt-in для быстрой итерации / quick-прогонов, где ~9% приемлемо.
- Результаты параллельного прогона **помечаются** новым полем в `BenchResult` (schema-change, см. ниже) → reporter бэйджит; sequential и parallel числа **никогда молча не смешиваются**.
- Измеренный профиль контенции → **finding в `docs/guidelines.md`**.

### Schema change (`packages/result-schema`)

Единственная схема-правка Slice A: добавить в `BenchResult` признак, что кейс мерян под host-параллелизмом.

- Добавить **аддитивное optional-поле** `parallel: z.boolean().default(false)` (точное место — `env`-блок; `env` уже есть в top-level result-keys — план подтвердит форму по актуальной схеме) — `true`, если прогон был с `--parallel-envs`.
- **Bump SCHEMA_VERSION НЕ нужен.** Поле аддитивно и опционально с `default(false)` → старые `results/raw/` (без поля) продолжают валидироваться. Это осознанно избегает принудительного heavy re-bench (в отличие от PR #10 v1→v2). Правило CLAUDE.md § BenchResult schema: правка только через `packages/result-schema` — соблюдено; bump требуется лишь при breaking-изменении, здесь его нет.

### Reporter change (presenter-only)

- Бэйдж «measured under host-parallelism (±~2–9% bias)» на кейсах с `parallel=true`.
- Опционально: не смешивать parallel/sequential в одном сравнении (если оба присутствуют — показывать раздельно или предпочитать sequential). Точная UX-форма — в плане; presenter-only, консистентно с PR #9/#11 lineage.

### Files changed (Slice A, ориентировочно)

| file | change |
|------|--------|
| `scripts/lib/` (new `p-limit`-подобный helper или dep) | bounded concurrency pool |
| `scripts/build-all.ts` | оркестрация пула поверх fixtures + build-* |
| `scripts/build-js.ts` / `build-rust.ts` / `build-cpp.ts` | per-combo функции вызываются из пула |
| `scripts/run-matrix.ts` | node in-process цикл (A2a) ИЛИ prebuilt-JS вызов (A2b); `--parallel-envs` флаг + concurrent env-стримы |
| `apps/runner-node/` | (если A2b) build-target → `dist/` |
| `packages/result-schema/src/schema.ts` | `+parallel` optional-флаг (`default(false)`); **без** bump `SCHEMA_VERSION` |
| `packages/reporter/src/*` | parallel-бэйдж |
| `docs/guidelines.md` | contention-profile finding |
| `README.md` | `--parallel-envs` в § Запуск бенчмарков |
| соответствующие `tests/` | pool, schema, reporter |

### Wave-0 gates (Slice A)

1. **Baseline timing** — зафиксировать build:all + node-phase wall до правок (для сравнения).
2. **node parity** (A2a vs subprocess) — выбирает A2a/A2b.
3. **build-parallel детерминизм** — артефакты параллельной сборки **бит-в-бит** идентичны sequential-сборке (все `module.wasm` / glue / `meta.json` composition совпадают).

### Out of scope (Slice A)

- **Pipelining build↔measure** — build CPU-тяжёлый, наложение на measurement контендит и портит тайминги (та же причина, что cross-env). Барьеры между фазами сохраняем намеренно.
- **Parallel perf-eval внутри одного env** — контенция; тот же bias.
- **CPU-pinning / core-affinity** — на macOS нет надёжного механизма (tech-debt `cpu-throttling-lock-macos`); из скоупа.
- **Оптимизация cargo-инвокаций для rust-raw** (обход workspace-lock) — принимаем сериализацию.

### Risk register (Slice A)

| risk | likelihood | mitigation |
|------|------------|------------|
| A2a shared-VM вносит cross-case bias в node | medium | Wave-0 parity-gate; fallback A2b (pristine VM) |
| build-параллелизм недетерминирован (race на shared ресурс) | low | per-combo изолированные каталоги + детерминированный wasm-opt; Wave-0 bit-identical gate |
| cargo workspace-lock сериализует rust так, что пул почти не помогает по rust | medium | принято; выигрыш всё равно есть по cpp/js/bindgen (большая доля) |
| `--parallel-envs` числа молча попадают в guideline-прогон | low | `parallel` флаг в schema + reporter-бэйдж; default off |
| новое поле ломает парсинг старых raw | none | поле optional `default(false)` → старые raw валидны; bump не нужен |

---

## Slice B — mandelbrot workload

Новый compute-bound workload по шаблону `matmul` (single-entry, pure compute) — первый из academic-algos.

### Purpose / evidence-сигналы

1. **Perf — raw FLOP-throughput.** Escape-time Мандельброта = плотный float-loop без аллокаций и почти без marshalling. Изолирует «сырую» вычислительную пропускную способность тулчейнов чище, чем container-workload'ы (нет hash/tree/alloc-machinery, нет buffer-маршалинга в горячем пути). Комплементарен текущему набору.
2. **Size — floor чистого compute.** rust/raw в `no_std` (нет аллокаций) → минимальный артефакт; прямое сравнение floor'а «чистая арифметика» против std-контейнерных workload'ов.

### Workload contract

- **Вычисление:** для сетки dims_x × dims_y точек в фиксированном регионе комплексной плоскости — итерировать `z ← z² + c` пока `|z|² > 4` или до `max_iter`; аккумулировать счётчик итераций. Регион фиксирован и подобран так, чтобы escape-распределение было нетривиальным (не «всё убежало» / «всё осталось») — напр. классический `[-2.5, 1] × [-1.25, 1.25]` или zoom вокруг `(-0.75, 0)`.
- **Checksum:** сумма iteration-counts по всем точкам — детерминированное число (f64/целое). Ложится в текущую checksum-модель (`number | string`).
- **Fixture:** кодирует параметры прогона (регион bounds, dims_x, dims_y, max_iter). S/M/L масштабируют `dims × max_iter` так, чтобы L ≈ сотни мс/сэмпл (порядок matmul L). Генератор — `benches/mandelbrot/fixtures/generate.ts` (детерминированный; параметры, не случайные данные — `mulberry32` не нужен).

### Entry

- Один entry `mandelbrot` (f64), как единственный entry у `matmul`.
- **Follow-up (roadmap, не в этой нарезке):** f32-вариант (precision × throughput), SIMD-ось.

### Toolchain matrix (`spec.json` `supported`)

Полная, как у matmul:

- **cpp** — emscripten, wasi-sdk × {speed, size}.
- **rust** — raw (**`no_std`**, нет alloc), bindgen × {speed, size}.
- **js** — idiomatic; **typed-array — открытый под-вопрос** (см. ниже) × speed (js только speed, как в остальных workload'ах).

### js typed-array вариант — открытый под-вопрос

mandelbrot не маршалит входной массив (вход — параметры), выход — единственный checksum. Значит typed-array отличается от idiomatic только если использует typed scratch (напр. `Uint32Array` строки под iteration-counts перед суммированием). Решение в плане: **склоняюсь оставить оба** для parity матрицы (typed-array пишет счётчики в `Uint32Array` scratch, idiomatic — скалярный аккумулятор), НО если варианты выйдут байт-в-байт идентичны по смыслу — оставить только idiomatic и объявить это в `spec.json.supported`. Проверяется при написании js-кода.

### Validation

- `benches/mandelbrot/validate/` — reference TS считает expected checksums per size.
- Пиннинг в `spec.json` (v2: `entries: string[]` + `expectedChecksums`).
- Parity-gate: idiomatic ≡ typed-array ≡ reference (в `validate/`, по eslint project-service конвенции — тест в `validate/`, не в корне bench'а; tech-debt `benches-tests-not-in-gate`).

### Guidelines (Slice B)

- +claim: raw FLOP-throughput ranking тулчейнов на чистом compute (число из прогона).
- +claim: size-floor чистого compute (no_std rust/raw) — отдельно от std-контейнерного floor'а.

### Files (Slice B)

Новый каталог `benches/mandelbrot/` по образцу `benches/matmul/`:
`spec.json`, `fixtures/generate.ts`, `validate/`, `js/{idiomatic,typed-array}/`, `rust/{raw,bindgen}/`, `cpp/` (`*.cpp` + `build-emscripten.sh` + `build-wasi-sdk.sh`). Discovery авто­матический (`glob("benches/*/spec.json")`). CLAUDE.md § workload-list += `mandelbrot`.

### Out of scope (Slice B)

- f32 / SIMD-варианты (roadmap follow-up).
- Прочие academic-algos (sort / parsing / hash) — отдельные будущие нарезки.

---

## Sequencing / PR structure

1. **Slice A** на `feature/phase-1.2-parallel-bench`: спек (этот файл) + план A → execute (Wave-0 gates → build-pool → node → cross-env → schema/reporter/docs) → PR → **user push + review + merge**.
2. **Slice B** на `feature/phase-1.2-mandelbrot` (от master после merge A): план B → execute → PR → user push + review + merge.

Оба плана пишутся **сейчас** (в этой сессии, по запросу пользователя «спланировать всё разом»), каждый с обязательным Execution Protocol. План B коммитится вместе со спеком/планом A на ветку A (лендится на master через PR A), затем ветка B его наследует.

## Alternatives considered

- **Overlap build с measurement (pipelining)** — отвергнут: контенция портит тайминги.
- **Coarse build-параллелизм (js ∥ rust ∥ cpp только)** — проще, но упирается в max(rust, cpp); fine worker-pool утилизирует ядра лучше.
- **Default-on cross-env параллелизм** — отвергнут пользователем: тихий ~9% bias в canonical-прогоне против north-star (guideline-grade evidence).
- **Отказ от cross-env целиком** — отвергнут: opt-in даёт скорость на итерации без fidelity-цены по умолчанию.
- **sort / hash / parsing как первый academic-algo** — отложены: mandelbrot даёт самый чистый compute-сигнал (без confound'а stdlib-алгоритма / marshalling / выбора парсера).
