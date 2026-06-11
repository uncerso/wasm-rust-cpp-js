# Phase 1.1.2.1 — bench-infra hardening — execution design

**Status:** ready for implementation plan
**Refines:** [`2026-05-20-phase-1-1-design.md`](2026-05-20-phase-1-1-design.md) (out-of-scope sub-phase, inserted between 1.1.2 close and 1.1.3 brainstorm)
**Predecessor:** Phase 1.1.2 closed 2026-05-23 (merge `6b8073d`), V8 deopt root-cause investigation closed 2026-05-26 (commit `2e385e9`)
**Successor:** Phase 1.1.3 (shape_dispatch + Phase 1.1 close)

## Purpose

Сделать `pnpm bench:all` детерминированно reliable для full Phase 1.1.x matrix
(270 cases × 3 envs = 810 cases), устранив cumulative chromedriver/geckodriver
session-spawn root cause. Pole-vault на Phase 1.1.3 evidence collection: без
надёжного browser pipeline reporter cross-workload page и guidelines harvest
будут опираться на Node-only данные.

Вторичная цель — дозаполнить evidence-base browser data для Phase 1.1.2
(hashmap'а), который не был captured из-за упавшего bench:all (chromium crash
mid-run, firefox не выполнен). Existing guideline "rust/bindgen для u64;
JS Map для string" пока Node-only-confirmed — после re-bench становится
cross-runtime либо split с browser-caveats.

## Scope

**In scope:**

- Refactor `apps/runner-web/src/driver.ts` из per-case CLI subprocess в exported
  module (`createDriverSession(env) → DriverSession`) + thin CLI wrapper для
  existing manual debug workflow.
- Refactor `scripts/run-matrix.ts` browser loop: one long-lived `DriverSession`
  per env (chromium + firefox симметрично), navigation между cases через full
  page reload (`driver.get(newUrl)`).
- Unified error recovery в `run-matrix.ts`: retry-once-with-relaunch на любой
  case error (per-case error и session-level crash трактуются единообразно),
  soft-fail после 2й failed попытки, abort env после 3 consecutive failures.
- Optional `--restart-every=N` knob (default 0 = never) как hedge на случай
  cumulative V8 state drift в late-run measurements.
- Smoke extension: `pnpm smoke` после refactor покрывает matmul × все combos ×
  S size × **все 3 envs** (node + chromium + firefox). Симметрия node ↔ browser.
- Full Phase 1.1.x re-bench (matmul + interop_calls + hashmap_string + hashmap_int)
  во всех 3 envs — consistent fresh dataset.
- Guidelines refinement: existing Node-only confirmed claim → cross-runtime
  confirmed либо split с browser-caveats. Existing tentative claim про bindgen
  overhead — escalate to confirmed если cross-runtime persists.
- Resolve tech-debt `chromedriver-session-retry.md`; remove roadmap entry
  `browser-driver-lifecycle-refactor`.

**Out of scope:**

- Parallel chromium + firefox envs concurrent execution (sequential остаётся —
  parallel создаст CPU load → timing bias). Future Phase 1.2 optimization.
- Resume-from-checkpoint CLI flag (`--resume=results/raw/<run>`) для recovery
  между orchestrator restarts. Текущая recovery scope — внутри одного run'а
  через retry-on-error. Cross-run recovery defer'ится до выявления потребности.
- Schema changes. `BenchResultSchema` остаётся unchanged. Failed cases —
  отсутствующие result files + summary `<run>/failures.txt` (plain text, не
  parsed downstream).
- Driver-side optimisations не связанные с lifecycle (per-page timing precision,
  Selenium API replacement через CDP, WebDriver BiDi migration). Эти — roadmap
  Phase 2+.
- Phase 1.1.3 workload (shape_dispatch). Отдельный brainstorm + spec после
  closing 1.1.2.1.

**Rejected explicitly (not roadmap):**

- Long-lived driver subprocess с line-delimited JSON protocol на stdin/stdout
  (alternative architecture). Rejected per session decision 2026-05-26:
  in-process module проще, IPC layer не нужен, error handling прямой.
