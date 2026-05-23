# V8 JIT-deopt repro materials

Sibling files to `../2026-05-23-v8-deopt-switch-over-closure-const.md`.

## Quick repro (from repo root, on this branch `feature/phase-1.1.2-bug`)

```bash
# Setup (only if not done):
pnpm install
pnpm fixtures
pnpm build:js

# The failure (harness-mediated, exits 1):
pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=hashmap_int --entry=hashmap_int_lookup \
  --language=js --toolchain=idiomatic --profile=speed \
  --size=S --out=/tmp/_debug --mode=eval

# The non-failure (manual repro outside harness — succeeds):
node docs/superpowers/bug-reports/2026-05-23-v8-deopt-repro/manual-runner.mjs

# Workaround verification (eval mode succeeds with --jitless):
NODE_OPTIONS="--jitless" pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=hashmap_int --entry=hashmap_int_lookup \
  --language=js --toolchain=idiomatic --profile=speed \
  --size=S --out=/tmp/_debug --mode=eval
```

## V8 tracing flags for next investigation

```bash
# Show deopts:
NODE_OPTIONS="--trace-deopt" pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=hashmap_int --entry=hashmap_int_lookup \
  --language=js --toolchain=idiomatic --profile=speed \
  --size=S --out=/tmp/_debug --mode=eval 2>&1 | head -200

# Show what turbofan optimized:
NODE_OPTIONS="--trace-opt" pnpm exec tsx apps/runner-node/src/main.ts ...

# Dump optimized code:
NODE_OPTIONS="--print-opt-code" pnpm exec tsx ...

# Disable specific tiers to bisect:
NODE_OPTIONS="--no-maglev" pnpm exec tsx ...
NODE_OPTIONS="--no-turbofan" pnpm exec tsx ...
```

## Bundle inspection

The built JS bundle that triggers the bug:

```bash
cat dist/hashmap_int/js-idiomatic-speed/module.js | jq -R 'split("function ")' | head
```

Or look at the un-minified source:

```bash
cat benches/hashmap_int/js/idiomatic/src/index.ts
```

## Things confirmed (see parent file for full notes)

- ✅ Source code is correct (cases match `entry` byte-for-byte).
- ✅ Bundle is correct (cases preserved by esbuild).
- ✅ Loader passes correct entry string (`DBG-plain-js entry:` instrumentation).
- ✅ Bug is consistent: 3/3 reproductions of eval+S+lookup throw `unknown entry`.
- ✅ `--jitless` reliably fixes it.
- ✅ Manual repro (same call sequence outside harness) does NOT trigger the bug.
- ❌ Root cause not yet identified.
