# V8 12.4 JIT-deopt repro materials

Companion folder для `../2026-05-23-v8-deopt-switch-over-closure-const.md`. Содержит
инструкции для воспроизведения V8 12.4 deopt-eager codegen bug на Node 22.x.

> **Why no self-contained `.mjs` repro in this folder?**
> Bug требует двух одновременных триггеров: (1) tsx CLI invocation (preflight.cjs
> bootstrap), (2) полный harness import graph (Zod + `@bench/harness` + tsx on-the-fly
> transpile of 5+ .ts files). 5 итераций попытки сделать minimal self-contained .mjs
> repro не triggered bug — V8 12.4 в reduced context компилирует `run` без broken
> deopt-eager guard. Canonical reproduction — через checkout `feature/phase-1.1.2-bug`
> branch + полный harness path (ниже). Buggy code shape для reading сохранена в
> bug-report markdown § Reproduction + во второй секции ниже.

## Quick repro (через checkout bug branch)

Branch `feature/phase-1.1.2-bug` сохранена specifically для этого. Содержит buggy
source files (`benches/hashmap_*/js/idiomatic/src/index.ts` pre-fix shape) + bug-report
docs. From repo root:

> **Prerequisite:** working tree должен быть **clean** перед checkout. Branch
> содержит ранние версии `docs/superpowers/bug-reports/2026-05-23-v8-deopt-*` —
> git откажется переключаться если есть uncommitted versions same paths. Commit
> или stash до checkout.

```bash
# 1. Checkout bug branch:
git checkout feature/phase-1.1.2-bug

# 2. Make sure deps + tools installed (one-off; обычно already done):
pnpm install
pnpm setup-tools          # only if .tools/ not populated

# 3. Generate fixtures (gitignored):
pnpm fixtures

# 4. Build JS bundles:
pnpm exec tsx scripts/build-js.ts hashmap_int hashmap_string

# 5. Reproduce on Node 22 — fails with "unknown entry":
pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=hashmap_int --entry=hashmap_int_lookup \
  --language=js --toolchain=idiomatic --profile=speed \
  --size=S --out=/tmp/_debug --mode=eval

# Expected output:
#   Error: hashmap_int/js-idiomatic: unknown entry "hashmap_int_lookup"
#       at Object.l [as run] (file:///<repo>/dist/hashmap_int/js-idiomatic-speed/module.js:1:780)
#       at runMeasure (.../packages/harness/src/measure.ts:53:26)

# 6. Verify clean on Node 20 / Node 24 (V8 11.3 / V8 13.6):
/path/to/node-v20/bin/node \
  --require ./node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/preflight.cjs \
  --import  ./node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs \
  apps/runner-node/src/main.ts \
  --benchmark=hashmap_int --entry=hashmap_int_lookup \
  --language=js --toolchain=idiomatic --profile=speed \
  --size=S --out=/tmp/_debug --mode=eval

# 7. Verify --jitless workaround устраняет bug на Node 22 (same buggy source):
NODE_OPTIONS="--jitless" pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=hashmap_int --entry=hashmap_int_lookup \
  --language=js --toolchain=idiomatic --profile=speed \
  --size=S --out=/tmp/_debug --mode=eval

# 8. Return к master:
git checkout master
pnpm exec tsx scripts/build-js.ts hashmap_int hashmap_string   # rebuild master JS
```

## Buggy code shape (для reading без checkout)

Полная buggy pre-fix shape — committed на branch как
`benches/hashmap_int/js/idiomatic/src/index.ts` и
`benches/hashmap_string/js/idiomatic/src/index.ts`. Также доступна без checkout:

```bash
git show feature/phase-1.1.2-bug:benches/hashmap_int/js/idiomatic/src/index.ts
git show 0cc508b~1:benches/hashmap_int/js/idiomatic/src/index.ts            # same content via master
```

Ключевой фрагмент (function что V8 mis-компилирует):

