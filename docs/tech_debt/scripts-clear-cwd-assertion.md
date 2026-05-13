---
id: scripts-clear-cwd-assertion
title: scripts/clear.ts работает только из repo root, но не проверяет cwd
created: 2026-05-14
source: docs/superpowers/session-state-2026-05-05.md
category: nice-to-have
status: open
priority: low
---

## What

`scripts/clear.ts` использует relative paths (`"dist"`, `"results"`, `"target"`, etc.) для
rm. Работает потому, что `pnpm clear` всегда из repo root. Но скрипт не проверяет cwd —
если запустить `tsx scripts/clear.ts` из субдиректории, можно случайно удалить чужой `dist`.

## Why it matters

Низкий риск (обычно через `pnpm clear`), но destructive-операции лучше защищать.

## Possible fix

В начале `main()`: assert `process.cwd()` совпадает с repo root (например, проверкой
existence `pnpm-workspace.yaml` или известного marker-файла). Или резолвить все paths
от `import.meta.url` (как делает driver.ts).

## References

- `scripts/clear.ts`
- `package.json` scripts.clear
