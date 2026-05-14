---
id: pnpm-typecheck-skips-scripts
title: pnpm typecheck не покрывает scripts/ — type-errors в orchestrator коде могут проскочить
created: 2026-05-14
source: session 2026-05-13/14 (Phase 1.0.6 Task 7-8 implementation)
category: process-gap
status: open
priority: medium
roadmap: phase-1.1-candidate
---

## What

`pnpm typecheck` запускает `pnpm -r typecheck`, который итерирует только по workspace
packages (`apps/*`, `packages/*`, etc.). Файлы в `scripts/` (orchestrator code:
`run-matrix.ts`, `setup.ts`, `build-*.ts`, `lib/*`) **не покрываются** и могут содержать
type-errors которые проявятся только при runtime.

Root `tsconfig.json` ВКЛЮЧАЕТ `scripts/**/*` — но требует прямого вызова
`npx tsc --noEmit -p tsconfig.json`.

## Why it matters

Silent gap. В Phase 1.0.6 Task 7 это выявилось: после удаления `ensurePlaywrightBrowsers`
из `scripts/lib/setup-tools.ts` остался невалидный импорт в `scripts/setup.ts`, который
`pnpm typecheck` НЕ показал. Поймали только когда subagent явно запустил root-level tsc.
Это значит: любое изменение orchestrator-кода может ломать type contracts молча.

## Possible fix

Варианты:
- Добавить в root `package.json` отдельный script: `"typecheck:scripts": "tsc --noEmit -p tsconfig.json"` и сделать `"typecheck"` запускающим оба (`pnpm -r typecheck && pnpm typecheck:scripts`).
- Или превратить `scripts/` в полноценный workspace package (pnpm-workspace.yaml + scripts/package.json) — тогда `-r` его подхватит.

Первый вариант проще, second — архитектурно чище.

## References

- `scripts/lib/setup-tools.ts`, `scripts/setup.ts` (область gap'а)
- `package.json` scripts.typecheck — текущая команда
- `tsconfig.json` — root config с include scripts/**/*
- Discovered: Phase 1.0.6 Wave 2 Task 7 implementation (subagent report 2026-05-13)

## Roadmap

Triage 2026-05-15: marked **phase-1.1-candidate**. Включить в Phase 1.1 plan (особенно
актуально если Phase 1.1 затронет CI integration). При создании plan-файла переместить
этот item в `resolved/` со ссылкой на plan.
