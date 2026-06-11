# Session state — 2026-05-14 (Phase 1.0.6 closed, tech-debt infra live)

Handoff для следующей сессии. Phase 1.0.6 завершён, tech-debt process infrastructure встал
в master. Дальше — likely Phase 1.1 planning + tech-debt triage.

В этом файле — то, чего нет в спеке/плане/коде/git history. Высокоуровневое состояние и
актуальные указатели. Общие feedback'и — в auto-memory.

---

## TL;DR — где мы сейчас

- `master` HEAD = `2287a94` (commit с tech-debt infrastructure).
- Phase 1.0.6 closed: merge `7424618`, tag `phase-1-0-6`. Wave-tag'и `phase-1-0-6-wave-1`/`-wave-2` сохранены как breadcrumbs.
- Tech-debt process live: `CLAUDE.md` (capture protocol), `docs/tech_debt/` (13 seed items + README), `.claude/skills/tech-debt-review/SKILL.md`.
- Untracked в root (не коммитить): `.claude/settings.local.json`, `.pnpm-store/`, `chrome-console.txt`, `firefox-console.txt`, `Какие есть существующие бенчмарки wasm под браузер.md`.

**Phase 1.0.6 финальные numbers (M-size, warmMedian):**
- FF cpp/emscripten/size **5.22 ms** (было ~107ms на Playwright FF — 20.6× ускорение)
- FF cpp/wasi-sdk/speed **3.88 ms**
- Chromium cpp/emscripten/size 4.94 ms
- Node cpp/emscripten/size 5.12 ms
- js/typed-array/speed: ~13ms (FF), ~12.4ms (Chrome) — unchanged

Все 60/60 cases validated против reference checksums.

---

## Что прочитать перед стартом (порядок)

1. `CLAUDE.md` — capture protocol уже active. Прочитать первым (загружается автоматически в новой сессии).
2. `docs/tech_debt/README.md` — формат debt items + status machine.
3. `docs/tech_debt/*.md` — 13 seed items для первого triage.
4. **Если planning Phase 1.1:** `docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md` секцию § «Phase 2+» (намёки на новые workloads) + project_wasm_benchmarks.md в auto-memory.
5. Этот файл (handoff).

---

## Что было сделано в session 2026-05-13/14

Один длинный subagent-driven цикл — реализован весь Phase 1.0.6 plan (19 tasks) + tech-debt process.

**Phase 1.0.6 commits на master:**
- `9d7c187` feat(runner-web): vite prod-bundle + sirv preview middleware
- `1deb47f` feat(run-matrix): vite build + preview вместо dev
- `419f1e3` feat(setup): ensureFirefox/Geckodriver/ChromeForTesting + tool-versions.json browsers section
- `99211ab` refactor(runner-web): Playwright → selenium-webdriver + downloaded browsers
- `65a104e` docs(readme): selenium + browser-versions section, FF disclaimer удалён
- `7424618` merge: Phase 1.0.6

**Tech-debt infrastructure commit на master:**
- `2287a94` chore: introduce docs/tech_debt/ capture & review process

**Bonus orphan cleanup (не в плане, обязательное):**
- `apps/runner-web/playwright.config.ts` удалён + ссылка из `tsconfig.json` — typecheck blocker после dep swap.

**Skipped (intentional):**
- Task 18 (optional rebaseline notes file).

---

## Решения, зафиксированные в этой сессии (не передоговариваться)

| Решение | Где зафиксировано |
|---|---|
| Tech-debt capture style: AI suggest → user confirms | `CLAUDE.md`, `/tech-debt-review` skill |
| Tech-debt storage: `docs/tech_debt/<slug>.md`, frontmatter format | `docs/tech_debt/README.md` |
| Review trigger: on-demand через `/tech-debt-review` skill, не hook | `.claude/skills/tech-debt-review/SKILL.md` |
| Phase 1.1 roadmap items НЕ переносим в tech_debt/ — у них есть план | `docs/superpowers/specs/`, plans/ |
| Browser versions pinned в `tool-versions.json` `browsers` section | FF 150.0.3, geckodriver 0.36.0, Chrome for Testing 148.0.7778.167 |
| Selenium classic WebDriver (W3C), не BiDi | spec § Out of scope (Phase 1.0.6) |
| Safari — placeholder только, implementation Phase 1.1+ | spec § Future Safari |

---

## Tech-debt seed inventory (13 items в `docs/tech_debt/`)

| slug | category | priority |
|---|---|---|
| `pnpm-typecheck-skips-scripts` | process-gap | **medium** |
| `worker-importscripts-detection` | open-review-ticket | **medium** |
| `cpu-throttling-lock-macos` | known-limitation | **medium** |
| `cargo-lock-stage-discipline` | process-gap | low |
| `scripts-clear-cwd-assertion` | nice-to-have | low |
| `matmul-cpp-heap-alignas-latent` | latent-bug | low |
| `bench-debug-timings-docs` | open-review-ticket | low |
| `clang-tidy-cpp` | nice-to-have | low |
| `bindgen-size-regression-investigation` | investigation | low |
| `bindgen-thread-local-init-shim-overhead` | investigation | low |
| `rust-raw-get-slices-ergonomics` | nice-to-have | low |
| `rust-raw-output-view-force-copy` | nice-to-have | low |
| `rust-raw-heap-ptr-repr-rust` | known-limitation | low |

Все `status: open`. Каждый файл имеет верифицируемые ссылки на source (session-state/notes/specs).

При triage держать в голове: некоторые items могут стать частью Phase 1.1 plan (move-to-roadmap), некоторые resolved прямо (например `bench-debug-timings-docs` — простой README PR), некоторые wontfix (если accepted trade-off).

---

## Phase 1.1 — что уже известно из существующих специф

