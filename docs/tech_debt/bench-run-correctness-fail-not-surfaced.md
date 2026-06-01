---
id: bench-run-correctness-fail-not-surfaced
title: bench run reports "0 failures" while writing validated:false results — correctness-fail not surfaced
created: 2026-06-02
source: session 2026-06-02 phase-1.1.3 Wave 3 (Task 25 step 3)
category: process-gap
status: open
priority: medium
---

## What

A full `pnpm bench` run exits 0 and writes **no `failures.txt`** even when individual
result JSONs carry `quality.validated: false` / `correctnessFailed: true`. In the
2026-06-02 phase-1.1.3 run, 12 `hashmap_int` cpp-emscripten L cases failed correctness
(see [[hashmap-int-emscripten-L-correctness]]) yet the run looked clean by the plan's
Task 25 step-3 check (`test -f failures.txt && cat || echo "clean: 0 failures"`).

The same 12 failures are present in the Phase 1.1.2.1 baseline — meaning they survived
that phase's close undetected, because the close criteria keyed on `failures.txt` /
non-zero exit rather than scanning result JSONs for `validated:false`.

## Why it matters

"0 failures" is the headline success signal for a bench wave. If correctness failures
don't flip that signal, a phase can close green on top of silently-wrong data, and the
defect compounds across phases (it already crossed two: 1.1.2.1 → 1.1.3). The plan's
exit-criteria language ("342 new cases × 0 failures") is satisfiable while real
correctness failures sit in the output.

## Possible fix

1. Make the bench orchestrator (`scripts/run-matrix.ts`) treat `correctnessFailed: true`
   as a hard failure: append to `failures.txt` and/or exit non-zero. (Confirm why it
   currently doesn't — the per-case runner sets the flag, but the matrix driver may only
   record process-level crashes, not validation failures.)
2. Until fixed, add an explicit post-run grep to plan/CI gates:
   `grep -rl '"validated": false' <out>/*.json` must be empty.
3. Reconcile with the harness: a single-sample `nSamples:1` + `correctnessFailed` result
   suggests the case aborted early on mismatch — verify that early-abort path also
   propagates to the run summary, not just the JSON.