- Tactical "retry-on-session-loss" без architectural lifecycle refactor.
  Rejected per investigation 2026-05-26 — patch symptom, не root cause.

## Architecture

### Driver module API

`apps/runner-web/src/driver.ts` экспортирует:

```ts
export interface CaseInput {
    benchmark: string;
    entry: string;
    language: Language;
    toolchain: Toolchain;
    profile: Profile;
    size: InputSize;
    mode: "quick" | "eval";
}

export interface CaseResult {
    result: BenchResult;    // schema-validated, ready to write
    fileName: string;       // canonical filename per existing convention
}

export interface DriverSession {
    runCase(input: CaseInput): Promise<CaseResult>;
    quit(): Promise<void>;
}

export async function createDriverSession(
    env: "chromium" | "firefox",
    options: { port?: number; baseUrl?: string },
): Promise<DriverSession>;
```

Внутри `createDriverSession`:
- Текущий `launchBrowser(env)` reused.
- WebDriver instance stored в closure; `runCase` reuses его без relaunch.

Внутри `runCase`:
- Spec file read (`dist/<benchmark>/spec.json`) per call. Spec файлы маленькие,
  caching premature.
- workerInput build, URL encode, `driver.get(url)`.
- Poll `__BENCH_RESULT` через `driver.wait(...)` с 5min timeout (existing).
- Parse `BenchResultSchema`, patch machine fields, return `CaseResult`.
- Errors throw (caller responsibility — retry/log).

Внутри `quit`:
- `await driver.quit()` обёрнут в `Promise.race([quit, timeout(5000)])` чтобы
  hang не блокировал caller recovery.

**CLI wrapper** (existing manual debug):

```ts
// Bottom of driver.ts — preserved для two-terminal flow:
//   pnpm exec tsx apps/runner-web/src/driver.ts --benchmark=... --browser=chromium
async function cliMain() {
    const args = parseCli(argv.slice(2));
    const session = await createDriverSession(args.browser, { port: args.port });
    try {
        const { result, fileName } = await session.runCase({ ...args });
        const outPath = resolve(REPO_ROOT, args.outDir, fileName);
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, JSON.stringify(result, null, 2));
        console.log(`wrote ${outPath}`);
    } finally {
        await session.quit();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    cliMain().catch((e) => { console.error(e); exit(1); });
}
```

### Run-matrix browser loop

`scripts/run-matrix.ts` существующий per-case `await run("tsx", ...)`
заменяется per-env long-lived loop:

```ts
import { createDriverSession, type CaseInput } from "../apps/runner-web/src/driver.js";

// Within main(), after server is up:
for (const env of browserEnvs) {
    const casesForEnv = collectBrowserCases(specs, env, args);  // existing enumeration
    const sessionRef = { current: await createDriverSession(env, { port: 5174 }) };
    let consecutiveFailures = 0;
    const failures: Array<{ caseId: string; error: string }> = [];

    for (let i = 0; i < casesForEnv.length; i++) {
        if (args.restartEvery > 0 && i > 0 && i % args.restartEvery === 0) {
            await sessionRef.current.quit().catch(() => {});
            sessionRef.current = await createDriverSession(env, { port: 5174 });
        }
        const result = await runCaseWithRetry(env, sessionRef, casesForEnv[i], failures);
        if (result === null) {
            consecutiveFailures++;
            if (consecutiveFailures >= 3) {
                console.error(`[abort] env=${env}: 3 consecutive failures, skipping ${casesForEnv.length - i - 1} remaining cases`);
                break;
            }
        } else {
            consecutiveFailures = 0;
            const outPath = resolve(args.out, result.fileName);
            await writeFile(outPath, JSON.stringify(result.result, null, 2));
        }
    }

    await sessionRef.current.quit().catch(() => {});
    accumulateFailures.push(...failures.map(f => ({ env, ...f })));
}

// After all envs done — emit summary:
if (accumulateFailures.length > 0) {
    const summary = accumulateFailures.map(f => `[${f.env}] ${f.caseId}: ${f.error}`).join("\n");
    await writeFile(join(args.out, "failures.txt"), summary);
    console.error(`${accumulateFailures.length} case(s) failed; see ${args.out}/failures.txt`);
    process.exit(1);
}
```

