# Session state — 2026-05-06 (post-Wave-4)

Снапшот для следующей сессии. Phase 1.0.5 (Housekeeping), ветка `feature/phase-1-0-5`.
Wave 4 закрыт. Этот файл — handoff для двух **независимых** работ:

1. **Migration на prod-bundle build** для runner-web (small improvement, ~17-27% perf gain в FF wasm combos).
2. **Brainstorm FF handling** — что делать с Playwright FF artifact long-term.

В этом файле — только то, чего нет в спеке/плане/коде/git history. Высокоуровневое состояние и общие feedback'и — в auto-memory.

---

## TL;DR — где мы сейчас

- Branch `feature/phase-1-0-5`. Tag `wave-4-done` указывает на closeout commit.
- Commits в Wave 4 поверх `wave-3-done` (см. `git log --oneline wave-3-done..wave-4-done`):
  - `551e744` — instrumentation (Task 15 Gate 1 — probe + per-sample log + notes file)
  - `0466c51` — COI fix Vite dev/preview headers
  - closeout commit — notes finalize + 2 session-state files + README update + `?debug=1` URL param
- **Wave 4 не сделал quantization-fix (Task 16)** и **не сделал Liftoff-pref-fix (Task 17)** в plan-задуманном виде — Gate 1 + manual test перевернули hypothesis space до их применения.
- **Wave 5 (auto-deps installer, Tasks 19-26) — ещё впереди.**
- Untracked: `chrome-console.txt`, `firefox-console.txt` — input от user'а в этой сессии (manual runs реального Firefox/Chrome — данные в notes file).

**Главное открытие Wave 4:** оригинальный 20-25× FF wasm gap — это Playwright-Firefox-Nightly artifact, не реальное SpiderMonkey behavior. Real Firefox ≈ Chrome для wasm matmul. Подробности — `docs/superpowers/notes/2026-05-05-perf-now-precision.md` (read this first).

---

## Состояние репозитория

| Что | Куда указывает |
|---|---|
| `feature/phase-1-0-5` HEAD | closeout commit (см. `git rev-parse refs/tags/wave-4-done`) |
| tag `wave-4-done` | Wave 4 closeout commit |
| tag `wave-3-done` | `94f313e` (без изменений) |
| `master` | `c9a00c3` (без изменений) |
| Untracked | `Какие есть существующие бенчмарки wasm под браузер.md` (input от пользователя, **не коммитить**) |
| Untracked | `chrome-console.txt`, `firefox-console.txt` (manual run dumps; **не коммитить** — данные уже в notes file) |

---

## Open work (две независимых задачи)

### A. Transition к prod-bundle build для runner-web

**Контекст:** во время Wave 4 проверили `vite build` + `vite preview` vs текущий `vite` (dev mode). Получили **17-27% improvement** в FF C++ wasm combos:

| combo | dev | prod |
|---|---|---|
| cpp/emscripten/size (M) | 125-128 | 104 |
| cpp/wasi-sdk/speed (M) | 97 | 71 |

Rust combos и JS — почти не поменялись. Это **secondary improvement** (главный — fix через automation switch, см. §B), но worth it.

**Что нужно сделать:**

1. **Изменить `scripts/run-matrix.ts`** (lines ~65-117 — где launches Vite):
   - Вместо `execa(viteBin, [], { cwd: "apps/runner-web", ... })` (`vite` без args = dev mode), сначала `vite build`, потом `vite preview --port=5174`.
   - Альтернатива: dev для smoke и `quick` mode (быстрее), preview для `eval` mode (качественнее). Trade-off: prod build занимает ~150 ms; не критично.

2. **Update `apps/runner-web/vite.config.ts`:**
   - **Issue with publicDir:** `publicDir: resolve(__dirname, "../../dist")` указывает на repo `/dist/`. Vite warning: "publicDir feature may not work correctly. outDir и publicDir are not separate folders." В наших экспериментах build artifacts (index.html, assets/) попадали в repo `/dist/` рядом с benchmarks dist. Нужно либо:
     - (a) Явно указать `build.outDir: resolve(__dirname, "dist")` (apps/runner-web/dist) и продолжать use publicDir для bench artifacts.
     - (b) Set `publicDir: false` и добавить static-serving middleware для `/dist/<benchmark>/` paths.
     - (c) Move benchmarks dist в публичный location, чтобы publicDir и outDir не conflict'or.
   - `preview.headers` уже имеет COI (commit `0466c51`). Не трогать.
   - `worker.format` остаётся `"es"` (module worker — user предпочёл, dev ergonomics, source maps).

3. **Update `pnpm bench:all` chain в root `package.json`** — добавить build runner-web step before bench, OR просто убедиться что run-matrix.ts (см. п.1) сам триггерит build.

4. **Verification:**
   - `pnpm smoke` — должно работать.
   - `pnpm bench:all` — все 60 cases должны passed validation (S=8505.752465030815, M=275996.81878375803).
   - Проверить что timings improvement действительно landed (compare с pre-change Phase 1.0 baseline).

5. **Decision points для user:**
   - Хотим ли всегда prod-bundle, или dev для quick/smoke и prod для eval? (Recommend: всегда prod — build быстрый.)
   - Re-baseline ALL Phase 1.0 numbers с prod-bundle (для consistency в reports/docs)? Это отдельный commit/PR с обновлёнными `dist/results/` и report.html.
   - Сохранить ли возможность legacy dev mode для interactive debugging? (Тогда: keep `vite` script as is для standalone use, но `bench` использует preview.)

**Выполнение:** subagent-driven (sonnet implementer + spec/quality reviewers, как в Wave 1-3). Не trivial — vite config dance + scripts/run-matrix.ts change + ensure smoke and bench:all OK.

---

### B. Brainstorm FF handling

