# Phase 1.4 — size attribution toolchain coverage — design

**Status:** ready for implementation plan
**Refines:** roadmap entry `size-attr-toolchain-coverage` ([→ roadmap § TBD](../../roadmap.md)).
**Predecessor:** Phase 1.3 `wasm-size-floor-vs-marginal` (closed, merged PR #7). Та итерация сделала размер разложимым first-class-результатом, но атрибутировала **только rust/raw**; остальные три wasm-тулчейна (rust/bindgen, cpp/wasi-sdk, cpp/emscripten) показывались серым `composition: null` («не атрибутировано»). Это самый весомый остаток spec § In scope Phase 1.3 (отгружен 1 из 4 тулчейнов).

## Purpose

Закрыть size-ось: дать facility-атрибуцию **всем** wasm-тулчейнам (rust/bindgen, cpp/wasi-sdk, cpp/emscripten) тем же методом, что rust/raw (доли из name-bearing pre-opt сборки × калибровка к точному production-тоталу), и честно показать **per-binary JS-glue** bindgen/emscripten в Size-виде. Превратить серые «не атрибутировано» бары в разложение + grounded кросс-тулчейновые guideline-числа.

## Root-cause finding — cpp/wasi-sdk name-section «heisenbug» РЕШЁН

Bug-report `2026-06-21-cpp-wasi-sdk-name-section-heisenbug.md` («механизм не изолирован») закрыт в дизайн-фазе через `/systematic-debugging`. Корень тривиален и не мистичен:

- `build-cpp.ts buildWasiSdk` запускает сборку с `PATH=.tools/bin:$PATH` (чтобы скрипт мог звать `wasm-opt` для production size-сборки).
- С `.tools/bin` на PATH **драйвер wasi-sdk clang при `-flto` авто-находит `wasm-opt` и прогоняет его post-link** (подтверждено `clang -###`: в плане линковки `.tools/bin/wasm-opt`).
- Этот авто-`wasm-opt` без `-g` **срезает `name`-секцию** у `module.attr.wasm` → twiggy видит `code[N]` → ~98% unattributed → `composition: null`.

**Изоляция (по одной переменной, воспроизведено):** name-секция присутствует ⟺ `wasm-opt` НЕ на PATH. Флаги во всех тестах байт-в-байт идентичны (`diff` argv → identical); единственная переменная — PATH. **Почему прошлая сессия не нашла:** их standalone-репро шли с дефолтным PATH (без `.tools/bin`) → авто-wasm-opt не срабатывал → «standalone работает», pipeline «ломает». Ложный дискриминатор «файл-скрипт vs `bash -c`» — мираж; настоящая переменная — окружение (PATH), на что указывал open-question #1 самого bug-report'а.

**End-to-end подтверждение фикса** (name-bearing attr-сборка с PATH-гигиеной → реальный `buildComposition`): `unattributedShare = 0.66%` (порог деградации 50%), facilities: allocator 44.3%, hash-map 20.8%, observed 17.8%, compiler-rt 6.9%, string 4.7%, data 2.9%, structural 1.5%, panic-fmt 0.4%. Пишется **реальная** композиция, не null.

**Pitfall/agent-lesson записаны** (env-diff, не argv-diff, при «не воспроизводится standalone»).

## Эмпирика компрессии (W0, выполнен в дизайн-фазе)

Усреднение по 73 meta.json: коэффициент сжатия glue и wasm **разный и непредсказуемый** — bindgen glue gz **29.4%** vs его wasm gz 45.3%; emscripten glue зависит от профиля (gz 48% size / 33% speed); wasm gz 45–61%. **Вывод:** длина glue-band'а и wasm-band'а должна браться из **собственных** измеренных `{raw,gz,brotli}` каждого артефакта (в проде это два независимо сжимаемых файла) — **никаких общих коэффициентов**. Архитектура это уже выдерживает (`meta.wasm` и `meta.jsGlue` несут по три измеренных размера).

## Scope

**In scope:**

- Facility-атрибуция трёх оставшихся wasm-тулчейнов: **rust/bindgen**, **cpp/wasi-sdk**, **cpp/emscripten** — тем же методом (доли pre-opt × калибровка), раскатка по всем поддерживающим workload'ам.
- **PATH-гигиена (точечно):** attr-сборка cpp/wasi-sdk не видит `wasm-opt` на PATH; production-вызов `wasm-opt` — через абсолютный путь. Чинит name-секцию для всех wasi-sdk-workload'ов.
- Раскатка SIZE_ATTR attr-build-ветки на остальные wasi-sdk-скрипты (сейчас только `hashmap_string`); attr-output в изолированный dir (не dist).
- emscripten name-preservation для attr-сборки (`--profiling-funcs`/`-g2`); проба name-survival; section-only fallback если не выживают.
- Reporter: **glue-band** «glue (JS)» для bindgen/emscripten (измеренный `jsGlue`-размер, отдельный paid-once-сегмент); bar-тотал = `wasm + glue` на общей шкале; компрессия per-артефакт.
- Обновление `docs/guidelines.md` (grounded кросс-тулчейновая floor-композиция + glue-цена), roadmap removal (`size-attr-toolchain-coverage`), закрытие bug-report.

**Out of scope:**

- Полная проектная PATH-гигиена (аудит всех PATH-инъекций, абсолютные пути ко всем тулам) → roadmap `path-hygiene-build-isolation`.
- Оценка размера самописного raw host-glue (`rawWasmLoader`) → roadmap `size-attr-raw-host-glue`.
- math-table split (`size-attr-math-table`), per-facility bar color (`size-bar-per-facility-color`), perf-редизайн (`perf-view-redesign`) — их roadmap-пункты.
- Байт-точная per-symbol атрибуция production-бинаря (доказана невозможной, Phase 1.3 находка 3).
- Intra-bundle декомпозиция JS / декомпозиция glue по содержимому (glue показывается одним сегментом, не разлагается по facility — это JS, не wasm).
- Изменение workload-исходников/семантики (атрибуция read-only; production-бинарь и perf/корректность не затрагиваются).

## Метод

Без изменений относительно Phase 1.3 (Option A): production-тотал точен (якорь absolute); композиционные доли — из name-bearing **pre-wasm-opt** сборки через `twiggy top -f json` → реестр правил; per-facility absolute = доля × productionTotal (помечен `≈`); бары суммируются в точный shipped-тотал. Каждый тулчейн поставляет name-bearing сборку своим способом (ниже).

## Per-toolchain дизайн

### rust/bindgen
- wasm: `wasm-pack`/`cargo build` со STRIP=false в изолированный dir → twiggy → `buildComposition`. wasm-bindgen glue-внутри-wasm → facility `toolchain-runtime` (в реестре). Аналог `attributeRustRaw`.
- `glue.js`: отдельный измеренный glue-band (§ Reporter). Не атрибутируется по facility.

### cpp/wasi-sdk
- attr-сборка clang со STRIP=false (без `--strip-all`), **без `wasm-opt` на PATH** (PATH-гигиена) → name-секция выживает → twiggy → `buildComposition`. Раскатка attr-build-ветки на все wasi-sdk-скрипты; attr-output в изолированный dir.
- Без glue (raw-loader общий, не шипится per-binary; см. out-of-scope `size-attr-raw-host-glue`).

### cpp/emscripten
- emcc всегда гоняет Binaryen внутри → attr-сборка с emcc name-preservation (`--profiling-funcs` или `-g2`). **Проба name-survival при достижении** (зондом НЕ проверялся). Если имена выживают → атрибуция; если нет → section-only fallback (graceful degradation, `composition: null` + документируется).
- `glue.mjs`: отдельный измеренный glue-band.

## Facility-реестр

Покрытие cpp подтверждено (unattributed 0.66% на hashmap_string). Возможна донастройка под bindgen/emscripten glue-in-wasm паттерны — правила добавляются по мере прогона инстансов; видимый unattributed/observed сигналит «добавь правило» (by design, не баг). Изменения реестра — в `packages/size-attr/src/facilities.ts`.

## Reporter — glue-band

- bindgen/emscripten: добавить сегмент **«glue (JS)»**, длина = собственный измеренный `jsGlue.{raw|gz|brotli}` для текущего режима компрессии (НЕ пересчёт из wasm). Помечен `paid-once`, не разлагается по facility.
- Bar-тотал (per режим компрессии) = `wasm.X + glue.X` (каждый измерен независимо — честно, т.к. в проде два независимо сжимаемых файла; = текущий `totalTransferGzipBytes` для gz).
- raw/wasi-sdk — без glue-band (бар = wasm).
- `packages/reporter/src/size-data.ts`: `totals` сейчас = `m.wasm` → расширить на `wasm + jsGlue` (когда `jsGlue` присутствует), плюс пробросить glue-сегмент в view-model.

## Schema

**Изменений в `packages/result-schema` НЕ требуется.** Reporter собирает бар из уже существующих `meta.composition` (wasm-facilities) + `meta.jsGlue` (glue-band, три измеренных размера). `composition` остаётся wasm-only (twiggy-derived). Если по ходу выяснится потребность пометить glue в схеме — изменение строго через `packages/result-schema` (бамп при необходимости).

## Sequencing (инстансы последовательно)

1. **rust/bindgen** — чистейший (та же cargo-машинерия, что raw).
2. **cpp/wasi-sdk** — PATH-фикс (подтверждён) + раскатка на все workload'ы.
3. **cpp/emscripten** — проба name-preservation флага; fallback section-only.
4. **Reporter glue-band** — после того как bindgen/emscripten дают `jsGlue`-данные.
5. **Guidelines + roadmap + bug-report close + gates.**

Сюрпризы ловим до следующего инстанса.

## Deliverables

- Атрибуция bindgen/wasi-sdk/emscripten в `build:all` + отчёте (или section-only fallback для emscripten, документированный).
- PATH-гигиена для cpp/wasi-sdk attr-сборки; раскатка attr-build на все wasi-sdk-скрипты; attr-output изолирован.
- Reporter glue-band (bindgen/emscripten) + честный bar-тотал wasm+glue.
- `docs/guidelines.md` — grounded кросс-тулчейновая floor-композиция (rust panic-fmt 24.7% vs cpp 0.4%; bindgen самый тяжёлый; glue — paid-once цена bindgen/emscripten).
- `docs/roadmap.md` — удалить `size-attr-toolchain-coverage` (graduated).
- `docs/superpowers/bug-reports/2026-06-21-cpp-wasi-sdk-name-section-heisenbug.md` — пометить RESOLVED (root cause + фикс).
- Gates зелёные; correctness re-eval не затронут (атрибуция read-only).

## Валидация

- unattributedShare мал и виден (rust/raw ~0.05–2%, cpp/wasi-sdk подтверждён 0.66%); bindgen/emscripten — целевой <50% (порог деградации), стремимся к единицам %.
- Бары суммируются в точный production-тотал (wasm) + измеренный glue.
- Glue-band длина = измеренный `jsGlue` per режим компрессии (не пересчёт).
- Production gates зелёные; smoke 0 correctness failures; production-бинари не меняются (только attr-сборка/PATH).
- twiggy-JSON парсится; реестр фальсифицируем (видимый residual).
- **Визуальный чек отчёта** (iterate Close-checklist): открыть HTML, убедиться — bindgen/emscripten бары разложены + glue-band читаем; raw/wasi-sdk без glue; emscripten section-only (если fallback) честно помечен.

## Риски

- **emscripten name-survival** не проверен → проба при достижении; fallback section-only (митигация в дизайне).
- **PATH-фикс ломает production wasm-opt** (size-профиль) → production-вызов через абсолютный путь; gate: production-бинари byte-идентичны до/после (hashSha256 в meta).
- **Раскатка на 7 wasi-sdk-скриптов** — копипаста attr-ветки; митигация — единый PATH-фикс централизован в build-cpp.ts, в скриптах только attr-инвокация.
- **glue-band в reporter** — `size-data.ts`/view-model правки; визуальный чек обязателен (Phase 1.3 pitfall: гейты не ловят render-регрессии).
- **реестр неполон для bindgen/emscripten** glue-in-wasm → unattributed сигналит, добавляем правила (by design).

## Структура волн (набросок для плана)

- **W1** — rust/bindgen атрибуция (`attributeRustBindgen`, glue-in-wasm → toolchain-runtime) — чистейший инстанс, без env-сюрпризов.
- **W2** — PATH-гигиена cpp/wasi-sdk (фикс + раскатка attr-build на все wasi-sdk-скрипты, attr-output изолирован) → реальная композиция всех wasi-sdk-workload'ов.
- **W3** — cpp/emscripten name-preservation проба + атрибуция или section-only fallback.
- **W4** — reporter glue-band (bindgen/emscripten) + честный bar-тотал; визуальный чек.
- **W5** — guidelines + roadmap removal + bug-report close + gates.

## References

- Predecessor spec: [`2026-06-21-wasm-size-floor-vs-marginal-design.md`](2026-06-21-wasm-size-floor-vs-marginal-design.md) (метод, калибровка, facility-таксономия).
- Resolved bug-report: [`2026-06-21-cpp-wasi-sdk-name-section-heisenbug.md`](../bug-reports/2026-06-21-cpp-wasi-sdk-name-section-heisenbug.md).
- Roadmap: `size-attr-toolchain-coverage` + преемники `path-hygiene-build-isolation`, `size-attr-raw-host-glue` ([→ roadmap.md](../../roadmap.md)).
- Существующие size-guideline: `docs/guidelines.md` § Artifact size.
- Design spec (BenchModule / артефакты / meta): [`2026-05-01-wasm-benchmarks-design.md`](2026-05-01-wasm-benchmarks-design.md).
