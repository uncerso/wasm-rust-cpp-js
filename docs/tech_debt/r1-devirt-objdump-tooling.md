---
id: r1-devirt-objdump-tooling
title: R1 devirt check `wasm-objdump` path missing — silently returns 0 (false "devirt fired")
created: 2026-06-02
source: session 2026-06-02 phase-1.1.3 Wave 2 (Tasks 16-18 execution)
category: latent-bug
status: open
priority: medium
---

## What

Phase 1.1.3 plan + spec specify R1 (devirtualization) verification via:

```bash
wasm-objdump -d <artifact>.wasm | grep -c call_indirect
```

But `wasm-objdump` (wabt) is **not installed** on this machine and is not in `.tools/`.
When invoked, the shell either errors (command not found) or — depending on how it's
piped — the `grep -c` against empty input returns `0`. A `0` count is the exact signal
for "devirtualization fired" (R1 risk materialized), so a missing tool produces a
**false R1-fired** reading for every binary, including the `*_dyn` ones that genuinely
preserve `call_indirect`.

During Task 16-18 execution the subagent caught this by sanity-checking the known-positive
`mixed_dyn` reference (which read `0` under the broken path) and switched to:

```bash
.tools/wasi-sdk-25/bin/llvm-objdump -d <artifact>.wasm | grep -c call_indirect
```

which gives correct counts (homo_dyn rust-raw = 9, mixed_dyn rust-raw = 3, etc.).
Earlier tasks (9, 14) had used `wasm-dis` (binaryen, present via wasm-opt) which also works.

## Why it matters

R1 is a named spec risk with a STOP-and-surface protocol. A verification command that
silently yields the failure signal regardless of the artifact defeats the whole gate:
either it wastes a STOP cycle (false alarm) or — worse — a reviewer "confirms" `> 0` using
a working tool while an automated step elsewhere uses the broken path and disagrees.
Any future phase that copies the plan's `wasm-objdump` invocation inherits the trap on a
fresh checkout. Blast radius: every devirt/codegen inspection step in shape_dispatch and
future dispatch-sensitive workloads.

## Possible fix

Pick one canonical, present-on-this-machine disassembler and use it everywhere:
- `.tools/wasi-sdk-25/bin/llvm-objdump -d` (confirmed working), OR
- `wasm-dis` from the binaryen install that ships `wasm-opt` (also working).

Then:
1. Add a tiny resolver to `scripts/tool-paths.ts` (e.g. `tool-paths.ts wasm-disasm`) so
   callers don't hardcode a version-pinned path like `.tools/wasi-sdk-25/...`.
2. Grep plan/spec/docs for `wasm-objdump` and replace with the resolver invocation.
3. Optionally: have the resolver `exit 1` (not print empty) if the tool is absent, so a
   missing disassembler is a hard error rather than a false `0`.
