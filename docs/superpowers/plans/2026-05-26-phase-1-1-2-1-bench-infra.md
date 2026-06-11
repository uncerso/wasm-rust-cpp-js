# Phase 1.1.2.1 — bench-infra hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pnpm bench:all` deterministically reliable for full Phase 1.1.x matrix (810 cases) by replacing per-case browser subprocess spawn with one long-lived WebDriver session per env, plus unified retry-with-relaunch error recovery.

**Architecture:** `apps/runner-web/src/driver.ts` becomes an exported module (`createDriverSession(env) → DriverSession`) with a thin CLI wrapper preserved. `scripts/run-matrix.ts` browser loop converts to per-env long-lived session driven via `driver.get(newCaseUrl)`. Errors trigger `runCaseWithRetry` → quit + relaunch + retry-once → soft-fail with failures collected and written to `<run>/failures.txt`. Node env loop unchanged.

**Tech Stack:** TypeScript (ESM, strict), selenium-webdriver ~4.27, vitest ^3, tsx ^4.19, execa ^9, Node 22.x.

**Spec:** [`docs/superpowers/specs/2026-05-26-phase-1-1-2-1-bench-infra-design.md`](../specs/2026-05-26-phase-1-1-2-1-bench-infra-design.md)

---

## Wave 0 — Pre-flight

### Task 0: Verify master baseline green

**Files:** none modified

- [ ] **Step 1: Confirm starting branch + clean tree**

Run:
```bash
git checkout master && git status --short && git log --oneline -3
```

Expected: branch `master`, clean tree (or only untracked files pre-existing from prior sessions: `.claude/settings.local.json`, untracked `*.md` from V8 deopt session), HEAD includes `a5586b6 docs(spec): Phase 1.1.2.1`.

- [ ] **Step 2: Run pre-flight gates**

Run:
```bash
pnpm typecheck && pnpm lint:all && pnpm test
```

Expected: all green, exit 0. If anything fails — STOP, surface to user. Do not proceed.

- [ ] **Step 3: Smoke (current shape) sanity**

Run:
```bash
pnpm smoke
```

Expected: ends with `smoke OK`, exit 0. If smoke fails — STOP, root-cause; this is baseline regression unrelated to our work.

- [ ] **Step 4: Create work branch**

Run:
```bash
git checkout -b feature/phase-1-1-2-1-bench-infra
```

Expected: branch created.

---

## Wave 1 — Driver refactor + recovery + tests

### Task 1: Add vitest infra to `apps/runner-web`

**Files:**
- Modify: `apps/runner-web/package.json`

- [ ] **Step 1: Add `test` script + vitest devDep**

Edit `apps/runner-web/package.json` so the `scripts` and `devDependencies` blocks read:

```json
{
    "scripts": {
        "typecheck": "tsc --noEmit",
        "test": "vitest run",
        "dev": "vite",
        "build": "vite build",
        "preview": "vite preview",
        "drive": "tsx src/driver.ts"
    },
    "devDependencies": {
        "@types/selenium-webdriver": "~4.1.0",
        "selenium-webdriver": "~4.27.0",
        "sirv": "^3.0.0",
        "tsx": "^4.19.0",
        "typescript": "^5.6.3",
        "vite": "^6.0.0",
        "vitest": "^3.0.0"
    }
}
```

- [ ] **Step 2: Install + verify `pnpm test` picks up the workspace**

Run (sandbox-disabled because tsx subprocess):
```bash
pnpm install
pnpm --filter @bench-app/runner-web test
```

Expected: vitest starts and reports `No test files found`. Exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/runner-web/package.json pnpm-lock.yaml
git commit --no-gpg-sign -m "build(runner-web): add vitest infra for upcoming driver tests"
```

### Task 2: Define `DriverSession`/`CaseInput`/`CaseResult` types and stub `createDriverSession`

**Files:**
- Modify: `apps/runner-web/src/driver.ts`

This task introduces the public module surface (exports + types) without yet refactoring internals. CLI behaviour must continue to work — Task 3 then moves implementation into `createDriverSession`/`runCase`.

- [ ] **Step 1: Add module exports above existing CLI code**

At the top of `apps/runner-web/src/driver.ts` (just below existing imports), add:

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
    /** Parsed + machine-patched BenchResult ready to serialize. */
    result: import("@bench/result-schema").BenchResult;
    /** Canonical output filename `<entry>__<lang>-<tc>-<profile>__<size>__<env>.json`. */
    fileName: string;
}

export interface DriverSession {
    runCase(input: CaseInput): Promise<CaseResult>;
    quit(): Promise<void>;
}

export interface CreateDriverSessionOptions {
    /** Vite preview port (default 5174). */
    port?: number;
}

/** STUB — implemented in Task 3. Throws so accidental use surfaces clearly. */
export async function createDriverSession(
    _env: "chromium" | "firefox",
    _options: CreateDriverSessionOptions = {},
): Promise<DriverSession> {
    throw new Error("createDriverSession: not yet implemented (Task 3)");
}
```

Note: leave the existing `main()` CLI function untouched in this task.

- [ ] **Step 2: Verify typecheck still passes**

Run:
```bash
pnpm --filter @bench-app/runner-web typecheck
pnpm --filter @bench-app/runner-web exec eslint src/driver.ts
```

Expected: both green.

- [ ] **Step 3: Commit**

```bash
git add apps/runner-web/src/driver.ts
git commit --no-gpg-sign -m "feat(runner-web): public DriverSession module API (stub)"
```

### Task 3: Implement `createDriverSession` + `runCase` + `quit` (internal refactor of existing CLI logic)

**Files:**
- Modify: `apps/runner-web/src/driver.ts`

- [ ] **Step 1: Extract `launchBrowser` (no change needed — already extracted as `async function launchBrowser(env)`). Verify it stays internal (not exported).**

Read `apps/runner-web/src/driver.ts` lines 57-90 — `launchBrowser(env)` already exists as a top-level async function. No edit; just confirm it's not prefixed `export`.

- [ ] **Step 2: Replace stub `createDriverSession` with real implementation**

Replace the stub from Task 2 with:

