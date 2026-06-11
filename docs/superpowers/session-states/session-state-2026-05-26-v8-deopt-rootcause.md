# Session state — 2026-05-26 (V8 deopt root-cause + chromedriver triage)

Investigation session. Closed two open debug items deferred из Phase 1.1.2:
V8 12.4 deopt-eager bug (root-cause confirmed at bytecode level) и chromedriver
session-loss (deferred to architectural roadmap entry). Session work committed
under `2e385e9 v8-deopt-bug-reproduce`. Then /finish-session pass добавил
CLAUDE.md/README.md drift fixes + pitfall capture.

---

## TL;DR — где мы сейчас

- Branch: **`master`** (clean working tree).
- Master HEAD: **`2e385e9`** (session work commit). Pushed to `origin/master`.
- Bug branch `feature/phase-1.1.2-bug` — **preserved** (per user директива; на случай
  upstream V8/Node report).
- Gates green: `pnpm typecheck && pnpm lint:all && pnpm test`.
- Phase 1.1.2 closed earlier; Phase 1.1.3 (shape_dispatch) — следующий по плану.

---

## Done in this session

### V8 deopt root-cause investigation (A + B + D из ранее одобренных опций)

**Reproduction confirmed** на Node 22.22.3 / V8 12.4 (детерминированно через harness path,
restoring buggy source via `git checkout 0cc508b~1 -- benches/hashmap_*/js/idiomatic/src/index.ts`).

**Node version matrix verified:**

| Node | V8 | hashmap_int_lookup eval/S |
|---|---|---|
| 20.19.5 | 11.3.244.8 | ✓ clean |
| **22.22.3** | **12.4.254.21** | **❌ throws** |
| 24.14.1 | 13.6.233.17 | ✓ clean |

Bug **строго V8 12.4-only** — upstream исправлено между minor releases. Workaround
`0cc508b` (factory-time dispatch) остаётся **permanent**: Node 22 — current LTS до 2027-04,
и pattern-class общий (любой closure-const switch с default-branch template-literal в hot
loop потенциально fragile к аналогичным JIT codegen bugs).

**Bytecode-level root cause confirmed** (через `--trace-opt --trace-deopt --print-bytecode`):

- V8 turbofan компилирует `run` ("hot and stable").
- Default branch содержит template literal `` `unknown entry "${entry}"` `` —
  `Add` instruction (bytecode offset 427) для string concat имеет пустой feedback IC
  slot [67] (default never executed).
- Turbofan ставит deopt-eager guard для пустого feedback, но **deopt continuation
  point miscomputed** — interpreter резюмит выполнение с offset 427 (default-branch
  `Add → Construct Error → Throw`) вместо корректного location в lookup-branch.
- Trace exact: `[bailout deopt-eager, reason: Insufficient type feedback for binary operation, bytecode offset 427]`.

**Heisenbug attribution — два trigger'а одновременно требуются:**

1. **tsx CLI invocation** (preflight.cjs в child node bootstrap). Bare `node script.mjs`
   без preflight — clean. Identified via diff'ing `pnpm exec tsx ...` vs `node --import tsx ...`.
2. **Full harness "competing work" volume.** Verified via 5 итераций attempts at minimal
   isolated repro (inline factory / data: URL / sibling static import / sibling dynamic
   import + performance.now() / real `@bench/harness runMeasure` + Zod schema parse) —
   все под `pnpm exec tsx` с preflight, но bug **не triggers** в isolated context.
   V8 успевает feedback gather до tier-up в minimal mix.

**Docs landed:**

- `docs/superpowers/bug-reports/2026-05-23-v8-deopt-switch-over-closure-const.md` (NEW)
  — full bug-report с bytecode trace, Heisenbug matrix, Node version matrix, workaround
  rationale, potential upstream report scope.
- `docs/superpowers/bug-reports/2026-05-23-v8-deopt-repro/README.md` (NEW) — canonical
  reproduction workflow: `git checkout feature/phase-1.1.2-bug` + harness invocation.
  Prerequisite note про clean working tree (branch conflicts с untracked docs files).
  V8 tracing flags для investigation. Что подтверждено / Что не self-contained.
- `docs/guidelines.md` § Code patterns > "Избегай `switch (entry)` over closure-constant…"
  — status confirmed (was tentative-mechanism), mechanism rewritten как confirmed
  bytecode-level analysis, Caveats обновлены с Node version matrix + dual-trigger
  Heisenbug + permanent-workaround rationale.

