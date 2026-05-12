# Session state — 2026-05-12 (Phase 1.0.6 ready to start)

Handoff для следующей сессии. Spec и plan для Phase 1.0.6 закоммичены в master,
ветка `feature/phase-1-0-6` пока не создана. Implementation ещё не стартовал.

В этом файле — только то, чего нет в спеке/плане/коде/git history. Высокоуровневое
состояние и общие feedback'и — в auto-memory.

---

## TL;DR — где мы сейчас

- `master` HEAD = `e59f489` (commit с этим файлом будет следующим).
- Spec: `docs/superpowers/specs/2026-05-12-web-pipeline-finalize-design.md` (commit `08095ae`).
- Plan: `docs/superpowers/plans/2026-05-12-web-pipeline-finalize.md` (commit `e59f489`).
- Phase 1.0.5 closed, tag `phase-1-0-5` в master. Все артефакты этого предыдущего этапа в репо.
- Untracked в root (не коммитить): `chrome-console.txt`, `firefox-console.txt`, `Какие есть существующие бенчмарки wasm под браузер.md`.

**Phase 1.0.6 scope:** объединяет два carry-over'а из Phase 1.0.5 в один phase:
1. **Prod-bundle migration** для runner-web (vite dev → vite build + vite preview). Wave 1 (low risk).
2. **Real-engine automation** — заменить Playwright на selenium-webdriver + pin'ennный Firefox stable + Chrome for Testing через `tool-versions.json`. Wave 2 (medium risk). Решает FF wasm 20-25× artifact (root cause investigation: `docs/superpowers/notes/2026-05-05-perf-now-precision.md`).

Wave 3 — combined re-baseline + README update + final tag `phase-1-0-6`.

---

## Что прочитать перед стартом (порядок)

1. **`docs/superpowers/plans/2026-05-12-web-pipeline-finalize.md`** — главный артефакт сессии, 19 задач с конкретным кодом.
2. **`docs/superpowers/specs/2026-05-12-web-pipeline-finalize-design.md`** — rationale и architecture (если plan нужен контекст).
3. `docs/superpowers/notes/2026-05-05-perf-now-precision.md` — root cause analysis FF artifact'а (Wave 4 Phase 1.0.5 investigation).
4. `tool-versions.json` — текущая schema; в Task 6 добавляется новая `browsers` секция.
5. Этот файл (handoff).

---

## Решения, зафиксированные в brainstorm'е (не передоговариваться)