```ts
export async function createDriverSession(
    env: "chromium" | "firefox",
    options: CreateDriverSessionOptions = {},
): Promise<DriverSession> {
    const port = options.port ?? 5174;
    const baseUrl = `http://localhost:${port}`;
    const driver = await launchBrowser(env);

    async function runCase(input: CaseInput): Promise<CaseResult> {
        const baseMeasureConfig = input.mode === "quick"
            ? { warmupIterations: 3, innerIterations: 1, minSamples: 5, maxSamples: 10, cvThreshold: 0.05 }
            : { warmupIterations: 10, innerIterations: 1, minSamples: 30, maxSamples: 100, cvThreshold: 0.05 };

        const specPath = join(REPO_ROOT, `dist/${input.benchmark}/spec.json`);
        const spec = SpecSchema.parse(JSON.parse(await readFile(specPath, "utf8")));
        const sizeSpec = spec.inputSizes[input.size];
        if (!sizeSpec) {
            throw new Error(`spec missing inputSize ${input.size}`);
        }
        const perEntry = spec.expectedChecksums[input.entry];
        if (!perEntry) {
            throw new Error(`spec missing expectedChecksums for entry "${input.entry}"`);
        }
        const expectedChecksum = perEntry[input.size];
        if (expectedChecksum === undefined) {
            throw new Error(`spec missing expectedChecksum for entry "${input.entry}" size "${input.size}"`);
        }

        const measureConfig = sizeSpec.innerIterations !== undefined
            ? { ...baseMeasureConfig, innerIterations: sizeSpec.innerIterations }
            : baseMeasureConfig;

        const workerInput: WorkerInput = {
            benchmarkId: input.benchmark,
            entry: input.entry,
            language: input.language,
            toolchain: input.toolchain,
            profile: input.profile,
            inputSize: input.size,
            fixtureSha256: sizeSpec.fixtureSha256,
            expectedChecksum,
            measureConfig,
            baseUrl,
        };

        const caseParam = btoa(JSON.stringify(workerInput));
        const debug = process.env["BENCH_DEBUG_TIMINGS"] === "1" ? "&debug=1" : "";
        const url = `${baseUrl}/?case=${encodeURIComponent(caseParam)}${debug}`;

        console.log(`navigating to ${url}`);
        await driver.get(url);

        const timeoutMs = 5 * 60 * 1000;
        let raw: unknown;
        try {
            await driver.wait(async () => {
                return await driver.executeScript<boolean>(
                    "return (window).__BENCH_RESULT !== undefined;",
                );
            }, timeoutMs);
        } catch {
            const status = await driver.executeScript<string>(
                "return document.getElementById('status')?.textContent || '(no status)';",
            ).catch(() => "(eval failed)");
            const logs = await driver.executeScript<unknown[]>(
                "return (window).__BENCH_LOGS || [];",
            ).catch(() => []);
            for (const log of logs) {
                console.error("[browser]", log);
            }
            throw new Error(`timed out waiting for result. Page status: ${status}`);
        }

        raw = await driver.executeScript<unknown>("return (window).__BENCH_RESULT;");

        const logs = await driver.executeScript<unknown[]>(
            "return (window).__BENCH_LOGS || [];",
        ).catch(() => []);
        for (const log of logs) {
            console.log("[browser]", log);
        }

        if (
            raw !== null
            && typeof raw === "object"
            && "error" in raw
            && typeof (raw as { error: unknown }).error === "string"
        ) {
            throw new Error(`benchmark failed: ${(raw as { error: string }).error}`);
        }

        const result = BenchResultSchema.parse(raw);
        const machineCpu = process.env["MACHINE_CPU"] ?? "unknown";
        const patched = BenchResultSchema.parse({
            ...result,
            machine: {
                os: `${process.platform} ${process.arch}`,
                cpu: machineCpu,
                memoryGb: Math.max(1, Math.round(totalmem() / (1024 ** 3))),
            },
        });

        const fileName = `${input.entry}__${input.language}-${input.toolchain}-${input.profile}__${input.size}__${env}.json`;
        return { result: patched, fileName };
    }

    async function quit(): Promise<void> {
        const QUIT_TIMEOUT_MS = 5_000;
        await Promise.race([
            driver.quit().catch(() => { /* swallowed by intent */ }),
            new Promise<void>((resolve) => setTimeout(resolve, QUIT_TIMEOUT_MS)),
        ]);
    }

    return { runCase, quit };
}
```

- [ ] **Step 3: Refactor CLI `main()` to use the new module API**

Replace lines 92-210 (existing `main()` function) with:

```ts
async function main() {
    const a = parseCli(argv.slice(2));
    const session = await createDriverSession(a.browser, { port: a.port });
    try {
        const { result, fileName } = await session.runCase({
            benchmark: a.benchmark,
            entry: a.entry,
            language: a.language,
            toolchain: a.toolchain,
            profile: a.profile,
            size: a.size,
            mode: a.mode,
        });
        const resolvedOutDir = resolve(REPO_ROOT, a.outDir);
        await mkdir(resolvedOutDir, { recursive: true });
        const outPath = join(resolvedOutDir, fileName);
        await writeFile(outPath, JSON.stringify(result, null, 2));
        console.log(`wrote ${outPath}`);
        console.log(`checksum: ${String(result.quality.checksum)}`);
        console.log(`validated: ${String(result.quality.validated)}`);
    } finally {
        await session.quit();
    }
}
```

- [ ] **Step 4: Verify typecheck + lint**

Run:
```bash
pnpm --filter @bench-app/runner-web typecheck
pnpm --filter @bench-app/runner-web exec eslint src/driver.ts
```

Expected: both green.

- [ ] **Step 5: Manual smoke of CLI (verify regression-free)**

Run (sandbox-disabled — tsx subprocess + browser):
```bash
pnpm build:all
pnpm exec tsx apps/runner-web/src/driver.ts \
    --benchmark=matmul --entry=matmul --language=rust --toolchain=raw --profile=speed \
    --size=S --out=/tmp/_t1-cli --mode=quick --browser=chromium --port=5174
```

(Requires vite preview already running on 5174; otherwise launch it manually in another terminal: `pnpm --filter @bench-app/runner-web dev`.)

Expected: result file written under `/tmp/_t1-cli/`, `checksum:` and `validated: true` printed.

- [ ] **Step 6: Commit**

```bash
git add apps/runner-web/src/driver.ts
git commit --no-gpg-sign -m "refactor(runner-web): driver.ts CLI uses new module API"
```

### Task 4: Unit test `quit()` timeout race

**Files:**
- Create: `apps/runner-web/tests/driver-quit-timeout.test.ts`

This test isolates the timeout race without requiring a real WebDriver — we extract the race into a small testable helper.

- [ ] **Step 1: Extract the race into a named internal helper**

Edit `apps/runner-web/src/driver.ts`. Above `createDriverSession`, add:

```ts
const QUIT_TIMEOUT_MS = 5_000;

