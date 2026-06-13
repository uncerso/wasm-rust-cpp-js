# Phase 1.2 — rust-vs-cpp wasm size — investigation design

**Status:** ready for implementation plan
**Refines:** roadmap entry `rust-vs-cpp-wasm-size` (TBD bucket, [→ roadmap § TBD](../../roadmap.md)); folds in adjacent narrow hypothesis `rust-raw-drop-staging-buffer` ([→ § Workload expansion](../../roadmap.md)).
**Predecessor data:** Phase 1.2 hashmap-stdlib-no-glue ([`2026-06-13-hashmap-stdlib-no-glue-design.md`](2026-06-13-hashmap-stdlib-no-glue-design.md)) — its guidelines уже содержат частичный, workload-confounded ответ (std-container floor caveat). Эта итерация даёт чистый, per-workload-атрибутированный ответ.

## Purpose

Объяснить **направление** разрыва raw-wasm размера между `rust/raw` и `cpp/wasi-sdk`, которое по workload'ам смотрит в **разные стороны** — и вытащить из этого confirmed product-guideline.

Захваченная гипотеза «rust wasm стабильно крупнее cpp» **частично опровергается** измерениями (raw wasm bytes, size-профиль):

| workload | rust/raw | cpp/wasi-sdk | направление |
|---|---:|---:|---|
| matmul | 1639 | 763 | rust **2.1× крупнее** |
| interop_calls | 302 | 353 | ≈ равны (rust чуть меньше) |
| hashmap_int | 16189 | 13746 | rust **1.18× крупнее** |
| hashmap_string | 18939 | 16279 | rust **1.16× крупнее** |
| shape_dispatch_homo_static | 1522 | 6024 | rust **4× МЕНЬШЕ** (!) |

Направление workload-зависимо. Цель — атрибутировать байты (какую машинерию каждый toolchain тянет по умолчанию) и заменить грубую гипотезу на механизм-объяснённый guideline.

## Предварительные находки (W0-обоснование подхода)

Уже подтверждено через `wasm-tools objdump`/`print` на production-артефактах:

- **cpp shape_dispatch bloat = data-секция 4247 B** (не code): гигантская таблица f64-констант — почти наверняка статически слинкованная **libm lookup-таблица** (trig/`atan2`/`pow`-аппроксимация), которую wasi-sdk тянет при вызове math-функции. Rust те же операции эмитит как wasm-интринсики (`f64.sqrt` и т.п.) без таблиц.
- **matmul rust bloat = code 940 B (vs cpp 531) + data 520 B (cpp 0)**: подлежит code-level атрибуции (panic/fmt/alloc).
- **`name`-секция в production-артефактах срезана wasm-opt'ом** (остался только `target_features`) → symbol-level атрибуция требует name-bearing analysis-build.

## Scope

**In scope:**

- Первичное сравнение — `rust/raw` vs `cpp/wasi-sdk` (обе no-glue → изолируют язык+stdlib от glue-floor, который уже отдельный confirmed guideline).
- Headline-профиль — **size**; speed отмечаем там, где направление/величина существенно иные.
- Покрытие: matmul, interop_calls, hashmap_int, hashmap_string, shape_dispatch ×4 (homo/mixed × static/dyn) — 8 бинарных директорий.
- `rust/bindgen` + `cpp/emscripten` — вторичные context-колонки (без глубокой атрибуции; их glue-floor уже покрыт).
- **Фолд-ин:** `rust-raw-drop-staging-buffer` — финальный эксперимент (см. § Эксперимент).

**Out of scope:**

- Runtime/perf анализ (отдельная ось; эта итерация — только artifact size).
- Glue-floor re-attribution (уже confirmed guideline Phase 1.2).
- Изменение build/bench-пайплайна; `tool-versions.json` не трогаем (twiggy — analysis-only, см. § Инструментарий).
- CV/variance вопросы (отдельный roadmap-пункт `benchmark-cv-stabilization`).

## Инструментарий

- **`wasm-tools`** (уже установлен, `/opt/homebrew/bin`) — `objdump` (section-байты), `print` (data-контент). Работает на production-артефактах.
- **`twiggy`** — symbol-level атрибуция code-секции. **Analysis-only**: ставится `cargo install twiggy` (версия фиксируется в этой спеке при установке), в `tool-versions.json` (build/bench-контракт) НЕ добавляется — не входит в воспроизводимый пайплайн. Бежит на name-bearing analysis-build.
- **`.tools/wasi-sdk-*/bin/llvm-objdump`** — fallback для дизассемблирования (если twiggy/имена недоступны на cpp-стороне).

## Метод (пайплайн)

1. **Section-split.** `wasm-tools objdump` по каждому из 8 бинарей × {rust/raw, cpp/wasi-sdk} × size-профиль → таблица байт по секциям. Top-level: code vs data vs прочее. Контроль: сумма секций = размер файла.
2. **Data-content ID.** Где data доминирует (cpp shape_dispatch, rust matmul) — `wasm-tools print` + инспекция; идентифицировать содержимое (libm-таблицы / panic-строки / f64-константы / static buffers). Для shape_dispatch ×4 — подтвердить, что libm-история консистентна (какие варианты зовут math).
3. **Code-level symbol-атрибуция (точечно, rust-side).** Собрать name-bearing analysis-build (pre-wasm-opt rust-артефакт из `target/wasm32-unknown-unknown/release/`, имена не срезаны) для случаев, где доминирует code (rust matmul, hashmap). `twiggy top` / `twiggy dominators` → разложить code на panic / fmt / alloc(dlmalloc) / hash(SipHash). cpp в основном объясняется секцией+data — twiggy на cpp только при необходимости (fallback llvm-objdump).
4. **Калибровка.** twiggy бежит на pre-opt сборке → даёт **композицию** (какие функции доминируют), НЕ абсолютные production-байты. Абсолют якорим к production section-split (шаг 1); twiggy — для «что внутри code». Проговаривается в evidence явно.
5. **Синтез.** Per-workload таблица атрибуции (production-байты: total / code / data + доминирующий контрибьютор) + нарратив механизма, объясняющий направление в каждом workload'е.

