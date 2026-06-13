# Phase 1.2 — rust-vs-cpp wasm size+perf — investigation & optimization design

**Status:** ready for implementation plan
**Refines:** roadmap entry `rust-vs-cpp-wasm-size` (TBD bucket, [→ roadmap § TBD](../../roadmap.md)); folds in adjacent narrow hypothesis `rust-raw-drop-staging-buffer` ([→ § Workload expansion](../../roadmap.md)).
**Predecessor data:** Phase 1.2 hashmap-stdlib-no-glue ([`2026-06-13-hashmap-stdlib-no-glue-design.md`](2026-06-13-hashmap-stdlib-no-glue-design.md)) — его guidelines уже содержат частичный, workload-confounded ответ (std-container floor caveat). Эта итерация даёт чистый, per-workload-атрибутированный ответ **плюс** меряет perf-стоимость каждого size-рычага.

## Purpose

Объяснить **направление** разрыва raw-wasm размера между `rust/raw` и `cpp/wasi-sdk` (по workload'ам смотрит в **разные стороны**), **применить** найденные size-улучшения, и для каждого замерить **size↔perf трейд** — вытащив из этого confirmed product-guideline по обеим осям.

Захваченная гипотеза «rust wasm стабильно крупнее cpp» **частично опровергается** измерениями (raw wasm bytes, size-профиль):

| workload | rust/raw | cpp/wasi-sdk | направление |
|---|---:|---:|---|
| matmul | 1639 | 763 | rust **2.1× крупнее** |
| interop_calls | 302 | 353 | ≈ равны (rust чуть меньше) |
| hashmap_int | 16189 | 13746 | rust **1.18× крупнее** |
| hashmap_string | 18939 | 16279 | rust **1.16× крупнее** |
| shape_dispatch_homo_static | 1522 | 6024 | rust **4× МЕНЬШЕ** (!) |

Направление workload-зависимо. Цель — атрибутировать байты, применить рычаги, и заменить грубую гипотезу на механизм-объяснённый guideline по size И perf.

## Предварительные находки (W0-обоснование подхода)

Уже подтверждено через `wasm-tools objdump`/`print` на production-артефактах:

- **cpp shape_dispatch bloat = data-секция 4247 B** (не code): гигантская таблица f64-констант — почти наверняка статически слинкованная **libm lookup-таблица** (trig/`atan2`/`pow`-аппроксимация), которую wasi-sdk тянет при вызове math-функции. Rust те же операции (если это `sqrt`) эмитит как wasm-интринсик (`f64.sqrt`) без таблиц.
- **matmul rust bloat = code 940 B (vs cpp 531) + data 520 B (cpp 0)**: подлежит code-level атрибуции (panic/fmt/alloc).
- **`name`-секция в production-артефактах срезана wasm-opt'ом** → symbol-level атрибуция требует name-bearing analysis-build.

## Scope

**In scope:**

- Первичное сравнение — `rust/raw` vs `cpp/wasi-sdk` (обе no-glue → изолируют язык+stdlib от glue-floor, который уже отдельный confirmed guideline).
- **Обе оси:** artifact size (raw/gzip/brotli) И runtime perf (warm-median на L).
- Покрытие атрибуции: matmul, interop_calls, hashmap_int, hashmap_string, shape_dispatch ×4 (homo/mixed × static/dyn) — 8 бинарных директорий.
- Применение найденных рычагов к production-бинарям (apply-политика ниже) + перф-замер каждого.
- `rust/bindgen` + `cpp/emscripten` — вторичные context-колонки (без глубокой атрибуции).
- **Фолд-ин:** `rust-raw-drop-staging-buffer` (см. § Рычаги).

**Out of scope:**

- Glue-floor re-attribution (уже confirmed guideline Phase 1.2).
- Изменение build/bench-пайплайна; `tool-versions.json` не трогаем (twiggy — analysis-only global, см. § Инструментарий).
- Общая CV/variance стабилизация (отдельный roadmap-пункт `benchmark-cv-stabilization`); здесь CV только как guard на читаемость perf-дельт.

## Инструментарий

- **`wasm-tools`** (уже установлен, `/opt/homebrew/bin`) — `objdump` (section-байты), `print` (data-контент). Работает на production-артефактах.
- **`twiggy`** — symbol-level атрибуция code-секции. **Global analysis-only**: `cargo install twiggy` → бинарь в `~/.cargo/bin`, **ноль следов в репо** (не трогает workspace `Cargo.toml`/`Cargo.lock` ни `tool-versions.json`). Для запуска бенчмарков вне этой итерации не нужен. Бежит на name-bearing analysis-build. Версия: `twiggy 0.8.0` (установлена W0, 2026-06-13).
- **`.tools/wasi-sdk-*/bin/llvm-objdump`** — fallback для дизассемблирования (если twiggy/имена недоступны на cpp-стороне).

## Метод — атрибуция (W1)

1. **Section-split.** `wasm-tools objdump` по каждому из 8 бинарей × {rust/raw, cpp/wasi-sdk} × size-профиль → таблица байт по секциям. Контроль: сумма секций = размер файла.
2. **Data-content ID.** Где data доминирует — `wasm-tools print` + инспекция; идентифицировать содержимое. Для cpp shape_dispatch — **установить точную math-функцию** за таблицей (читая `benches/shape_dispatch_*/cpp/*.cpp`) и **есть ли toolchain-рычаг** её избежать (для `sqrt` — да, `-fno-math-errno` → `f64.sqrt`; для `sin/cos/atan2` wasm-интринсика НЕТ — тогда левера может не быть, и это само по себе находка). Подтвердить, что rust той же операции избегает (и как).
3. **Code-level symbol-атрибуция (точечно, rust-side).** Name-bearing analysis-build (pre-wasm-opt rust из `target/wasm32-unknown-unknown/release/`) → `twiggy top`/`dominators` разложит code на panic/fmt/alloc(dlmalloc)/hash. cpp в основном объясняется секцией+data; twiggy на cpp только при необходимости.
4. **Калибровка.** twiggy на pre-opt сборке даёт **композицию**, не абсолютные production-байты; абсолют якорим к section-split (шаг 1). Проговаривается в evidence.
5. **Синтез + список рычагов.** Per-workload таблица атрибуции + нарратив + список optimization-кандидатов, каждый с (механизм, гипотетический рычаг, ожидаемая size-дельта).

## Рычаги — применение + perf-замер (W2)

Кандидаты выводятся из W1. Заранее идентифицированные:

- **cpp libm-таблица → wasm-интринсик** (shape_dispatch, matmul если зовут `sqrt`) — контингентно наличию рычага (W1 шаг 2).
- **rust фикс-overhead** (matmul: panic/fmt/alloc-машинерия) — рычаги типа `panic_immediate_abort` / убрать неявный fmt, если применимо для `rust/raw`.
- **rust-raw-drop-staging-buffer** (фолд-ин): убрать static 4 MiB staging-buffer в `benches/hashmap_{int,string}/rust/raw/` → natural `Vec` (зеркалит cpp `operator new`). Аудит sibling raw-крейтов (matmul/interop/shape) на тот же паттерн.

**Протокол на каждый рычаг:**

1. Реализовать изменение.
2. **Size-дельта** — raw/gzip/brotli (+ initial-memory min-pages для staging-buffer; ожидание: file почти не двигается, BSS не в `.wasm` — **верифицировать**).
3. **Perf-дельта** — затронутый workload×toolchain на **L**, `--mode=eval`, **node + chromium + firefox**, before/after warm-median + **CV**. Если дельта в пределах шума (CV-доминирована) на env — явно «within noise», не выдавать за non-finding.
4. **Корректность** — `run-matrix --mode=eval`, checksums остаются pinned.
5. **Классификация:** **pure-win** (size↓, perf within-noise-или-лучше на всех env) → **adopt** (default-бинарь меняется). **Трейд** (size↓ но perf↓ за пределами шума хотя бы на одном env) → revert к default, зафиксировать before/after в guideline, adoption — явное per-case решение. **Негативный результат — first-class guideline.**

## Выход / deliverables

- **`docs/guidelines.md`** — headline per-workload таблица атрибуции (evidence-блок, формат B-1) + guideline:
  - Основной (size): направление rust↔cpp **workload-driven, не константа** — rust несёт фикс-overhead (panic+fmt+alloc в code+data), доминирующий на мелких простых; cpp/wasi-sdk статически линкует libm math-таблицы (multi-KB data) при math-функциях без wasm-интринсика; на std-контейнерах оба тянут сопоставимый floor. Confirmed: ≥6 workload'ов, size env/size-invariant.
  - size↔perf трейды: для каждого применённого рычага — дельта обеих осей (включая негативные: «рычаг X срезает N байт но замедляет на M% — не применять при perf-критичности»).
  - Узкий (libm): механизм + есть/нет рычага per math-функция.
  - Staging-buffer: если значимая дельта памяти — fairness-уточнение к hashmap-claim'ам.
- Полные twiggy-дампы — **ephemeral** (`$TMPDIR`), не персистятся; в evidence — reproducible команды.
- **`docs/roadmap.md`** — удалить `rust-vs-cpp-wasm-size` (graduated) и `rust-raw-drop-staging-buffer` (выполнен).

## Валидация

- Section-байты суммируются в размер файла (W1 контроль).
- twiggy-тоталы сходятся внутри analysis-build.
- Механизм-claim фальсифицируем (cpp shape_dispatch data = конкретная libm-таблица; rust matmul code = panic/fmt по twiggy).
- На каждый landed-рычаг: production gates (`build:all`, `typecheck`, `lint:all`, `test`, `smoke`) + correctness re-eval (checksums pinned) + perf-замер задокументирован.

## Риски

- **cpp libm-рычаг может не существовать** для не-`sqrt` math (нет wasm-интринсика для trig) — тогда «рычага нет» это находка, не провал; формулируем как ограничение cpp/wasi-sdk.
- **cpp name-секция в analysis-build** стрипнута → fallback section+data-content (cpp shape_dispatch уже объясняется data-таблицей). twiggy нужен почти только rust-side.
- **twiggy ≠ production bytes** — митигировано калибровкой.
- **Browser perf-шум / жёлтые CV** могут сделать дельту нечитаемой на chromium/firefox — митигация: увеличенные samples для A/B-замера, репорт CV рядом, явное «within noise» где дельта тонет.
- **Рычаг ломает корректность/perf** — митигировано re-eval + gates; pure-win/трейд классификация защищает от слепого адопшна.
- **shape_dispatch ×4 неоднородность** — подтвердить per-variant, не экстраполировать.

## Структура волн

- **Wave 0** — установить twiggy (global; crates.io может потребовать sandbox-bypass или `! cargo install` пользователем); name-bearing analysis-build на matmul rust; подтвердить читаемую twiggy-разбивку (feasibility-гейт code-level атрибуции). Section-split + data-content уже де-рискованы.
- **Wave 1** — полная size-атрибуция ×8 бинарей × 2 toolchain; data-content ID (вкл. math-функцию + наличие рычага); twiggy rust-разбивка; синтез таблицы + список рычагов.
- **Wave 2** — на каждый рычаг: применить → size+perf(L, 3 env)-дельта → re-eval → классификация (adopt/revert). Рычаги независимы (разные бинари) — кандидаты на параллельную обработку.
- **Wave 3** — синтез guidelines (size-механизм + size↔perf трейды + негативы) → guidelines.md; roadmap removal; gates; close.

## References

- Roadmap: `rust-vs-cpp-wasm-size`, `rust-raw-drop-staging-buffer` ([→ roadmap.md](../../roadmap.md)).
- Pitfall (staging-buffer контекст): [`pitfalls/2026-06-13-phase-1-2-hashmap-no-glue-w0.md`](../../pitfalls/2026-06-13-phase-1-2-hashmap-no-glue-w0.md).
- Существующие size-guideline (не дублировать, уточнять): `docs/guidelines.md` § Artifact size.
- Design spec (BenchModule/артефакты/eval-mode): [`2026-05-01-wasm-benchmarks-design.md`](2026-05-01-wasm-benchmarks-design.md).