Node env loop остаётся per-subprocess как сейчас — subprocess isolation не
вредит, Node не имеет cumulative session-spawn issue.

### runCaseWithRetry helper

```ts
async function runCaseWithRetry(
    env: "chromium" | "firefox",
    sessionRef: { current: DriverSession },
    caseInput: CaseInput,
    failures: Array<{ caseId: string; error: string }>,
): Promise<CaseResult | null> {
    const caseId = formatCaseId(caseInput);
    try {
        return await sessionRef.current.runCase(caseInput);
    } catch (e1) {
        const msg1 = (e1 as Error).message;
        console.error(`[retry] ${caseId}: 1st attempt failed: ${msg1}`);
        await sessionRef.current.quit().catch(() => {});
        sessionRef.current = await createDriverSession(env, { port: 5174 });
        try {
            return await sessionRef.current.runCase(caseInput);
        } catch (e2) {
            const msg2 = (e2 as Error).message;
            console.error(`[fail] ${caseId}: 2nd attempt failed: ${msg2}`);
            failures.push({ caseId, error: msg2 });
            return null;
        }
    }
}
```

Unified path: per-case error и session-level crash трактуются одинаково.
Selenium-side distinguishing (NoSuchSessionError vs WebDriverError vs TimeoutError)
не делается — simpler code, identical outcome.

### --restart-every=N CLI knob

`parseArgs` в `run-matrix.ts` добавляет:

```ts
restartEvery: parseInt(get("restart-every", "0"), 10),
```

Default 0 = never restart (рассчитываем что long-lived session stable на 270
navigations). Если в W2 заметим late-run measurement drift — выставим, например,
`--restart-every=50`.

Knob документируется в README § Benchmark runs.

## Case state reset protocol

