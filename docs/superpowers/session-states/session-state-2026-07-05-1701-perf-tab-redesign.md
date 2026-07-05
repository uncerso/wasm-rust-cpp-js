# Session state — Phase 1.2 perf-tab redesign

## TL;DR
- Branch `feature/phase-1.2-perf-tab-redesign` (from master `3f970ad`), HEAD `a3b77bb`, **not pushed**.
- 7 commits: spec (`145cafb`) + plan (`6e0d89d`) + Task1 (`2157153`) + Task2 (`cbb8c34`) + Task3 (`d0b9a07`) + Task4 docs (`6f7d789`) + visual-check refinements (`a3b77bb`).
- 3 задачи (perf-таб reporter'а), все done; гейты (typecheck + test 67 + lint:ts) зелёные; отчёт визуально проверен пользователем в компаньоне.
  - **shape_dispatch:** heatmap → impl×env grid, на каждую (impl,env)-ячейку блок **2×2** (строки homo/mixed × столбцы static/dynamic) баров; шкала **per-env** (incl js, короткий wasm-бар = «в разы быстрее»); value/Δ% в фиксированных слотах (выровнены); js `homo_static` = прочерк.
  - **detail-таблица:** `table-layout:fixed` + `width:100%` + явные % ширины колонок → full-width И стабильна между size/profile-фильтрами (min-width оказался недостаточен). Базовый `.cbox` стал fluid.
  - **спойлеры:** синхронизируются между фильтрами через `data-sync`-ключи + Set в `PERF_JS` (re-entry guard).
  - **Task4 docs:** roadmap `bindgen-size-opt-level` обогащён (size≈speed, оба opt-level=3, отличие лишь wasm-opt -Oz/-O3); README perf-описание.
- finish-session applied: README:270 (cbox→2×2), память (PR #14 merged + эта фаза), pitfall `docs/pitfalls/2026-07-05-visual-mockup-vs-real-render.md` + workflow.md bullet, этот снимок.

## What the next session needs
- **User: push + PR** (Yubikey SSH, gh отсутствует — агент не пушит). Затем review на GitHub, merge.
- После merge: `/iterate` → следующий срез Phase 1.2. `bindgen-size-opt-level` остаётся ready (теперь с задокументированным «как чинить»: `CARGO_PROFILE_RELEASE_OPT_LEVEL=z` при `wasm-pack --release`).

## Deferred / open-loops
- **Push + PR** — pending (user action). Команды в Resume.
- **Спека/план разошлись с финалом** — spec/plan описывают исходный дизайн (cbox-бары, min-width); реализация эволюционировала по визуальному фидбеку (2×2 CSS-grid, table-layout:fixed). При возврате — читать **код/этот снимок**, не спеку/план. Осознанное design-evolution, не баг; переписывать spec/plan не стали (историчны, дивергенция в commit-месседжах).
- **Сам фикс `bindgen-size-opt-level`** (opt-level=z + ре-бейзлайн bindgen size) — НЕ делали, только задокументировали «как» в roadmap. По договорённости вне скоупа этой фазы.
- **Тяжёлые гейты** (`build:all` + `smoke` + `lint:rust`) — НЕ прогонялись: изменение чисто reporter-TS, wasm-сборки/бенчи/clippy не затронуты, `pnpm report` прогнал reporter e2e на 1161 результате. Если нужен полный pre-flight перед PR — прогнать (вне sandbox).
- **plan-чекбоксы `- [ ]`** в `docs/superpowers/plans/2026-07-05-perf-tab-redesign.md` не проставлены (трекалось через task-tool) — косметика.

## Resume
```
# user pushes + opens PR:
git push -u origin feature/phase-1.2-perf-tab-redesign
# compare: https://github.com/uncerso/wasm-rust-cpp-js/compare/master...feature/phase-1.2-perf-tab-redesign
# после merge → /iterate → следующий срез Phase 1.2 (bindgen-size-opt-level ready)

# посмотреть текущий отчёт:
pnpm report   # → results/summarized/<newest>/index.html, вкладка Perf
```

## Stop point
perf-tab redesign (shape 2×2 grid + detail fixed-layout + spoiler-sync + docs) complete on `feature/phase-1.2-perf-tab-redesign`; гейты зелёные; отчёт eyeball'нут пользователем. finish-session doc/memory-правки применены. Пользователь просил закоммитить finish-session-правки в ветку (сделано отдельным коммитом) — дальше push/PR сам.