Из `docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md`:
- Новые workloads: `interop_calls`, `hashmap_workload`, `shape_dispatch`.
- Расширить stdlib-контейнеры (vector/string, sorted map, set).
- SIMD/threads — отдельная ось, отложено до Phase 2+.
- CI-интеграция — Phase 1.1+ candidate (но не firm scope).
- `--jitless` Node mode — nice-to-have.

Из Phase 1.0.6 spec:
- Safari implementation как extension существующей selenium-webdriver архитектуры.
- Cross-platform installer (Linux/Windows) — нужен если будет CI.

**Recommended sequencing для Phase 1.1 planning:**
1. Сначала brainstorm (`superpowers:brainstorming`) — какие из этих директивов брать, в каком объёме.
2. Затем `superpowers:writing-plans` — spec + plan.
3. Параллельно (или до Phase 1.1 start) `/tech-debt-review` — некоторые debt items могут попасть в Phase 1.1 scope (например `pnpm-typecheck-skips-scripts` если будет CI; `cpu-throttling-lock-macos` если новые workloads чувствительны к noise).

---

## Подводные камни, не очевидные из кода

### 1. `pnpm typecheck` НЕ покрывает `scripts/`

Workspace-recursive typecheck (`pnpm -r typecheck`) пропускает root `scripts/`. Это **уже в backlog** (`docs/tech_debt/pnpm-typecheck-skips-scripts.md`). Для надёжной проверки orchestrator-кода используй `npx tsc --noEmit -p tsconfig.json`.

### 2. Tech-debt capture protocol активный с этой сессии

В новой сессии AI прочитает `CLAUDE.md` автоматически и должен соблюдать capture protocol. Если заметит что-то — спросит. Если ответишь «yes» — создаст файл в `docs/tech_debt/`. Если «no/later» — продолжит. Это не hook, просто instruction в `CLAUDE.md`.

### 3. `/tech-debt-review` skill доступен с next session

Skill заскейнится при session start (Claude Code сканит `.claude/skills/`). Команда — batched triage с AskUserQuestion. Не делает file moves без confirmation.

### 4. Browser binaries в `.tools/` — ~500 MB, gitignored

`firefox-150.0.3/`, `geckodriver-0.36.0/`, `chrome-148.0.7778.167/` — auto-installed `pnpm setup-tools`. Если решишь bump'нуть версии, обнови `tool-versions.json` browsers section + run `pnpm setup-tools` (state.json idempotency справится с переустановкой).

### 5. Untracked `.pnpm-store/` появился во время Phase 1.0.6 ops

В gitignore не входит. Накопился из-за `pnpm install` ops. Не блокирует ничего, но стоит подумать добавить в gitignore при следующем housekeeping.

---

## Workflow notes

Без изменений с Phase 1.0.5/1.0.6:
- `--no-gpg-sign` обязателен на каждом коммите (плюс зафиксировано в `CLAUDE.md`).
- WASI_SDK_PATH=/Users/uncerso/wasi-sdk-25 (zshrc), но `.tools/wasi-sdk-25/` тоже работает.
- emcc через `.tools/emsdk/upstream/emscripten/emcc` (на PATH через emsdk env).
- Rust toolchain 1.95.0.
- Гибридная execution: subagent для сложного, inline для тривиального (auto-memory `feedback_execution_strategy.md`).
- Для длинных bench-прогонов (`pnpm bench:all` ~30-60 мин) — `Bash run_in_background: true` + `dangerouslyDisableSandbox: true` (port 5174 + browser launch не в whitelist).

**Новое:**
- Tech-debt capture: следуй `CLAUDE.md` Section «Tech-debt capture». Никаких auto-file.
- `pnpm typecheck` не покрывает scripts/ — используй `npx tsc --noEmit -p tsconfig.json` для orchestrator кода.

---

## Старт next session — checklist

В новой сессии:
1. Read план Phase 1.1 (если уже создан) или этот файл + Phase 1.0 design spec.
2. `git rev-parse HEAD` — capture base SHA (должно быть `2287a94` или потомок).
3. `git status` — verify clean working tree (untracked OK).
4. **Если начинаешь с tech-debt triage:** `/tech-debt-review` (skill подхватится автоматически).
5. **Если начинаешь с Phase 1.1 planning:** `superpowers:brainstorming` для clarification scope, затем `superpowers:writing-plans`.

Решение порядка — за user'ом. Можно сначала triage'нуть debt (некоторые items могут попасть в Phase 1.1 plan), затем планировать. Или наоборот.

---

## Stop point

- Phase 1.0.6 closed, tagged, merged to master.
- Tech-debt process infrastructure live, 13 seed items в backlog.
- Working tree clean (untracked files те же, что были перед Phase 1.0.6 start).
- Branch `feature/phase-1-0-6` сохранилась локально (можно удалить: `git branch -D feature/phase-1-0-6`).

В следующей сессии: brainstorm Phase 1.1 + первый /tech-debt-review.

---

## Полезные команды

```bash
# Базовый ориентир
git rev-parse HEAD                                       # should be 2287a94 or descendant
git log --oneline -10                                    # последние commits
git status                                               # tree state
git tag | grep phase-1-0-6                               # 3 tags: -wave-1, -wave-2, final

# Tech-debt
ls docs/tech_debt/                                       # 14 files (13 items + README.md)
# /tech-debt-review                                      # skill (next session)

# Quick smoke / bench
pnpm smoke                                               # ~30s sanity
pnpm bench --envs=firefox --sizes=M --mode=quick --out=/tmp/sanity

# Orchestrator typecheck (НЕ pnpm typecheck — оно scripts/ не покрывает)
npx tsc --noEmit -p tsconfig.json

# Feature branch cleanup (если хочешь)
git branch -D feature/phase-1-0-6
```