| Решение | Источник |
|---|---|
| Single framework — selenium-webdriver, не Puppeteer (нет Safari support'а) | brainstorm 2026-05-12 |
| Explicit binaries в `tool-versions.json` (pattern wasi-sdk/binaryen), не library-managed | brainstorm 2026-05-12 |
| Atomic switch обоих browsers (FF + Chrome) — Wave 2 single deliverable | brainstorm 2026-05-12 |
| Prod-bundle перед real-engine (Wave 1 → Wave 2) | brainstorm 2026-05-12 |
| Always prod-bundle, без dev fallback в pipeline (но `pnpm dev` остаётся для manual debug) | brainstorm 2026-05-12 |
| Classic WebDriver (W3C), не BiDi — minimal API surface достаточен | spec §Out of scope |
| Safari — только архитектурно подготовлено (placeholder в spec § Future Safari), implementation Phase 1.1+ | brainstorm 2026-05-12 |
| macOS arm64 only — нет cross-platform support'а в Phase 1.0.6 | spec §Out of scope |

---

## Sequencing и tag scheme

| Wave | Tasks | Tag в конце |
|---|---|---|
| Setup (branch + plan commit) | 0.1-0.3 | (нет) |
| Wave 1 — Prod-bundle | 1-4 | `phase-1-0-6-wave-1` |
| Wave 2 — Real-engine | 5-15 | `phase-1-0-6-wave-2` |
| Wave 3 — Re-baseline | 16-19 | `phase-1-0-6` (final) |

Каждая wave закрывается до старта следующей. **Wave 1 sanity-check (Task 4) — full bench:all на intermediate Playwright+prod stack для проверки prod-bundle effect.** Если получится грязно, чинить ДО Wave 2.

---

## Подводные камни, которые НЕ очевидны из плана

### 1. `tool-versions.json` browsers — версии не зафиксированы

Plan Task 5 — это lookup-задача: запросить latest stable Firefox, geckodriver, Chrome for Testing на момент имплементации. Конкретные URLs и sha256 определяются ТОГДА. Это intentional — плановая дата сессии и реализации могут быть с лагом, freeze'ить версии в плане бессмысленно.

Где смотреть:
- Firefox: `https://product-details.mozilla.org/1.0/firefox_versions.json` → `LATEST_FIREFOX_VERSION`. Sha256 в `https://ftp.mozilla.org/pub/firefox/releases/<ver>/SHA256SUMS`.
- geckodriver: `https://api.github.com/repos/mozilla/geckodriver/releases/latest`. Sha256 — в release body (на странице), или compute самим (см. Task 5.4).
- Chrome for Testing: `https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json` → channels.Stable. Sha256 НЕ публикуется — compute локально (см. Task 5.6).

### 2. DMG handling — macOS-specific

Plan Task 7.3 (`ensureFirefox`) использует `hdiutil attach/detach`. Это macOS-only. Cross-platform — отдельный artifact, явно out of scope (см. spec §Out of scope).

Edge case: если `hdiutil attach` падает — DMG корраптнут или Mac заблокирован security policy. Plan throw'ит понятную ошибку.

### 3. Selenium prefs могут ломать JIT (повтор Playwright проблемы)

Real risk per spec §Risk матрица. Mitigation в plan Task 13.4 (manual cross-check FF binary). Если manual launching downloaded FF показывает ~5ms, а через selenium ~50ms — investigate какие prefs selenium auto-applies. Минимальный набор prefs выставлен в driver.ts Task 12.1 — но selenium может ещё что-то добавлять.

**Дебаг план:** запустить FF binary вручную с `-profile <tmpprof>` argument'ом (тот же profile, который selenium создаёт). Сравнить prefs. Если selenium что-то задаёт через Marionette капабилитис — investigate `Capabilities`/`MozCapability` объекты.

### 4. Vite preview не serveит publicDir без custom plugin

Подтверждено в spec §1.1. План решает через `sirv` middleware (Task 2.2). Fallback (если sirv path не работает): `copyPublicDir = true` + accept дублирования benchmark artifacts в `apps/runner-web/dist/` — wasteful но работает.

### 5. `pnpm bench:all` re-baseline (Task 16.2) — может занять час, может полчаса

Зависит от того, насколько FF cases быстрее под Ion. Если оригинальные FF cases brали ~125ms (Playwright artifact) и теперь 5ms — total cycle time для firefox env сократится примерно в 25×. Для cpp/emscripten/size M alone это difference ~10× в total run-time.

---

## Что НЕ надо делать в этой сессии

- **Не trogать Safari.** Архитектурно подготовлено, implementation Phase 1.1+ (spec §Future Safari).
- **Не вычищать legacy Playwright tests.** `apps/runner-web/test-results/` и `playwright-report/` — Wave 2 Task 14 optional cleanup. Если уже не существуют после миграции — все ОК, не trogать.
- **Не обновлять CI/GitHub Actions.** Out of scope (Phase 1.1+).
- **Не делать cross-platform support.** macOS arm64 only.
- **Не writing новые workload'ы.** Это Phase 1.1.

---

## Workflow notes (без изменений с Phase 1.0.5)

- `--no-gpg-sign` обязателен на каждом коммите.
- WASI_SDK_PATH=/Users/uncerso/wasi-sdk-25 (zshrc — но `pnpm setup-tools` теперь устанавливает в `.tools/wasi-sdk-25/` тоже; build:cpp.ts уважает env var).
- emcc через `.tools/emsdk/upstream/emscripten/emcc` (на PATH через emsdk env).
- Rust toolchain 1.95.0.
- Гибридная execution: subagent для сложного, inline для тривиального (auto-memory `feedback_execution_strategy.md`).
- Использовать subagent-driven-development для Wave 2 (большой changeset, много задач с clear boundaries). Wave 1 и Wave 3 можно inline.

---

## Старт next session — checklist

В новой сессии:
1. Read план (`docs/superpowers/plans/2026-05-12-web-pipeline-finalize.md`).
2. Read этот файл.
3. `git rev-parse HEAD` — capture base SHA.
4. `git status` — verify clean working tree.
5. Solidify execution strategy: subagent-driven для Wave 2, inline для Wave 1+3.
6. Use `superpowers:subagent-driven-development` skill или `superpowers:executing-plans` (в зависимости от strategy).
7. Start с Setup (Step 0.1-0.3): create branch, commit plan-pointer-file если нужен (план уже в master, отдельной коммит на branch не нужен).

---

## Stop point

Phase 1.0.6 не стартован, всё ready для implementation. Branch чистая на master.

В новой сессии: один из путей — subagent-driven implementation Wave 1 → review → Wave 2 → review → Wave 3 → final tag.

---

## Полезные команды

```bash
# Базовый ориентир
git rev-parse HEAD                                       # capture base SHA
git log --oneline -5                                     # последние коммиты
git status                                               # tree state

# Старт работы (после reading plan)
git switch -c feature/phase-1-0-6                        # branch

# Verification по ходу плана
pnpm typecheck                                           # после кодовых изменений
pnpm smoke                                               # ~30s sanity
pnpm bench --envs=firefox --sizes=M --mode=quick --out=/tmp/p106-quick

# Manual FF cross-check (Wave 2 Task 13.4)
"$(node -e "const tv=require('./tool-versions.json'); console.log(\`\${require('node:path').resolve('.tools','firefox-'+tv.browsers.firefox.version)}/Firefox.app/Contents/MacOS/firefox\`);")" \
  http://localhost:5174/?case=<base64>&debug=1
```
