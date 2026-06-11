# Session state — 2026-05-06 (Wave 5 entry)

Снапшот для следующей сессии. Phase 1.0.5 (Housekeeping), ветка `feature/phase-1-0-5`.
Wave 4 закрыт (см. sibling файл `session-state-2026-05-06-wave-4.md`). **Этот файл — entry handoff для Wave 5 (auto-deps installer, Tasks 19-26).**

В этом файле — только то, чего нет в спеке/плане/коде/git history.

---

## TL;DR

- Wave 5 = **auto-deps installer (macOS arm64 only)**. Tasks 19-26 из plan'а.
- Goal: на чистой машине с **только** node + pnpm + rustup + xcode-tools, `pnpm bench:all` отрабатывает без ручных шагов.
- Ставит в `.tools/`: emcc (через emsdk), wasi-sdk, binaryen (wasm-opt), wasm-pack. Pin'нутые версии, sha256 verification.
- Pre-Wave-5 state: `feature/phase-1-0-5 @ wave-4-done`. Спека и план готовы.
- **Это финальный wave Phase 1.0.5.** После Task 25 closeout → Task 26 finalize → merge to master, tag `phase-1-0-5`.
- Time estimate: **3-5 дней** (по spec). Финальный exit-point — если затягивается, отрезается в Phase 1.0.6 без блокировки Phase 1.1 (per spec §5).

---

## Состояние репозитория (entry для Wave 5)

| Что | Куда указывает |
|---|---|
| `feature/phase-1-0-5` HEAD | (после Wave 4 closeout commit; см. `git log`) |
| tag `wave-4-done` | post-Wave-4 closeout commit |
| tag `wave-3-done` | `94f313e` |
| tag `wave-2-done` | `efab4f0` |
| tag `wave-1-done` | `3384aba` |
| `master` | `c9a00c3` |

**Untracked (не коммитить):**
- `Какие есть существующие бенчмарки wasm под браузер.md` — input от user'а
- `chrome-console.txt`, `firefox-console.txt` — manual run dumps Wave 4 (data в notes file)

---

## Wave 5 — что делаем (high-level)

**Spec:** `docs/superpowers/specs/2026-05-04-housekeeping-design.md` §5 (lines ~475-583).
**Plan:** `docs/superpowers/plans/2026-05-04-housekeeping-phase-1-0-5.md` Tasks 19-26 (lines ~1785-2453).

