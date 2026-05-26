# Session state — 2026-05-26 (Phase 1.1.2.1 designed)

Brainstorm session. Производил два commit'а: spec `a5586b6` + plan `bb6527d` для
**Phase 1.1.2.1 — bench-infra hardening** (separate sub-phase, вставленный между
Phase 1.1.2 close и Phase 1.1.3 brainstorm). Execution не делалась — mid-task
interrupt по соглашению с user'ом перед transition к implementation.

---

## TL;DR — где мы сейчас

- Branch: **`master`** (working tree includes pre-existing untracked files
  от prior sessions — `.claude/settings.local.json`, V8 deopt pitfall + session-state,
  random `Какие есть...` file; никакие из них не от текущей сессии).
- Master HEAD: **`bb6527d`** (plan commit). Не push'нуто к origin.
- 1.1.2.1 spec + plan committed. Implementation pending.
- 1.1.3 sketch direction зафиксирована в 1.1.2.1 spec §8 + roadmap update запланирован
  в W3 Task 19 plan'а.
- Gates green на master: typecheck + lint:all + test + smoke.

---

## Done in this session

### Phase 1.1.2.1 brainstorm + spec (commit `a5586b6`)

User redirected с initial "распланируем Phase 1.1.3" на **bench-infra hardening как
отдельный sub-phase** перед 1.1.3 — потому что `pnpm bench:all` падает на ~85 cumulative
chromium sessions (Phase 1.1.2 evidence) и блокирует надёжный evidence-base для 1.1.3.

Major design decisions, зафиксированные в spec'е через AskUserQuestion approval'ы:

