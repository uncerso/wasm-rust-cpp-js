# Roadmap

Live index отложенной работы — что в скоупе текущей/предстоящих фаз и что explicitly
отвергнуто. Updated через capture extension в `CLAUDE.md` (auto-suggestion во время
работы) и skill `/backlog-review` (batched review). Не replaces:

- `docs/superpowers/specs/` — детальные design specs для фаз.
- `docs/tech_debt/*.md` — мелкие debt items с собственным формом frontmatter.

## Conventions

- **Item format:** `- **<name>** — <one-line описание> ([→ <source>](path))` где source — либо tech-debt slug-файл, либо spec section, либо отсутствует (inline-only items).
- **Source markers:** единая стрелка `→`. Тип источника очевиден из path (`tech_debt/...` vs `superpowers/specs/...`).
- **Cluster headers:** `### <free-form cluster name>` внутри Phase bucket'а. Sub-grouping для related items; имена не стабильные, могут переименовываться без церемоний.
- **Removal:** items удаляются полностью при completion / move-to-Won't-do / graduate-to-spec. История через `git log -- docs/roadmap.md`. Никакого «Done archive».
- **TBD bucket:** для свежезахваченных items без assigned phase. `/backlog-review` периодически перетасовывает.
- **Won't do entries:** `- **<name>** — <описание>; **Decided <YYYY-MM-DD>:** <rationale>`. Дата позволяет оценить актуальность rationale при пересмотре.
- **Tech-debt items без roadmap target:** живут только в `docs/tech_debt/`, в roadmap.md не появляются.
- **Tech-debt wontfix:** остаётся в `docs/tech_debt/` с `status: wontfix`; НЕ дублируется в roadmap.md.

Source of truth для conventions — этот файл. `/backlog-review` верифицирует format compliance первым шагом каждого триажа.

## Phase 1.2

> Текущий target (Phase 1.1 закрыта 2026-06-02 — 4 workloads + reporter v2 + guidelines).
> Не committed; перетасуется при `/backlog-review`.

### CI & supporting infra
- **ci-github-actions** — GitHub Actions integration для размер/perf baseline tracking. Требует cross-platform installer'а.
- **cross-platform-installer** — `pnpm setup-tools` для Linux/Windows ([→ housekeeping spec § Out of scope](superpowers/specs/2026-05-04-housekeeping-design.md))
- **pnpm-typecheck-skips-scripts** — process gap, natural fit для CI ([→ tech_debt/pnpm-typecheck-skips-scripts](tech_debt/pnpm-typecheck-skips-scripts.md))
- **cargo-lock-stage-discipline** — process gap, lockfile check в CI ([→ tech_debt/cargo-lock-stage-discipline](tech_debt/cargo-lock-stage-discipline.md))

### Browsers
- **safari-implementation** — selenium-webdriver extension, macOS-only safaridriver ([→ web-pipeline-finalize spec § Future Safari](superpowers/specs/2026-05-12-web-pipeline-finalize-design.md))

### Workload expansion
- **hashmap-raw-shared-crate** — DRY raw+bindgen hashmap logic into a shared crate per binary; adopt only if measurement shows unification does NOT regress size/perf (currently duplicated to keep variants isolated). ([→ spec § Scope](superpowers/specs/2026-06-13-hashmap-stdlib-no-glue-design.md))

### Agent workflow
- **sessionstart-hook-insurance** — deterministic SessionStart hook that bootstraps `/iterate`; add only if `/iterate`-invocation drift recurs (deferred 2026-06-12, [→ spec § D2](superpowers/specs/2026-06-12-workflow-trigger-landing-design.md))

## Phase 2+

> Definitely-later. Включает explicit Phase 2+ items из specs.

### Runtime axes
- **simd-threads** — SIMD/threads как отдельная ось матрицы ([→ design spec § Открытые вопросы](superpowers/specs/2026-05-01-wasm-benchmarks-design.md))
- **node-jitless** — Node `--jitless` mode как low-level controlpoint ([→ design spec § Открытые вопросы](superpowers/specs/2026-05-01-wasm-benchmarks-design.md))
- **webdriver-bidi** — WebDriver BiDi protocol вместо classic W3C WebDriver ([→ web-pipeline-finalize spec § Out of scope](superpowers/specs/2026-05-12-web-pipeline-finalize-design.md))

### Workload expansion
- **stdlib-containers** — vector, string, sorted map, set ([→ design spec § Открытые вопросы](superpowers/specs/2026-05-01-wasm-benchmarks-design.md))
- **academic-algos** — sort, parsing, mandelbrot, hash ([→ design spec § Открытые вопросы](superpowers/specs/2026-05-01-wasm-benchmarks-design.md))

## TBD

> Freshly captured items без assigned phase. Capture extension добавляет сюда, если phase
> не уверен. `/backlog-review` периодически перетасовывает в Phase X.Y или Won't do.

