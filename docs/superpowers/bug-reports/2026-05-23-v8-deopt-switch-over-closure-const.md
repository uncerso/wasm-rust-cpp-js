# Bug report — V8 deopt: switch over closure-const in hot loop throws "unknown entry" at default branch

**Discovered:** 2026-05-23 во время Phase 1.1.2 Task 22 (`pnpm bench:all`).
**Branch with reproducer:** `feature/phase-1.1.2-bug` (этот файл — snapshot бранча; JS impls
содержат un-refactored switch-pattern, ровно тот, который ломается).
**Affected source files:**
- `benches/hashmap_string/js/idiomatic/src/index.ts`
- `benches/hashmap_int/js/idiomatic/src/index.ts`

**Affected built artifacts:**
- `dist/hashmap_string/js-idiomatic-speed/module.js`
- `dist/hashmap_int/js-idiomatic-speed/module.js`

---

## TL;DR

`benches/<workload>/js/idiomatic/src/index.ts` ships a factory `create(entry)` whose
returned `run(iters)` does `switch (entry) { case ...; ... default: throw "unknown entry"; }`.
`entry` is a closure-constant captured at `create()` time. In Node v22.22.3 / V8 (default
JIT), repeatedly calling `run()` with sample counts ≥30 (`--mode=eval` minSamples=30) at
**size S** specifically для **lookup** entries causes the `default:` branch to fire even
though `entry === "hashmap_<x>_lookup"` and the matching `case` literal is byte-identical.

Adding `NODE_OPTIONS=--jitless` makes the bug disappear, confirming it's a turbofan tier-up
issue, not a code defect.

This blocks Phase 1.1.2 Task 22 (`pnpm bench:all`) because eval mode is what bench:all uses.

---

## Reproduction

All commands run from repo root `/Users/uncerso/src/wasm-rust-cpp-js`. Requires:
- Build artifacts present (`pnpm build:all` first, or at minimum `pnpm build:js` +
  fixtures available — `pnpm fixtures`).
- This bug branch checked out so JS impls have the broken pattern.

### Minimal repro (one combo, one entry, one size, eval mode)

```bash
pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=hashmap_int --entry=hashmap_int_lookup \
  --language=js --toolchain=idiomatic --profile=speed \
  --size=S --out=/tmp/_debug --mode=eval
```

**Expected:** result JSON written.
**Actual:**
```
Error: hashmap_int/js-idiomatic: unknown entry "hashmap_int_lookup"
    at Object.l [as run] (file:///<repo>/dist/hashmap_int/js-idiomatic-speed/module.js:1:780)
    at runMeasure (/<repo>/packages/harness/src/measure.ts:53:26)
    at runCase (/<repo>/apps/runner-node/src/run-case.ts:126:27)
    at async main (/<repo>/apps/runner-node/src/main.ts:43:15)
```

### Failure matrix (entry × mode × size)

| entry                  | quick / S | eval / S | eval / M | eval / L |
| ---------------------- | --------- | -------- | -------- | -------- |
| hashmap_int_insert     | ✓         | ✓        | (not tested L) | (not tested L) |
| hashmap_int_lookup     | ✓         | **❌**   | ✓        | (not tested L) |
| hashmap_int_delete     | ✓         | ✓        | (not tested L) | (not tested L) |
| hashmap_string_insert  | ✓         | ✓        |          |          |
| hashmap_string_lookup  | ✓         | **❌**   |          |          |
| hashmap_string_delete  | ✓         | ✓        |          |          |

**Pattern:** only `*_lookup` entries fail, only in eval mode, only at size S.

### Disabling JIT fixes it

```bash
NODE_OPTIONS="--jitless" pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=hashmap_int --entry=hashmap_int_lookup \
  --language=js --toolchain=idiomatic --profile=speed \
  --size=S --out=/tmp/_debug --mode=eval
```

**Result:** succeeds (with V8 warnings about `--expose_wasm`).

### Manual repro reproducing the eval-mode sequence outside the harness — does NOT fail

```bash
cat > /tmp/_debug-runner.mjs << 'EOF'
import("file:///<repo>/dist/hashmap_int/js-idiomatic-speed/module.js").then(async (m) => {
    const mod = m.default("hashmap_int_lookup");
    const { readFile } = await import("node:fs/promises");
    const buf = new Uint8Array(await readFile("/<repo>/benches/hashmap_int/fixtures/s.bin"));
    mod.loadInput(buf);
    console.log("first call:", mod.run(1));
    for (let i = 0; i < 10; i++) mod.run(1000);    // simulate eval warmup
    console.log("after warmup");
    for (let i = 0; i < 30; i++) {                  // simulate eval sample loop (minSamples)
        mod.reset();
        const r = mod.run(1000);
        if (r.checksum !== 2078117175396) { console.log("sample", i, "wrong:", r); break; }
    }
    console.log("DONE");
}).catch(e => console.error("ERR:", e));
EOF
node /tmp/_debug-runner.mjs
```