1. **Phase scope:** один sub-phase = workload + close (5 waves внутри), не split. Для 1.1.2.1
   же — отдельный merge separate от 1.1.3 (per user: "лучше не 1.1.2.5 — 1.1.2.1, странно
   выглядит после .6").
2. **Driver lifecycle:** in-process module (не subprocess + JSON protocol). Один
   `DriverSession` per env, navigation через `driver.get(newUrl)` page reload.
3. **Session granularity:** one session per env (~270 cases / 540 total browser cases vs
   current 540 sessions / ~85-case crash threshold). Хедж — `--restart-every=N` knob (default 0).
4. **Error recovery:** unified retry-once-with-relaunch для per-case errors AND session crashes
   (Selenium distinction unreliable). Soft-fail после 2й попытки; abort env после 3 consecutive
   failures. ~170 LoC всего.
5. **Re-bench scope:** full Phase 1.1.x во всех 3 envs (consistent fresh dataset).
6. **Smoke extension:** matmul × все combos × все 3 envs (10 combos × 3 envs = 30 cases),
   symmetry node ↔ browser. Total smoke ≤90s.

Spec: `docs/superpowers/specs/2026-05-26-phase-1-1-2-1-bench-infra-design.md` — 11 секций,
499 строк (Purpose, Scope, Architecture, Case state reset, Error recovery, Re-bench protocol,
Guidelines harvest, Tech-debt + roadmap updates, Wave structure, Exit criteria, Open risks).

### Phase 1.1.2.1 plan (commit `bb6527d`)

20 tasks across 3 waves через writing-plans skill:

- **W1 (Tasks 1-10):** vitest infra setup → DriverSession types stub → real
  `createDriverSession`/`runCase`/`quit` → `quitWithTimeout` test → `runCaseWithRetry`
  + 4 unit tests → `--benchmarks=<csv>` filter → run-matrix long-lived session loop +
  `--restart-every=N` knob + retry integration → smoke extension → README → merge.
- **W2 (Tasks 11-15):** tmp dir cleanup → `pnpm bench:all` (40-60min) → 810-case validation
  + per-env sanity check → diff vs Phase 1.1.2 Node baseline (±10% threshold) → canonical
  rename + commit + reporter check.
- **W3 (Tasks 16-20):** refine "rust/bindgen u64 / JS Map string" claim к cross-runtime
  evidence → wasm-bindgen overhead claim + firefox-emscripten review → retire
  `chromedriver-session-retry` tech-debt + roadmap entry → 1.1.3 sketch capture в roadmap →
  phase tag + session-state + MEMORY.md update.

Plan: `docs/superpowers/plans/2026-05-26-phase-1-1-2-1-bench-infra.md` — 1560 строк,
exact code blocks + commands + commit messages per task per skill's "no placeholders" rule.

### Phase 1.1.3 sketch (captured в 1.1.2.1 spec §8)

User в брeinсторминге дал ключевое уточнение про static-vs-dynamic semantics — он хочет
measure trade-off:
- **Bundle size cost от monomorphization** (template/generic instantiated per concrete shape
  type, 3 копии function body в bundle).
- **Runtime cost от vtable indirection** (single function + virtual call per shape).

Workload requirements:
- Substantial method body (10-20 FP ops или несколько method calls per shape) чтобы
  compiler не inline'ил полностью.
- Two binaries: **static** = homogeneous-per-type arrays × generic processor (3 monomorphizations);
  **dynamic** = mixed array × single virtual processor (compact bundle, vtable per call).
- JS path **asymmetric** — нет monomorphization concept; instead measures V8 IC state
  (monomorphic vs polymorphic vs megamorphic).

Эта direction зафиксирована в 1.1.2.1 spec §8 для capture в roadmap during W3 Task 19.
Phase 1.1.3 polnyy brainstorm — отдельная session после 1.1.2.1 close.

### /finish-session pass (this turn)

**Memory drift fixes applied:**

- `~/.claude/projects/.../memory/project_wasm_benchmarks.md` — frontmatter `name:` +
  `description:` updated с Phase 1.1.2.1 context; new section "## Phase 1.1.2.1 — SPEC
  + PLAN COMMITTED" inserted; "Phase 1.1 — IN PROGRESS" section updated; "Sequencing
  для next session" section rewritten (execute 1.1.2.1 plan → 1.1.3 brainstorm).
- `~/.claude/projects/.../memory/MEMORY.md` index line updated.

CLAUDE.md / README.md / guidelines.md — no drift (brainstorm-only session, не trogalo
runtime artifacts).

Pitfall collection — skipped silently. Friction signals (static/dynamic framing redirect
+ quantified architecture comparison request) — AI-behavior lessons, не fit project's
`docs/pitfalls/` scope per skill exclusion.

---

## Deferred items

- **Implementation of 1.1.2.1 plan** — 20 tasks, execution waiting на user'а решения по
  execution strategy (subagent-driven recommended per writing-plans skill handoff).
- **Pre-existing untracked CLAUDE.md/README.md modifications** + V8 deopt pitfall +
  session-state file + random `Какие есть...` file — pre-existing, не текущая сессия.
  Не trogano per skill scope.
- **Phase 1.1.3 brainstorm** — отдельная session, после 1.1.2.1 close. Sketch уже
  захвачен (location в spec §8, finalize в roadmap entry per 1.1.2.1 W3 Task 19).

---

## What the next session needs to know

### Чтобы execute Phase 1.1.2.1 plan

1. **Прочитать в порядке:**
   - `CLAUDE.md` (auto-loaded). Sandbox + commit conventions всё ещё актуальны.
   - `docs/superpowers/specs/2026-05-26-phase-1-1-2-1-bench-infra-design.md` — design context.
   - `docs/superpowers/plans/2026-05-26-phase-1-1-2-1-bench-infra.md` — 20 tasks с exact
     code/commands. Включает self-review checklist в конце.

2. **Pre-flight gates (Plan W0 Task 0):**

   ```bash
   git checkout master
   pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke
   git checkout -b feature/phase-1-1-2-1-bench-infra
   ```

3. **Execution strategy choice:**
   - **Subagent-driven (recommended per plan handoff)** — fresh subagent per task,
     review между tasks. Best для TDD-style tasks с независимыми units.
   - **Inline executing-plans** — batch с checkpoints, single context. Useful если
     нужен sustained cross-task context.

4. **W1 caveats:**
   - Task 7 (run-matrix.ts refactor) — самый крупный таск (~250 LoC). Cross-workspace
     import от `scripts/` к `apps/runner-web/src/` может потребовать `tsconfig.json` root
     include update. Plan указывает fallback (re-export через `scripts/lib/driver-types.ts`)
     если basic include не сработает.
   - Task 8 (smoke extension) — total time budget ≤90s. Если выходит — investigation
     flag в commit message, не silently bury.

5. **W2 caveats:**
   - `pnpm bench:all` берёт 40-60 минут. Plan: `pnpm bench:all 2>&1 | tee /tmp/...`
     для capturing log.
   - Sanity-diff threshold ±10% vs Phase 1.1.2 Node baseline (`results/raw/2026-05-23T01-51-06Z/`).
     Если drift > 10% → STOP, investigate перед W2 close.

### Чтобы brainstorm Phase 1.1.3 (после 1.1.2.1 close)

- Read 1.1.2.1 spec §8 для design direction sketch.
- Read roadmap entry shape-dispatch (updated в 1.1.2.1 W3 Task 19).
- Workload design key facts:
  - Trade-off measurement: monomorphization bundle vs vtable runtime.
  - Substantial method body required (не inlinable).
  - Static = homogeneous arrays × 3 monomorphizations; dynamic = mixed array × virtual.
  - JS asymmetric (V8 IC behavior, не monomorphization).
- Phase 1.1.3 = W1-W3 workload + W4 reporter v2 final + W5 guidelines harvest + Phase 1.1 close.

### Решения, зафиксированные (не передоговариваться)

| Решение | Где зафиксировано |
|---|---|
| Sub-phase numbering "1.1.2.1" (не "1.1.2.5") | spec header, plan filename |
| In-process driver module (не subprocess + JSON protocol) | spec §2 Architecture |
| One session per env (не per workload, не per binary) | spec §2 Architecture + brainstorm Q&A |
| Unified retry path (per-case + session-crash единое) | spec §4 Error recovery |
| `--restart-every=N` knob (default 0) как hedge | spec §3 + plan Task 7 |
| `--benchmarks=<csv>` filter (для smoke + ad-hoc) | spec §9 W1 + plan Task 6 |
| Full Phase 1.1.x re-bench (не targeted) | spec §6 + user choice "Full" |
| Smoke = node-all + matmul × всех envs | spec §9 W1 + plan Task 8 |
| Failed cases = missing files + `failures.txt` summary (не schema change) | spec §4 + plan Task 7 |
| Phase 1.1.3 — отдельный brainstorm session | this session user choice |

---

## Workflow notes

- `--no-gpg-sign` на коммитах per repo директива.
- Sandbox: для tsx subprocess (smoke, build:all, bench:all, etc.) — `dangerouslyDisableSandbox: true`.
- Git stash под sandbox restrictions ненадёжен — prefer `git diff <commit>` / `git show <commit>:<file>`.
- Pipe exit codes для gate chains — use `set -o pipefail` или капчуйте `${PIPESTATUS[0]}`,
  не полагайтесь на `cmd 2>&1 | tail`.

---

## Полезные команды

```bash
# Базовый ориентир
git rev-parse HEAD                                           # should be bb6527d or descendant
git branch --show-current                                    # master
git log --oneline -5                                          # recent commits

# Phase 1.1.2.1 docs
cat docs/superpowers/specs/2026-05-26-phase-1-1-2-1-bench-infra-design.md
cat docs/superpowers/plans/2026-05-26-phase-1-1-2-1-bench-infra.md

# Pre-flight (per plan W0 Task 0)
pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke

# Start execution
git checkout -b feature/phase-1-1-2-1-bench-infra
# затем Task 1: add vitest infra к apps/runner-web

# Leaked tmp dirs (housekeeping; plan W2 Task 11)
ls -d $TMPDIR/org.chromium.Chromium.scoped_dir.* 2>/dev/null | wc -l
du -shc $TMPDIR/org.chromium.Chromium.scoped_dir.* 2>/dev/null
# rm -rf $TMPDIR/org.chromium.Chromium.scoped_dir.* $TMPDIR/com.google.chrome.for.testing.*
```

---

## Stop point

- Phase 1.1.2.1 — **designed** (spec + plan committed, implementation pending).
- Phase 1.1.3 — **sketch captured** (1.1.2.1 spec §8), brainstorm pending after 1.1.2.1 close.
- V8 deopt investigation — closed earlier (2026-05-26 morning session, commit `2e385e9`).
- Memory drift — fixed.

В следующей сессии: либо execute 1.1.2.1 plan (subagent-driven), либо если нужна
поспешная brainstorm 1.1.3 — после 1.1.2.1 close.
