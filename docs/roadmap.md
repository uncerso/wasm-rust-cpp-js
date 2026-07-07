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
- **ci-github-actions** — GitHub Actions integration для размер/perf baseline tracking. Требует cross-platform installer'а (deferred в Phase 2+).
- **pnpm-typecheck-skips-scripts** — process gap, natural fit для CI ([→ tech_debt/pnpm-typecheck-skips-scripts](tech_debt/pnpm-typecheck-skips-scripts.md))
- **cargo-lock-stage-discipline** — process gap, lockfile check в CI ([→ tech_debt/cargo-lock-stage-discipline](tech_debt/cargo-lock-stage-discipline.md))
- **plan-authoring-lint-and-case-count** — из pitfall 2026-05-27: (1) добавить `argsIgnorePattern: "^_"` в `eslint.config.js` (`@typescript-eslint/no-unused-vars`), чтобы `_param`-идиома работала и для assigned-vars → plan-code-blocks проходят lint без ручных правок; (2) `scripts/lib/case-count.ts` helper, печатающий expected case-counts per (envs, sizes, benchmarks, filters) через `enumerateRunCases()` → plan-gate values не hand-derived (Phase 1.1.2.1: предсказал 810, actual 630). ([→ pitfall 2026-05-27](pitfalls/2026-05-27-phase-1-1-2-1-execution.md))
- **bench-correctness-fail-surfacing** — bench run может писать `validated:false` / `correctnessFailed:true` результаты, но exit 0 + отсутствие их в `failures.txt` маскируют correctness-провал. Проверить, что `accumulateFailures` в `scripts/run-matrix.ts` включает validated:false кейсы; если нет — surface (запись в `failures.txt` + non-zero exit), чтобы тихий correctness-fail не проскочил.
- **emscripten-wasm-opt-universality** — build-hygiene (PR #12) сделал `wasm-opt` универсальным через `scripts/lib/wasm-opt.ts` (`optimizeWasm`), но `benches/*/cpp/build-emscripten.sh` всё ещё содержат собственный inline `wasm-opt -Oz` на size-профиле (строки ~42-46). Разобраться: это double-opt (inline + universal) или emscripten исключён из universal-пути? Привести к единому механизму — убрать inline из emscripten-скриптов (если universal покрывает) ЛИБО задокументировать, почему emscripten особый (emcc-специфичный pipeline).

### Workload expansion
- **hashmap-raw-shared-crate** — DRY raw+bindgen hashmap logic into a shared crate per binary; adopt only if measurement shows unification does NOT regress size/perf (currently duplicated to keep variants isolated). ([→ spec § Scope](superpowers/specs/2026-06-13-hashmap-stdlib-no-glue-design.md))
- **stdlib-containers** — vector, string, sorted map, set ([→ design spec § Открытые вопросы](superpowers/specs/2026-05-01-wasm-benchmarks-design.md))
- **academic-algos** — sort, parsing, mandelbrot, hash ([→ design spec § Открытые вопросы](superpowers/specs/2026-05-01-wasm-benchmarks-design.md))

### Correctness & C++ tooling
- **hashmap-string-cpp-emplace-latent** — `benches/hashmap_string/cpp/src/hashmap_string.cpp` резолвит dup-keys через `unordered_map::emplace` (first-wins) в `parse_pairs` + lookup, тогда как reference (`Map.set`/`HashMap::insert`) — last-wins; int-аналог починен Phase 1.2 (`operator[]`), string остался латентным. Fix: `emplace` → `operator[]` + re-bench hashmap_string cpp. ([→ pitfall/bug parallel](superpowers/bug-reports/2026-06-13-hashmap-int-emplace-dupkey.md))
- **clang-tidy-cpp** — C++ linter не настроен (ESLint для TS + clippy для Rust есть, C++ нет). Добавить clang-tidy config для `benches/*/cpp/src/*.cpp` + integration в `lint:all` для паритета toolchain-дисциплины.

### Docs & conventions
- **docs-language-consistency** — repo prose мешает RU/EN без stated convention. Зафиксировать canonical-language правило в `docs/writing-standard.md` (напр.: RU для internal docs/specs/plans/pitfalls, EN для user-facing README + code identifiers/technical terms); опционально lightweight consistency-check.

## Phase 2+

> Definitely-later. Включает explicit Phase 2+ items из specs.

### Runtime axes
- **simd-threads** — SIMD/threads как отдельная ось матрицы ([→ design spec § Открытые вопросы](superpowers/specs/2026-05-01-wasm-benchmarks-design.md))
- **node-jitless** — Node `--jitless` mode как low-level controlpoint ([→ design spec § Открытые вопросы](superpowers/specs/2026-05-01-wasm-benchmarks-design.md))
- **webdriver-bidi** — WebDriver BiDi protocol вместо classic W3C WebDriver ([→ web-pipeline-finalize spec § Out of scope](superpowers/specs/2026-05-12-web-pipeline-finalize-design.md))

### Infra & browsers
- **cross-platform-installer** — `pnpm setup-tools` для Linux/Windows ([→ housekeeping spec § Out of scope](superpowers/specs/2026-05-04-housekeeping-design.md))
- **safari-implementation** — selenium-webdriver extension, macOS-only safaridriver ([→ web-pipeline-finalize spec § Future Safari](superpowers/specs/2026-05-12-web-pipeline-finalize-design.md))

## TBD

> Freshly captured items без assigned phase. Capture extension добавляет сюда, если phase
> не уверен. `/backlog-review` периодически перетасовывает в Phase X.Y или Won't do.

- **size-attr-math-table** — отщепить math primitive-таблицы (`math-table:isqrt` / `math-table:log`) из `data`/`compiler-rt`-категорий в свой facility. isqrt анонимна (`.rodata`-сегмент) → нужен content-ID через `wasm-tools print` (+ пин wasm-tools); большая musl `__log_data` (cpp ~4.2 KB) — за heisenbug'ом из `size-attr-toolchain-coverage`. Отложено из Phase 1.3 (низкий ROI без cpp-атрибуции; guideline-числа про примитив-таблицы уже есть, Phase 1.2). ([→ guidelines § Artifact size](guidelines.md))
- **size-attr-raw-host-glue** — оценить размер самописного host-glue (`rawWasmLoader`, общий для rust/raw + cpp/wasi-sdk): эти тулчейны эмитят только wasm, но требуют рукописного generic-loader'а для вызова из JS. Сейчас он не учитывается на Size-баре (генерируемый glue bindgen/emscripten — учитывается). Оценить «минимальный продуктовый» размер loader'а per marshalling-pattern (number-only vs buffer-маршалинг) и показать отдельным помеченным reference для честного кросс-сравнения. Captured Phase 1.4 (отложено: judgment-артефакт, не измеряемый эмитируемый файл).

## Won't do

> Зафиксированные «нет» — feature ideas, отклонённые после обсуждения. Сохранены чтобы
> external readers видели sketches, и для повторного пересмотра, если planning изменится
> (date позволяет оценить актуальность rationale).
>
> NB: tech-debt wontfix items живут в `docs/tech_debt/` с `status: wontfix` и сюда НЕ
> дублируются.

<!-- empty -->
