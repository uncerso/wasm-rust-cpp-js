# Session state — 2026-06-25 0256 · Phase 1.4 size-attr-toolchain-coverage (spec + plan, NOT executed)

## TL;DR

- Branch `feature/phase-1-4-size-attr-toolchain-coverage`, HEAD `491bcb9`, **не запушена**. Master нетронут.
- **Брейнсторм + планирование DONE; исполнение НЕ начато (0/6 задач).** Спека `7c4a01a`, план `491bcb9`.
- **Heisenbug cpp/wasi-sdk name-section RESOLVED в дизайн-фазе** (`/systematic-debugging`): root cause = `build-cpp.ts` инжектит `.tools/bin` в PATH → wasi-sdk clang при `-flto` авто-прогоняет `wasm-opt` post-link → срезает name-секцию. Фикс = PATH-гигиена для attr-сборки. Подтверждён end-to-end через реальный `buildComposition`: unattributed **0.66%** (было ~98% → null).
- Артефакты: spec `docs/superpowers/specs/2026-06-25-size-attr-toolchain-coverage-design.md`, plan `docs/superpowers/plans/2026-06-25-size-attr-toolchain-coverage.md` (6 задач, Execution Protocol встроен).

## What the next session needs

1. **Начать исполнение плана** — Task 1 (rust/bindgen attribution, `[S]`). Routing размечен в плане § Execution Protocol (I/S). Использовать `subagent-driven-development` (рекоменд.) или `executing-plans`.
2. **Wave-0 baseline gate ПЕРЕД Task 1:** `pnpm typecheck && pnpm lint:all && pnpm test` (sandbox-ok) зелёные; зафиксировать текущие `meta.wasm.hashSha256` для всех `cpp-wasi-sdk-*` (production-byte-identity gate в Task 2/3/5).
3. Учесть эмпирические пробы: bindgen `_bg.wasm` name-survival (Task 1 Step 6), emscripten name-preservation флаг `-g2`/`--profiling-funcs` (Task 5 Step 1).

## Deferred / open-loops

- **bug-report `2026-06-21-cpp-wasi-sdk-name-section-heisenbug.md` всё ещё помечен «open / NOT isolated»** — пометить RESOLVED запланировано в **Task 6 Step 3**, в этой сессии НЕ сделано (finish-session не пре-исполняет план). НЕ считать done.
- **emscripten name-survival НЕ зондирован** — решается в Task 5 Step 1; если имена не выживают → section-only fallback (документированный, допустимый по спеке).
- **bindgen `_bg.wasm` name-survival НЕ зондирован** — Task 1 Step 6 (`--release` STRIP=false vs `--profiling`).
- **Проектная PATH-гигиена** (вне этой фазы) → roadmap `path-hygiene-build-isolation`. Raw host-glue оценка → roadmap `size-attr-raw-host-glue`.

## Resume

```bash
git checkout feature/phase-1-4-size-attr-toolchain-coverage
# прочитать спеку + план:
#   docs/superpowers/specs/2026-06-25-size-attr-toolchain-coverage-design.md
#   docs/superpowers/plans/2026-06-25-size-attr-toolchain-coverage.md
# Wave-0 gate:
pnpm typecheck && pnpm lint:all && pnpm test
# зафиксировать baseline hashes:
for d in dist/*/cpp-wasi-sdk-*/meta.json; do node -e "const m=require('./$d');console.log('$d',m.wasm.hashSha256)"; done
# начать Task 1 (bindgen) через subagent-driven-development или /iterate (route = CONTINUE)
# push (Yubikey, когда фаза закрыта):
git push -u origin feature/phase-1-4-size-attr-toolchain-coverage
```

## Stop point

Спека (`7c4a01a`) + план (`491bcb9`) написаны и закоммичены, не запушены. Путь сессии: `/iterate` (START FRESH, выбран срез `size-attr-toolchain-coverage`) → `/brainstorming` (спека, с эмпирикой компрессии + raw-loader-разбором) → `/systematic-debugging` (heisenbug root cause = PATH/wasm-opt, изолирован за R1–R5 + подтверждён end-to-end) → `/writing-plans` (6-задачный план) → `/finish-session`. `/finish-session`: 2 capture-маркера (pitfall + agent-lesson, один инцидент); drift — 2 правки памяти (Phase 1.3 «не запушено» → merged PR #7); pitfall → форензик-док `docs/pitfalls/2026-06-25-cpp-wasi-sdk-name-section-env-diff.md` + 1 строка в CLAUDE.md § Tooling gotchas (env-diff-not-argv). roadmap +`path-hygiene-build-isolation` +`size-attr-raw-host-glue`.
