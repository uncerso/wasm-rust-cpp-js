---
id: worker-importscripts-detection
title: Worker-kind detection через typeof importScripts unreliable
created: 2026-05-14
source: docs/superpowers/notes/2026-05-05-perf-now-precision.md
category: open-review-ticket
status: open
priority: medium
---

## What

В runner-web коде есть detection `typeof importScripts === "function"` для определения
worker context vs main-thread. По notes/2026-05-05-perf-now-precision.md этот check
unreliable — `importScripts` не определён в Module Workers (ES module worker'ах), а
проект использует именно их (`new Worker(url, { type: "module" })`).

Detection либо silently false-negative'ит, либо просто не нужен (если код всё равно знает
свой context).

## Why it matters

Скрытая bug-prone проверка в hot path browser-side кода. Может вызывать неверные code
paths при будущих изменениях runtime'а.

## Possible fix

Investigate:
- Где конкретно `importScripts` check ещё используется (grep по runner-web).
- Можно ли просто удалить (если код стек-локально знает context).
- Иначе: заменить на `typeof self.WorkerNavigator !== "undefined"` или
  `typeof DedicatedWorkerGlobalScope !== "undefined"` (более reliable).

## References

- `docs/superpowers/notes/2026-05-05-perf-now-precision.md` (TODO mention)
- `apps/runner-web/src/` (grep target)