**Result:** completes `DONE` без ошибок. So the failure mode requires *something else* про
harness/runner-node context — likely a JIT optimization triggered by execution path.

---

## Observations / what's been confirmed

1. **Source code is correct.** All 3 entry cases (`hashmap_<x>_insert`, `_lookup`, `_delete`)
   exist in both `reset()` and `run()` switches. Byte-identical strings (verified via
   `xxd benches/hashmap_int/spec.json | grep lookup`).

2. **Bundle is correct.** `dist/hashmap_int/js-idiomatic-speed/module.js` contains all 3
   cases:
   ```js
   function l(t){switch(i){case"hashmap_int_insert":{...}case"hashmap_int_lookup":{let e=0;for(let n=0;n<t;n++)e+=r.get(s[n][0])??0;return{checksum:e}}case"hashmap_int_delete":{...}default:throw new Error(`hashmap_int/js-idiomatic: unknown entry "${i}"`)}}
   ```
   Verified via `cat dist/hashmap_int/js-idiomatic-speed/module.js`.

3. **Loader passes correct entry.** Instrumented `packages/loaders/src/plain-js.ts`:
   ```ts
   console.error("DBG-plain-js entry:", JSON.stringify(input.entry));
   const compiled = await timed(() => factory.default(input.entry));
   ```
   Logs `DBG-plain-js entry: "hashmap_int_lookup"` immediately before the throw fires.

4. **Smoke at size S in quick mode passes for all entries** — that's why the bug didn't
   appear in `pnpm smoke` after Wave 2 close. Smoke uses `--mode=quick` (minSamples=5,
   maxSamples=10), bench uses `--mode=eval` (minSamples=30, maxSamples=100).

5. **Eval at size M passes for lookup.** Bug is sensitive to (mode, entry, size)
   combination — specifically high sample count × lookup-shaped hot loop × small map.

6. **`--jitless` reliably fixes it.** Confirms JIT-tier-up as cause (turbofan most likely;
   maglev possible but less specific to switch optimization).

7. **Manual repro outside harness completes.** Same fixture + same module call sequence
   (run(1) + 10x run(1000) + 30x reset+run(1000)) succeeds via direct `node script.mjs`.
   So the trigger requires something specific про harness or runner-node — possibly
   `tsx` module loading semantics, `await` boundaries, or interaction with
   `performance.now()` calls between iterations.

---

## Hypotheses (none confirmed; for next session to investigate)

### H1 — Turbofan inlines the switch and speculates a single hit case

V8's turbofan likely sees `switch(i)` with `i` as a closure constant and inlines/specializes
the hot path. If the speculation goes wrong (e.g., type confusion or a soft-deopt
trigger), the fallback bytecode path might be the `default:` branch только. This would
explain why insert/delete work (their hot bodies are different) and lookup fails
(its body is the smallest and most likely candidate for aggressive inlining).

**Test candidates:**
- Run with `--print-opt-source` / `--trace-deopt` / `--trace-turbo` to see what
  turbofan does to `l()`.
- Try writing a microbench that triggers same pattern: closure-const switch + Map.get in
  hot loop + many iterations.

### H2 — `??` (nullish coalescing) interacts badly with Map.get speculation

Lookup case has `acc += r.get(s[n][0]) ?? 0`. If V8 speculates that `r.get` always returns
a number (after first thousand hits prove it), it might omit the `?? 0` branch and then
deopt incorrectly. But this would corrupt the value, not throw.

**Test candidate:** rewrite lookup as `const v = r.get(...); if (v !== undefined) acc += v;`
(same as delete pattern, which works), see if bug disappears.

### H3 — Harness/runner-node interaction with V8 tiering schedule

Manual repro outside harness succeeds. So something in harness/runner-node makes V8 tier
up faster или differently. Candidates:
- `performance.now()` calls between iterations — might affect inlining heuristics.
- `await` boundaries (firstResult, samples-loop) — V8 deopts при поднятии promise через
  optimized frame?
- `BenchResultSchema.parse(result)` at end — Zod has heavy dynamic dispatch which V8 might
  poison.

**Test candidate:** strip harness down to bare-minimum invocation matching the manual repro;
identify which line triggers the deopt.

### H4 — Maglev/turbofan version-specific bug in Node 22

Node 22 uses V8 12.4 which introduced changes to maglev tier. Worth testing:
- Other Node versions (20 LTS, 24).
- `--no-maglev`, `--no-turbofan` selectively.

---

## Workaround applied на feature/phase-1-1-2

Refactor `benches/<workload>/js/idiomatic/src/index.ts` to dispatch entry → run/reset at
factory time (no per-call switch). This means `create("hashmap_int_lookup")` returns a
module whose `run` is *the lookup function directly*, not a switch.

**Why this works:** V8 sees a direct function call, no switch to specialize, no
speculation-vs-fallback mismatch.

**Cost:** marginally more code duplication (3 run bodies repeated inline). Не invalidates
benchmark fairness — wasm impls (Rust/C++) already use per-entry exports, so the JS
factory-time-dispatch is closer to wasm baseline, not further from it.