```ts
export default function create(entry: string): BenchModule {
    let pairs: Array<readonly [number, number]> = [];
    const map = new Map<number, number>();
    // ... parsePairs, refillMap ...

    function run(iters: number): { checksum: number } {
        switch (entry) {                            // ← closure-const switch
            case "hashmap_int_insert": { /* hot loop */ ... }
            case "hashmap_int_lookup": {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    acc += map.get(pairs[i][0]) ?? 0;
                }
                return { checksum: acc };
            }
            case "hashmap_int_delete": { /* hot loop */ ... }
            default:
                throw new Error(`hashmap_int/js-idiomatic: unknown entry "${entry}"`);
        }
    }
    return { loadInput, run, reset };
}
```

`default:` branch — это ветка, бэйткод которой получает broken deopt continuation
target. См. parent bug-report § Root cause для bytecode-level analysis (offset 427
= `Add r10, [67]` инструкция template-literal'а в default-branch).

## V8 tracing для root-cause investigation

Critical: `--trace-deopt` сам по себе скрывает bug когда подаётся через `NODE_OPTIONS`
(security filter rejects flag) — used directly через `node ...`. Tracing запускается
поверх buggy source, после step (4) выше:

```bash
node --trace-deopt --trace-opt \
  --require ./node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/preflight.cjs \
  --import  ./node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs \
  apps/runner-node/src/main.ts \
  --benchmark=hashmap_int --entry=hashmap_int_lookup \
  --language=js --toolchain=idiomatic --profile=speed \
  --size=S --out=/tmp/_debug --mode=eval 2>&1 | grep -E "JSFunction l|bailout"
```

Expected output (V8 12.4 / Node 22.22.3):
```
[marking <JSFunction l> for optimization to TURBOFAN, reason: hot and stable]
[completed optimizing <JSFunction l> (target TURBOFAN)]
[bailout (kind: deopt-eager, reason: Insufficient type feedback for binary operation): ...
  bytecode offset 427 ...]
```

Bytecode dump для маппинга offset → source position:

```bash
node --print-bytecode --print-bytecode-filter=l \
  --require ./node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/preflight.cjs \
  --import  ./node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs \
  apps/runner-node/src/main.ts ...
```

В output найди `[generated bytecode for function: l ...]`. Offset 427 — `Add r10, [67]`
инструкция в default-branch template-literal'е.

## NODE_OPTIONS restrictions

Note: `--trace-deopt`, `--trace-opt`, `--print-bytecode` нельзя пробросить через
`NODE_OPTIONS` (Node-side security filter). Use direct `node ...` invocation выше.
`--jitless` — allowed через `NODE_OPTIONS`.

## Что подтверждено

- ✅ Source code корректен (cases match `entry` byte-for-byte; verified `xxd`).
- ✅ Bundle корректен (3 case branches present в `dist/.../module.js`).
- ✅ Loader передаёт правильный entry string.
- ✅ Bug — deopt continuation point miscomputed → resume at default-branch bytecode (offset 427).
- ✅ `--jitless` устраняет (turbofan-cause confirmed).
- ✅ V8 12.4-only — V8 11.3 (Node 20) и V8 13.6 (Node 24) чисты.
- ✅ Heisenbug — два trigger'а одновременно требуются. **(1)** tsx `preflight.cjs` в child node invocation; bare `node script.mjs` — clean. **(2)** Full harness "competing work" volume — Zod parses, multi-package import graph, tsx on-the-fly transpile of 5+ .ts files. Изолированный minimal repro (`runMeasure` import + Zod schema parse + dynamic import factory + harness-like loop) под тем же tsx invocation **не** воспроизводит — недостаточно competing work для V8 tier-up window. (Verified 5 итераций, 2026-05-26.)

## Reference

- Parent bug-report: `../2026-05-23-v8-deopt-switch-over-closure-const.md`
- Workaround commit on master: `0cc508b`
- Bug-source branch (preserved для repro): `feature/phase-1.1.2-bug` —
  `git checkout feature/phase-1.1.2-bug`.
- Guidelines entry: `docs/guidelines.md` § Code patterns > "Избегай `switch (entry)`
  over closure-constant..."