- **benchmark-cv-stabilization** — почти все ячейки отчётов жёлтые (coefficient of variation выше порога): разобраться в источниках дисперсии и стабилизировать измерения; одна известная под-причина — нет CPU-throttling lock на macOS ([→ tech_debt/cpu-throttling-lock-macos](tech_debt/cpu-throttling-lock-macos.md)).
- **size-attr-math-table** — отщепить math primitive-таблицы (`math-table:isqrt` / `math-table:log`) из `data`/`compiler-rt`-категорий в свой facility. isqrt анонимна (`.rodata`-сегмент) → нужен content-ID через `wasm-tools print` (+ пин wasm-tools); большая musl `__log_data` (cpp ~4.2 KB) — за heisenbug'ом из `size-attr-toolchain-coverage`. Отложено из Phase 1.3 (низкий ROI без cpp-атрибуции; guideline-числа про примитив-таблицы уже есть, Phase 1.2). ([→ guidelines § Artifact size](guidelines.md))
- **path-hygiene-build-isolation** — провести PATH-гигиену по всему build-пайплайну. Root cause cpp/wasi-sdk name-section heisenbug (изолирован Phase 1.4): `build-cpp.ts` инжектит `.tools/bin` в `PATH` → драйвер wasi-sdk clang авто-обнаруживает `wasm-opt` и прогоняет его post-link, меняя вывод (срезает name-секцию у attr-сборки). Phase 1.4 чинит точечно: production-`clang++` получает `.tools/bin` через `PROD_PATH` (намеренный авто-`wasm-opt` → byte-identity с baseline Phase 1.1–1.3), attr-`clang++` идёт с чистым PATH (имена выживают). **Открытый риск:** attr-`clang++` всё ещё может подхватить случайный `wasm-opt` из PATH пользователя (окружение непонятно) → нужна полная изоляция PATH (scrubbed / `env -i`) для attr-сборки, чтобы wasi-sdk clang не нашёл сторонний `wasm-opt`. Здесь — аудит ВСЕХ PATH-инъекций (`buildWasiSdk`/`buildEmscripten`/прочие), переход на абсолютные пути к тулам вместо PATH-инъекции, чтобы окружение не влияло на артефакты. ([→ bug-report](superpowers/bug-reports/2026-06-21-cpp-wasi-sdk-name-section-heisenbug.md))
- **cpp-wasm-opt-explicit** — вызывать `wasm-opt` для cpp/wasi-sdk **явно и детерминированно** (как для rust в `build-rust.ts`), независимо от того, каким путём получен wasm — вместо опоры на авто-запуск драйвером wasi-sdk clang при `-flto` (текущее поведение, сохранённое в Phase 1.4 через `PROD_PATH` ради byte-identity с Phase 1.1–1.3). Сделает production-байты воспроизводимыми и не зависящими от PATH; потребует ре-бейзлайна size-чисел (speed-профиль cpp/wasi-sdk сейчас оптимизируется только этим неявным авто-пассом, +~14.5% без него). Тесно связано с `path-hygiene-build-isolation`. Captured Phase 1.4.
- **bindgen-size-opt-level** — rust/bindgen size-профиль использует `opt-level=3` cargo-codegen (`release`) + `wasm-opt -Oz`, тогда как rust/raw size — `opt-level="z"` codegen (`release-size`) + `wasm-opt -Oz`. Причина: wasm-pack CLI принимает только `--dev/--release/--profiling`, передать `--profile=release-size` нельзя. Выровнять методологию size-оси: для bindgen size-сборки выставить `CARGO_PROFILE_RELEASE_OPT_LEVEL=z` (+ `CODEGEN_UNITS`/прочее при нужде) при `wasm-pack --release` — тот же env-механизм, что `STRIP=false` в attr-сборке; потенциально уменьшит bindgen size-артефакты и сделает кросс-toolchain size-сравнение честнее. Ре-бейзлайн bindgen size. Captured Phase 1.4.
- **perf-metric-explainers** — на Perf-табе появился набор метрик, непонятных без подготовки (`relSem`, `mad`, `cv`, `<res` badge, amber-строки на `meanImprecise`): добавить объяснение — tooltip на заголовках колонок / glossary-блок / легенда — чтобы продуктовый читатель понимал, что означает каждая и как её читать (напр. relSem = SEM среднего = cv/√n; amber = среднее не прижато к порогу, НЕ ошибка операции). Captured Phase 1.5 (CV-stabilization). ([→ guidelines § Measurement](guidelines.md))
- **size-attr-raw-host-glue** — оценить размер самописного host-glue (`rawWasmLoader`, общий для rust/raw + cpp/wasi-sdk): эти тулчейны эмитят только wasm, но требуют рукописного generic-loader'а для вызова из JS. Сейчас он не учитывается на Size-баре (генерируемый glue bindgen/emscripten — учитывается). Оценить «минимальный продуктовый» размер loader'а per marshalling-pattern (number-only vs buffer-маршалинг) и показать отдельным помеченным reference для честного кросс-сравнения. Captured Phase 1.4 (отложено: judgment-артефакт, не измеряемый эмитируемый файл).

## Won't do

> Зафиксированные «нет» — feature ideas, отклонённые после обсуждения. Сохранены чтобы
> external readers видели sketches, и для повторного пересмотра, если planning изменится
> (date позволяет оценить актуальность rationale).
>
> NB: tech-debt wontfix items живут в `docs/tech_debt/` с `status: wontfix` и сюда НЕ
> дублируются.

<!-- empty -->