**Sketch of patched code:**

```ts
export default function create(entry: string): BenchModule {
    let pairs: Array<readonly [Key, number]> = [];
    const map = new Map<Key, number>();

    function parsePairs(buf: Uint8Array): void { /* unchanged */ }
    function refillMap(): void { /* unchanged */ }

    let runFn: (iters: number) => { checksum: number };
    let resetFn: () => void;

    switch (entry) {
        case "hashmap_int_insert":
            resetFn = () => { map.clear(); };
            runFn = (iters) => {
                for (let i = 0; i < iters; i++) {
                    const [k, v] = pairs[i]!;
                    map.set(k, v);
                }
                return { checksum: map.size };
            };
            break;
        case "hashmap_int_lookup":
            resetFn = () => {};
            runFn = (iters) => {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    acc += map.get(pairs[i]![0]) ?? 0;
                }
                return { checksum: acc };
            };
            break;
        case "hashmap_int_delete":
            resetFn = () => { refillMap(); };
            runFn = (iters) => {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    const k = pairs[i]![0];
                    const v = map.get(k);
                    if (v !== undefined) { acc += v; map.delete(k); }
                }
                return { checksum: acc };
            };
            break;
        default:
            throw new Error(`hashmap_int/js-idiomatic: unknown entry "${entry}"`);
    }

    return {
        loadInput(buf) { parsePairs(buf); refillMap(); },
        run: runFn,
        reset: resetFn,
    };
}
```

---

## Environment

```
node: v22.22.3
darwin: 24.6.0 (macOS 15.7.3)
arch: arm64
pnpm: see pnpm-lock.yaml
tsx: see package.json (workspace deps)
```

V8 details (`node -p "process.versions.v8"`):

```
12.4.254.21-node.56
```

---

## Reproducer files preserved on `feature/phase-1.1.2-bug`

- This file.
- The un-refactored JS impl sources (Tasks 15/16) showing the switch-in-run pattern.
- The built artifacts in `dist/hashmap_<x>/js-idiomatic-speed/module.js`. (May need
  `pnpm build:js` to regenerate; bundles are deterministic on the same source.)

To resurrect repro from scratch:

```bash
git checkout feature/phase-1.1.2-bug
pnpm install
pnpm setup-tools                # only if .tools/ not yet populated
pnpm fixtures                   # generate s.bin/m.bin/l.bin
pnpm build:js                   # rebuild JS bundles
pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=hashmap_int --entry=hashmap_int_lookup \
  --language=js --toolchain=idiomatic --profile=speed \
  --size=S --out=/tmp/_debug --mode=eval
# Expect: Error: unknown entry "hashmap_int_lookup"
```

---

## What to investigate next session

1. **Capture V8 version exactly** (`process.versions.v8`).
2. **Repro on Node 20 LTS and Node 24** to see if it's Node-22-specific.
3. **Run with V8 tracing flags** (`--trace-deopt`, `--trace-turbo`, `--print-opt-code`)
   on the minimal repro. Identify which optimization deopts incorrectly.
4. **Bisect harness vs manual:** trim runner-node to the bare minimum and see when the
   bug surfaces vs disappears. Specifically test:
   - Without `BenchResultSchema.parse`.
   - Without `performance.now()` calls.
   - Without `await` boundaries.
   - Without spec-loading code paths.
5. **File minimal V8 bug report** if root cause is confirmed turbofan misbehavior, not
   a code semantic issue.
6. **Validate workaround durability:** ensure the factory-time dispatch pattern doesn't
   trigger similar JIT bugs in other workloads (`shape_dispatch`?).
7. **Document лесон-learned пitfall** в `docs/pitfalls/`: "Avoid switch over closure-const
   in hot loop bodies for V8-targeted JS benchmark workloads."
8. **Consider expanding scope:** if turbofan has issues with our hot-loop patterns, the
   Phase 1.1.2 JS measurements might not reflect typical product-engineer JS performance.
   Worth investigating whether real-world JS apps hit similar deopts and whether our
   `benches/<workload>/js/typed-array/` variants (matmul has one) avoid it.

---

## Significance / impact

- **Blocks bench:all** on master without workaround. Без рефактора Task 22 не доедет до
  end-of-evaluation.
- **Methodology concern:** if benchmark code triggers a JIT bug, the JS measurements
  measure "JIT bug" not "JS hashmap perf." Workaround restores fairness.
- **Evidence-base risk:** the broken bundle (this branch) measured *something* — was it
  deopted code path? If we run bench:all on this branch with `--jitless`, we get
  *jitless* perf, not realistic JS. Workaround is the only way to get production-like
  numbers.

---

## Acknowledgement / non-goals

- This document is **not a root-cause analysis**. It's a reproducer + hypotheses for the
  next investigation session.
- It does **not** propose to file an upstream V8 bug yet — that requires confirming the
  bug independently of our harness (which the manual repro currently fails to do).
- The workaround on `feature/phase-1-1-2` is **applied for Phase 1.1.2 close**; deeper
  investigation can land later without blocking the phase merge.
