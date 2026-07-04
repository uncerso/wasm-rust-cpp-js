# build-hygiene — explicit wasm-opt + PATH isolation — design

**Status:** ready for implementation plan
**Refines:** roadmap entries `cpp-wasm-opt-explicit` + `path-hygiene-build-isolation` ([→ roadmap § TBD](../../roadmap.md)); folds in tech-debt `r1-devirt-objdump-tooling` + `dead-ts-output-fields`.
**Predecessor:** Phase 1.4 `size-attr-toolchain-coverage` (closed, merged PR #8). Та итерация изолировала name-section heisenbug **точечно** (production clang держит `.tools/bin` через `PROD_PATH` ради byte-identity с baseline Phase 1.1–1.3; attr clang идёт с «чистым» PATH). Осталось два сцепленных остатка: неявный wasm-opt у cpp/wasi-sdk и утечка ambient PATH в сборку.
**Bug-report:** `docs/superpowers/bug-reports/2026-06-25-cpp-wasi-sdk-name-section-env-diff.md` (root cause PATH-зависимости).

## Purpose

Сделать wasm-артефакты **воспроизводимыми и не зависящими от ambient PATH пользователя**. Сегодня байты cpp/wasi-sdk определяются тем, что́ лежит на PATH (драйвер wasi-sdk clang при `-flto` сам находит `wasm-opt` и прогоняет его post-link). Это невоспроизводимо и возвращает heisenbug name-секции при чужом `wasm-opt` на машине. Заодно — выровнять методологию wasm-opt по всем тулчейнам (см. Root-cause finding 2 + решение Option B).

## Root-cause findings (измерено в дизайн-фазе)

Все числа получены на этой машине (wasi-sdk-25, binaryen-129), matmul+hashmap_int, node.

**1. Драйвер авто-запускает wasm-opt по наличию на PATH.** Трейс `clang++ … -flto -v`:
```
wasm-opt module.wasm -O3 -o module.wasm     # speed profile
wasm-opt module.wasm -Oz -o module.wasm     # size profile (авто) + ещё явный -Oz в shell → size оптимизируется ДВАЖДЫ
```
Флаги `--enable-*` драйвер не передаёт (binaryen читает target_features-секцию). Убрать `.tools/bin` из PATH → wasm-opt не запускается → артефакт 962B (неоптимизирован) вместо 988B. **Байты PATH-зависимы.**

**2. `run()` (`scripts/lib/exec.ts:9`) наследует весь `process.env`** (`{ ...process.env, ...opts.env }`). Attr-сборка cpp PATH явно не задаёт → наследует ambient PATH → чужой `wasm-opt` может её испортить (открытый риск роадмапа).

**3. Явный wasm-opt на strip'нутом артефакте требует `--enable-bulk-memory --enable-nontrapping-float-to-int`** — иначе падает валидацией (`memory.fill requires bulk memory`), т.к. `--strip-all` срезает target_features. Совпадает с правилом CLAUDE.md.

**4. wasi-sdk clang линкует с пустым `PATH=`** (clang абсолютный, wasm-ld находит относительно себя). Значит полная PATH-изоляция достижима.

**5. Эффект `wasm-opt -O3` на speed-профиль (warmMedian, node; negative = быстрее):**

| workload | CPP/wasi-sdk | RUST/raw | size Δ (wasm-opt) |
|---|---|---|---|
| matmul (компьют) | −0.9% | −0.3% | cpp +26B, rust −6% |
| hashmap insert | **−13.6%** | −0.3% | cpp −13.5%, rust −18% |
| hashmap delete | **−11.1%** | +1.0% | (то же) |
| hashmap lookup | **+18.5%** ⚠ | +0.3% | (то же) |

Вывод: `wasm-opt -O3` практически никогда не вредит perf и помогает (cpp — perf на allocator-коде, оба — размер). rust perf-нейтрален (rustc/LLVM уже speed-оптимален), но размер жмётся. Аномалия hashmap-lookup (+18.5% cpp) — вероятно code-layout эффект или шум (M≈0.07→0.08ms); подтвердит полный re-bench. Эти данные — основание Option B.

## Решение — методологический выбор

**Option B (принято):** wasm-opt применяется ко **всем** профилям — speed (`-O3`) и size (`-Oz`), у всех тулчейнов, эмитящих wasm явно. Обоснование: wasm-opt эмпирически — speed-инструмент (не только size), исключать его из speed = недооптимизировать; никогда не регрессит; единообразно; отражает «лучший реалистичный выход» для product-guidelines. Отклонён Option A (spec-намерение «speed без wasm-opt») как эмпирически неполный. Развилка и данные — выше (finding 5).

## Scope

**In scope:**
- Общий модуль `scripts/lib/wasm-opt.ts`; вызов из `build-rust.ts` + `build-cpp.ts`.
- Явный wasm-opt для cpp/wasi-sdk (оба профиля) + **новый** для rust/raw-speed и rust/bindgen-speed.
- Per-invocation PATH-сборка (wasi-sdk / emscripten / rust); удаление `PROD_PATH`-костыля.
- cpp `build-wasi-sdk.sh` (×8 workloads) → link-only.
- Правка методологической таблицы design-спеки + `postprocess`-декларации speed-профилей.
- Folded-in: `wasmDisasmPath()` резолвер (r1-devirt) + удаление dead-полей лоадеров.
- Full re-baseline (size агентом + perf полным прогоном) + обновление `docs/guidelines.md`.

**Out of scope:**
- Полный env-scrub `run()` (не наследовать `process.env` вовсе) — высокий blast radius (cargo/emcc нужны `HOME`/`CARGO_HOME`/пр.); для детерминизма артефакта решает PATH.
- emscripten wasm-opt — остаётся внутренним у emcc (не добавляем явный пасс — двойная оптимизация).
- `bindgen-size-opt-level`, `size-attr-math-table`, `size-attr-raw-host-glue` — отдельные роадмап-items.
- Выравнивание codegen opt-level bindgen vs raw — не здесь.

## Per-toolchain дизайн

### `scripts/lib/wasm-opt.ts`
`optimizeWasm(wasmPath: string, level: "O3" | "Oz"): Promise<void>` → `run(wasmOptPath(), ["-${level}", "--enable-bulk-memory", "--enable-nontrapping-float-to-int", wasmPath, "-o", wasmPath])`. Единственное место с enable-флагами + абсолютным путём. Идемпотентен по контракту (in-place).

### rust (`build-rust.ts`)
- Заменить два inline-вызова wasm-opt на `optimizeWasm(dst, "Oz")` (size).
- Добавить `optimizeWasm(dst, "O3")` для speed (raw + bindgen) — новое.
- PATH: собрать `dirname(resolveOnPath("cargo"))` + `.tools/bin` (wasm-pack), передать в `run("cargo"/wasmPackPath(), …, { env: { PATH } })`. Проверить: чисто-Rust крейтам (без cc-rs/build.rs-шелла) rustc через `RUSTUP_HOME` — PATH больше не нужен.

### cpp/wasi-sdk (`build-cpp.ts` + `benches/*/cpp/build-wasi-sdk.sh`)
- Shell-скрипт → **link-only**: `module.wasm` (`--strip-all`, без wasm-opt) + `module.attr.wasm` (name-bearing). Удалить строку `wasm-opt -Oz` и всю логику `PROD_PATH`.
- `build-cpp.ts buildWasiSdk`: запускать shell с **минимальным PATH** (без wasm-opt); после — `optimizeWasm(module.wasm, profile === "speed" ? "O3" : "Oz")`.
- Тот же минимальный PATH и для attr-сборки внутри скрипта → name-секция выживает независимо от машины.

### cpp/emscripten (`build-cpp.ts` + `build-emscripten.sh`)
- Без изменений в оптимизации (emcc гоняет binaryen внутри).
- PATH: только то, что даёт `emsdkEnv()`; **дропнуть prepend `.tools/bin`** (emcc использует свой binaryen; `.tools/bin` лишний и потенциально затеняет версию).

## Спека + schema
- Design-спека `2026-05-01-wasm-benchmarks-design.md`: методологическая таблица — speed-профили теперь включают `wasm-opt` (`-O3`). Явно отметить, что это ревизия Phase build-hygiene (было: wasm-opt только size).
- `postprocess` **выводится в раннере**, не из spec.json: `ranWasmOpt = profile === "size" && (rust||cpp)` в `apps/runner-node/src/run-case.ts:139` + `apps/runner-web/src/worker.ts:187`. Правка Option B — **убрать условие `profile === "size"`**: `ranWasmOpt = language === "rust" || language === "cpp"` (wasm-opt теперь на обоих профилях; emscripten тоже cpp → true, binaryen internal у emcc). JS остаётся `[]`. Правку продублировать в оба раннера (node+web) идентично.
- **Schema НЕ меняется** (postprocess — данные, `SCHEMA_VERSION` не трогаем; старые v2-результаты парсятся, re-bench их регенерирует).

## Folded-in tech-debt
- **r1-devirt-objdump-tooling:** `wasmDisasmPath()` в `scripts/lib/tool-paths.ts` — резолвит канонический дизассемблер (`.tools/wasi-sdk-25/bin/llvm-objdump` или binaryen `wasm-dis`), **hard-error если отсутствует** (не тихий `0`). Грепнуть plan/spec/docs на `wasm-objdump`, заменить на резолвер. Закрыть debt-файл.
- **dead-ts-output-fields:** удалить `output_ptr`/`output_len` (`raw-wasm.ts`), `_output_ptr`/`_output_len` (`emscripten.ts`) после grep-верификации, что читаются только в interface-декларациях. Закрыть debt-файл.

## Re-baseline
- **Size (агент):** `pnpm build:all` → размеры из `meta.json`. Замерить byte-дельту cpp/wasi-sdk (оба профиля) + rust-speed; обновить size-числа в `docs/guidelines.md`.
- **Perf (полный прогон, после имплементации):** `pnpm bench:all` (node+chromium+firefox). Сравнить с baseline `results/raw/2026-07-04T12-06-07-626Z`: ожидать cpp/wasi-sdk-speed hashmap ~−11..−14% (быстрее), rust-speed perf ~±1%, matmul ~0; проверить hashmap-lookup аномалию. Обновить perf-claims в guidelines. Кто гоняет полный браузерный прогон — решается на close-фазе (машинная тишина).

## Валидация
- Гейты: `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke`.
- **Новый инвариант детерминизма:** собрать один и тот же workload дважды с **разными** ambient PATH (например с/без постороннего `wasm-opt` на PATH) → production `module.wasm` **байт-идентичны**. Сейчас этого свойства нет — это ключевой acceptance-критерий. Оформить как проверяемый шаг (скрипт/тест).
- Size-attr не сломан: attr.wasm name-bearing, `twiggy` читает имена, композиция × новый production-total.
- Все результаты парсятся (`BenchResultSchema.parse`), 0 correctness-fail.

## Риски
- **hashmap-lookup аномалия (+18.5% cpp)** — полный re-bench покажет, реальна ли; если реальна и велика — surface + guideline-finding, не блокер.
- **rust PATH-синтез** — если чисто-Rust сборке всё же нужен системный тул через PATH (маловероятно, нет cc-rs), fallback: добавить `/usr/bin` в собранный PATH. Проверить на этапе плана.
- **cpp size ×2→×1 wasm-opt** — байты size-профиля сдвинутся (двойной -Oz был почти идемпотентен, но не гарантированно); ловится size re-baseline.
- **Спека vs реальность postprocess** — точный источник поля найти до правки (иначе декларация разъедется с фактом).

## Структура волн (набросок для плана)
- **W0 baseline gate:** зелёные гейты на master-состоянии ветки; зафиксировать текущие размеры (для дельты).
- **W1 wasm-opt helper + rust:** `wasm-opt.ts`, рефактор `build-rust.ts` (helper + speed wasm-opt + PATH-синтез).
- **W2 cpp wasi-sdk:** shell link-only (×8), `build-cpp.ts` явный wasm-opt + минимальный PATH, удалить `PROD_PATH`.
- **W3 emscripten PATH + folded-in:** дропнуть `.tools/bin`; `wasmDisasmPath()` + замены; dead-fields.
- **W4 спека + postprocess + determinism-invariant тест.**
- **W5 re-baseline + guidelines + close** (size агент; perf полный прогон).

## References
- roadmap `cpp-wasm-opt-explicit`, `path-hygiene-build-isolation` ([→ roadmap](../../roadmap.md)).
- tech-debt `r1-devirt-objdump-tooling`, `dead-ts-output-fields`.
- bug-report `2026-06-25-cpp-wasi-sdk-name-section-env-diff.md`; pitfall того же дня.
- Phase 1.4 spec `2026-06-25-size-attr-toolchain-coverage-design.md` (PROD_PATH/attr-механизм).
- design spec `2026-05-01-wasm-benchmarks-design.md` (методологическая таблица — правится здесь).
- Baseline замеры: `results/raw/2026-07-01T20-56-14-040Z`, `results/raw/2026-07-04T12-06-07-626Z`.