## Эксперимент (фолд-ин: rust-raw-drop-staging-buffer)

После атрибуции: в `benches/hashmap_{int,string}/rust/raw/` убрать static 4 MiB staging-buffer → natural `Vec`-аллокация (зеркалит cpp `operator new`). Замерить дельту:

- **file-size** (raw/gzip/brotli) — ожидание: почти не двигается (BSS zero-init не хранится в `.wasm`); **верифицировать**, не предполагать.
- **initial-memory** (min pages в memory-секции) — ожидание: заметное снижение (4 MiB ≈ 64 страницы по 64 KiB).

Аудит sibling raw-крейтов (matmul, interop_calls, shape_dispatch) на тот же паттерн static-buffer. Re-валидация корректности: `run-matrix --mode=eval` для обоих hashmap-workload'ов — checksums должны остаться pinned.

## Выход / deliverables

- **`docs/guidelines.md`** — headline per-workload таблица атрибуции как evidence-блок (по конвенции файла, формат B-1) + 1–2 guideline:
  - Основной: направление rust↔cpp по размеру **workload-driven, не константа** — rust несёт фикс-overhead (panic+fmt+alloc машинерия в code+data), доминирующий на мелких простых workload'ах; cpp/wasi-sdk статически линкует libm math-таблицы (multi-KB data) при transcendental/math-функциях, которые rust эмитит как wasm-интринсики; на std-контейнерах оба тянут сопоставимый stdlib-floor (rust чуть выше). Confirmed-планка: ≥6 workload'ов, size env/size-invariant.
  - Возможный узкий: libm-table механизм (для size-чувствительного cpp/wasi-sdk избегать libm-transcendentals, либо учитывать multi-KB data-floor).
  - Если staging-buffer эксперимент даёт значимую дельту памяти — отметить как fairness-уточнение к hashmap size-claim'ам.
- Полные twiggy-дампы — **ephemeral** (в `$TMPDIR`), не персистятся; в evidence — только reproducible команды.
- **`docs/roadmap.md`** — удалить `rust-vs-cpp-wasm-size` (graduated в эту спеку) и `rust-raw-drop-staging-buffer` (выполнен) по конвенции removal-on-completion.

## Валидация

Анализ, не feature-код:

- Section-байты суммируются в размер файла (контроль шага 1).
- twiggy-тоталы сходятся внутри analysis-build.
- Механизм-claim фальсифицируем: «cpp shape_dispatch data = libm-таблица» подтверждается идентификацией таблицы/символа; «rust matmul code = panic/fmt» — twiggy-разбивкой.
- Staging-buffer: production gates (`build:all`, `typecheck`, `lint:all`, `test`, `smoke`) + correctness re-eval (checksums pinned).

## Риски

- **cpp name-секция в analysis-build** — wasi-sdk size-сборка стрипает символы. Если cpp symbol-атрибуция трудна → fallback на section+data-content (который cpp shape_dispatch уже объясняет полностью — это data-таблица, не code). twiggy нужен почти только на rust-side, где pre-opt имена есть.
- **twiggy ≠ production bytes** — митигировано калибровкой (§ Метод шаг 4).
- **shape_dispatch ×4 неоднородность** — не все варианты могут звать math; подтвердить per-variant, не экстраполировать с homo_static.
- **Staging-buffer drop регрессирует корректность/perf** — митигировано re-eval + gates; если file-size не двигается (как ожидается) — claim формулируется про initial-memory, не про bundle.

## Структура волн

- **Wave 0** — установить twiggy; собрать name-bearing analysis-build для 1 rust-кейса (matmul); подтвердить, что twiggy даёт читаемую разбивку (feasibility-гейт code-level атрибуции). Section-split + data-content уже де-рискованы (§ Предварительные находки).
- **Wave 1** — полная атрибуция: section-split ×8 бинарей × 2 toolchain; data-content ID где доминирует; twiggy code-разбивка rust matmul/hashmap; синтез per-workload таблицы + нарратив.
- **Wave 2** — staging-buffer эксперимент (code-change + re-measure + re-eval + gates); guidelines.md обновление; roadmap removal; close.

## References

- Roadmap: `rust-vs-cpp-wasm-size`, `rust-raw-drop-staging-buffer` ([→ roadmap.md](../../roadmap.md)).
- Pitfall (staging-buffer контекст): [`pitfalls/2026-06-13-phase-1-2-hashmap-no-glue-w0.md`](../../pitfalls/2026-06-13-phase-1-2-hashmap-no-glue-w0.md).
- Существующие size-guideline (не дублировать, уточнять): `docs/guidelines.md` § Artifact size (glue-floor, std-container floor, monomorphization trade).
- Design spec (BenchModule/артефакты): [`2026-05-01-wasm-benchmarks-design.md`](2026-05-01-wasm-benchmarks-design.md).
