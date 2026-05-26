# Pitfalls — Phase 1.1.2.1 execution (2026-05-27)

Lessons from Phase 1.1.2.1 (bench-infra hardening) execution session — 20 tasks
across 3 waves merged за one session, multiple plan deviations applied.

## Planning

### Plan code-blocks should pre-pass project lint

**What happened.** Plan provided exact TS code blocks для driver.ts stub, real
createDriverSession implementation, и run-matrix.ts refactor. При copy-paste без
modification surfaced 5 distinct lint errors across W1 tasks:

| Error | Location | Plan-provided code |
|---|---|---|
| `@typescript-eslint/require-await` | Task 2 stub | `async function` throws без await |
| `@typescript-eslint/no-unused-vars` | Task 2 stub | `_options: T = {}` (assigned default, не просто unused param) |
| `prefer-const` | Task 3 real impl | `let raw: unknown;` после refactor stays single-assign |
| `@typescript-eslint/no-unnecessary-type-assertion` | Task 3 real impl | `(raw as { error: unknown }).error` после narrow |
| `@typescript-eslint/unbound-method` | Task 5 test | vitest mock pattern `expect(sess.method).toHaveBeenCalled()` |

Каждое сюрфейсилось at task time через `pnpm exec eslint` — easily fixed locally
but repetitive friction. Larger task (W1 Task 7, ~250 LoC через subagent) potentially
скрыло бы issues hidden в bulk.

**Root cause.** Plan written без running code blocks через eslint.config.js. Some lints
project-specific: `argsIgnorePattern: "^_"` not configured for no-unused-vars; test
files лackedunbound-method override. Plan author defaulted to "common" TS style assumptions.

**Prevention.** writing-plans skill — code-block self-review checklist должна включать
"would `eslint <tempfile>` pass с project config?" check. OR project eslint.config.js
should `argsIgnorePattern: "^_"` to make `_param` idiom universal AND add test-file
override для vitest mock pattern.

### Pre-flight gate assumed dist/ exists

**What happened.** Plan Task 0 Step 3 `pnpm smoke` failed at execution start because
`dist/hashmap_int/rust-bindgen-speed/meta.json` ENOENT. dist/ был empty (только
js-idiomatic from prior partial work). Plan implicitly assumed dist would carry forward
from session that wrote the plan.

Spent ~3 min running `pnpm build:all` (2-5 min) before smoke could pass.

**Root cause.** Pre-flight gate chain `typecheck + lint + test + smoke` написана для
"steady-state" master, not для fresh post-checkout / post-`pnpm clear` state. dist/
gitignored — present on writing-machine, absent on executing-machine.

**Prevention.** CLAUDE.md "Spec & plan conventions > Pre-flight gate" — `pnpm build:all`
explicitly required before smoke. Applied 2026-05-27.

### Plan case-count predictions hand-derived

**What happened.** Plan Task 12 Step 2 predicted "810 cases, 270 per env" with explicit
"STOP if not 810" gate. Actual: 630 cases, 210 per env. Match would have falsely STOPed
clean run if I'd followed the gate verbatim.

Math: matmul (1 entry × 10 effective combos × 3 sizes = 30) + interop_calls (3 × 10 × 3
= 90) + 2 hashmap workloads (3 × 5 × 3 = 45 each) = 210 per env × 3 envs = 630. Plan's
810 not derivable из enumerateBinaries logic with js-size filter applied.

**Root cause.** Hand-count error — forgot to apply
`if (c.language === "js" && c.profile !== "speed") continue;` filter in run-matrix.ts
when computing expected counts. Plan-writer mental model didn't include the filter.

**Prevention.** Plans referencing case counts должны derive из `enumerateBinaries`
via runnable snippet OR via `scripts/lib/matrix.ts` helper — not hand-counted. Captured
in bulk tech-debt for /tech-debt-review.

### Plan exit-criteria referenced gitignored baseline

