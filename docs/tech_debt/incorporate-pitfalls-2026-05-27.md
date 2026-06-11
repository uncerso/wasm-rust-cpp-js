---
id: incorporate-pitfalls-2026-05-27
title: Bulk-defer pitfalls из /finish-session 2026-05-27 (Phase 1.1.2.1 execution)
created: 2026-05-27
source: docs/pitfalls/2026-05-27-phase-1-1-2-1-execution.md
category: process-gap
status: open
priority: medium
---

## What

Bulk-defer бакет для pitfall items из /finish-session 2026-05-27 (Phase 1.1.2.1
execution session), которые не были задиспатчены inline. Каждый item — отдельный
suggestion для дальнейшего dispatch через `/backlog-review`.

### Item 1: Plan code-blocks should pre-pass project lint

**Lesson:** Plan provided exact TS code blocks для driver.ts stub, createDriverSession
implementation, run-matrix.ts refactor — multiple lint errors при copy без modification:
`@typescript-eslint/require-await` (stub без await), `@typescript-eslint/no-unused-vars`
(stub `_options` с default value — `_` prefix не настроен в argsIgnorePattern),
`prefer-const` (`let raw` после refactor stays single-assign), `@typescript-eslint/no-unnecessary-type-assertion`
(plan-provided cast после narrow stays unnecessary), `@typescript-eslint/unbound-method`
(vitest mock pattern `expect(mock.method).toHaveBeenCalled()` в test files).

Each surface необходим был manual fix at task time. На big task (W1 Task 7 ~250 LoC)
было бы более dangerous — fix-on-paste risk.

**Suggested dispatch options:**
1. Update `superpowers:writing-plans` skill — добавить «code-block lint pre-check»
   к Self-review checklist. Plan code blocks > ~10 LoC должны проходить mental
   `eslint <tempfile>` check OR plan annotates "lint deviation expected here".
2. Add `argsIgnorePattern: "^_"` to project eslint.config.js for
   `@typescript-eslint/no-unused-vars` — make `_param` idiom work universally
   (current behavior: `_` prefix ignored для unused-args но не для assigned-vars).
3. Skip — pattern not unique, every project deals с этим.

**Why medium priority:** Multiple-occurrence в single session, fixed time investment
per occurrence ~30s-2min. Recurring если plan-writing не addresses.

### Item 3: Plan case-count predictions hand-derived

**Lesson:** Plan Task 12 Step 2 predicted "810 cases, 270 per env" — actual 630 / 210.
Math overcount likely from hand-counting binaries × entries × sizes × envs without
applying the js-size profile filter в run-matrix.ts (`if (c.language === "js" && c.profile !== "speed") continue;`).

Plan asserted "STOP if not 810" — if I'd followed без verification я бы остановил
clean run в 630. Caught by recount, но gate was incorrect.

**Suggested dispatch options:**
1. Update `superpowers:writing-plans` skill — references к case counts должны derive
   через one-liner `pnpm exec tsx -e '...'` или ссылку на `enumerateRunCases()`,
   не hand-counted.
2. Add a `scripts/lib/case-count.ts` helper that prints expected counts per (envs, sizes,
   benchmarks, filters) configuration — usable by plans + verification.
3. Skip — единичный overcount, easily detected at execution.

**Why medium priority:** Wrong gate values mask real success OR cause false-stop. Recurring
если plans будут продолжать predict counts.

### Item 5: Methodology change → re-baseline tentative cross-runtime claims

**Lesson:** Phase 1.1.1 measured cpp-emscripten noop M firefox = 11 ms (5.7× rust-raw)
и captured это в `docs/tech_debt/firefox-emscripten-noop-5x-slowdown.md` (open
investigation). Phase 1.1.2.1 measured 1.96 ms (same as wasi-sdk and rust-raw) — 5×
artifact GONE. Most likely cause: per-case driver spawn methodology Phase 1.1.1 introduced
systematic contamination для emscripten×firefox combination (perhaps initial-launch warmup
state в SpiderMonkey × emscripten glue path), eliminated by long-lived session.

**Generalization:** When bench infrastructure changes (driver lifecycle, browser
harness, warmup protocol, COOP/COEP, runtime versions), prior tentative cross-runtime
claims may need re-baseline. Tentative status implies "subject to invalidation when
methodology shifts" — but it's not explicit policy.

**Suggested dispatch options:**
1. Add к `docs/guidelines.md § Format` (или `CLAUDE.md § Guidelines artifact`): note
   что major methodology changes (bench-infra, COI setup, runtime versions) trigger
   re-baseline of tentative claims before promoting to confirmed.
2. Skip — observation noted в Phase 1.1.2.1 session-state, не requires durable rule.

**Why low priority:** Single observation; phase-boundary discipline already implicit
("don't promote tentative without cross-runtime evidence"). Methodology shifts rare.

## Why it matters

См. pitfall `docs/pitfalls/2026-05-27-phase-1-1-2-1-execution.md` для full context.
Без review во время следующего `/backlog-review` items тихо застревают в backlog'е.

## Suggested workflow для review

Run `/backlog-review`; для каждого item:
- Если решено «update writing-plans skill» — открыть skill file и применить change inline,
  закрыть этот item.
- Если решено «skip» — пометить отдельным `status: wontfix` rationale (или закрыть весь
  bulk file если все items skipped).
- Если решено «hold» — оставить open до следующей phase, перепосмотреть если pattern
  повторится.