**Контекст:** Real Firefox матмул ≈ 5 ms (≡ Chrome). Playwright Firefox Nightly = 125 ms (~25× artifact). См. notes file для деталей.

**Question for brainstorming:** что делаем с FF env в нашем benchmark suite long-term?

**Кандидаты на discussion (не решения — это вход в brainstorm):**

1. **Drop FF env полностью.**
   - Pro: numbers честные, no misleading data.
   - Con: теряем browser diversity coverage; users could find this surprising в open-source benchmarks suite.

2. **Document and keep как есть.**
   - Pro: minimal effort, current commit `0466c51` уже good improvement.
   - Con: numbers continue to mislead unless каждый user reads disclaimer.

3. **Switch to BiDi (geckodriver + system FF).**
   - Pro: real numbers, lasting fix.
   - Con: extra dependency (geckodriver на macOS arm64?), может потребоваться newer Playwright (1.60+ exposes BiDi публично?) или selenium-webdriver migration.
   - Investigate: Playwright `bidiFirefox.js` есть internally в 1.59 — публичный API в 1.60+? Альтернатива: switch на `selenium-webdriver` package.

4. **Dual-env: `firefox` (Playwright artifact) + `firefox-real` (BiDi).**
   - Pro: cleanest comparison. Showcases artifact gap explicitly.
   - Con: maintenance burden, double matrix runtime, configurations.

5. **Wait for Playwright fix.**
   - Может быть Playwright команда в будущем включит Ion в Nightly build, или upstream Mozilla fix.
   - Не actionable сейчас.

**Suggested process:**

1. **Use `superpowers:brainstorming` skill** для exploration. Ask "what's the user's goal with FF env?" first — это formative question.
2. Сначала understand domain:
   - BiDi maturity (production-ready?) на 2026-05.
   - geckodriver setup на macOS arm64 — есть ли в Playwright или нужен homebrew?
   - Как user'ы будут использовать suite? (CI? local dev? Comparison artifacts?)
3. Затем `superpowers:writing-plans` для concrete migration plan если выберем switch.

**Pre-reading для brainstorm:**
- `docs/superpowers/notes/2026-05-05-perf-now-precision.md` (handling recommendation section в конце).
- Possibly explore: Playwright 1.60+ release notes, geckodriver compat, WebDriver BiDi spec maturity.

**Не trivial:** any switch к BiDi/system FF потребует ре-baseline всех Phase 1.0 results для FF env. Это affect's docs и user expectations.

---

## Чтение перед стартом сессии (порядок)

1. **`docs/superpowers/notes/2026-05-05-perf-now-precision.md`** — все findings Wave 4 + handling recommendation. **Самое важное.**
2. `docs/superpowers/specs/2026-05-04-housekeeping-design.md` — overall housekeeping design (Wave 5 раздел §5).
3. `docs/superpowers/plans/2026-05-04-housekeeping-phase-1-0-5.md` Tasks 19-26 — Wave 5 (auto-deps installer).
4. **Этот файл** (handoff).

Если задача (A): focus на Open work A. Не нужен Wave 5 reading сразу.
Если задача (B): focus на Open work B + brainstorming skill + Wave 5 spec можно отложить.

---

## Workflow notes (без изменений с Wave 1-3)

- `--no-gpg-sign` обязателен на каждом коммите (`feedback_gpg_no_sign.md` в memory).
- WASI_SDK_PATH=/Users/uncerso/wasi-sdk-25 (zshrc).
- emcc через /Users/uncerso/emsdk/upstream/emscripten/emcc — на PATH.
- Playwright browsers в ~/Library/Caches/ms-playwright/ (firefox-1511 — Firefox Nightly 148.0.2 patched).
- Rust toolchain 1.95.0.
- Гибридная execution: subagent для сложного, inline для тривиального (`feedback_execution_strategy.md` в memory).

---

## Stop point

Конец Wave 4. Branch чистая после closeout commit. Готов к выбору задачи (A) или (B).

В новой сессии: после прочтения этого файла + notes — `git rev-parse HEAD` (capture base SHA) и dispatch implementer (для A) или brainstorming session (для B).

---

## Полезные команды

```bash
git switch feature/phase-1-0-5                              # вернуться на ветку
git log --oneline wave-4-done..HEAD                         # что нового с прошлой сессии
git log --oneline wave-3-done..wave-4-done                  # все Wave 4 commits
pnpm smoke                                                  # 30s sanity
pnpm bench --envs=firefox --sizes=M --mode=quick --out=/tmp/foo  # quick FF check
BENCH_DEBUG_TIMINGS=1 pnpm bench --envs=firefox --sizes=M --mode=quick --out=/tmp/dbg  # с per-sample logging

# Manual browser run (для diagnostic, не для regular bench):
cd apps/runner-web && ./node_modules/.bin/vite             # dev server
# Открыть в browser, в URL добавить ?debug=1 для bench-debug logs в DevTools console.

# Generate manual URL для cpp/emscripten/size M (eval mode):
node -e "
const wi = {
    benchmarkId: 'matmul', language: 'cpp', toolchain: 'emscripten', profile: 'size',
    inputSize: 'M', fixtureSha256: '9808581790a2389ab4263529ac50bbce6c1fc611b26ba11daf61a6a4d1471b94',
    expectedChecksum: 275996.81878375803,
    measureConfig: { warmupIterations: 10, innerIterations: 1, minSamples: 30, maxSamples: 100, cvThreshold: 0.05 },
    baseUrl: 'http://localhost:5174',
};
console.log('http://localhost:5174/?case=' + encodeURIComponent(Buffer.from(JSON.stringify(wi)).toString('base64')) + '&debug=1');
"

# Capture base SHA before starting work in next session:
git rev-parse HEAD
```
