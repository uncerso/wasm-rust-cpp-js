---
id: dead-ts-output-fields
title: Удалить dead type-only output fields в raw и emscripten loader interfaces
created: 2026-05-22
source: docs/pitfalls/2026-05-21-phase-1-1-0-execution.md (§11)
category: code-cleanup
status: open
priority: low
---

## What

В Phase 1.1.0 Wave 5 удалены runtime `readOutput`/`output_view` callers. Связанные
TypeScript fields в loader interfaces оставлены subagent'ом как type-only declarations
(no runtime/bundle impact, но дальше никто их не читает):

- `packages/loaders/src/raw-wasm.ts` — `output_ptr`, `output_len`.
- `packages/loaders/src/emscripten.ts` — `_output_ptr`, `_output_len`.

(Точные пути и shape — verify через grep перед cleanup'ом.)

## Why it matters

Confusion при изменении loader contract: reader кода видит fields и может подумать что
они используются. Также bloats interface definitions без reason. Cleanup тривиальный
(type erasure, byte-identical bundle).

## Possible fix

1. `rg "output_ptr|output_len|_output_ptr|_output_len" packages/loaders/` — verify все
   references только в interface declarations.
2. Удалить fields из interface'ов.
3. `pnpm typecheck` (root через `npx tsc --noEmit -p tsconfig.json`).
4. Commit `chore(loaders): remove dead output fields after W5 cleanup`.

После cleanup'а — close этот tech-debt.

## References

- `docs/pitfalls/2026-05-21-phase-1-1-0-execution.md` §11.
- Phase 1.1.0 W5 subagent deviation note (commit range `9f1b636..8720f2f` на master).
- Connected investigation: `docs/tech_debt/subagent-leaves-micro-tech-debt.md`.
