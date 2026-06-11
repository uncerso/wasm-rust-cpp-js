---
id: incorporate-pitfalls-2026-05-22
title: Bulk-defer pitfalls из /finish-session 2026-05-22 (Phase 1.1.1 Wave 1)
created: 2026-05-22
source: docs/pitfalls/2026-05-22-phase-1-1-1-w1.md
category: process-gap
status: open
priority: low
---

## What

Bulk-defer бакет для pitfall items из /finish-session 2026-05-22 (Phase 1.1.1 Wave 1
execution), которые не были задиспатчены inline. Каждый item — отдельный suggestion
для дальнейшего dispatch через `/backlog-review`.

### Item 1: Plan executor — required-flag coupling

**Lesson:** При добавлении обязательного CLI flag в downstream worker (`--entry`
для `apps/runner-node/src/main.ts` в Task 11) — все upstream callers (`scripts/run-matrix.ts`
+ `scripts/smoke.ts`) должны передавать flag в **том же коммите**, иначе smoke падает
до завершения связки. Plan разбивал runner-node и run-matrix на разные tasks (11 и 13),
но фактически пришлось bundle'ить в один коммит — иначе intermediate state ломал
smoke gate.

**Suggested dispatch options:**
1. Update `superpowers:writing-plans` skill checklist: при добавлении required CLI flag —
   force "all callers in same commit, OR make flag optional with default" decision
   в plan writing phase.
2. Update plan-template (если будет) — добавить «Coupled tasks» секцию для cases где
   N tasks должны коммититься атомарно.
3. Skip — process pattern, не блокер; следующий /writing-plans естественно заметит.

**Why low priority:** одна сессия, одно проявление, fix был тривиальный (bundle two
tasks). Validated по факту, не повторяющийся источник друзья.

## Why it matters

См. pitfall `docs/pitfalls/2026-05-22-phase-1-1-1-w1.md` § 3 для full context. Без
review во время следующего `/backlog-review` — item тихо застревает в backlog'е.

## Suggested workflow для review

Run `/backlog-review`; для этого item:
- Если решено «update writing-plans skill» — открыть skill file и применить change inline,
  закрыть этот item.
- Если решено «skip» — пометить `status: wontfix` с rationale.
- Если решено «hold» — оставить open, перепосмотреть после Wave 2/3 (если pattern повторится).
