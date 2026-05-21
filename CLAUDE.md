# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Repo-local guidance для AI assistants, работающих в этом проекте.

## Project overview

Бенчмарк-suite сравнивающий C++, Rust и JS под wasm по двум осям: **размер артефакта** (raw/gzip/brotli) и **runtime-перформанс** (init phases, first call, warm samples). Прогоняется одним кодом нагрузки в Node и в браузерах (Chromium, Firefox) через одну и ту же `BenchModule`-абстракцию.

Каноничные источники контекста:
- `README.md` — user-facing manual (системные требования, install, build, run, отчёт, ограничения). Читать когда нужна команда или объяснение для пользователя.
- `docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md` — design spec, контракты `BenchModule` / `Loader`, формат `BenchResult`, обоснование выбранного workload. Читать перед изменением core abstractions.
- `docs/superpowers/plans/` — phase plans. Имена файлов dated; latest = closest к current focus.
- `docs/roadmap.md` — live index отложенной работы.
- `docs/tech_debt/` — backlog мелких items, один файл — один debt.
- `docs/pitfalls/` — lessons-learned документы из исполнения phase'ов; формат и назначение — в `docs/pitfalls/README.md`.
- `docs/superpowers/session-state-*.md` — снимки прогресса для длинных multi-session задач.
- `docs/guidelines.md` — actionable рекомендации для продуктовых команд (build-флаги, toolchain trade-off'ы, code patterns). First-class output проекта наравне с raw numbers.

Reframe: цель проекта не «сравнить три языка», а **накопить evidence-base + извлечь guidelines** под продуктовое использование wasm. Каждая phase обязана производить не только числа, но и обновления `docs/guidelines.md`, если появились confirmed выводы.

## Guidelines artifact

`docs/guidelines.md` — единственный канонический дом для actionable рекомендаций. Сейчас flat-doc (формат B-1); миграция на per-claim файлы возможна позже, когда наберётся >30 claim'ов или файл перевалит за ~500 строк.

**Format convention** для каждой рекомендации (subsection под бакетом):

```markdown
### <Imperative claim — одна строка>
**Status:** confirmed | tentative | needs-more-data
**Evidence:** <path-to-result-or-dist-artifact>
**Phase:** introduced 1.X / refined 1.Y
**Caveats:** <когда не применять>
```

Бакеты верхнего уровня (`##`): `Build flags`, `Toolchain choice`, `Code patterns`. Добавляй новые бакеты только когда ни один claim не вписывается в существующие.

**Когда добавлять claim:**
- Confirmed reproducible measurement через ≥2 size'а или ≥2 workload'а (когда workload'ов станет >1).
- Tentative — single-workload или single-size observation; помечать как `tentative`, чтобы reader не закладывался.
- Single-run anecdote — НЕ claim. Не добавлять.

**Не добавлять:**
- Generic best practices без evidence из этого репо («prefer SoA over AoS») — для этого есть literature.
- Claim'ы которые потенциально invalidate-ятся следующей phase'ой — лучше дождаться следующей phase и обновить с status `confirmed` или удалить.

## High-level architecture

Workspace — pnpm + cargo. Три типа packages:

- **`benches/matmul/`** — benchmark sources. Один workload (matmul) в 10 combos:
  - `js/{idiomatic,typed-array}` — TS implementations (ESM, bundled через esbuild).
  - `rust/{shared,raw,bindgen}` — три cargo crates; `shared` — pure-Rust core, `raw` — no_std + manual exports, `bindgen` — wasm-bindgen. Каждый crate × {speed, size} profile.
  - `cpp/` — общий `.cpp`, собирается двумя toolchains: Emscripten (выдаёт `glue.mjs`+`glue.wasm`) и wasi-sdk freestanding (выдаёт raw `module.wasm`). × {speed, size}.
  - `validate/` — генератор reference checksums, фикстуры читаются из `fixtures/` (gitignored, генерируются по `spec.json`).

- **`packages/`** — host libraries (workspace внутренний):
  - `result-schema` — zod `BenchResultSchema` (single source of truth для формата результата; **любое изменение схемы обязано пройти через этот файл**).
  - `harness` — measure loop (warm samples + CV-stop), stats, correctness validation против reference checksum.
  - `loaders` — четыре loader'а (`plain-js`, `raw-wasm`, `rust-bindgen`, `emscripten`), каждый возвращает унифицированную `BenchModule`.
  - `reporter` — aggregate JSON → static HTML.

- **`apps/`** — CLI-драйверы:
  - `runner-node` — один кейс в Node.
  - `runner-web` — Vite (dev/preview) + Worker + selenium-webdriver. Vite дев-сервер слушает порт 5174; `run-matrix.ts` сам поднимает и сносит его при `--envs=chromium,firefox`. COOP+COEP headers включены (cross-origin isolation) → `performance.now()` precision ~5 µs Chromium, ~20 µs Firefox.

- **`scripts/`** — orchestrators (tsx-исполняемые TS). `lib/` содержит общую infra: `matrix.ts` (combo enumeration), `exec.ts` (process spawning), `meta.ts` (write `meta.json` per artifact), `tool-paths.ts` + `tool-versions.ts` (резолв `.tools/`-installed binaries).

Всё связано через `BenchResult` — каждый прогон одной combo выдаёт JSON, который `BenchResultSchema.parse` валидирует. Reporter ест эти JSON'ы агрегатом. Reference checksums зашиты в `benches/matmul/spec.json`; correctness failure останавливает кейс сразу.

## Common commands

### Build

```bash
pnpm build:all              # все 10 combos + fixtures + spec в dist/matmul/
pnpm build:js               # только JS bundles
pnpm build:rust             # только Rust (требует wasm-pack + wasm-opt)
pnpm build:cpp              # только C++ (требует emcc + wasi-sdk + wasm-opt)
pnpm setup-tools            # одноразовая установка тулчейнов в .tools/ (macOS arm64 only)
pnpm clear                  # удалить dist/
pnpm clear:all              # удалить dist/ + .tools/ + Rust target/
```

### Test, typecheck, lint

```bash
pnpm typecheck              # tsc -r --noEmit во всех workspace packages
pnpm test                   # vitest run во всех packages (parallel)
pnpm lint:ts                # ESLint .ts/.tsx/.mts
pnpm lint:ts:fix            # autofix
pnpm lint:rust              # cargo clippy с -D warnings (wasm32 + native shared)
pnpm lint:all               # ts + rust
```

Один пакет / один файл:

```bash
pnpm --filter @bench/harness test                         # один package
pnpm --filter @bench/harness exec vitest run path/to.test.ts -t "case name"   # один файл / one case
pnpm --filter @bench/harness typecheck                    # один typecheck
```

### Benchmark runs

```bash
pnpm smoke                  # ~30s sanity, S × все combos × Node
pnpm bench --envs=node,chromium,firefox --sizes=S,M --mode=quick --out=results/raw/<run>
pnpm bench:all              # setup + build + bench (eval) + report — десятки минут
pnpm report --in=results/raw/<run>     # → results/summarized/<ISO>/index.html
```

Один кейс в Node:

```bash
pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=matmul --language=rust --toolchain=raw --profile=speed \
  --size=S --out=results/raw/single --mode=quick
```

Один кейс в браузере (двух-терминальный flow): `pnpm --filter @bench-app/runner-web dev` + `pnpm --filter @bench-app/runner-web drive --browser=chromium ...`.

## Conventions

- **TS style** — 4-space indent, double quotes, semis, trailing comma multiline, `curly: all`. Enforced ESLint flat config (`eslint.config.js`). `verbatimModuleSyntax` + strict TS.
- **Rust** — edition 2024, `warnings = "deny"`, `clippy::all = "deny"`, `pedantic`+`nursery` warn. `unsafe_code` warn (используется только в `raw` crate для wasm exports). См. `Cargo.toml` workspace lints.
- **Не редактируй** auto-generated файлы: `**/glue.mjs`, `**/glue.js` (Emscripten output) — игнорируются ESLint.
- **Tool versions** — все pin'ы (sha256+URL) в `tool-versions.json`. Изменение версии должно обновлять и `meta.json` writer и downstream documentation. `wasm-opt` зовётся с `--enable-bulk-memory --enable-nontrapping-float-to-int` — без этих флагов современный rustc/emcc output не парсится.
- **Изменение `BenchResult` schema** — только через `packages/result-schema`. Старые JSON'ы в `results/raw/` могут перестать парситься; это ОК для phase boundary, но требует bump'а в `meta.schemaVersion` если phase живая.

## Tech-debt capture

Когда во время работы замечаешь: process gap, latent bug, open review ticket,
investigation без owner'а, ergonomics improvement opportunity, «should fix later» —
**останови работу один раз и предложи зафиксировать**:

> «Заметил <X> в <file:line> — выглядит как tech-debt (category: <Y>). Оформить в `docs/tech_debt/`?»

Если user соглашается:
1. Создать `docs/tech_debt/<kebab-slug>.md` (формат → `docs/tech_debt/README.md`).
2. Использовать observation из контекста, не повторное расследование.
3. Не блокировать основную задачу.

Если user говорит «later» / «нет» — продолжай, **не повторяй предложение в этой сессии**.

**Что НЕ предлагать к фиксации:**
- Items уже в `docs/tech_debt/`, `docs/roadmap.md`, или `docs/superpowers/specs/`/`plans/`.
- Принятые trade-offs в README «Известные ограничения».
- Style nitpicks без impact.
- Items feature-уровня (новые workloads, runtime axes, infra epics) — это другой capture
  protocol, см. секцию «Roadmap capture» ниже.

**Trigger phrases в собственных рассуждениях** — если эти слова возникают в твоём
ответе, остановись и спроси: process gap, latent bug, should fix later, open review
ticket, investigation needed, не блокирующее, TODO, follow-up, skipped for now,
нужно разобраться позже.

Periodic triage: skill `/tech-debt-review` (см. `.claude/skills/tech-debt-review/`).

## Roadmap capture

Когда во время работы замечаешь крупную future-work возможность (новый workload, runtime
axis, browser support, инфраструктурный epic, фичу требующую spec'а) — **останови
работу один раз и предложи добавить в `docs/roadmap.md`**:

> «Заметил <X> — это feature-level work, кандидат в Phase X.Y (или TBD, если phase неясна). Добавить в `docs/roadmap.md`?»

Если user соглашается:
1. Добавить одну строку в подходящий bucket (или `## TBD`, если phase неясна):
   `- **<kebab-name>** — <one-line описание> ([→ <source>](path))` если есть spec
   section / tech-debt slug, иначе без ссылки.
2. Использовать observation из контекста.
3. **Не пытаться писать spec в этот момент** — это просто capture одной строкой.

Если user говорит «later» / «нет» — не предлагай снова в этой сессии.

**Граница tech-debt vs roadmap:**
- Tech-debt → мелкое, fix < 1 дня, single file/function impact. Идёт в `docs/tech_debt/`.
- Roadmap → новая фича / runtime axis / infra epic, требует brainstorm + spec.
  Одна строка в `docs/roadmap.md`.

**Что НЕ предлагать к roadmap capture:**
- Items уже в `docs/roadmap.md`, `docs/superpowers/specs/`, или `plans/`.
- Tech-debt scale items — используй tech-debt capture выше.
- Accepted trade-offs в README «Известные ограничения».

**Trigger phrases в собственных рассуждениях:** new workload, new axis, browser support,
runtime profile, future phase, big feature, requires spec, after Phase X.Y, separate
effort needed, отдельная фаза, требует дизайна.

Periodic triage: skill `/backlog-review` (см. `.claude/skills/backlog-review/`).

## Commits

Используй `--no-gpg-sign` для агентских коммитов в этом репо (GPG bypass
авторизован user'ом).
