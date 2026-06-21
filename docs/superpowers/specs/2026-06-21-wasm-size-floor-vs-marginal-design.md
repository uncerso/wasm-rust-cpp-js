# Phase 1.3 — wasm size floor-vs-marginal attribution — design

**Status:** ready for implementation plan
**Refines:** roadmap entry `wasm-size-floor-vs-marginal` (TBD bucket, [→ roadmap § TBD](../../roadmap.md)).
**Predecessor:** Phase 1.2 `rust-vs-cpp-wasm-size` (closed, merged PR #6). Та итерация установила, что размер микро-workload'ов доминируется фиксированным налогом тулчейна, а не структурой алгоритма (8× кросс-toolchain разброс при ~1.5 KB логики), но дала лишь handwave-числа. Эта итерация делает размер **разложимым first-class-результатом**.

## Purpose

Превратить артефакт-size из одного бесполезного числа (константный налог перебивает изучаемый эффект) в **разложение по категориям**, видимое в самом отчёте бенчмарка. Каждый бинарь разбивается на facility-категории (allocator, hash-map, string, panic/fmt, primitive-таблицы, наблюдаемый workload-код, …), каждая помечена **осью роста** (`paid-once` / `per-type` / `observed`), с приближёнными абсолютными байтами на **общей байтовой шкале** — чтобы выводы читались напрямую, в т.ч. кросс-языково.

## Предварительные находки (W0-зонд, выполнен 2026-06-21)

Эмпирический зонд (name-bearing pre-opt сборки + `twiggy 0.8.0`, на matmul / hashmap_int / hashmap_string, rust/raw + cpp/wasi-sdk) подтвердил:

1. **`twiggy top -f json`** даёт машинно-читаемые per-symbol shallow-байты `{name, shallow_size, shallow_size_percent}`, **авто-демangлит C++**. cpp-имена (wasi-sdk) **выживают** — символьная атрибуция доступна обоим языкам (0 анонимных `code[N]` на hashmap_string cpp).
2. **Faceted-таксономия атрибутирует >96% prod-релевантных байтов.** Реальный `unattributed` code-residual мал: на rust std-hashmap ~557 B — кластер `LazyLock`/`thread-local`/`FnOnce`/`RefCell` (ленивый init `RandomState`) → выделяется в категорию `toolchain-runtime`, и residual падает в ~0.
3. **Байт-точная символьная атрибуция production-бинаря НЕВОЗМОЖНА.** Присутствие `name`/debug-секций во время `wasm-opt` **меняет оптимизацию** (binaryen `-g` глушит merge-functions/dedup): matmul keep-names→strip = 1005 code B / 8 функций vs production 940 / 6. Контроль: `strip-first → wasm-opt` даёт байт-в-байт production (940/6), но это выкидывает имена. **Вывод: нельзя одновременно иметь production-байты И post-opt имена.** Символьная атрибуция неизбежно **pre-optimization** (композиция/доли). Это определяет метод (ниже).
4. Находки-бонусы для guidelines: rust несёт большой `panic+fmt`-floor (~15–23% std-hashmap) против cpp ~0.4%; `string`-facility мал (rust 0.37K / cpp 0.71K) — большая часть «строковой» цены на самом деле allocator+hash; `Vec`/`vector` ≈ ноль сверх allocator.

Полный отчёт зонда — в истории сессии; точные тоталы воспроизводимы перечисленными командами.

## Scope

**In scope:**

- Атрибуция размера как **first-class output** в `build:all` + отчёте, для wasm-тулчейнов (rust/raw, rust/bindgen, cpp/wasi-sdk, cpp/emscripten) и JS (особый случай, ниже).
- **Faceted facility-таксономия** (расширяемый реестр правил, не плоский enum).
- Reporter-визуализация: композиционные bars (floor-band + observed-band) на общей байтовой шкале + within-toolchain «вычесть floor» + кросс-языковой вид (выравнивание по категориям + таблица + тумблер «только наблюдаемое»).
- **Reporter-shell**: одна статическая страница с вкладками `Size`/`Perf` + клиентские фильтры; perf-вкладка = релокация существующей таблицы + 2×2 shape-grid в shell с удалением size-колонок (size теперь свой вид) — **без perf-редизайна**.
- Фильтры отображения: сжатие `raw/gzip/brotli`, профиль `size/speed`, мульти-выбор тулчейнов, тумблер «только наблюдаемое».
- Точечный **дифференциал на production-opt** для headline-фактов (реальная цена allocator на -Oz; «map<int,int> paid-once» через 1-vs-N use-site; премия мономорфизации).
- `twiggy` пинится в `tool-versions.json` как build-инструмент.
- Обновление `docs/guidelines.md` + `README.md` (раздел «почему размеры приближённые и почему это ок») + roadmap removal.

**Out of scope:**

- Байт-точная per-symbol атрибуция production-бинаря (доказано невозможной — см. находку 3).
- Богатый perf-редизайн (графики init-фаз, CV-heatmap, сравнение env): perf-таблица только переносится в shell минус size-колонки; полный редизайн → roadmap-преемник `perf-view-redesign`.
- Intra-bundle декомпозиция JS (нет константного floor — весь bundle наблюдаемый; декомпозиция по зависимостям — future, наши JS-impl бездепные).
- Изменение workload-исходников или семантики бенчмарков (атрибуция — read-only анализ сборки; production-бинарь не меняется, perf/корректность не затрагиваются).
- Фильтр размера S/M/L в size-отчёте (бинарь size/env-инвариантен; S/M/L — ось perf).
- Общая CV/variance стабилизация (отдельный roadmap-пункт).

## Метод измерения (Option A — композиция-как-доли + приближённые абсолюты + точечный дифференциал)

Три слоя, разной точности и назначения:

1. **Production-тотал (точный).** Shipped-бинарь `raw/gzip/brotli` — меряется как сегодня. Это якорь абсолюта, ему доверяем побайтово.
2. **Композиционные доли (устойчивые).** Name-bearing **pre-wasm-opt** сборка → `twiggy top -f json` → категоризация реестром → доли каждой facility (% от code+data, исключая DWARF/name). Доли устойчивы к калибровке.
3. **Per-facility абсолют (приближённый).** `доля × production-тотал` → бары суммируются в **точный** shipped-размер, сегменты помечены `≈`. Caveat: `wasm-opt` сжимает категории неравномерно (может слить дублированные мономорфные тела сильнее, чем allocator) → per-facility абсолют ±; **порядок величины надёжен** (этого достаточно — подтверждено в брейнсторме).
4. **Дифференциал (production-точный, точечно).** Только для headline-утверждений: minimal-варианты на `-Oz`, размер = дельта слоёв. Production-точные маржинальные числа для пары guideline'ов; кросс-проверка крупных facility (доля×тотал должна совпасть по порядку с дифференциал-дельтой).

**Почему так, а не байт-точно:** см. находку 3 (W0). Невозможность — фундаментальная (wasm-opt vs имена), не лень. Дисциплина калибровки = ровно то, что Phase 1.2 уже применяла («twiggy = композиция, абсолют якорим к section-split»). Это объяснение идёт в README.

## Faceted facility-таксономия

Реестр упорядоченных правил `{facility, scaling-tag, name-patterns}`. Символ → первая совпавшая facility; workload-namespace → `observed`; иначе → `unattributed` (видимый, целевой ~0). Реестр **расширяемый**: будущие workload'ы (sort/parsing/set/sorted-map) добавляют свои правила; непокрытое падает в `unattributed`/`observed` и сигналит «добавь правило».

Начальный реестр (обоснован зондом):

| facility | scaling | примеры символов |
|---|---|---|
| `allocator` | paid-once | dlmalloc/dlfree, `__rust_alloc`, wasi malloc, `operator new` |
| `hash-map` | paid-once¹ | `HashMap`/`unordered_map` probe, SipHash/`RandomState`, libc++ `__hash_table` |
| `string` | paid-once | `alloc::string`, `std::__2::basic_string`, utf8/clone/compare |
| `dynamic-array` | paid-once² | `Vec`/`RawVec`, `__split_buffer` |
| `panic/fmt` | paid-once | `core::fmt`, panic/unwrap/expect, bounds-fail; cpp `__cxa_*`/`__throw_*` |
| `toolchain-runtime` | paid-once | `LazyLock`/`thread_local`/`FnOnce` (RandomState-init); bindgen/emscripten glue-in-wasm |
| `math-table:<fn>` | paid-once | libm `__log_data`, isqrt-таблица (требует data-content ID через `wasm-tools print`) |
| `compiler-rt` | paid-once | `__multi3`/`__udiv*`, memcpy/memmove/memcmp |
| `data/structural` | paid-once | прочие data-сегменты, exports/elem/magic |
| `observed` | observed | функции namespace'а workload'а + экспорты |
| `monomorphized` | per-type | N специализированных копий тела (shape_dispatch static) |
| `unattributed` | — | непокрытый residual (видимый) |

¹ per-keytype при нескольких типах ключа — для одного workload'а ≈ paid-once; уточняется в caveat.
² на практике ≈0 сверх allocator (зонд: 55 B) — отвечает на вопрос «куда vector»: своя категория, но крошечная. `unordered_map<string,int>` = `hash-map` + `string` + `allocator` (три категории), не одна.

Группировка `floor` = все paid-once; `observed`+`monomorphized` = изучаемое. «floor-band» (приглушённые цвета) ↔ «observed-band» (акцент), разделитель.

## Reporter — визуализация

- **Per-binary композиция:** горизонтальный stacked-bar, **общая байтовая шкала** (длина = точный shipped-размер), сегменты с приближёнными байтами (`≈`) + доли; floor-band / observed-band с разделителем.
- **Within-toolchain сравнение** (общий floor): «вычесть floor» схлопывает band → чистая маржинальная дельта (static vs dyn, мономорфизация).
- **Кросс-языковой вид** (floor НЕ общий): бары на общей байтовой шкале, категории выровнены по позиции + **таблица по категориям**; «вычесть до общего floor» **отключена**; тумблер **«только наблюдаемое»** оставляет наблюдаемые абсолюты (ключевой вывод: observed сопоставим в абсолюте ~1.2–2.5K, тоталы расходятся 1.2K↔16K — разница в floor).
- **Фильтры:** сжатие `raw/gzip/brotli` (композиция считается по **raw**; gz/brotli — глобальное сжатие сворачивает дублирование → меняем тотал, композицию помечаем «по raw»); профиль `size/speed` (разные бинари → меняет тотал и композицию); мульти-выбор тулчейнов; тумблер «только наблюдаемое». **S/M/L отсутствует** (size-инвариантен).

## Information Architecture (отчёт)

Текущий reporter (`packages/reporter/src/render.ts`) — одна страница, монолитная таблица per workload, обе оси перемешаны в одних строках (env×impl×size), причём size-колонки (`wasm raw/gz/total gz`) дублируются по строкам, хотя size env/size-инвариантен. Новая форма:

**Одна статическая HTML-страница, общий shell** (header + tab-nav + клиентские фильтры), две вкладки по двум осям проекта:

- **Size** (эта фаза, богатый вид — § Reporter выше). Size **выносится** из построчной таблицы в свой per-(binary×profile) вид → перестаёт дублироваться.
- **Perf** — существующая perf-таблица + 2×2 shape-grid, **перенесённые в shell без редизайна**; size-колонки удаляются (уехали в Size). Фильтры perf-вкладки — env / size (S/M/L) / профиль.
- **Overview** — опционально (headline-сводка), отложить.

Форма — **одна страница**: вкладки = клиентский JS (он всё равно нужен под size-фильтры/тумблеры), не многофайловый сайт. Сайт с навигацией по workload'ам — возможный future. Полный perf-редизайн → out of scope (roadmap `perf-view-redesign`).

## JS — особый случай

Весь bundle = `observed`, **floor ≈ 0** (движок = runtime, в артефакт не едет; bundler-runtime esbuild минимален, наши JS-impl бездепные). Один бар, без символьной/facility-декомпозиции, помечен отдельно. Сам по себе вывод: «JS грузит только твой код». (Future: intra-bundle/dependency-атрибуция, если JS-impl потянет зависимость.)

## Тулинг

- **`twiggy`** — пинится в `tool-versions.json`. `twiggy top -f json` для per-symbol shallow-байтов. Наш код = слой категоризации (parse JSON + реестр правил) + reporter + schema. Pinning-механизм: cargo-install-from-source (version pin) — новый **тип** записи vs sha256-binary (как `wasm-opt`); точный механизм решается в плане. **Риск:** twiggy read-only/unmaintained (sunset rustwasm org, передан AlexEne, архивирован 2026-03) — core wasm-формат стабилен; митигация — fork при нужде (MIT/Apache).
- **`wasm-tools`** (1.249.0, запинен) — `print` для data-content ID (math-таблицы); `strip --all` для удаления name-секции; `objdump` для section-контроля.

## Pipeline

Атрибуция — часть `build:all`. Name-bearing pre-opt артефакт берётся из той же компиляции (sibling-копия без strip, либо `CARGO_PROFILE_*_STRIP=false` / cpp `-g`); маржинальная стоимость = прогон twiggy + категоризация, не лишний полный компайл. Production stripped-бинарь не меняется — исполнение и perf-бенчи используют его.

## Schema

Разложение прикрепляется per (binary × profile) в **meta** (размер env/size-инвариантен — НЕ per-`BenchResult`-run). Изменение строго через `packages/result-schema`. Форма (черновик): `productionTotal {raw,gz,brotli}` + `composition: [{facility, scalingKind, share, approxBytes}]` + `unattributedShare` + флаг калибровки. Reporter агрегирует из meta.

## Scope v1 — экземпляры последовательно

По одному, сюрпризы вылавливаем до следующего:

1. **matmul** — low-floor sanity (observed доминирует, `math-table:isqrt`, unattributed ~0).
2. **hashmap_int** — allocator + hash-map floor; валидирует `toolchain-runtime`-категорию.
3. **hashmap_string** — `string`-facility; rust panic/fmt-floor; кросс-языковой вид.
4. **shape_dispatch static + dyn** — `monomorphized` (per-type); `math-table:log`; within-toolchain «вычесть floor».
5. **js** — floor≈0-референс.

Затем раскатка на остальные бинари/тулчейны. **emscripten** name-survival зондом НЕ проверен (только wasi-sdk) → верифицировать при достижении; если имена срезаны — emscripten деградирует до section-only, документируется.

## Выход / deliverables

- **Attribution engine + facility-реестр** (код, тестируемый).
- **Schema-расширение** (`packages/result-schema`).
- **`build:all`-интеграция.**
- **Reporter-shell + Size-визуализация** — одна страница, вкладки Size/Perf, клиентские фильтры; Size-вид (композиция + сравнения + фильтры); релокация perf-таблицы + 2×2 grid в shell с удалением size-колонок.
- **`README.md`** — раздел: размеры per-facility **приближённые** (pre-opt композиция × калибровка к точному production-тоталу), **почему** (wasm-opt vs имена — байт-точность невозможна, находка 3) и **почему это ок** (порядок величины надёжен, доли устойчивы, production-тотал точен). ← явный запрос пользователя.
- **`docs/guidelines.md`** — grounded floor-vs-marginal claims, заменяющие/уточняющие handwave (`§ Artifact size`, текущие claim'ы про «8× разброс» и «примитив тянет таблицу»): rust panic/fmt-floor; `string`-facility мал; allocator доминирует std-floor; observed сопоставим кросс-языково в абсолюте; JS floor≈0.
- **`docs/roadmap.md`** — удалить `wasm-size-floor-vs-marginal` (graduated); добавить преемник `perf-view-redesign` (богатый perf-вид: init-фазы, CV-heatmap, сравнение env).

## Валидация

- Доли композиции суммируются в ~100% (unattributed мал, виден).
- Бары суммируются в **точный** production-тотал (калибровка).
- Дифференциал-дельты кросс-валидируют крупные facility (доля×тотал ≈ дельта по порядку величины).
- Production gates зелёные; correctness re-eval не затронут (атрибуция read-only, production-бинарь не меняется).
- twiggy-JSON парсится стабильно; реестр правил фальсифицируем (читаем, видимый residual).

## Риски

- **byte-identity** (находка 3) — снят дизайном (композиция+калибровка); документируется в README.
- **неравномерный wasm-opt shrink** → per-facility абсолют ± — митигация: метка `≈`, кросс-проверка дифференциалом, framing «порядок величины».
- **emscripten name-survival** не проверен — верифицировать при достижении; fallback section-only.
- **twiggy unmaintained** — fork-митигация.
- **категоризация — judgment** (panic/fmt включает bounds-fail-пути) — прозрачный реестр + видимый unattributed + фальсифицируемость.
- **реестр неполон для будущих workload'ов** → непокрытое в unattributed/observed сигналит «добавь правило» (by design, не баг).
- **сжатие** (gz/brotli глобально) → композиция только по raw.
- **twiggy pinning-механизм** (cargo-from-source vs sha256-binary) — новый тип записи в tool-versions.json; решается в плане.

## Структура волн (набросок для плана)

- **W0** — запинить twiggy + подтвердить `twiggy -f json` + зафиксировать калибровку-подход + определить реестр v1. (Большая часть де-рискнута зондом.)
- **W1** — attribution engine + facility-реестр + schema (сначала на matmul).
- **W2** — `build:all`-интеграция + reporter композиционный вид (экземпляры последовательно, § Scope v1).
- **W3** — сравнительные виды (within-toolchain «вычесть floor» + кросс-языковой) + фильтры.
- **W4** — дифференциал для headline-claims + guidelines + README + roadmap removal + gates.

## References

- Roadmap: `wasm-size-floor-vs-marginal` ([→ roadmap.md](../../roadmap.md)).
- Predecessor spec: [`2026-06-13-rust-vs-cpp-wasm-size-design.md`](2026-06-13-rust-vs-cpp-wasm-size-design.md) (калибровка-дисциплина, twiggy-подход).
- Существующие size-guideline (уточнять, не дублировать): `docs/guidelines.md` § Artifact size (claim'ы про glue-floor, std-container floor, «примитив тянет таблицу»).
- Design spec (BenchModule / артефакты / meta / eval-mode): [`2026-05-01-wasm-benchmarks-design.md`](2026-05-01-wasm-benchmarks-design.md).
- twiggy sunset: [Inside Rust, 2025-07](https://blog.rust-lang.org/inside-rust/2025/07/21/sunsetting-the-rustwasm-github-org/).