/** Exported for testing only. Races `quitFn` against a fixed timeout. */
export async function quitWithTimeout(
    quitFn: () => Promise<void>,
    timeoutMs: number = QUIT_TIMEOUT_MS,
): Promise<void> {
    await Promise.race([
        quitFn().catch(() => { /* swallowed by intent */ }),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
}
```

Then change the `quit` closure inside `createDriverSession` to:

```ts
async function quit(): Promise<void> {
    await quitWithTimeout(() => driver.quit());
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/runner-web/tests/driver-quit-timeout.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { quitWithTimeout } from "../src/driver.js";

describe("quitWithTimeout", () => {
    it("resolves when quitFn resolves quickly", async () => {
        const quit = vi.fn().mockResolvedValue(undefined);
        await quitWithTimeout(quit, 1_000);
        expect(quit).toHaveBeenCalledOnce();
    });

    it("resolves within timeout window when quitFn hangs", async () => {
        const quit = vi.fn(() => new Promise<void>(() => { /* never resolves */ }));
        const start = Date.now();
        await quitWithTimeout(quit, 50);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(50);
        expect(elapsed).toBeLessThan(500);
        expect(quit).toHaveBeenCalledOnce();
    });

    it("swallows rejection from quitFn (does not throw)", async () => {
        const quit = vi.fn().mockRejectedValue(new Error("boom"));
        await expect(quitWithTimeout(quit, 1_000)).resolves.toBeUndefined();
    });
});
```

- [ ] **Step 3: Run test, expect 3 passes**

Run:
```bash
pnpm --filter @bench-app/runner-web test
```

Expected: 3 passed, 0 failed.

- [ ] **Step 4: Commit**

```bash
git add apps/runner-web/src/driver.ts apps/runner-web/tests/driver-quit-timeout.test.ts
git commit --no-gpg-sign -m "test(runner-web): quit timeout race helper + unit tests"
```

### Task 5: Implement `runCaseWithRetry` helper + unit tests

**Files:**
- Create: `apps/runner-web/src/run-case-with-retry.ts`
- Create: `apps/runner-web/tests/run-case-with-retry.test.ts`

- [ ] **Step 1: Write the failing test first**

Create `apps/runner-web/tests/run-case-with-retry.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runCaseWithRetry, type DriverSessionLike } from "../src/run-case-with-retry.js";
import type { CaseInput, CaseResult } from "../src/driver.js";

function mkInput(overrides: Partial<CaseInput> = {}): CaseInput {
    return {
        benchmark: "matmul",
        entry: "matmul",
        language: "rust",
        toolchain: "raw",
        profile: "speed",
        size: "S",
        mode: "quick",
        ...overrides,
    };
}

function mkResult(): CaseResult {
    return {
        result: { /* opaque to retry logic */ } as CaseResult["result"],
        fileName: "matmul__rust-raw-speed__S__chromium.json",
    };
}

function mkSessionRef(initial: DriverSessionLike) {
    return { current: initial };
}

describe("runCaseWithRetry", () => {
    it("returns result on 1st-attempt success without relaunch", async () => {
        const expected = mkResult();
        const sess: DriverSessionLike = {
            runCase: vi.fn().mockResolvedValue(expected),
            quit: vi.fn(),
        };
        const ref = mkSessionRef(sess);
        const failures: Array<{ caseId: string; error: string }> = [];
        const create = vi.fn();

        const got = await runCaseWithRetry(ref, mkInput(), failures, create);

        expect(got).toBe(expected);
        expect(sess.runCase).toHaveBeenCalledOnce();
        expect(sess.quit).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
        expect(failures).toEqual([]);
    });

    it("relaunches and retries on 1st-attempt error; returns 2nd-attempt result", async () => {
        const expected = mkResult();
        const session1: DriverSessionLike = {
            runCase: vi.fn().mockRejectedValue(new Error("first attempt boom")),
            quit: vi.fn().mockResolvedValue(undefined),
        };
        const session2: DriverSessionLike = {
            runCase: vi.fn().mockResolvedValue(expected),
            quit: vi.fn(),
        };
        const ref = mkSessionRef(session1);
        const failures: Array<{ caseId: string; error: string }> = [];
        const create = vi.fn().mockResolvedValue(session2);

        const got = await runCaseWithRetry(ref, mkInput(), failures, create);

        expect(got).toBe(expected);
        expect(session1.runCase).toHaveBeenCalledOnce();
        expect(session1.quit).toHaveBeenCalledOnce();
        expect(create).toHaveBeenCalledOnce();
        expect(session2.runCase).toHaveBeenCalledOnce();
        expect(ref.current).toBe(session2);
        expect(failures).toEqual([]);
    });

    it("returns null and records failure when both attempts fail", async () => {
        const session1: DriverSessionLike = {
            runCase: vi.fn().mockRejectedValue(new Error("attempt 1 boom")),
            quit: vi.fn().mockResolvedValue(undefined),
        };
        const session2: DriverSessionLike = {
            runCase: vi.fn().mockRejectedValue(new Error("attempt 2 boom")),
            quit: vi.fn(),
        };
        const ref = mkSessionRef(session1);
        const failures: Array<{ caseId: string; error: string }> = [];
        const create = vi.fn().mockResolvedValue(session2);

        const got = await runCaseWithRetry(ref, mkInput({ entry: "matmul" }), failures, create);

        expect(got).toBeNull();
        expect(session2.runCase).toHaveBeenCalledOnce();
        expect(ref.current).toBe(session2);
        expect(failures).toHaveLength(1);
        expect(failures[0]?.caseId).toContain("matmul");
        expect(failures[0]?.error).toBe("attempt 2 boom");
    });

    it("propagates relaunch failure as case failure (no third attempt)", async () => {
        const session1: DriverSessionLike = {
            runCase: vi.fn().mockRejectedValue(new Error("attempt 1 boom")),
            quit: vi.fn().mockResolvedValue(undefined),
        };
        const ref = mkSessionRef(session1);
        const failures: Array<{ caseId: string; error: string }> = [];
        const create = vi.fn().mockRejectedValue(new Error("relaunch failed"));

        const got = await runCaseWithRetry(ref, mkInput(), failures, create);

        expect(got).toBeNull();
        expect(failures).toHaveLength(1);
        expect(failures[0]?.error).toBe("relaunch failed");
    });
});
```

- [ ] **Step 2: Run test, expect failure (module not found)**

Run:
```bash
pnpm --filter @bench-app/runner-web test
```

Expected: failure — `Cannot find module '../src/run-case-with-retry.js'`.

- [ ] **Step 3: Implement the helper**

Create `apps/runner-web/src/run-case-with-retry.ts`:

```ts
import type { CaseInput, CaseResult, DriverSession } from "./driver.js";

/** Minimal contract used by retry helper — narrower than full DriverSession for easier mocking. */
export interface DriverSessionLike {
    runCase(input: CaseInput): Promise<CaseResult>;
    quit(): Promise<void>;
}

export type CreateSessionFn = () => Promise<DriverSession>;

export interface RetryFailure {
    caseId: string;
    error: string;
}

function caseIdOf(input: CaseInput): string {
    return `${input.entry}__${input.language}-${input.toolchain}-${input.profile}__${input.size}`;
}

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * Run a case with one retry attempt. On any error:
 *   1. Log the error
 *   2. Quit + recreate the session (replacing sessionRef.current)
 *   3. Retry the case on the fresh session
 *   4. If retry also fails → push to failures[] and return null
 *
 * Unified path for per-case errors and session-level crashes (Selenium error
 * distinction is unreliable; relaunch on any failure is the conservative choice).
 */
export async function runCaseWithRetry(
    sessionRef: { current: DriverSessionLike },
    caseInput: CaseInput,
    failures: RetryFailure[],
    createSession: CreateSessionFn,
): Promise<CaseResult | null> {
    const caseId = caseIdOf(caseInput);
    try {
        return await sessionRef.current.runCase(caseInput);
    } catch (e1) {
        const msg1 = errorMessage(e1);
        console.error(`[retry] ${caseId}: 1st attempt failed: ${msg1}`);
        await sessionRef.current.quit().catch(() => { /* best-effort */ });
        try {
            sessionRef.current = await createSession();
        } catch (eRelaunch) {
            const msgR = errorMessage(eRelaunch);
            console.error(`[fail] ${caseId}: relaunch failed: ${msgR}`);
            failures.push({ caseId, error: msgR });
            return null;
        }
        try {
            return await sessionRef.current.runCase(caseInput);
        } catch (e2) {
            const msg2 = errorMessage(e2);
            console.error(`[fail] ${caseId}: 2nd attempt failed: ${msg2}`);
            failures.push({ caseId, error: msg2 });
            return null;
        }
    }
}
```

- [ ] **Step 4: Run tests, expect all 4 pass**

Run:
```bash
pnpm --filter @bench-app/runner-web test
```

Expected: 7 tests passed (3 quit-timeout + 4 retry).

- [ ] **Step 5: Lint + typecheck**

Run:
```bash
pnpm --filter @bench-app/runner-web typecheck
pnpm --filter @bench-app/runner-web exec eslint src/run-case-with-retry.ts tests/run-case-with-retry.test.ts
```

Expected: both green.

- [ ] **Step 6: Commit**

```bash
git add apps/runner-web/src/run-case-with-retry.ts apps/runner-web/tests/run-case-with-retry.test.ts
git commit --no-gpg-sign -m "feat(runner-web): runCaseWithRetry helper + unit tests"
```

### Task 6: Add `--benchmarks=<csv>` filter to `scripts/run-matrix.ts`

This is needed by Task 9 (smoke extension) — gives smoke the ability to restrict to matmul-only when running browsers.

**Files:**
- Modify: `scripts/run-matrix.ts`

- [ ] **Step 1: Extend `CliArgs` + parsing**

In `scripts/run-matrix.ts`, edit the `CliArgs` interface (currently around line 14):

```ts
interface CliArgs {
    envs: Env[];
    sizes: Size[];
    mode: "quick" | "eval";
    out: string;
    benchmarks: string[];  // empty = all
}
```

In `parseArgs`, after the existing returns:

```ts
const benchmarksRaw = get("benchmarks", "");
const benchmarks = benchmarksRaw === ""
    ? []
    : benchmarksRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);

return {
    envs: parseList(get("envs", "node,chromium,firefox"), ALL_ENVS, "env"),
    sizes: parseList(get("sizes", "S,M"), ALL_SIZES, "size"),
    mode,
    out: get("out", `results/raw/${new Date().toISOString().replace(/[:.]/g, "-")}`),
    benchmarks,
};
```

- [ ] **Step 2: Apply filter in `loadSpecs` (or after)**

Modify `loadSpecs` call site in `main()` — after `const specs = await loadSpecs();` add:

```ts
const filteredSpecs = args.benchmarks.length === 0
    ? specs
    : specs.filter((s) => args.benchmarks.includes(s.id));
if (args.benchmarks.length > 0 && filteredSpecs.length !== args.benchmarks.length) {
    const found = new Set(filteredSpecs.map((s) => s.id));
    const missing = args.benchmarks.filter((b) => !found.has(b));
    throw new Error(`--benchmarks: unknown benchmark id(s): ${missing.join(", ")}`);
}
```

Then replace subsequent `for (const spec of specs)` with `for (const spec of filteredSpecs)`.

- [ ] **Step 3: Manual verification**

Run:
```bash
pnpm exec tsx scripts/run-matrix.ts --envs=node --sizes=S --mode=quick --benchmarks=matmul --out=/tmp/_t6
```

Expected: only matmul cases run (visible in stdout). No interop/hashmap cases.

```bash
pnpm exec tsx scripts/run-matrix.ts --envs=node --sizes=S --mode=quick --benchmarks=nonexistent --out=/tmp/_t6
```

Expected: throws `--benchmarks: unknown benchmark id(s): nonexistent`, exit 1.

- [ ] **Step 4: Lint + typecheck**

Run:
```bash
pnpm typecheck && pnpm lint:ts
```

Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-matrix.ts
git commit --no-gpg-sign -m "feat(run-matrix): --benchmarks=<csv> filter"
```

### Task 7: Add `--restart-every=N` knob + browser long-lived session loop + retry integration

**Files:**
- Modify: `scripts/run-matrix.ts`
- Modify: `apps/runner-web/src/driver.ts` (re-export `createDriverSession` via package.json type path resolution — likely no edit needed, just verify path)

This is the largest task. It replaces the per-case subprocess spawn for browser envs with a long-lived session loop driving `runCase` directly via the module import.

- [ ] **Step 1: Add `--restart-every=N` parse**

Extend `CliArgs` (from Task 6) with `restartEvery: number;`. In `parseArgs`:

```ts
const restartEveryRaw = parseInt(get("restart-every", "0"), 10);
if (!Number.isFinite(restartEveryRaw) || restartEveryRaw < 0) {
    throw new Error(`--restart-every must be a non-negative integer; got "${get("restart-every", "0")}"`);
}

return {
    envs: parseList(get("envs", "node,chromium,firefox"), ALL_ENVS, "env"),
    sizes: parseList(get("sizes", "S,M"), ALL_SIZES, "size"),
    mode,
    out: get("out", `results/raw/${new Date().toISOString().replace(/[:.]/g, "-")}`),
    benchmarks,
    restartEvery: restartEveryRaw,
};
```

- [ ] **Step 2: Add module imports at the top of `scripts/run-matrix.ts`**

After existing imports (currently end with `import { run } from "./lib/exec.js";`):

```ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDriverSession, type CaseInput, type DriverSession } from "../apps/runner-web/src/driver.js";
import { runCaseWithRetry, type RetryFailure } from "../apps/runner-web/src/run-case-with-retry.js";
```

Note: tsx resolves `.js` → `.ts` automatically; tsconfig.json (root) includes `scripts/**/*` but not `apps/runner-web/**/*`. Cross-workspace import via relative path works at runtime through tsx, but root typecheck needs the path included. Verify and patch in Step 3.

- [ ] **Step 3: Verify `pnpm typecheck` finds the cross-workspace import**

Run:
```bash
pnpm typecheck
```

If failure mentions inability to find `apps/runner-web/src/driver.js` types from `scripts/run-matrix.ts`:

Edit root `tsconfig.json`:

```json
{
    "extends": "./tsconfig.base.json",
    "compilerOptions": {
        "noEmit": true
    },
    "include": [
        "scripts/**/*",
        "benches/common/**/*",
        "benches/*/validate/**/*",
        "apps/runner-web/src/driver.ts",
        "apps/runner-web/src/run-case-with-retry.ts",
        "apps/runner-web/src/worker.ts",
        "apps/runner-web/src/browser-paths.ts"
    ]
}
```

(Include the imports' transitive deps to avoid type errors.)

Re-run `pnpm typecheck`. Expected: green.

If issues persist (e.g., DOM types leak), narrow approach: create `scripts/lib/driver-types.ts` re-exporting `type { CaseInput, DriverSession } from "../../apps/runner-web/src/driver.js"` and import from there. Document choice in commit message.

- [ ] **Step 4: Refactor the main loop — split node vs browser cases**

In `scripts/run-matrix.ts main()`, locate the current case loop (line 110-139). Replace with:

```ts
let ranOK = true;
const accumulateFailures: Array<RetryFailure & { env: Env }> = [];
try {
    // ── Node loop: per-case subprocess (unchanged behaviour) ─────────────
    if (args.envs.includes("node")) {
        for (const spec of filteredSpecs) {
            for (const c of enumerateBinaries(spec)) {
                if (c.language === "js" && c.profile !== "speed") {
                    continue;
                }
                for (const entry of spec.entries) {
                    for (const sz of args.sizes) {
                        const common = [
                            `--benchmark=${c.sourceBench}`,
                            `--entry=${entry}`,
                            `--language=${c.language}`,
                            `--toolchain=${c.toolchain}`,
                            `--profile=${c.profile}`,
                            `--size=${sz}`,
                            `--out=${args.out}`,
                            `--mode=${args.mode}`,
                        ];
                        await run("tsx", ["apps/runner-node/src/main.ts", ...common]);
                    }
                }
            }
        }
    }

    // ── Browser loops: long-lived session per env ───────────────────────
    for (const env of args.envs) {
        if (env === "node") {
            continue;
        }
        const cases: CaseInput[] = [];
        for (const spec of filteredSpecs) {
            for (const c of enumerateBinaries(spec)) {
                if (c.language === "js" && c.profile !== "speed") {
                    continue;
                }
                for (const entry of spec.entries) {
                    for (const sz of args.sizes) {
                        cases.push({
                            benchmark: c.sourceBench,
                            entry,
                            language: c.language,
                            toolchain: c.toolchain,
                            profile: c.profile,
                            size: sz,
                            mode: args.mode,
                        });
                    }
                }
            }
        }
        if (cases.length === 0) {
            continue;
        }

        const create = (): Promise<DriverSession> => createDriverSession(env, { port: 5174 });
        let session: DriverSession;
        try {
            session = await create();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[env-skip] env=${env}: initial session create failed: ${msg}`);
            accumulateFailures.push({ env, caseId: "(env-init)", error: msg });
            ranOK = false;
            continue;
        }
        const sessionRef = { current: session };
        const envFailures: RetryFailure[] = [];
        let consecutiveFailures = 0;

        for (let i = 0; i < cases.length; i++) {
            if (args.restartEvery > 0 && i > 0 && i % args.restartEvery === 0) {
                console.log(`[restart-every] env=${env}: restarting session at case ${i}`);
                await sessionRef.current.quit().catch(() => {});
                sessionRef.current = await create();
            }
            const result = await runCaseWithRetry(sessionRef, cases[i]!, envFailures, create);
            if (result === null) {
                consecutiveFailures++;
                if (consecutiveFailures >= 3) {
                    const remaining = cases.length - i - 1;
                    console.error(`[abort] env=${env}: 3 consecutive failures, skipping ${remaining} remaining cases`);
                    break;
                }
            } else {
                consecutiveFailures = 0;
                const outPath = join(args.out, result.fileName);
                await writeFile(outPath, JSON.stringify(result.result, null, 2));
                console.log(`wrote ${outPath}`);
            }
        }

        await sessionRef.current.quit().catch(() => {});

        if (envFailures.length > 0) {
            ranOK = false;
            for (const f of envFailures) {
                accumulateFailures.push({ env, ...f });
            }
        }
    }
} catch (e) {
    ranOK = false;
    throw e;
} finally {
    if (serverProc?.pid) {
        try {
            process.kill(-serverProc.pid, "SIGTERM");
        } catch (e: unknown) {
            if ((e as NodeJS.ErrnoException).code !== "ESRCH") {
                throw e;
            }
        }
        try {
            await serverProc;
        } catch { /* expected on SIGTERM */ }
    }
}

