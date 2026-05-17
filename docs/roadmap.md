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

## Phase 1.1

> Текущий target. Scope зафиксирован 2026-05-15 (scope-decision сессия после Phase 1.0.6
> close). Brainstorm + writing-plans — следующий шаг.

### Workloads
- **interop-calls** — 100k-1M коротких JS↔Wasm calls, cost interop-границы ([→ design spec § Phase 1.1](superpowers/specs/2026-05-01-wasm-benchmarks-design.md))
- **hashmap-workload** — std::unordered_map vs Rust HashMap vs JS Map (insert/lookup/delete) ([→ design spec § Phase 1.1](superpowers/specs/2026-05-01-wasm-benchmarks-design.md))
- **shape-dispatch** — static (templates/generics) vs dynamic (virtual/dyn Trait/class hierarchy) dispatch ([→ design spec § Phase 1.1](superpowers/specs/2026-05-01-wasm-benchmarks-design.md))

### Bindgen size deep-dive
- **bindgen-size-regression-investigation** — root cause +0.9-1.0 KB drift в Wave 3 ([→ tech_debt/bindgen-size-regression-investigation](tech_debt/bindgen-size-regression-investigation.md))
- **bindgen-thread-local-init-shim-overhead** — likely contributor; try OnceLock ([→ tech_debt/bindgen-thread-local-init-shim-overhead](tech_debt/bindgen-thread-local-init-shim-overhead.md))
- **bindgen-output-view-force-copy** — wasm-side alloc для output_view; может частично разрешиться удалением dead readOutput API ([→ tech_debt/bindgen-output-view-force-copy](tech_debt/bindgen-output-view-force-copy.md))

### rust-raw hardening
- **rust-raw-heap-ptr-repr-rust** — heap ptr derivation от repr(Rust) layout (implementation-defined) ([→ tech_debt/rust-raw-heap-ptr-repr-rust](tech_debt/rust-raw-heap-ptr-repr-rust.md))
- **rust-raw-get-slices-ergonomics** — caller-chosen lifetime, latent UAF при 2+ callers ([→ tech_debt/rust-raw-get-slices-ergonomics](tech_debt/rust-raw-get-slices-ergonomics.md))

### Solo
- **worker-importscripts-detection** — unreliable `typeof importScripts` check для Module Workers в runner-web ([→ tech_debt/worker-importscripts-detection](tech_debt/worker-importscripts-detection.md))
- **matmul-cpp-heap-alignas-latent** — `alignas(8) static` heap, relative vs absolute alignment gap ([→ tech_debt/matmul-cpp-heap-alignas-latent](tech_debt/matmul-cpp-heap-alignas-latent.md))
- **bench-debug-timings-docs** — документировать `BENCH_DEBUG_TIMINGS=1` + `?debug=1` в README ([→ tech_debt/bench-debug-timings-docs](tech_debt/bench-debug-timings-docs.md))

## Phase 1.2

> Plausible targets после Phase 1.1. Не committed; перетасуется при `/backlog-review` перед
> Phase 1.1 close.

### CI & supporting infra
- **ci-github-actions** — GitHub Actions integration для размер/perf baseline tracking. Требует cross-platform installer'а.
- **cross-platform-installer** — `pnpm setup-tools` для Linux/Windows ([→ housekeeping spec § Out of scope](superpowers/specs/2026-05-04-housekeeping-design.md))
- **pnpm-typecheck-skips-scripts** — process gap, natural fit для CI ([→ tech_debt/pnpm-typecheck-skips-scripts](tech_debt/pnpm-typecheck-skips-scripts.md))
- **cargo-lock-stage-discipline** — process gap, lockfile check в CI ([→ tech_debt/cargo-lock-stage-discipline](tech_debt/cargo-lock-stage-discipline.md))

### Browsers
- **safari-implementation** — selenium-webdriver extension, macOS-only safaridriver ([→ web-pipeline-finalize spec § Future Safari](superpowers/specs/2026-05-12-web-pipeline-finalize-design.md))

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

<!-- empty -->

## Won't do

> Зафиксированные «нет» — feature ideas, отклонённые после обсуждения. Сохранены чтобы
> external readers видели sketches, и для повторного пересмотра, если planning изменится
> (date позволяет оценить актуальность rationale).
>
> NB: tech-debt wontfix items живут в `docs/tech_debt/` с `status: wontfix` и сюда НЕ
> дублируются.

<!-- empty -->