**C (upstream V8/Node report)** — НЕ сделан. Bug fixed в V8 13.x; upstream contribution
=== research-driven bug archive value, не product-blocking. На усмотрение user'а в будущем.

### Chromedriver session-loss triage (architectural defer)

**Investigation findings (smoking gun):** `$TMPDIR/org.chromium.Chromium.scoped_dir.*` —
**365 leaked dirs ~3.1 GB**. Это chrome user-data-dirs от сессий, где `driver.quit()`
упал и был silently проглочен `.catch(() => { /* best effort */ })` в
`apps/runner-web/src/driver.ts:177`. Это не *причина* первого crash'а, но *симптом*:
что-то регулярно ломается до или во время cleanup'а на длинных runs.

**Architecture diagnosis:** `scripts/run-matrix.ts` спавнит fresh `tsx driver.ts`
subprocess per case → fresh chromedriver + chrome session + temp user-data-dir per
invocation. Кумулятивно ~80-100+ chromium sessions на full bench:all run. Live root
cause первого SessionNotCreatedError не верифицирован (требует длинного repro session) —
кандидаты: cumulative system-level state, chromedriver port pool, memory pressure.

**Decision (user-directed):** **No tactical fix** (retry / cleanup / explicit
user-data-dir пропустили). Defer к architectural refactor.

**Docs landed:**

- `docs/roadmap.md` § Phase 1.2 > Browsers — new entry `browser-driver-lifecycle-refactor`:
  single long-lived driver per browser env (chrome+firefox), parallel envs, навигация
  по URL вместо driver-per-case spawn.
- `docs/tech_debt/chromedriver-session-retry.md` — переписан как `status: deferred-to-roadmap`,
  investigation findings preserved (365 dirs / 3.1 GB / architecture diagnosis / candidates
  для root cause), no tactical fix, refactor scope с pros/cons trade-offs для будущего
  design phase.

### /finish-session pass (this turn)

**Audit findings applied:**

- `CLAUDE.md` § "Project overview" "Каноничные источники контекста" — добавлен bullet
  про `docs/superpowers/bug-reports/` (новая top-level docs subdir этой сессии).
- `README.md` § "Структура репозитория" — `docs/superpowers/` tree получил bullet про
  `bug-reports/`.

**Pitfall captured:**

- `docs/pitfalls/2026-05-26-v8-deopt-investigation.md` — § Process > "Ephemeral-path
  references in committed scripts/docs". Inline применён к
  `CLAUDE.md` § "Spec & plan conventions" > "Committed scripts/docs — ephemeral-path audit"
  (sanity rule: `git check-ignore <path>` per referenced path; red flags = `dist/`,
  `target/`, `.tools/`, `benches/*/fixtures/*.bin`).

---

## Deferred items

- **C — upstream V8/Node bug report.** Не приоритет (V8 13.x clean), на усмотрение
  user'а. Repro документирован полностью; bug branch preserved.
- **Self-contained .mjs repro.** 5 итераций не triggered bug — V8 tier-up timing требует
  full harness import graph. Canonical repro = branch checkout workflow в bug-reports README.
- **MEMORY.md staleness** (pre-existing, не текущая сессия). `project_wasm_benchmarks.md`
  описание "Phase 1.1.2 spec+plan ready to execute" — Phase 1.1.2 закрыт ранее. Не fix'или
  per /finish-session scope (audit drift только текущей сессии).

---

## What the next session needs to know

### Чтобы стартовать Phase 1.1.3 (shape_dispatch) или другую работу

1. **Прочитать в порядке:**
   - `CLAUDE.md` (auto-loaded). Updated в этой сессии: bug-reports/ как canonical source,
     ephemeral-path audit как sanity rule.
   - `README.md` (auto-loaded если нужен пользовательский context).
   - `docs/superpowers/specs/2026-05-20-phase-1-1-design.md` § Phase 1.1.3.
   - `docs/superpowers/session-states/session-state-2026-05-23-phase-1-1-2-closed.md` — handoff от
     закрытия Phase 1.1.2 (что сделано, decisions, conventions).

2. **Sanity check master gates:**

   ```bash
   git checkout master
   pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke
   ```

3. **Brainstorm + spec → plan для Phase 1.1.3.** Skill: `superpowers:brainstorming` →
   `superpowers:writing-plans`.

### Если возвращаться к V8 deopt bug