if (accumulateFailures.length > 0) {
    const summary = accumulateFailures
        .map((f) => `[${f.env}] ${f.caseId}: ${f.error}`)
        .join("\n");
    await writeFile(join(args.out, "failures.txt"), summary + "\n");
    console.error(`${accumulateFailures.length} case(s) failed; see ${args.out}/failures.txt`);
    process.exit(1);
}

console.log(`results in ${args.out}${ranOK ? "" : " (partial — some cases failed)"}`);
```

(Remove the old per-case subprocess invocation for browser envs; remove dead `await mkdir(args.out, { recursive: true });` — it's still needed, ensure it stays before any writes.)

- [ ] **Step 5: Sanity verify args.out exists before any write**

Confirm `await mkdir(args.out, { recursive: true });` is called before the loop (it already is, line 84). No edit needed.

- [ ] **Step 6: Typecheck + lint**

Run:
```bash
pnpm typecheck && pnpm lint:ts
```

Expected: both green. Fix any type issues (likely DOM type leaks if tsconfig was over-included — narrow as needed).

- [ ] **Step 7: Manual integration test — single browser env, 3 cases**

Run:
```bash
pnpm build:all
pnpm exec tsx scripts/run-matrix.ts --envs=chromium --benchmarks=matmul --sizes=S --mode=quick --out=/tmp/_t7-int
ls -la /tmp/_t7-int/
```

Expected: 10 result JSON files in `/tmp/_t7-int/` (matmul × 10 combos × S × chromium). No failures.txt. Console shows `navigating to ...` 10 times — confirms session reuse (single launchBrowser).

- [ ] **Step 8: Manual integration test — failure path**

Force a failure by passing a nonexistent entry (workerInput will produce error in browser):

```bash
pnpm exec tsx scripts/run-matrix.ts --envs=chromium --benchmarks=matmul --sizes=S --mode=quick --out=/tmp/_t7-fail
```

(Use matmul which is real — this should succeed.) Then test failure recovery indirectly: stop the vite preview process while a case is running. Verify retry triggers, then session relaunches with vite back up.

(Alternatively, leave failure-path verification to W2 — full bench:all run will expose any real-world weakness.)

- [ ] **Step 9: Commit**

```bash
git add scripts/run-matrix.ts tsconfig.json
git commit --no-gpg-sign -m "feat(run-matrix): long-lived browser session per env + retry + --restart-every"
```

### Task 8: Extend `pnpm smoke` to cover browser envs

**Files:**
- Modify: `scripts/smoke.ts`

- [ ] **Step 1: Update smoke to include browser envs limited to matmul**

Replace contents of `scripts/smoke.ts` with:

```ts
import { run } from "./lib/exec.js";

