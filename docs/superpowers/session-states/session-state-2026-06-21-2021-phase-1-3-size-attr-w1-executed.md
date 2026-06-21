# Session state — 2026-06-21 2021 · phase-1-3 size-attr — Plan 1/3 W0+W1 executed

## TL;DR

- Branch `feature/phase-1-3-wasm-size-floor-vs-marginal`, HEAD `57b9655`, **не запушена**. Master нетронут. Рабочее дерево: только 2 pre-existing stray'я (не коммитить) + несколько uncommitted docs-правок от `/finish-session` (tech-debt, pitfall, README/CLAUDE.md/workflow.md drift-фиксы — закоммитить отдельно или вместе с Plan 2 стартом).
- **Phase 1.3 Plan 1/3 (size-attribution engine) — W0 + W1 ИСПОЛНЕНЫ.** 11 коммитов (`c4c17a4`..`57b9655`). Все гейты зелёные: build:all, typecheck, lint:all, test (20 size-attr + 10 result-schema), smoke (149 results, 0 correctness failures).
- Движок (`packages/size-attr`: facility-реестр + twiggy-парсер + buildComposition с калибровкой; `SizeCompositionSchema` в result-schema) валидирован на **3 rust-экземплярах** (matmul/hashmap_int/hashmap_string, unattr 0.1–2.2%). `meta.json` всех rust/raw несёт `composition`.
- **cpp/wasi-sdk — heisenbug:** name-секция теряется (`code[N]`, ~98% unattributed) при сборке через `build-wasi-sdk.sh`, хотя тот же argv в свежем процессе даёт демангл-имена. Механизм НЕ изолирован (превышен retry-бюджет). Контейнировано: `attributeWasiSdk` деградирует до `composition: null` при unattr > 0.5. Bug-report + pitfall записаны.

## What the next session needs

1. **Push** (действие пользователя) — см. Resume.
2. **Закоммитить `/finish-session` docs-правки**, если ещё не: `docs/tech_debt/{pnpm-typecheck-skips-scripts(upd),size-attr-nonexemplar-unattr}.md`, `docs/pitfalls/2026-06-21-phase-1-3-size-attr-w1.md`, `docs/workflow.md`, `README.md`, `CLAUDE.md`.
3. **Написать Plan 2/3** через `/writing-plans` (reporter-shell + Size-визуализация) перед его execution.

## Deferred / open-loops

- **cpp/wasi-sdk name-section heisenbug** → Plan 3. Деградирует чисто (composition: null). Зацепки: `docs/superpowers/bug-reports/2026-06-21-cpp-wasi-sdk-name-section-heisenbug.md` (env-diff failing-vs-passing; `wasm-ld --keep-section=name`; post-link `llvm-objcopy`/`wasm-tools`).
- **emscripten cpp name-survival** — НИКОГДА не пробовалось (open-loop с прошлой сессии, всё ещё открыт). Проверить в Plan 3 при bindgen/emscripten атрибуции; сейчас emscripten = composition: null.
- **bindgen rust атрибуция** → Plan 3 (сейчас composition: null).
- **size-attr-nonexemplar-unattr** (tech-debt) — interop_calls (~28%) + shape_dispatch_*_dyn (~22–27%) rust/raw имеют высокий unattr; донастроить правила в Plan 3 (паттерн Task 1.8, commit `608dac6`).
- **math-table content ID** (isqrt/log) — отложено в Plan 3 (`wasm-tools print`); сейчас data-сегменты в категории `data`.
- **Plan 3/3** (дифференциал headline-claims + guidelines + README «почему размеры приближённые» + roadmap removal) — outline в Plan 1, пишется перед execution.

## Resume

```bash
git checkout feature/phase-1-3-wasm-size-floor-vs-marginal
# 1. commit finish-session docs (если grep ниже показал uncommitted):
git status --short
# git add docs/ README.md CLAUDE.md && git commit --no-gpg-sign -m "docs: finish-session — tech-debt+pitfall+drift (Phase 1.3 W1)"
# 2. push (Yubikey):
git push -u origin feature/phase-1-3-wasm-size-floor-vs-marginal
# compare: https://github.com/uncerso/wasm-rust-cpp-js/compare/master...feature/phase-1-3-wasm-size-floor-vs-marginal
# 3. Plan 2/3:
#   /iterate → START FRESH внутри фазы → /writing-plans (reporter-shell + Size-вид)
```

## Stop point

Plan 1/3 W0+W1 закрыты (движок + schema + rust-атрибуция на 3 экземплярах + cpp graceful-degradation), гейты зелёные, не запушено. Routing шёл гибридно: subagent на pure-logic TDD (Tasks 1.1–1.5), inline на движок/интеграцию/валидацию (1.6–1.10). Materialized planned-risk: инструкция плана «добавить `-g`» была ошибочной (DWARF глушит name-секцию) — исправлено; вскрылся cpp build-heisenbug, контейнирован degradation'ом + эскалирован — user выбрал «отложить cpp → Plan 3, пауза». `/finish-session` отработал: 2 tech-debt записаны, 5 drift-правок применены (README ×4 + CLAUDE.md), 1 pitfall (doc + workflow.md правило про probe-integration-fidelity). Plan 1/3 spec: `docs/superpowers/specs/2026-06-21-wasm-size-floor-vs-marginal-design.md`; plan: `docs/superpowers/plans/2026-06-21-size-attribution-engine.md`.