Between cases внутри одной session — `driver.get(newUrl)` с новым `?case=`
encoded JSON parameter. Это full page reload:
- Window context fresh (DOM, JS heap).
- Worker recreated (existing `worker.ts` создаётся per `new Worker(...)` call
  при init page'а).
- Wasm module fetched и instantiated заново.

**Browser-level state, persists across reloads:**
- V8 wasm code cache (chromium): compiled wasm для same URL может reused.
  Realistic — соответствует product use case "user reloads page".
- Module-level JS bundle cache (Vite preview serves with strong cache headers).
- Network DNS / TLS state.

Принимаем эти persistences как realistic. Phase 1.0 measurements использовали
fresh-browser-per-case, новый baseline — page-reload-per-case. Sanity diff в W2
покажет, если delta достаточно large для investigation.

## Error recovery semantics

| Scenario | Behaviour |
|---|---|
| Case throws (1st attempt) | Log "[retry]", quit + relaunch session, retry case |
| Case throws (2nd attempt после relaunch) | Log "[fail]", push to `failures[]`, return null, continue |
| 3 consecutive case failures in env | Log "[abort]", skip remaining cases в этом env, continue с next env |
| `createDriverSession` throws (initial) | Log "[env-skip]", skip всё в env, continue с next env |
| `createDriverSession` throws (mid-retry) | Treated как case failure (case marked failed, env continues) |
| `quit()` hangs > 5s | Timeout race — proceed without waiting; orphan browser process accepted |
| All envs complete | Если failures.length === 0 → exit 0; иначе write `failures.txt` + exit 1 |

Exit code semantics остаются совместимы с CI: 0 = clean, 1 = anything failed.

## Re-bench protocol (W2)

После W1 close (refactor + tests merged):

```bash
pnpm bench:all --envs=node,chromium,firefox --mode=eval --sizes=S,M,L
```

Это `pnpm setup-tools && pnpm build:all && pnpm exec tsx scripts/run-matrix.ts --envs=... --mode=eval && pnpm report`.

**Expected output:**
- 810 result files в `results/raw/<ISO>/`:
  - 270 per env × 3 envs.
  - 30 matmul + 90 interop_calls + 45 hashmap_string + 45 hashmap_int per env.
- `failures.txt` empty или explicitly-acknowledged transient failures (target: 0).
- Reporter HTML generates без errors.

**Validation:**
- File count matches expected per env (sanity check via `ls -1 | wc -l`).
- Diff с Phase 1.1.2 Node data: warm-median delta per case < 10% (sanity bound;
  если drift больше — investigation flag).

**Если bench:all fails mid-run:**
- Investigate root cause (not session-loss anymore — что-то новое).
- W2 не closed пока clean 810-case run.

**Если выявляется V8 state drift в late-run measurements:**
- Re-run с `--restart-every=50` (или подобранное число).
- Document в guidelines/spec, если drift pattern persistent.

Run результирующего set сохраняется как canonical: `results/raw/2026-XX-XX-phase-1-1-2-1/`
(human-renamed после auto-ISO имени для permanence).

## Guidelines harvest (W3)

### Existing claims под review

**Claim:** "Для u64-keyed hashmap'ов выбирай `rust/bindgen`; для string-keyed
выбирай `js Map`" (currently confirmed Node-only).

- Read browser data из W2 run для `hashmap_int_lookup` и `hashmap_string_lookup`
  warm-median per (toolchain × size × env).
- Pattern check: rust/bindgen consistently wins u64 cross-runtime?
  js/idiomatic consistently wins string cross-runtime?
- **Если да** → status remains `confirmed`, evidence section updates с
  "voiced cross-runtime (node + chromium + firefox); ≥2 sizes × ≥2 key types
  × ≥3 runtimes". Strongest signal так далеко.
- **Если diverges на browsers** → split в 2 claims (Node-only confirmed + browser
  caveat) или add `Caveats` paragraph с browser-divergent behavior.

**Claim:** "Для hot, sub-µs JS↔Wasm functions предпочитай `rust/raw extern "C"`
или `cpp/wasi-sdk` — `wasm-bindgen` добавляет ~10-40% per-call overhead"
(currently tentative, Phase 1.1.1).

- Phase 1.1.2 W3 harvest deferred подтверждение до hashmap_string (multi-arg
  signatures). В этой Phase 1.1.2.1 W3 — final harvest decision:
- Read W2 browser data для hashmap_string operations (raw bindgen via
  rust/bindgen vs alternative? — но wasi-sdk hashmap не существует в Phase 1.1.x).
- Likely: claim остаётся tentative до Phase 1.1.3 (shape_dispatch addы дополнительные
  multi-arg JS↔Wasm signatures).
- Если pattern из interop_calls persists во всех 3 envs → escalate to `confirmed`
  с caveat "single workload class".

### firefox-emscripten 5x slowdown tech-debt

`docs/tech_debt/firefox-emscripten-noop-5x-slowdown.md` (от Phase 1.1.1) —
re-check в new firefox data:
- Если persists для `interop_calls_noop` (firefox × emscripten) → escalate
  to guideline (toolchain choice category) с status `confirmed` (если cross-size
  и cross-workload — но это single-workload single-export, скорее всего
  останется tentative с firefox-specific caveat).
- Если sample-specific drift (W2 не воспроизводит) → close tech-debt as
  not-reproducible.

## Tech-debt + roadmap updates

| File | Action |
|---|---|
| `docs/tech_debt/chromedriver-session-retry.md` | Delete (per `resolved → delete` policy) после W2 successful bench:all |
| `docs/tech_debt/firefox-emscripten-noop-5x-slowdown.md` | W3 review: либо escalate to guideline + delete, либо annotate `status: not-reproducible` + delete, либо keep с updated evidence |
| `docs/roadmap.md` § Phase 1.2 > Browsers > `browser-driver-lifecycle-refactor` | Remove entry (completed forward via this sub-phase) |
| `docs/roadmap.md` § Phase 1.1 > Workloads > `shape-dispatch` | Не трогаем — entry удалится при graduate-to-spec на closing Phase 1.1.3 |

**1.1.3 sketch capture:** В этой sub-phase зафиксировать short note про direction
Phase 1.1.3 workload design (per user input 2026-05-26):
- Workload должен measure trade-off: monomorphization bundle-cost vs vtable
  runtime-cost.
- Function body должна быть substantial enough чтобы compiler не inline'ил полностью.
- Two binaries: static = homogeneous-per-type array (template/generic instantiated
  per shape type, 3 copies в bundle); dynamic = mixed array через virtual dispatch
  (single function + vtable).
- JS path asymmetric: monomorphization concept не applies; instead measure V8 IC
  state (monomorphic vs polymorphic vs megamorphic).
- Location: краткий paragraph в `docs/roadmap.md` § Phase 1.1 > Workloads >
  shape-dispatch entry или standalone session-state note.

## Wave structure

### Wave 1 — Refactor + recovery + tests

1. Refactor `apps/runner-web/src/driver.ts`:
   - Extract `createDriverSession`, `runCase`, `DriverSession` interface.
   - Preserve CLI wrapper as thin shim.
   - Add `quit()` timeout race.
2. Refactor `scripts/run-matrix.ts`:
   - Browser env loop: long-lived session per env.
   - `runCaseWithRetry` helper + failures collection.
   - Consecutive-failure abort logic (3 in a row → break env loop).
   - `--restart-every=N` CLI arg parse + apply.
   - End-of-run summary write `failures.txt` + exit code logic.
3. Update `apps/runner-node/src/main.ts` если есть — Node loop unchanged.
4. Tests:
   - Unit test `runCaseWithRetry`: mock DriverSession that succeeds / fails-then-succeeds /
     fails-twice / hangs in runCase. 5 cases minimum.
   - Unit test consecutive-failure abort: mock session always-fails, verify break
     after 3rd attempt.
   - Integration test (live chromium driver, opt-in via env var if needed):
     создать session, run 3 matmul S cases, verify all return correctly + clean
     quit, no temp dir leak.
5. README updates:
   - Document `--restart-every=N` knob.
   - Document new bench:all reliability characteristics.

**W1 exit gates:**
- `pnpm typecheck && pnpm lint:all && pnpm test` зелёные.
- `pnpm smoke` зелёный, **с расширенным scope** (matmul S × все combos × node + chromium + firefox).
  - Total smoke cases: 10 × 3 envs = 30.
  - Total smoke time: ~40-65s acceptable.
  - Если > 90s — investigation flag, не close W1.
- `git status` clean; W1 commit'ы merged в master.

### Wave 2 — Full Phase 1.1.x re-bench

6. `pnpm bench:all --envs=node,chromium,firefox --mode=eval --sizes=S,M,L`.
7. Validate output:
   - 810 result files в `results/raw/<ISO>/`.
   - `failures.txt` отсутствует или empty.
8. Sanity diff vs Phase 1.1.2 Node data:
   - Pick 5-10 representative cases.
   - Compute median delta per case (`(new - old) / old`).
   - If max delta < 10% → ok, измерения reproducible.
   - If max delta > 10% — investigation: что изменилось? (page-reload vs fresh-browser
     baseline shift? Toolchain version drift? System load?) — block W2 close до
     understanding.
9. Rename run dir: `results/raw/<ISO>` → `results/raw/2026-XX-XX-phase-1-1-2-1/` для permanence.
10. `pnpm report` → reporter HTML sanity check (renders без errors, все 10
    measurement IDs показаны).

**W2 exit gates:**
- 810/810 cases complete без soft-failures.
- Sanity diff < 10% (или explicitly documented drift с rationale).
- Reporter HTML rendered.
- W2 commit (canonical run + reporter output) merged в master.

### Wave 3 — Guidelines harvest + close

11. Guidelines update в `docs/guidelines.md`:
    - "rust/bindgen u64 / JS Map string" — refine to cross-runtime evidence либо
      split per Section 7 logic.
    - "wasm-bindgen overhead" — escalate если pattern persists, либо leave
      tentative с note про browser corroboration.
    - firefox-emscripten 5x — escalate или document как not-reproducible.
12. Tech-debt:
    - Delete `docs/tech_debt/chromedriver-session-retry.md`.
    - Resolve `docs/tech_debt/firefox-emscripten-noop-5x-slowdown.md` per
      Section 7 outcome (delete если escalated to guideline; delete если
      not-reproducible; keep с updated status иначе).
13. Roadmap:
    - Remove `docs/roadmap.md` § Phase 1.2 > Browsers > `browser-driver-lifecycle-refactor`.
14. Capture 1.1.3 sketch note (per Section 8 location).
15. Update `MEMORY.md` (`project_wasm_benchmarks.md`):
    - "Phase 1.1.2 closed; Phase 1.1.2.1 (bench-infra) closed; Phase 1.1.3
      (shape_dispatch) pending brainstorm".
16. Phase close: tag `phase-1-1-2-1`, merge `--no-ff`, session-state snapshot.

**W3 / Phase 1.1.2.1 exit criteria:**

- `pnpm bench:all` runs end-to-end без manual intervention на full matrix.
- 810 results canonical в `results/raw/2026-XX-XX-phase-1-1-2-1/`.
- `runCaseWithRetry` + consecutive-abort coverage tests passing.
- `chromedriver-session-retry.md` deleted; `browser-driver-lifecycle-refactor`
  roadmap entry removed.
- `docs/guidelines.md` имеет ≥1 claim refined to `confirmed cross-runtime`
  (или explicitly split с browser-caveats).
- 1.1.3 sketch note captured.
- Master gates green.
- Tag `phase-1-1-2-1` поставлен.

## Open risks / known unknowns

- **Long-lived session V8 state drift.** Single browser process на 270 navigations —
  V8 wasm code cache, IC state, GC pressure аккумулируются. Phase 1.0 measurements
  использовали fresh browser per case (clean baseline). Sanity diff в W2 покажет
  delta; mitigation knob `--restart-every=N` уже built-in.
- **Geckodriver session-loss not verified.** Investigation 2026-05-26 quantified
  chromedriver issue (~85 session crash threshold); firefox/geckodriver не
  верифицирован, но архитектурно presumed similar. Если в W2 firefox crashes
  до завершения 270 cases — root cause investigation (может быть другая) +
  refine recovery.
- **Page reload timing artifacts.** `driver.get(url)` имеет ~100-500ms overhead
  per case (page parse + bundle load + worker init). Это inflate'ит wall-clock
  bench:all time, но не measurement per-case (sample timing inside runCase
  unchanged). Acceptable.
- **CLI wrapper duplication.** `cliMain` в driver.ts повторяет orchestrator
  logic (read spec, build URL, write file). Risk: divergence между CLI и
  orchestrator path. Mitigation: shared helper functions если duplication > 30 LoC.
- **Integration test reliability.** Live-chromium integration test может flake
  в CI environments без display server. Mitigation: gate via env var
  `BENCH_INTEGRATION_TEST=1` (skip by default), document в README.
- **Re-bench measurement drift discovery.** Если W2 sanity diff > 10% — block
  W2 close. Может потребовать extension W2 (investigation budget). Acceptable
  trade-off; не блокирует 1.1.2.1 architecturally.
- **failures.txt format underspecified.** Just plain text, one line per failure
  ("[env] caseId: errorMessage"). No parsing downstream. Если позже нужно
  programmatic access — promote to JSON; не сейчас.

## References

- Umbrella Phase 1.1 spec: [`2026-05-20-phase-1-1-design.md`](2026-05-20-phase-1-1-design.md)
- Tech-debt origin: [`../../tech_debt/chromedriver-session-retry.md`](../../tech_debt/chromedriver-session-retry.md)
- Roadmap entry: [`../../roadmap.md § Phase 1.2 > Browsers`](../../roadmap.md)
- V8 deopt investigation (predecessor session): [`../session-states/session-state-2026-05-26-v8-deopt-rootcause.md`](../session-states/session-state-2026-05-26-v8-deopt-rootcause.md)
- Pitfall §Tooling (smoke-at-S insufficient): [`../../pitfalls/2026-05-23-phase-1-1-2-execution.md`](../../pitfalls/2026-05-23-phase-1-1-2-execution.md)
- Guidelines (under review): [`../../guidelines.md`](../../guidelines.md)
- Current driver.ts: `apps/runner-web/src/driver.ts`
- Current run-matrix.ts: `scripts/run-matrix.ts`