async function main() {
    const out = "results/raw/_smoke";

    // Full S × all combos × node (existing breadth — regression coverage for non-matmul workloads).
    await run("tsx", ["scripts/run-matrix.ts", "--envs=node", "--sizes=S", "--mode=quick", `--out=${out}`]);

    // matmul × all combos × S × all browser envs (new sanity for long-lived session).
    await run("tsx", [
        "scripts/run-matrix.ts",
        "--envs=chromium,firefox",
        "--benchmarks=matmul",
        "--sizes=S",
        "--mode=quick",
        `--out=${out}`,
    ]);

    await run("tsx", ["scripts/report.ts", `--in=${out}`, "--out=results/summarized/_smoke"]);
    console.log("smoke OK");
}

main().catch((e) => {
    console.error("smoke FAILED:", e); process.exit(1);
});
```

Rationale: keeps node breadth (regression coverage), adds matmul × all toolchains × chromium + firefox (long-lived session sanity), preserves symmetry user requested.

- [ ] **Step 2: Run extended smoke**

Run (sandbox-disabled):
```bash
pnpm smoke
```

Expected: ends `smoke OK`. Total time ≤90s. If >90s — investigation flag (note in commit message; do not silently bury).

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke.ts
git commit --no-gpg-sign -m "feat(smoke): extend to chromium+firefox matmul sanity"
```

