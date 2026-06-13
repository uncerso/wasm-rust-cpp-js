# Phase 1.2 — hashmap-stdlib-no-glue — execution design

**Status:** ready for implementation plan
**Refines:** roadmap entry `hashmap-stdlib-no-glue` (Phase 1.2, [→ § Workload expansion](../../roadmap.md))
**Predecessor:** Phase 1.1.2 hashmap workload (spec [`2026-05-23-phase-1-1-2-hashmap-design.md`](2026-05-23-phase-1-1-2-hashmap-design.md)); its `§ Out of scope` deferred exactly these two toolchains.

## Purpose

Добавить **minimal-overhead** тулчейн-варианты — `rust/raw` и `cpp/wasi-sdk` — к существующим workload'ам `hashmap_int` и `hashmap_string`, сохраняя **тот же** stdlib-контейнер и **тот же** дефолтный хешер, что у glue-вариантов (`rust/bindgen`, `cpp/emscripten`), и срезая только авто-обвязку.

Это даёт два evidence-сигнала:

1. **Чистый glue-оверхед** — `raw` vs `bindgen` и `wasi-sdk` vs `emscripten` при held-constant контейнере (тот же `HashMap`/`unordered_map`, тот же SipHash/`std::hash`) изолируют именно стоимость авто-обвязки (wasm-bindgen runtime / emscripten glue.mjs).
2. **std-inclusion delta** — размер `rust/raw` hashmap (std + HashMap) vs no_std matmul-raw показывает, во что обходится подключение std-контейнера в иначе-минимальный wasm.

int + string × S/M/L × {speed,size} → планка для **confirmed** bundle-size guideline (≥2 key-types × ≥2 sizes consistent signal).

## Симметричное правило (определяет весь дизайн)

minimal-overhead вариант = **без авто-обвязки, без неявных зависимостей**; `std`/libc++ выкидываем там, где можно уйти в более минималистичное (в пределе no_std), а где контейнер этого не позволяет — оставляем, но пользуемся аккуратно. Для stdlib-hashmap контейнер по определению требует своего рантайма:

- `std::unordered_map` живёт в libc++ → libc++ оставляем, но без emscripten-glue/command-модели.
- `std::collections::HashMap` живёт в `std` (не в core/alloc) → `std` оставляем, но без wasm-bindgen-glue.

Цель обоих вариантов идентична: **wasm-модуль с нулём не-`memory` импортов**, инстанцируемый raw-wasm loader'ом с пустым import object `{}`.

## Scope

**In scope:**

- 4 новых (binary × toolchain) комбинации: `hashmap_{int,string}` × `{rust/raw, cpp/wasi-sdk}` × `{speed,size}` = **8 новых wasm**.
- `rust/raw` — 4 новых крейта (`std` cdylib, ручные `extern "C"` экспорты, без wasm-bindgen).
- `cpp/wasi-sdk` — 2 новых build-скрипта, переиспользующих существующий shared `cpp/src/*.cpp`; + trap-shim TU.
- `spec.json` обоих workload'ов: добавить `raw` в `rust`, `wasi-sdk` в `cpp` (`supported.toolchains`).
- Guidelines harvest — target ≥1 confirmed claim (glue-overhead cross-key-type/size).

**Out of scope:**

- Изменения loader'ов — оба варианта грузятся существующим `raw-wasm` loader'ом без правок (см. § Loaders).
- Перегенерация фикстур / `expectedChecksums` — checksums hasher-independent, остаются pinned (см. § Корректность).
- `js/typed-array` hashmap — отвергнут в Phase 1.1.2 spec (workload меряет stdlib-контейнер).
- Объединение raw+bindgen логики в shared-крейт — оставляем дубликаты; кандидат на потом в roadmap (`hashmap-raw-shared-crate`), решается по факту замера size/perf.

**Rejected explicitly:**

- `no_std` + `hashbrown` для `rust/raw` — это другой контейнер/хешер (foldhash ≠ SipHash), ломает held-constant сравнение с bindgen + добавляет third-party dep против правила «stock stdlib defaults». Минимальность не стоит потери сопоставимости.
- loader-side WASI-стабы как основной путь — размывают «no-glue» чистоту loader-контракта; только fallback (см. § Риски).

## Компоненты

