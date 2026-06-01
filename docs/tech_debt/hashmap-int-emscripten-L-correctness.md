---
id: hashmap-int-emscripten-L-correctness
title: hashmap_int cpp-emscripten lookup+delete produce wrong checksum at L size
created: 2026-06-02
source: session 2026-06-02 phase-1.1.3 Wave 3 bench (results/raw/2026-06-02-phase-1-1-3); reproduced in baseline results/raw/2026-05-26-phase-1-1-2-1
category: latent-bug
status: open
priority: high
---

## What

`hashmap_int` compiled via **cpp-emscripten** fails correctness validation on the
`lookup` and `delete` entries at **L size only** (N = 100 000), across all 3 envs
(node, chromium, firefox) and both profiles (speed, size) — 12 cases total:

| entry | size | got | expected (spec.json) |
|---|---|---|---|
| hashmap_int_lookup | L | `213953188581571` | `213944096178963` |
| hashmap_int_delete | L | `213942901681979` | `213938355480675` |

`insert` at L passes (`99996` = expected). S and M sizes pass for all entries.
Only the cpp-emscripten toolchain is affected — rust-raw / rust-bindgen / wasi-sdk /
js-idiomatic all validate at L. The wrong checksums are **bit-identical** to the
Phase 1.1.2.1 baseline run (2026-05-26), so this is deterministic and reproducible,
**not** a flaky measurement and **not** a regression from the shape_dispatch work.

The got-values are *close* to expected (off by ~9e9 / ~4.5e9 out of ~2.1e14), which
points at a small number of mis-probed/mis-counted entries rather than total garbage —
consistent with a hash-table sizing / probing-order / integer-width edge that only
trips at large N under the emscripten codegen.

## Why it matters

A shipped workload produces silently-wrong results for 2 of its 3 entries at the
largest size on one toolchain. Any guideline or comparison drawing on hashmap_int
cpp-emscripten L numbers is built on invalid output. It also slipped through the
Phase 1.1.2.1 close undocumented (see [[bench-run-correctness-fail-not-surfaced]] for
the gate gap that hid it). priority: high because it's a correctness defect, not perf.

## Possible fix

Investigation needed — root-cause the C++ `hashmap_int` impl at N=100k under emscripten:
1. Diff emscripten vs wasi-sdk codegen for the lookup/delete paths (same .cpp, so the
   divergence is toolchain/UB-sensitivity, not source logic per se).
2. Suspects: hash/index integer width (32 vs 64-bit truncation at large N), table
   capacity/rehash threshold, signed/unsigned probe arithmetic, or reliance on
   emscripten default memory growth behaviour.
3. Confirm whether the spec.json expected checksum (derived from the TS reference) is
   itself correct at L — i.e. is emscripten wrong, or is the reference wrong? The other
   3 toolchains agreeing with the reference strongly implicates emscripten.
4. Once root-caused, decide: fix the C++ impl, or document as a known emscripten
   limitation in README if it's an accepted toolchain quirk.