### Task 9: README — document `--benchmarks`, `--restart-every`, new bench:all reliability

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Locate the bench section**

Read `README.md` to find the "Запуск бенчмарков" / "Запуск" section that documents `pnpm bench:all`.

- [ ] **Step 2: Add knobs to bench section**

Under the existing `pnpm bench:all` documentation, add two lines documenting the new knobs:

```markdown
- `--benchmarks=<id1,id2>` — фильтр по `spec.id` (по умолчанию все).
- `--restart-every=N` — quit+relaunch browser session каждые N cases per env (default 0 = never; hedge на возможный V8 state drift в long runs).
```

Replace any text that says "fresh chromedriver per case" / "per-case subprocess" with description of long-lived per-env session.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit --no-gpg-sign -m "docs(readme): document --benchmarks + --restart-every + new session lifecycle"
```

### Task 10: W1 close — verify all gates + merge to master

- [ ] **Step 1: Final gate check on branch**

Run:
```bash
pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke
```

Expected: all green. If anything red — fix, do not proceed.

- [ ] **Step 2: Switch to master, merge, push**

Run:
```bash
git checkout master
git merge --no-ff --no-gpg-sign feature/phase-1-1-2-1-bench-infra
```

Provide merge commit message:

```
merge: Phase 1.1.2.1 W1 — bench-infra refactor (driver lifecycle + recovery)

- driver.ts: createDriverSession/runCase/quit module API + CLI wrapper preserved
- run-matrix.ts: long-lived session per env, runCaseWithRetry, --restart-every,
  --benchmarks filters, failures.txt summary