- Canonical repro: `docs/superpowers/bug-reports/2026-05-23-v8-deopt-repro/README.md` —
  8-step workflow через `git checkout feature/phase-1.1.2-bug`. Prerequisite: clean working
  tree.
- Если решишь upstream report — bug branch preserved; bytecode-level root cause solid;
  V8 12.4-only (исправлено в V8 13).

### Если возвращаться к chromedriver refactor

- Roadmap: `docs/roadmap.md` § Phase 1.2 > Browsers > `browser-driver-lifecycle-refactor`.
- Investigation evidence: `docs/tech_debt/chromedriver-session-retry.md` — 365 leaked
  dirs / architecture diagnosis / trade-offs для refactor design.
- Cleanup leftover dirs (housekeeping): `rm -rf $TMPDIR/org.chromium.Chromium.scoped_dir.* $TMPDIR/com.google.chrome.for.testing.*` — освободит ~3 GB.

### Решения, зафиксированные (не передоговариваться)

| Решение | Где зафиксировано |
|---|---|
| V8 12.4 workaround (factory-time dispatch) — permanent | guidelines.md § Code patterns + bug-report |
| Bug branch `feature/phase-1.1.2-bug` — preserved as repro source | bug-reports/README.md + this file |
| Upstream V8 report — discretionary, не блокирует | bug-report § Upstream report |
| Chromedriver — no tactical fix, await architectural refactor | tech_debt entry + roadmap entry |
| Bug-reports/ как canonical docs subdir | CLAUDE.md + README.md tree |
| Ephemeral-path audit как sanity rule | CLAUDE.md § Spec & plan conventions |

---

## Workflow notes

- `--no-gpg-sign` на коммитах per repo директива.
- `dangerouslyDisableSandbox: true` для всех tsx-launched commands (build:js, runner-node,
  fixtures, exec tsx) — Unix IPC socket blocked в sandbox.
- V8 tracing flags (`--trace-deopt`, `--trace-opt`, `--print-bytecode`) — нельзя через
  NODE_OPTIONS (Node security filter), use direct `node ...` invocation.
- `--jitless` — allowed через NODE_OPTIONS.

---

## Полезные команды

```bash
# Базовый ориентир
git rev-parse HEAD                                           # should be 2e385e9 or descendant
git branch --show-current                                    # master
git log --oneline -5                                          # recent commits

# Bug repro materials
ls docs/superpowers/bug-reports/                             # 1 file + 1 subdir
cat docs/superpowers/bug-reports/2026-05-23-v8-deopt-repro/README.md   # canonical repro

# V8 deopt repro (на master, restoring buggy):
git checkout 0cc508b~1 -- benches/hashmap_int/js/idiomatic/src/index.ts \
                          benches/hashmap_string/js/idiomatic/src/index.ts
pnpm exec tsx scripts/build-js.ts hashmap_int hashmap_string
pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=hashmap_int --entry=hashmap_int_lookup --language=js \
  --toolchain=idiomatic --profile=speed --size=S --out=/tmp/_debug --mode=eval
# Expect: Error: hashmap_int/js-idiomatic: unknown entry "hashmap_int_lookup"
# Restore master:
git checkout HEAD -- benches/hashmap_int/js/idiomatic/src/index.ts \
                     benches/hashmap_string/js/idiomatic/src/index.ts
pnpm exec tsx scripts/build-js.ts hashmap_int hashmap_string

# Chromedriver leaked dirs (housekeeping):
ls -d $TMPDIR/org.chromium.Chromium.scoped_dir.* | wc -l    # count
du -shc $TMPDIR/org.chromium.Chromium.scoped_dir.*           # total disk
# rm -rf $TMPDIR/org.chromium.Chromium.scoped_dir.* $TMPDIR/com.google.chrome.for.testing.*
```

---

## Stop point

- V8 deopt — investigation **closed** (root-cause confirmed, workaround permanent, bug
  branch preserved). C (upstream report) deferred to user discretion.
- Chromedriver — investigation **closed**, tactical fix **declined**, refactor **deferred**
  to roadmap entry.
- CLAUDE.md / README.md drift **fixed** (bug-reports/ subdir mentioned).
- Pitfall **captured** (ephemeral-path audit, inline-applied to CLAUDE.md).
- Phase 1.1.3 (shape_dispatch) — следующий шаг.

В следующей сессии: pre-flight gates → brainstorm Phase 1.1.3 → writing-plans.
