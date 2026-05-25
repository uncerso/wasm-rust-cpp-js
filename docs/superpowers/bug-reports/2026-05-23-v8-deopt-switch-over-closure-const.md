# Bug report — V8 12.4 deopt-eager: switch over closure-const in hot loop mis-resumes at default branch

**Status:** root cause **confirmed** 2026-05-26. V8 12.4-only (Node 22.x). Workaround applied 2026-05-23 в commit `0cc508b`; investigation completed in follow-up session.

**Discovered:** 2026-05-23 во время Phase 1.1.2 Task 22 (`pnpm bench:all`).
**Bug branch (preserved для upstream report):** `feature/phase-1.1.2-bug`.
**Affected source files (now patched на master):**
- `benches/hashmap_string/js/idiomatic/src/index.ts`
- `benches/hashmap_int/js/idiomatic/src/index.ts`

---

## TL;DR

V8 12.4 (Node 22.x) turbofan-компилирует функцию `run` следующего шейпа:

```js
function run(iters) {
    switch (entry) {                    // entry — closure-const
        case "..._insert": {...}
        case "..._lookup": {...}
        case "..._delete": {...}
        default: throw new Error(`unknown entry "${entry}"`);   // ← template literal
    }
}
```

После warmup turbofan ставит deopt-eager guard в default-branch (`Add` instruction для template-literal'а — feedback slot пустой т.к. default never executed). На первом optimized call deopt срабатывает, **но continuation point miscomputed** — interpreter резюмит выполнение с bytecode offset default-ветки (offset 427) вместо корректного location в lookup-branch. Результат — `throw new Error("unknown entry ...")` несмотря на то, что `entry === "hashmap_int_lookup"`.

Bug **строго V8 12.4-only**. V8 11.3 (Node 20) и V8 13.6 (Node 24) чисты — V8 codegen fix between minor releases.

---

## Node version matrix

Запуск repro (см. ниже) на разных Node-версиях:

| Node | V8 | hashmap_int_lookup eval/S | hashmap_string_lookup eval/S |
|---|---|---|---|
| 20.19.5 | 11.3.244.8 | ✓ passes | ✓ passes |
| **22.22.3** | **12.4.254.21** | **❌ throws** | **❌ throws** |
| 24.14.1 | 13.6.233.17 | ✓ passes | ✓ passes |

(Все тесты — на повёрнутом-обратно buggy source через `git checkout 0cc508b~1 -- benches/hashmap_*/js/idiomatic/src/index.ts`, build:js, then run.)

Verified 2026-05-26. Bug сидит в V8 12.4 series, исправлен в V8 13.

---

## Reproduction

Canonical путь — checkout `feature/phase-1.1.2-bug` branch (содержит buggy source files
именно для этой цели):

```bash
git checkout feature/phase-1.1.2-bug
pnpm fixtures                                # generate fixtures
pnpm exec tsx scripts/build-js.ts hashmap_int hashmap_string

# Failure on Node 22:
pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=hashmap_int --entry=hashmap_int_lookup \
  --language=js --toolchain=idiomatic --profile=speed \
  --size=S --out=/tmp/_debug --mode=eval

# Return к master:
git checkout master
pnpm exec tsx scripts/build-js.ts hashmap_int hashmap_string
```

Полный workflow с tracing flags и cross-version verification — `./2026-05-23-v8-deopt-repro/README.md`.

**Expected:** result JSON.
**Actual (Node 22):**
```
Error: hashmap_int/js-idiomatic: unknown entry "hashmap_int_lookup"
    at Object.l [as run] (file:///<repo>/dist/hashmap_int/js-idiomatic-speed/module.js:1:780)
    at runMeasure (/<repo>/packages/harness/src/measure.ts:53:26)
    at runCase (/<repo>/apps/runner-node/src/run-case.ts:126:27)
    at async main (/<repo>/apps/runner-node/src/main.ts:43:15)
```

### Failure matrix (entry × mode × size, Node 22)

| entry                  | quick / S | eval / S | eval / M | eval / L |
| ---------------------- | --------- | -------- | -------- | -------- |
| hashmap_int_insert     | ✓         | ✓        | (n/t)    | (n/t)    |
| hashmap_int_lookup     | ✓         | **❌**   | ✓        | (n/t)    |
| hashmap_int_delete     | ✓         | ✓        | (n/t)    | (n/t)    |
| hashmap_string_insert  | ✓         | ✓        |          |          |
| hashmap_string_lookup  | ✓         | **❌**   |          |          |
| hashmap_string_delete  | ✓         | ✓        |          |          |

**Pattern:** только `*_lookup` entries, только eval mode (warmup=10, samples=30-100), только size S. Quick mode (warmup=3, max=10) не успевает довести `run` до tier-up.

---

## Heisenbug attribution (resolved 2026-05-26)

Original bug-report заявлял "Manual repro вне harness не падает". Это **не** общее свойство — bug требует специфический Node invocation:

| Invocation (full harness path — `apps/runner-node/src/main.ts ...`) | Reproduces? |
|---|---|
| `pnpm exec tsx apps/runner-node/src/main.ts ...` | **❌ fails (bug)** |
| `node --require ./node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/preflight.cjs --import ./node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs apps/runner-node/src/main.ts ...` | **❌ fails (bug)** |
| `node --import tsx apps/runner-node/src/main.ts ...` | ✓ passes |
| Isolated minimal repro (`.mjs` + dynamic-import factory + harness-like loop + real `@bench/harness` `runMeasure` + Zod schema parse) via `pnpm exec tsx` | ✓ passes |

Trigger #1 — наличие `--require preflight.cjs` (tsx pre-flight hook, CJS) во время full harness execution. Без него `--import loader.mjs` (один только ESM loader) не запускает bug. Hypothesis: preflight.cjs смещает warm-up timeline (ещё одна CJS module load, который turbofan видит до hot loop'а) → V8 tier-up прилетает в `run` в момент пустого feedback slot для default-branch `Add`. Без preflight turbofan компилирует `run` либо позднее (feedback уже стабилизирован), либо в другом порядке IR-passes.

Trigger #2 — full harness "competing work" volume. Verified across 5 итераций attempts at minimal isolated repro (inline factory; data: URL import; sibling-module static import; sibling-module dynamic import + performance.now() probes; everything plus Zod schema parse + real `@bench/harness` `runMeasure`). All прогоны под `pnpm exec tsx` (preflight присутствует) — но bug не triggers. V8's tier-up timing зависит от overall workload mix. Full harness loads `@bench/harness`, `@bench/loaders`, `@bench/result-schema`, tsx transpiles ~5 .ts files on-the-fly, Zod parses meta.json + spec.json + final BenchResultSchema — это competing work сдвигает tier-up trigger для `run` в нужное окно (slot [67] ещё empty). Меньшее volume → V8 успевает оптимизировать `run` без broken deopt-eager guard.

Practical implication: для воспроизведения нужен **полный harness path** (workflow в § Reproduction). Изолированный single-file repro в этом репо не достигнут.

`--trace-deopt` сам тоже скрывает bug (изменяет tier-up scheduling); bytecode dump (`--print-bytecode`) — не скрывает.

---

## Root cause (confirmed)

Repro с `node --trace-opt --trace-deopt --require preflight.cjs --import loader.mjs ...`:

```
[marking 0x... <JSFunction l> for optimization to TURBOFAN, ConcurrencyMode::kConcurrent, reason: hot and stable]
[compiling method 0x... <JSFunction l> (target TURBOFAN)]
[completed compiling 0x... <JSFunction l> (target TURBOFAN) - took 0.000, 1.084, 0.000 ms]
[completed optimizing 0x... <JSFunction l> (target TURBOFAN)]
[bailout (kind: deopt-eager, reason: Insufficient type feedback for binary operation):
  begin. deoptimizing 0x... <JSFunction l>, Code TURBOFAN, opt id 9,
  bytecode offset 427, deopt exit 0, FP to SP delta 80]
Error: hashmap_int/js-idiomatic: unknown entry "hashmap_int_lookup"
```

`node --print-bytecode --print-bytecode-filter=l ...` показывает функцию `l` (минифицированный `run`). Bytecode offset 427 lands в default branch:

```
@ 417 : LdaGlobal [19], [65]    # load "Error"
@ 420 : Star9
@ 421 : LdaConstant [20]        # "hashmap_int/js-idiomatic: unknown entry \""
@ 423 : Star10
@ 424 : LdaImmutableCurrentContextSlot [2]    # load `entry`
@ 426 : ToString                # ToString(entry)
@ 427 : Add r10, [67]           ← OFFSET 427: string concat, feedback slot [67]
@ 430 : Star10
@ 431 : LdaConstant [21]        # "\""
@ 433 : Add r10, [67]           # second concat, same feedback slot
@ 436 : Star10
@ 437 : Ldar r9
@ 439 : Construct r9, r10-r10, [68]    # new Error(...)
@ 444 : Throw
```

Feedback slot `[67]` обслуживает обе `Add`-инструкции template literal'а в default-branch. Default branch never executes в этом workload'е → feedback empty.

### Bug mechanism

1. Turbofan компилирует `run` ("hot and stable" → eligible).
2. При генерации кода для default-branch'а turbofan встречает `Add r10 [67]` без feedback. Не может оптимально lower'нуть → вставляет deopt-eager unconditional bailout.
3. **Bug:** При генерации deopt continuation для этого bailout, turbofan устанавливает resume bytecode offset = 427 (текущий PC default-branch'а) во всех frame translations этой функции, включая translations для других case'ов switch'а.
4. На первом optimized call с `entry === "hashmap_int_lookup"` управление попадает в lookup branch (где-то в offsets 248-324). Turbofan генерирует код для lookup branch'а, но если по какой-то причине требуется deopt-eager exit (например, из-за inlined function speculation failure внутри hot loop), оно использует *неправильный* resume offset 427.
5. Interpreter резюмит с offset 427 → `Add → Construct Error → Throw`.

Это не пользовательский bug — это V8 12.4 deopt translation/continuation bug. Fix в V8 13.x (Node 24+) подтверждает.

---

## Workaround (applied на master, commit `0cc508b`)

Factory-time dispatch: `create(entry)` switch'ит ОДИН РАЗ на entry value и возвращает специализированные `runFn` / `resetFn` closures. Hot loop вызывает прямую функцию (никакого switch внутри).

```ts
export default function create(entry: string): BenchModule {
    // state ...
    let runFn: (iters: number) => { checksum: number };
    let resetFn: () => void;
    switch (entry) {
        case "hashmap_int_insert":
            resetFn = () => { map.clear(); };
            runFn = (iters) => { /* hot loop без switch'а */ };
            break;
        case "hashmap_int_lookup": /* ... */ break;
        case "hashmap_int_delete": /* ... */ break;
        default: throw new Error(`unknown entry "${entry}"`);
    }
    return { loadInput, run: runFn, reset: resetFn };
}
```

**Why it works:** V8 видит прямой function call в hot loop, нет switch для специализации, нет template-literal Add в default-branch которому нужен feedback. Generated turbofan-код не имеет broken deopt continuation.

**Bonus:** factory-time dispatch — ближе к baseline wasm impls (`rust/raw` exports per entry, `cpp/wasi-sdk` exports per entry). Workaround сделал JS impl более "fair" baseline'ом для cross-toolchain comparison.

**Bundle delta:** -63 B raw, -6 B gz для hashmap_int (~7% raw); -72 B raw, -5 B gz для hashmap_string. Marginally smaller.

---

## Significance

- **Blocks bench:all** на Node 22 без workaround'а (eval mode требуется для phase-close measurements).
- **Methodology concern:** если benchmark code триггерит JIT bug, JS measurements мерят "JIT bug", не "JS hashmap perf". Workaround восстанавливает fairness.
- **Permanent workaround:** keep даже после Node 22 EOL. Bug class общий — closure-const switch с default-branch template-literal throw'ом потенциально fragile к аналогичным JIT codegen bugs.

---

## Upstream report — potential next step

Не отправлен upstream V8/Node на момент 2026-05-26. Если будет желание зарепортить:

- Minimal repro: 3-case string switch + closure-const + default-branch с `throw new Error(\`...${closureConst}\`)` + hot loop calling много раз → должно reproduce без harness.
- Bug branch `feature/phase-1.1.2-bug` сохранён as reference.
- Filed-or-not status: TBD.

Поскольку bug уже fixed upstream (V8 13.x чист), upstream report — низко-приоритетная contribution, не product-blocking.

---

## Environment

```
node: v22.22.3 (also tested v20.19.5, v24.14.1)
darwin: 24.6.0 (macOS 15.7.3)
arch: arm64
pnpm: per pnpm-lock.yaml
tsx: 4.21.0
```

V8 versions tested:
```
12.4.254.21-node.56     ← bug
11.3.244.8-node.30      ← clean
13.6.233.17-node.44     ← clean
```

---

## Related artifacts

- `./2026-05-23-v8-deopt-repro/README.md` — canonical repro instructions (branch checkout + full harness path + tracing flags).
- `docs/guidelines.md` § Code patterns > "Избегай `switch (entry)` over closure-constant..."
- Bug branch: `feature/phase-1.1.2-bug` — `git show feature/phase-1.1.2-bug` (preserved для future upstream report).
- Commit `0cc508b` — workaround on master.