- New unit tests (vitest infra in apps/runner-web)
- smoke extended: matmul × all combos × all 3 envs
```

- [ ] **Step 3: Verify master green**

Run:
```bash
pnpm typecheck && pnpm lint:all && pnpm test
git log --oneline -5
```

Expected: master HEAD = merge commit; all gates green.

---

## Wave 2 — Full Phase 1.1.x re-bench

### Task 11: Pre-bench housekeeping — clear leaked tmp dirs

**Files:** none (filesystem hygiene)

- [ ] **Step 1: Inspect leak**

Run:
```bash
ls -d $TMPDIR/org.chromium.Chromium.scoped_dir.* 2>/dev/null | wc -l
du -shc $TMPDIR/org.chromium.Chromium.scoped_dir.* 2>/dev/null
```

Expected: count + total size from prior sessions (per session-state-2026-05-26: ~365 dirs / ~3.1 GB).

- [ ] **Step 2: Clear**

Run:
```bash
rm -rf $TMPDIR/org.chromium.Chromium.scoped_dir.* $TMPDIR/com.google.chrome.for.testing.*
```

Expected: command returns 0, no output (or globs-not-matched message acceptable).

- [ ] **Step 3: Re-verify zero**

Run:
```bash
ls -d $TMPDIR/org.chromium.Chromium.scoped_dir.* 2>/dev/null | wc -l
```

Expected: `0`.

### Task 12: Run full Phase 1.1.x bench:all

- [ ] **Step 1: Run full matrix**

Run (sandbox-disabled — tsx subprocess + browsers, will take 40-60 min):
```bash
pnpm bench:all 2>&1 | tee /tmp/bench-all-1-1-2-1.log
```

Or, to capture the canonical run dir name:
```bash
RUN_DIR="results/raw/$(date -u +%Y-%m-%dT%H-%M-%SZ)"
pnpm setup-tools && pnpm build:all
pnpm bench --envs=node,chromium,firefox --sizes=S,M,L --mode=eval --out=$RUN_DIR 2>&1 | tee /tmp/bench-all.log
pnpm report --in=$RUN_DIR --out=results/summarized/_1-1-2-1
```

Expected: ends with `results in <RUN_DIR>` (no "partial" suffix), exit 0.

- [ ] **Step 2: Verify 810 results**

Run:
```bash
ls $RUN_DIR/*.json | wc -l
test -f $RUN_DIR/failures.txt && cat $RUN_DIR/failures.txt || echo "no failures.txt — clean run"
```

Expected: `810` and `no failures.txt — clean run`. If file count != 810 or failures.txt exists with content — STOP, root-cause before proceeding.

Per-env breakdown sanity:
```bash
for env in node chromium firefox; do
    count=$(ls $RUN_DIR/*__$env.json 2>/dev/null | wc -l | tr -d ' ')
    echo "$env: $count"
done
```

Expected: each env shows `270`.

### Task 13: Sanity diff vs Phase 1.1.2 Node baseline

**Files:**
- Create (scratch, not committed): `/tmp/sanity-diff.txt`

- [ ] **Step 1: Pick 5 representative Node cases for comparison**

Cases to compare:
- `matmul__rust-raw-speed__M__node.json`
- `interop_calls_add_f64__rust-bindgen-speed__M__node.json`
- `hashmap_int_lookup__rust-bindgen-speed__M__node.json`
- `hashmap_string_lookup__js-idiomatic-speed__M__node.json`
- `hashmap_int_insert__cpp-emscripten-speed__M__node.json`

For each, read `summary.warmMedianMs` (or equivalent latency field per `BenchResultSchema`) from:
- Old: `results/raw/2026-05-23T01-51-06Z/<case>.json`
- New: `$RUN_DIR/<case>.json`

- [ ] **Step 2: Compute deltas**

For each case:
```bash
for case in matmul__rust-raw-speed__M__node.json \
            interop_calls_add_f64__rust-bindgen-speed__M__node.json \
            hashmap_int_lookup__rust-bindgen-speed__M__node.json \
            hashmap_string_lookup__js-idiomatic-speed__M__node.json \
            hashmap_int_insert__cpp-emscripten-speed__M__node.json; do
    old=$(jq -r '.summary.warmMedianMs // .summary.warmMedian // empty' results/raw/2026-05-23T01-51-06Z/$case 2>/dev/null)
    new=$(jq -r '.summary.warmMedianMs // .summary.warmMedian // empty' $RUN_DIR/$case 2>/dev/null)
    if [ -n "$old" ] && [ -n "$new" ]; then
        delta=$(echo "scale=4; ($new - $old) / $old * 100" | bc)
        echo "$case: old=$old new=$new delta=${delta}%"
    else
        echo "$case: missing data (old=$old new=$new)"
    fi
done | tee /tmp/sanity-diff.txt
```

Expected: each `delta` is within ±10% (note: actual field name may differ — adjust `jq` path per `BenchResultSchema`; consult `packages/result-schema/src/` if unclear).

- [ ] **Step 3: Decision**

- If all 5 deltas within ±10% → proceed to Task 14.
- If any delta > ±10% → STOP, investigate:
  - Is the difference systematic (all cases drift same direction) or random?
  - Likely cause: page-reload-vs-fresh-browser baseline shift (acceptable, document); OR system load during run (re-run); OR real regression in refactor (root-cause).
  - Document outcome in commit message + (if accepted) in spec Section 11 Open risks.

### Task 14: Rename canonical run dir + commit results

- [ ] **Step 1: Rename**

Run:
```bash
mv $RUN_DIR results/raw/2026-XX-XX-phase-1-1-2-1
# Replace 2026-XX-XX with today's date (UTC).
```

Replace the date placeholder with the actual UTC date today.

- [ ] **Step 2: Commit canonical results**

```bash
git add results/raw/2026-XX-XX-phase-1-1-2-1/
git commit --no-gpg-sign -m "results(phase-1-1-2-1): full Phase 1.1.x re-bench (810 cases, all 3 envs)"
```

(If commit message convention differs from repo norm, check `git log -- results/raw/` for prior phase result commit style.)

- [ ] **Step 3: Reporter sanity**

```bash
pnpm report --in=results/raw/2026-XX-XX-phase-1-1-2-1 --out=results/summarized/_1-1-2-1
open results/summarized/_1-1-2-1/index.html
```

Expected: HTML renders without errors; all 6 measurement IDs (matmul + 3 interop + 2 hashmap) shown across all 3 envs.

### Task 15: W2 close — merge

- [ ] **Step 1: Final gate**

Run:
```bash
pnpm typecheck && pnpm lint:all && pnpm test
```

Expected: green.

- [ ] **Step 2: Tag W2 progress (optional — only if main and branch diverged)**

If still on master directly (no separate W2 branch) — skip. Otherwise merge per Task 10 pattern.

---

## Wave 3 — Guidelines harvest + close

### Task 16: Refine guidelines.md — "rust/bindgen u64 / JS Map string" claim

**Files:**
- Modify: `docs/guidelines.md`

- [ ] **Step 1: Collect cross-runtime data**

For each (toolchain, size, env) combo, read `warmMedianMs` from new results:
```bash
RUN=results/raw/2026-XX-XX-phase-1-1-2-1
for env in node chromium firefox; do
    for tc in js-idiomatic-speed rust-bindgen-speed cpp-emscripten-speed; do
        for sz in S M; do
            file=$RUN/hashmap_int_lookup__${tc}__${sz}__${env}.json
            if [ -f "$file" ]; then
                v=$(jq -r '.summary.warmMedianMs // .summary.warmMedian' "$file")
                echo "u64 $env $tc $sz: $v ms"
            fi
        done
    done
done
```

Repeat for `hashmap_string_lookup`.

- [ ] **Step 2: Pattern check + update claim**

If rust/bindgen wins u64 consistently AND js/idiomatic wins string consistently across all 3 envs:

Edit `docs/guidelines.md` § Toolchain choice. Find the existing claim "Для u64-keyed hashmap'ов выбирай..." and update its body:
- Add new tables (chromium + firefox per-toolchain warm-median for S + M).
- Update first paragraph to note "Воспроизводимо через ≥2 sizes × 2 key types × 3 runtimes".
- Update `**Caveats:**` paragraph: remove "Only Node V8 12.4 measured; browser-side numbers TBD" — replace with cross-runtime confirmation note.

If pattern diverges in browsers → split into 2 claims:
- "Node: rust/bindgen u64 / JS Map string" (unchanged status)
- "Browser: <observed pattern>" — new claim with browser-specific evidence

- [ ] **Step 3: Commit**

```bash
git add docs/guidelines.md
git commit --no-gpg-sign -m "docs(guidelines): refine hashmap toolchain claim with cross-runtime evidence"
```

### Task 17: Refine guidelines.md — wasm-bindgen overhead claim + firefox-emscripten tech-debt

**Files:**
- Modify: `docs/guidelines.md`
- Modify or delete: `docs/tech_debt/firefox-emscripten-noop-5x-slowdown.md`

- [ ] **Step 1: Check wasm-bindgen overhead pattern**

For each env, compare raw vs bindgen interop_calls warm-median:
```bash
RUN=results/raw/2026-XX-XX-phase-1-1-2-1
for env in node chromium firefox; do
    for entry in interop_calls_noop interop_calls_add_i32 interop_calls_add_f64; do
        raw=$(jq -r '.summary.warmMedianMs // .summary.warmMedian' $RUN/${entry}__rust-raw-speed__M__${env}.json)
        bg=$(jq -r '.summary.warmMedianMs // .summary.warmMedian' $RUN/${entry}__rust-bindgen-speed__M__${env}.json)
        echo "$env $entry: raw=$raw bindgen=$bg"
    done
done
```

- [ ] **Step 2: Update claim if pattern persists cross-runtime**

If +10-40% overhead consistent in browsers too → edit `docs/guidelines.md` § Toolchain choice "Для hot, sub-µs JS↔Wasm functions..." claim. Update `**Status:**` from `tentative` to `confirmed`. Update body with browser data. Update `**Caveats:**` removing the "single workload class" caveat partially (still single workload, but cross-runtime now).

If diverges (browser doesn't show overhead) → keep `tentative` + add caveat documenting browser difference.

- [ ] **Step 3: Re-check firefox-emscripten 5x slowdown**

Compare firefox emscripten interop_calls_noop vs other toolchains:
```bash
for tc in rust-raw-speed rust-bindgen-speed cpp-emscripten-speed cpp-wasi-sdk-speed; do
    v=$(jq -r '.summary.warmMedianMs // .summary.warmMedian' $RUN/interop_calls_noop__${tc}__M__firefox.json)
    echo "firefox $tc noop M: $v ms"
done
```

- If emscripten still ~5x slower → escalate: add `docs/guidelines.md` § Toolchain choice claim "На firefox избегай cpp/emscripten для high-frequency interop" (tentative until cross-workload).
- If gap disappeared → delete `docs/tech_debt/firefox-emscripten-noop-5x-slowdown.md` (per resolved → delete policy).
- If gap shrunk but still notable → keep tech-debt with updated evidence.

- [ ] **Step 4: Commit**

```bash
git add docs/guidelines.md docs/tech_debt/firefox-emscripten-noop-5x-slowdown.md
git commit --no-gpg-sign -m "docs(guidelines+tech_debt): wasm-bindgen + firefox-emscripten cross-runtime review"
```

(Or use `git rm` for the tech-debt file if deleted; adjust command accordingly.)

### Task 18: Delete chromedriver-session-retry tech-debt + remove roadmap entry

**Files:**
- Delete: `docs/tech_debt/chromedriver-session-retry.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Delete tech-debt file**

Run:
```bash
git rm docs/tech_debt/chromedriver-session-retry.md
```

- [ ] **Step 2: Remove roadmap entry**

Edit `docs/roadmap.md` § Phase 1.2 > Browsers. Delete the line:
```
- **browser-driver-lifecycle-refactor** — single long-lived driver per browser env (chrome, firefox; parallel across envs) с навигацией по URL вместо driver-per-case spawn. Fixes session-loss accumulation на длинных bench runs. ([→ tech_debt/chromedriver-session-retry](tech_debt/chromedriver-session-retry.md))
```

If the Browsers cluster becomes empty → also delete the `### Browsers` heading per convention. (Currently `safari-implementation` остаётся в Browsers — heading stays.)

- [ ] **Step 3: Commit**

```bash
git add docs/roadmap.md
git commit --no-gpg-sign -m "docs(roadmap+tech_debt): retire chromedriver-session-retry — resolved in 1.1.2.1"
```

### Task 19: Capture 1.1.3 sketch in roadmap

**Files:**
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Expand shape-dispatch entry**

Edit `docs/roadmap.md` § Phase 1.1 > Workloads. Find the existing line:
```
- **shape-dispatch** — static (templates/generics) vs dynamic (virtual/dyn Trait/class hierarchy) dispatch ([→ design spec § Phase 1.1](superpowers/specs/2026-05-01-wasm-benchmarks-design.md))
```

Replace with:
```
- **shape-dispatch** — static (templates/generics, monomorphization) vs dynamic (virtual/dyn Trait/class hierarchy, vtable) dispatch. **Design direction (captured 2026-05-26):** workload measures trade-off bundle-size cost от monomorphization vs runtime cost от vtable indirection. Function body должна быть substantial enough чтобы compiler не inline'ил полностью (e.g. 10-20 FP ops over shape state, или несколько method calls per shape). Two binaries: static = template/generic processor применяется к homogeneous-per-type arrays (instantiated 3× per shape type, bundle растёт от monomorphization); dynamic = single virtual processor над mixed array (bundle compact, vtable indirection per call). JS path asymmetric — нет monomorphization concept, instead measures V8 IC state behavior (monomorphic/polymorphic/megamorphic). ([→ design spec § Phase 1.1](superpowers/specs/2026-05-01-wasm-benchmarks-design.md))
```

- [ ] **Step 2: Commit**

```bash
git add docs/roadmap.md
git commit --no-gpg-sign -m "docs(roadmap): capture 1.1.3 shape-dispatch design direction sketch"
```

### Task 20: Phase tag + close

**Files:**
- Modify: `docs/superpowers/session-states/session-state-2026-XX-XX-phase-1-1-2-1-closed.md` (create)

- [ ] **Step 1: Write session-state**

Create `docs/superpowers/session-states/session-state-2026-XX-XX-phase-1-1-2-1-closed.md` with:

```markdown
# Session state — 2026-XX-XX Phase 1.1.2.1 closed

Phase 1.1.2.1 (bench-infra hardening) merged. Next: Phase 1.1.3 brainstorm.

## TL;DR

- Master HEAD: <hash>; tag `phase-1-1-2-1` placed.
- `pnpm bench:all` reliable end-to-end на full Phase 1.1.x matrix (810 cases).
- One long-lived browser session per env; retry-once-with-relaunch recovery.
- `docs/guidelines.md` refined: <list claims updated>.
- `docs/tech_debt/chromedriver-session-retry.md` deleted; roadmap entry retired.
- 1.1.3 sketch captured в roadmap.
- Gates green: typecheck + lint:all + test + smoke.

## What the next session needs

- Phase 1.1.3 brainstorm: design shape_dispatch workload (substantial body,
  monomorphization bundle trade-off). Predecessor design info в roadmap §
  Phase 1.1 > Workloads > shape-dispatch.
- Canonical Phase 1.1.x results: `results/raw/2026-XX-XX-phase-1-1-2-1/` (810 cases).
- Updated guidelines: `docs/guidelines.md`.
```

(Fill `<hash>`, `<list claims updated>`, date placeholders with actuals.)

- [ ] **Step 2: Commit session-state**

```bash
git add docs/superpowers/session-states/session-state-2026-XX-XX-phase-1-1-2-1-closed.md
git commit --no-gpg-sign -m "docs(session-close): Phase 1.1.2.1 closed"
```

- [ ] **Step 3: Tag + push**

```bash
git tag phase-1-1-2-1
git push origin master --tags
```

- [ ] **Step 4: Update MEMORY.md project memory**

Edit `/Users/uncerso/.claude/projects/-Users-uncerso-src-wasm-rust-cpp-js/memory/project_wasm_benchmarks.md` (find via `MEMORY.md` index entry). Update description:
- "Phase 1.1.2.1 closed; Phase 1.1.3 (shape_dispatch) — pending brainstorm".
- Note guidelines now cross-runtime-confirmed.

Then re-check `MEMORY.md` index line for this entry; update the `—` description portion to match.

- [ ] **Step 5: Final master gates green**

```bash
pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke
git log --oneline -10
git tag | grep phase
```

Expected: all green; HEAD = "session-close" commit; `phase-1-1-2-1` in tag list.

---

## Self-review checklist (run before handing off to executing-plans)

- **Spec coverage:** Each spec section (1-11) maps to ≥1 task above:
  - § Purpose → Task 12 (full bench:all reliable run)
  - § Scope > In scope → Tasks 2-9 (driver refactor + recovery + smoke + re-bench) + 16-19 (guidelines + tech-debt)
  - § Architecture → Tasks 2-3 (driver module), Task 7 (run-matrix loop)
  - § Case state reset → Task 3 (driver.get within runCase — full reload by default)
  - § Error recovery → Tasks 4-5 (timeout race + retry helper), Task 7 (integration + consecutive abort)
  - § Re-bench → Tasks 12-14
  - § Guidelines harvest → Tasks 16-17
  - § Tech-debt + roadmap updates → Tasks 18-19
  - § Wave structure → Wave-prefixed sections; W1 = Tasks 1-10, W2 = Tasks 11-15, W3 = Tasks 16-20
  - § Exit criteria → Tasks 12 (810 cases), 16-17 (guidelines), 18 (tech-debt), 19 (sketch), 20 (tag)
  - § Open risks → noted as decision points (Task 13 sanity-diff stop condition; Task 8 smoke time budget; Task 7 cross-workspace import fallback)

- **Type consistency:** `CaseInput`, `CaseResult`, `DriverSession`, `DriverSessionLike`, `RetryFailure`, `CreateSessionFn` defined in Task 2 / Task 5; reused in Task 7. `--restart-every`, `--benchmarks`, `restartEvery`, `benchmarks` field names consistent across CliArgs + parseArgs + main loop.

- **Placeholder scan:** `2026-XX-XX` placeholders intentional (date stamped at execution). No "TBD" / "TODO" / "fill in" / "similar to" entries. All code blocks contain actual code.

- **Frequent commits:** Each task ends with a commit. Tasks 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 (merge), 14 (results), 16, 17, 18, 19, 20 (3 commits within).
