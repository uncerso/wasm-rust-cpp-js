---
id: benches-tests-not-in-gate
title: benches/**/*.test.ts не гоняются pnpm test (вне CI-гейта)
created: 2026-07-12
source: session 2026-07-12 sorted_map_int workload
category: process-gap
status: open
priority: medium
---

## What
`benches/common/*.test.ts` и `benches/*/validate/*.test.ts` (fixture / reference /
parity unit-тесты) git-tracked, но `pnpm test` = `pnpm -r --parallel test` их не
запускает: ни один пакет под `benches/` не имеет `test`-скрипта, и нет корневого
vitest-конфига с broad include. Тесты ловятся только ручным `npx vitest run <path>`.

## Why it matters
Unit-тесты фикстур / reference / parity живут вне all-gates pre-flight
(`… && pnpm test && …`). Регрессия в `benches/common/fixtures.ts` или в
reference-логике workload'а не покраснеет в гейте — её поймает только authoritative
node-матрица (checksum vs `spec.json`), и то не саму reference-логику (spec-pins
захардкожены, reference — их oracle). Confirmed этой сессией: `sorted_map_int`
reference.test + parity.test пришлось гонять `npx vitest run` вручную (Task 2/9/10);
они не входят в `pnpm test`.

## Possible fix
(1) корневой `vitest.workspace.ts` / vitest-конфиг с include `benches/**/*.test.ts`,
подключённый к корневому `test`-скрипту; (2) дать `benches/common` + затронутым
пакетам собственный `test`-скрипт; (3) отдельный `pnpm test:benches`, добавленный в
all-gates. Natural fit для CI-item.

## Related symptom + workaround
Тот же tsconfig-gap кусается и в eslint: test-файл под `benches/*/js/*/tests/` не
входит ни в один tsconfig include (js-пакет включает только `src/**`), а корневой
`tsconfig.json` покрывает лишь `benches/*/validate/**` + `benches/common/**` → eslint
typed-lint project-service падает с `Parsing error: … not found by the project service`.
**Workaround до фикса:** клади bench-тесты в `benches/<id>/validate/` (или `benches/common/`),
НЕ в `js/*/tests/`. Так сделан `sorted_map_int` parity.test (commit 305c99c).

## References
- session 2026-07-12 (sorted_map_int); `package.json` `"test": "pnpm -r --parallel test"`; `tsconfig.json` include `benches/*/validate/**`.
- Related: `pnpm-typecheck-skips-scripts` (parallel process-gap — покрытие вне `pnpm -r`).