### A. rust/raw — 4 крейта (`benches/hashmap_{int,string}/rust/raw/`)

Имена: `hashmap-int-rust-raw`, `hashmap-string-rust-raw`. `crate-type = ["cdylib"]`, **без** `wasm-bindgen` dependency, **НЕ** `#![no_std]`.

Глобальный стейт — зеркало bindgen-варианта (`LazyLock<SyncCell<State>>`):

```rust
#![allow(unsafe_code, reason = "raw WASM cdylib: no_mangle + Sync impl inherent to FFI surface")]

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::LazyLock;

struct SyncCell<T>(RefCell<T>);
// SAFETY: wasm32 single-threaded — &T never crosses thread boundary; Sync obligation vacuous.
unsafe impl<T> Sync for SyncCell<T> {}

struct State { pairs: Vec<(Key, u64)>, map: HashMap<Key, u64> }
static STATE: LazyLock<SyncCell<State>> = LazyLock::new(|| SyncCell(RefCell::new(State { pairs: Vec::new(), map: HashMap::new() })));
```

Экспорты (все `#[unsafe(no_mangle)] pub extern "C"`), arity под raw-wasm loader:

| Экспорт | Сигнатура | Действие |
|---|---|---|
| `alloc` | `(u32) -> u32` | выделить буфер под фикстуру, вернуть ptr (leak `Vec<u8>`) |
| `load_input` | `(u32, u32)` | `slice::from_raw_parts(ptr, len)` → парс пар → pre-fill `map` |
| `hashmap_X_insert` | `(u32) -> f64` | insert N пар, вернуть `map.len()` |
| `hashmap_X_insert_reset` | `()` | `map.clear()` |
| `hashmap_X_lookup` | `(u32) -> f64` | Σ найденных values |
| `hashmap_X_lookup_reset` | `()` | no-op |
| `hashmap_X_delete` | `(u32) -> f64` | Σ удалённых values |
| `hashmap_X_delete_reset` | `()` | clear + refill из `pairs` |

`memory` экспортируется линкером автоматически. Логика insert/lookup/delete/reset — копия из bindgen (operator semantics идентичны; last-wins на дубликатах ключей — `map.insert` перезаписывает, как в reference; ср. emscripten-баг Phase 1.2, исправленный `8cf09e3`).

Per-bin специфика парсинга (тот же layout, что bindgen):
- `int`: `Key = u64`; две `u64::from_le_bytes` на 16 байт.
- `string`: `Key = String`; `String::from(str::from_utf8(&buf[..16])?)` + `u64::from_le_bytes(&buf[16..24])`.

Аллокатор — дефолтный std global allocator (dlmalloc, import-free на `wasm32-unknown-unknown`). Паника — abort через `unreachable`/trap (для надёжности проверить `panic = "abort"` в release-профилях; на wasm32-unknown-unknown unwinding и так нет). Lints — workspace; `#![allow(unsafe_code)]` (как в bindgen + matmul-raw); pure-fn экспорты могут требовать `#[allow(clippy::missing_const_for_fn, …)]`.

Регистрация: 4 крейта в workspace `Cargo.toml` members. Сборка через существующий `scripts/build-rust.ts` (читает toolchain из dir-наличия + `spec.json.supported`).

### B. cpp/wasi-sdk — 2 build-скрипта (`benches/hashmap_{int,string}/cpp/build-wasi-sdk.sh`)

Переиспользуем существующий shared `cpp/src/<binary>.cpp` (уже собирается emscripten-вариантом — `extern "C"` экспорты те же). Скрипт — паттерн shape_dispatch/matmul wasi-sdk, **но** с libc++ + heap:

- `--target=wasm32-wasi`, `-std=c++23`, warn-флаги, `-fno-exceptions -fno-rtti`, `-fvisibility=hidden`, `-mbulk-memory`.
- `-nostdlib` (НЕ command-модель) + явные архивы:
  - `libc++.a`, `libc++abi.a` (контейнеры, `std::string`, `operator new`),
  - `libc.a` (wasi-libc malloc/free/memcpy/memset),
  - `libclang_rt.builtins-wasm32.a`.
  - порядок резолва через `-Wl,--start-group … -Wl,--end-group` (libc++/libc++abi/libc взаимозависимы).
