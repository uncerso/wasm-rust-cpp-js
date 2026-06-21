---
id: size-attr-nonexemplar-unattr
title: size-attr rust/raw — высокий unattributedShare на не-экземплярных workload'ах
created: 2026-06-21
source: session 2026-06-21 (Phase 1.3 Plan 1/3 W1, commit 608dac6)
category: investigation
status: open
priority: low
roadmap: phase-1.3-candidate
---

## What

Движок size-attr (`packages/size-attr`) tuned на 3 экземплярах Plan 1 (matmul,
hashmap_int, hashmap_string → `unattributedShare` 0.1–2.2%). Но `build:all` прогоняет
`attributeRustRaw` на ВСЕХ rust/raw бинарях, и не-экземплярные показывают высокий
unattributed:

- `interop_calls` ~28% (всего 2 facilities)
- `shape_dispatch_homo_dyn` ~13% (speed) / ~27% (size)
- `shape_dispatch_mixed_dyn` ~22–26%

(static-варианты shape_dispatch и matmul/hashmap — в норме, < 5%.)

## Why it matters

Композиция для этих workload'ов грубая: крупный unattributed-кластер занижает
facility-доли, а Size-вид reporter'а (Plan 2) покажет большую «unattributed» полосу →
снижает доверие к разложению именно для dyn-dispatch и interop. Не блокирует Plan 1
(эти бинари вне tuned-scope v1), но это quality-долг до того, как size-вид станет
first-class для всех workload'ов.

## Possible fix

В Plan 3 (или при расширении охвата): `twiggy top -n 60` на name-bearing бинарях этих
workload'ов (`target/attr/...`), добавить недостающие facility-правила в
`packages/size-attr/src/facilities.ts` + unit-кейсы в `facilities.test.ts`, ≤2 итерации
на бинарь — ровно паттерн, уже отработанный на hashmap в Task 1.8 (commit 608dac6).

## References

- `packages/size-attr/src/facilities.ts` — ruleset (first-match-wins)
- `scripts/lib/size-attr-build.ts` — `attributeRustRaw`
- commit `608dac6` — hashmap tuning pattern to replicate