**What happened.** Plan Task 13 sanity-diff vs `results/raw/2026-05-23T01-51-06Z/`
(Phase 1.1.2 Node baseline) — that path was not on this machine. Plan Task 14
`git add results/raw/2026-XX-XX-phase-1-1-2-1/` would have silently no-op'd because
`results/` is in `.gitignore`. Both Task 13 + Task 14 inconsistent with repo convention.

Skipped Task 13 entirely (primary success signal was 0 failures on bench:all);
adjusted Task 14 to rename only без commit (per `results/` gitignore convention).

**Root cause.** Plan author assumed prior session results would carry forward,
не verified против `.gitignore`. Repo convention: `results/` gitignored — paths
cited в guidelines.md как evidence references без committing JSON.

**Prevention.** CLAUDE.md "Spec & plan conventions > Committed scripts/docs —
ephemeral-path audit" — already covers script imports. Extended 2026-05-27 to also
cover spec/plan exit-criteria + gate steps. Plan-writers должны
`git check-ignore <path>` для any referenced path before writing.

## Process

### Methodology change → re-baseline tentative cross-runtime claims

**What happened.** Phase 1.1.1 measured cpp-emscripten interop_calls noop M firefox
= 11 ms (5.7× rust-raw 1.94 ms) и captured в `docs/tech_debt/firefox-emscripten-noop-5x-slowdown.md`
как open investigation. Phase 1.1.2.1 measured same combo = 1.96 ms — same as
wasi-sdk and rust-raw, **5× artifact eliminated.**

Methodology change between phases: Phase 1.1.1 used per-case driver spawn (new
chromedriver/geckodriver process per case, ~85-case session limit before crash);
Phase 1.1.2.1 uses one long-lived WebDriver session per env с navigation между
cases. Likely systematic contamination в Phase 1.1.1 для emscripten × firefox path
related to fresh-launch SpiderMonkey state interacting с emscripten glue startup.

**Root cause.** Tentative cross-runtime claims taken at face value across methodology
generations. Status `tentative` implies "subject to invalidation when methodology
shifts" but not explicit policy.

**Prevention.** Captured в bulk tech-debt — observation note для cross-phase
discipline; not a single fix.

## Patterns validated

### Entry-point guard для CLI modules

`driver.ts` имеет CLI entry (`tsx apps/runner-web/src/driver.ts ...`) AND теперь
exports module API. После Task 2 (define types + stub) running vitest на тестах
которые `import` из `driver.js` триггерил module-load → `main()` execute → CLI
args missing → `exit(1)`. Test files passed на 3 ✓ но process exit 1.

Fix: guard at module bottom:
```ts
const __filename = fileURLToPath(import.meta.url);
if (argv[1] === __filename) {
    main().catch((e: unknown) => { console.error(e); exit(1); });
}
```

Pattern transferable: любой TS file служащий и module exports и CLI entry должен
иметь такой guard. Standard ESM idiom.

### Cross-runtime patterns могут invert

Hashmap u64/string toolchain choice claim ранее formulated under "V8" assumption
(Phase 1.1.2 measured only Node). Phase 1.1.2.1 cross-runtime: Chromium confirmed
V8 pattern, **Firefox inverts pattern at M size** (JS wins u64; Rust/CPP win string).
Single-runtime claims могут быть completely wrong на другом engine.

Pattern transferable: при writing claims в guidelines.md — если single-runtime data
и cross-runtime evidence pending, prefer tentative status. Confirmed only when ≥2
runtimes show same pattern.

## How to apply lessons

- **Plan-writing:** см. CLAUDE.md updates (pre-flight gate build step, plan
  exit-criteria gitignore audit) and bulk tech-debt items 1 & 3 для /tech-debt-review
  cadence (lint pre-pass, case-count derivation).
- **Guidelines authoring:** prefer tentative для single-runtime claims; promote to
  confirmed only после cross-runtime evidence; consider methodology stability как
  prerequisite для confirmed promotion.
- **CLI/module dual files:** add entry-point guard pattern.