- `-Wl,--no-entry`, `-Wl,--export=` восьми функций + `memory`, `-Wl,--allow-undefined`, `-Wl,--strip-all`.
- **trap-shim TU** (`benches/hashmap_{int,string}/cpp/src/wasi-shims.cpp` — линкуется ТОЛЬКО этим скриптом, shared `.cpp` не засоряем ifdef'ами): свои `extern "C" void abort()`/`_Exit()` → `__builtin_trap()`, + любые символы, что иначе тянут wasi-libc'шный abort-путь (`__assert_fail`, `__cxa_pure_virtual` — точный набор фиксирует W0-спайк).
- size-профиль: `wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int`.

Точные пути архивов в `$WASI_SDK_PATH/share/wasi-sysroot/lib/wasm32-wasi/` + clang builtins под `$WASI_SDK_PATH/lib/clang/<ver>/lib/wasi/` (clang-версия в пути — взять из существующего shape_dispatch скрипта / `tool-versions.json`).

### C. spec.json — 2 правки

В `benches/hashmap_{int,string}/spec.json` → `supported.toolchains`:
- `rust`: `["bindgen"]` → `["bindgen", "raw"]`
- `cpp`: `["emscripten"]` → `["emscripten", "wasi-sdk"]`

`expectedChecksums` и `inputSizes`/`fixtureSha256` **не меняются**.

### D. Loaders — без изменений

Оба варианта грузятся существующим **`raw-wasm`** loader'ом:
- контракт: экспорты `memory`, `alloc(sz)->ptr`, `load_input(ptr,len)`, arity-1 entry `fn(iters)->f64`, опционально `<entry>_reset` (через `bindReset`, Phase 1.1.2);
- arity-1 dispatch отдаёт checksum напрямую — ровно сигнатура hashmap-entry;
- инстанцирование с пустым import object `{}` — отсюда требование 0 импортов.

`plain-js`/`rust-bindgen`/`emscripten` loader'ы не затрагиваются. `packages/harness` не меняется.

## Поток данных

fixture bytes → raw-wasm loader: `alloc(len)` → copy в `memory` → `load_input(ptr,len)` парс + pre-fill map → `run(iters)` (arity-1 entry → f64 checksum) → harness сверяет с pinned `expectedChecksums` (mismatch → halt case) → reporter агрегирует → guidelines harvest.

## Корректность

- Checksums pinned в `spec.json` (insert→`map.size()`, lookup/delete→Σ values) — **hasher-independent**: разный хешер у raw/wasi-sdk vs bindgen/emscripten невидим для checksum. Паритет с reference-значениями обеспечивается существующим correctness-гейтом harness'а автоматически.
- cpp/wasi-sdk: путь `bad_alloc` под `-fno-exceptions` ведёт в trap-shim (`__builtin_trap`) — приемлемо, фикстуры размерены под доступную память.

## Риски / W0-спайки (жёсткий гейт перед полной матрицей)

Перед сборкой всех 8 бинарей + правкой spec.json + bench — два feasibility-спайка (по одному бинарю на тулчейн, критерий идентичен: собрать → `wasm-dis`/`wasm-objdump` секции импортов → нет ни одного не-`memory` импорта). Работа не выбрасывается: rust-спайк = начало raw-крейта, cpp-спайк = начало build-скрипта.

1. **rust/raw zero-import** — даёт ли `std::collections::HashMap` на `wasm32-unknown-unknown` без wasm-bindgen модуль без не-`memory` импортов? Единственная подозрительная точка — seeding `RandomState` дефолтного хешера. bindgen-вариант работает, но он тащит `__wbindgen_*` импорты, которые удовлетворяет glue; raw-вариант glue не имеет. В `Cargo.lock` нет `getrandom`, что обнадёживает. **Fallback** (если протекает): стаб импорта в loader (нарушает симметрию — крайний случай) или fixed-seed `BuildHasher` (ломает «stock default», документируем как явный trade-off).
2. **cpp/wasi-sdk zero-import + libc++ link** — слинковать `unordered_map`/`std::string` + malloc freestanding без `proc_exit`/`fd_write`/прочих WASI-импортов. Спайк фиксирует точный набор trap-shim символов и порядок архивов. **Fallback**: минимальные loader-side WASI-стабы (документируем), если безвредный импорт неустраним.
3. **Размер** std-raw / libc++-wasi-sdk может оказаться большим — это и есть data point, не провал.

**Гейт:** если спайк не даёт 0 импортов без нарушения held-constant fairness — STOP, эскалация к user'у с fallback-альтернативами (по [feedback_surface_planned_risks]), а не молчаливое применение запасного пути.

## Структура волн

### Wave 0 — feasibility-спайки

1. rust-спайк: минимальный `std`-HashMap cdylib (int) под `wasm32-unknown-unknown`, ручные экспорты → проверить 0 не-`memory` импортов.
2. cpp-спайк: один hashmap `.cpp` (int) через wasi-sdk + libc++ + trap-shims → проверить 0 не-`memory` импортов.

**W0 exit gate:** оба модуля инстанцируются с `{}` и проходят S-валидацию в Node против pinned checksums. Иначе — гейт (эскалация).

### Wave 1 — полная матрица + spec.json

3. Достроить `rust/raw` оба крейта (int готов из W0 → string) + workspace `Cargo.toml` members.
4. Достроить `cpp/wasi-sdk` оба build-скрипта (int готов → string) + trap-shim TU.
5. spec.json обоих workload'ов: `supported.toolchains` += raw/wasi-sdk.
6. Verify: `scripts/build-rust.ts` / `build-cpp.ts` / `scripts/lib/matrix.ts` подхватывают новые тулчейны.

**W1 exit gates:**
- `pnpm build:all` → +8 wasm в `dist/`.
- `pnpm typecheck && pnpm lint:all && pnpm test` зелёные.
- `pnpm smoke` → все 4 новых (binary×toolchain) на S × Node validated против pinned checksums.

### Wave 2 — bench + guidelines + close

7. `pnpm bench:all` — полная матрица (включая новые 8 × 3 entries × 3 sizes).
8. `pnpm report` → reporter HTML sanity check (новые тулчейн-колонки видны).
9. Guidelines harvest (target ≥1 confirmed):
   - glue-overhead: `raw` vs `bindgen`, `wasi-sdk` vs `emscripten`, cross-key-type (int+string) × cross-size.
   - std-inclusion delta: raw-hashmap vs no_std matmul-raw.
   - Confirmed: ≥2 sizes × ≥2 key-types consistent. Tentative: single-axis.
10. `docs/roadmap.md`: убрать `hashmap-stdlib-no-glue`; добавить `hashmap-raw-shared-crate` кандидат.
11. Capture pitfalls если всплыло. Phase close по `/iterate` Phase 7 (gates → push → PR → /finish-session).

**Phase exit criteria:**
- 8 новых wasm built (2 binaries × 2 toolchains × 2 profiles).
- Корректность: все новые combo проходят pinned checksums (smoke@S + bench:all).
- Reporter показывает новые тулчейны для обоих hashmap workload'ов.
- ≥1 confirmed или well-justified tentative claim в `docs/guidelines.md`.
- Master gates green.

## Тестирование

- Корректность — pinned checksums (smoke@S, затем bench:all полная матрица). Новых фикстур нет.
- Кода loader'ов/harness не меняем → существующие unit-тесты достаточны; новые крейты/скрипты покрываются build + smoke.
- W0-спайки — сами по себе тест феасибилити (import-section assertion).

## References

- Predecessor spec: [`2026-05-23-phase-1-1-2-hashmap-design.md`](2026-05-23-phase-1-1-2-hashmap-design.md) (§ Out of scope → этот slice).
- BenchModule / Loader контракт: [`2026-05-01-wasm-benchmarks-design.md`](2026-05-01-wasm-benchmarks-design.md).
- raw-wasm loader: `packages/loaders/src/raw-wasm.ts` (arity dispatch + `bind-reset.ts`).
- wasi-sdk freestanding precedent: `benches/shape_dispatch_homo_dyn/cpp/build-wasi-sdk.sh` (`-nostdlib` + explicit `libc.a`).
- emscripten dup-key fix (last-wins semantics): commit `8cf09e3`, [`bug-reports/`](../bug-reports/).
- Roadmap: [`../../roadmap.md § Phase 1.2`](../../roadmap.md).
- Guidelines: [`../../guidelines.md`](../../guidelines.md).
