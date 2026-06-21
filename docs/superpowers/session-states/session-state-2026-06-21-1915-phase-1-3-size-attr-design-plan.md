# Session state — 2026-06-21 1915 · phase-1-3 size-attr — design + Plan 1/3 written

## TL;DR

- Branch `feature/phase-1-3-wasm-size-floor-vs-marginal`, HEAD `bbf550d`, **не запушена**. Master нетронут. Рабочее дерево чистое (только 2 pre-existing stray'я, не коммитить).
- **Phase 1.3 (wasm-size-floor-vs-marginal) — Design + Plan 1/3 готовы, execution НЕ начат.** Кода нет, гейты не запускались (нечего). 3 коммита: `f5dec8b` spec, `1062a15` spec IA-секция, `bbf550d` Plan 1/3.
- Цель фазы: размер — разложимый first-class-результат (facative-категории + scaling-метка), в отчёте с фильтрами. Метод A: композиция-как-доли (pre-opt twiggy) + калибровка к точному prod-тоталу + точечный дифференциал. W0-зонд подтвердил: twiggy JSON + авто-демangl cpp; >96% атрибутируется; **байт-точная атрибуция невозможна** (name-секции меняют wasm-opt) → доли+калибровка.

## What the next session needs

1. **Решить:** пушить spec+plan как PR сейчас (review дизайна на GitHub) ИЛИ сразу исполнять Plan 1/3.
2. **Исполнять Plan 1/3** — `/iterate` сориентируется на этот session-state + план и пойдёт CONTINUE (открытые `[ ]` в `docs/superpowers/plans/2026-06-21-size-attribution-engine.md`). Старт: W0 (пин twiggy), затем W1 (пакет `packages/size-attr` + схема + движок). Routing: subagent для self-contained TDD-юнит 1.1–1.5, inline для движка/интеграции 1.6–1.10. Сборки → `dangerouslyDisableSandbox: true`.

## Deferred / open-loops

- **Push + PR** — действие пользователя (Yubikey SSH, `gh` нет). 3 коммита на ветке. См. Resume.
- **Plan 2/3** (reporter-shell + Size-виды) и **Plan 3/3** (дифференциал + guidelines + README + roadmap) — заoutline'ены в Плане 1, пишутся `/writing-plans` перед своим execution.
- **emscripten cpp name-survival** — НЕ проверено зондом (только wasi-sdk). Верифицировать при достижении (Plan 1 Task 1.9 / Plan 3); если имена срезаны — emscripten деградирует до section-only.
- **math-table content ID** (isqrt/log таблицы) — отложено в Plan 3 (`wasm-tools print`); в Plan 1 data-сегменты идут в категорию `data`.
- **W0-находка (byte-identity)** — РАЗРЕШЕНА дизайном (доли+калибровка), задокументирована в спеке § Предварительные находки. Не open-loop, фиксирую чтобы не пере-открывать.
- **Companion-мокапы** в `.superpowers/brainstorm/` (gitignored) — можно удалить.

## Resume

```bash
git checkout feature/phase-1-3-wasm-size-floor-vs-marginal
# вариант A — PR дизайна сейчас:
git push -u origin feature/phase-1-3-wasm-size-floor-vs-marginal
# PR: https://github.com/uncerso/wasm-rust-cpp-js/compare/master...feature/phase-1-3-wasm-size-floor-vs-marginal
# вариант B — исполнять Plan 1/3:
#   /iterate  → CONTINUE по docs/superpowers/plans/2026-06-21-size-attribution-engine.md (W0 first)
```

## Stop point

Design утверждён через визуальный companion (формат отчёта: вариант C/гибрид, общая байтовая шкала + абсолюты, тумблер «только наблюдаемое»; IA: одна страница, вкладки Size/Perf, perf-таблица переносится минус size-колонки; полный perf-редизайн → roadmap `perf-view-redesign`). D1=twiggy (пинится), D2=экземпляры последовательно. Фаза разбита на 3 последовательных плана; Plan 1/3 (движок+схема) написан и самопроверен. Execution не начинался. `/finish-session` отработал: маркеров 0; CLAUDE.md/README/guidelines — без дрейфа; memory phase-указатель обновлён (Phase 1.2 closed → 1.3 current); pitfall пропущен (companion sandbox-bypass покрыт CLAUDE.md § Tooling gotchas). Spec: `docs/superpowers/specs/2026-06-21-wasm-size-floor-vs-marginal-design.md`.