| Task | Что | Сложность |
|---|---|---|
| 19 | Extend `tool-versions.json` с `url` + `sha256` per tool | Inline (data-only edit, но требует `curl --head` для verify URL'ов и download для sha256) |
| 20 | `scripts/lib/setup-tools.ts` — download/verify/extract logic | Subagent (сложный, network ops, sha verification, tar extraction) |
| 21 | `scripts/setup.ts` — CLI entry point, idempotent | Subagent (интеграция с lib + state.json bookkeeping) |
| 22 | `scripts/lib/tool-paths.ts` + `emsdk-env.ts` | Subagent (заменяет хардкод `wasm-opt`/`wasm-pack` paths) |
| 23 | Wire build scripts to use tool-paths | Subagent (multi-file: build-cpp.ts, build-rust*.ts, etc) |
| 24 | Integration test — clean install simulation | Inline test (в spec §5.7 уже описан — `pnpm clear:all && pnpm install && pnpm bench:all` должно работать) |
| 25 | Wave 5 closeout (verify + tag) | Inline |
| 26 | **Phase 1.0.5 finalize** (merge to master, tag `phase-1-0-5`, cleanup wave tags) | Inline |

---

## Pre-work / known issues для старта

1. **Task 19 был scoped в Wave 4** по previous session-state (Tasks 15-19), но **не выполнен** — Wave 4 ушёл в investigation rabbit hole. Start Wave 5 with Task 19.

2. **emsdk — не single tarball**. Это git repo + installer. State.json для emsdk хранит SHA коммита git'а, не tarball sha. Plan Task 20 учтёт это.

3. **URL'ы для tool downloads** (per plan Task 19.1):
    - emsdk: `git clone https://github.com/emscripten-core/emsdk` → `./emsdk install 5.0.7 && ./emsdk activate 5.0.7`
    - wasi-sdk: `https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-25/wasi-sdk-25.0-arm64-macos.tar.gz`
    - binaryen: `https://github.com/WebAssembly/binaryen/releases/download/version_122/binaryen-version_122-arm64-macos.tar.gz`
    - wasm-pack: `https://github.com/rustwasm/wasm-pack/releases/download/v0.13.1/wasm-pack-v0.13.1-aarch64-apple-darwin.tar.gz`
   
   **Verify актуальность** через `curl --head` перед download (URLs могли измениться).

4. **Task 26 включает merge to master + tag `phase-1-0-5` + delete wave-N-done tags + auto-memory update.** User explicitly approves push (per workflow note "не пушить без просьбы").

---

## Что **НЕ** делаем в Wave 5 (carry to other tracks)

- **Prod-bundle migration** для runner-web → see sibling `session-state-2026-05-06-wave-4.md` Open work A. Independent от auto-deps. Phase 1.0.6 candidate.
- **FF handling brainstorm** → see sibling Open work B. Phase 1.0.6 / 1.1 candidate.
- **Re-baseline Phase 1.0 results** для FF env (depends on FF handling decision).

---

## Чтение перед стартом сессии (порядок)

1. **`docs/superpowers/specs/2026-05-04-housekeeping-design.md` §5** (lines 475-583) — Wave 5 design. Самое важное.
2. **`docs/superpowers/plans/2026-05-04-housekeeping-phase-1-0-5.md` Tasks 19-26** — пошаговые steps.
3. **Auto-memory `project_wasm_benchmarks.md`** — high-level state.
4. **Этот файл** (handoff).
5. (Optionally) `docs/superpowers/notes/2026-05-05-perf-now-precision.md` — Wave 4 findings; не критично для Wave 5, но контекст полезен.

---

## Workflow notes (без изменений с Wave 1-4)

- `--no-gpg-sign` обязателен на каждом коммите.
- WASI_SDK_PATH=/Users/uncerso/wasi-sdk-25 (zshrc; **Wave 5 цель: убрать эту зависимость от global env**).
- emcc через /Users/uncerso/emsdk/upstream/emscripten/emcc (**Wave 5 цель: убрать; switch на `.tools/bin/emcc`**).
- Playwright browsers в `~/Library/Caches/ms-playwright/`.
- Rust toolchain 1.95.0.
- Гибридная execution: subagent для сложного, inline для тривиального.

---

## Execution flow expectations

Wave 5 — **multi-file native build/script work, не investigation-heavy**. Subagent flow на Tasks 20-23 (как в Wave 1-3): implementer (sonnet) → spec reviewer (haiku) → code quality reviewer (`superpowers:code-reviewer`). Tasks 19, 24, 25, 26 — inline.

Token budget: ~600-1000k для всего Wave 5 (8 tasks, mix subagent/inline). Wall time на одну сессию — может не хватить, возможен split на 2 сессии (e.g., Tasks 19-22 в одну, 23-26 в другую). User решает по progress.

**Acceptance criteria (per spec §5.7):**
```bash
# На чистом macOS arm64 (только node + pnpm + rustup + xcode-tools):
git clone <repo>
cd wasm-rust-cpp-js
pnpm install
pnpm bench:all
# → exit code 0, без ручных шагов
```

Артефакт sizes/timings — те же как до Wave 5 (тот же toolchain → те же байты). Validate против Phase 1.0 baseline `results/summarized/2026-05-03T19-13-32-386Z/index.html`.

---

## Stop point

Готов к Task 19 (start Wave 5). Если хватит времени — закрыть Wave 5 целиком + Phase 1.0.5 finalize (Task 26 → merge to master).

В новой сессии: после прочтения этого файла + spec §5 + plan Tasks 19-26 — `git rev-parse HEAD` (capture base SHA) и dispatch implementer / inline action для Task 19.

---

## Полезные команды

```bash
git switch feature/phase-1-0-5                         # вернуться на ветку
git log --oneline wave-4-done..HEAD                    # что нового
git log --oneline wave-3-done..wave-4-done             # все Wave 4 commits
pnpm smoke                                             # 30s sanity
pnpm bench:all                                         # full run (~10 min, 60 results) — baseline до Wave 5

# Verify download URLs до изменения tool-versions.json:
curl --head https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-25/wasi-sdk-25.0-arm64-macos.tar.gz
curl --head https://github.com/WebAssembly/binaryen/releases/download/version_122/binaryen-version_122-arm64-macos.tar.gz
curl --head https://github.com/rustwasm/wasm-pack/releases/download/v0.13.1/wasm-pack-v0.13.1-aarch64-apple-darwin.tar.gz

# Wave 5 acceptance test (Task 24):
pnpm clear:all && pnpm install && pnpm bench:all && echo "OK"

git rev-parse HEAD                                     # capture base SHA before task
git rev-parse refs/tags/wave-4-done                    # phase 1.0.5 wave 4 marker
```
