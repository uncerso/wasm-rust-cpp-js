# Session state — sorted_map_int workload (Phase 1.2)

## TL;DR
- Branch `feature/phase-1.2-sorted-map-workload` (from master `de9b9d1`), **14 commits, NOT pushed**.
- New workload `sorted_map_int` (ordered map, **range-query** core) across the full toolchain matrix (cpp emscripten/wasi-sdk, rust raw/bindgen, js idiomatic/typed-array × speed/size). All gates green; all 6 impls validated (node matrix **30/30**, parity gate idiomatic≡typed≡reference).
- User ran `bench:all` → `results/raw/2026-07-12T11-28-04-467Z` (270 sorted_map results, 0 correctness-fail); report `results/summarized/2026-07-12T11-45-37-082Z/`.
- Guidelines +2 claims (size tentative, perf confirmed); roadmap cleaned.

## What the next session needs
- **User: push + PR** (Yubikey SSH, `gh` absent — agent can't push).
- **User: browser eyeball** of the report (agent did structural check only — 23 sorted_map refs, no reporter code changed → low render risk).

## Deferred / open-loops
- **push + PR** — user action (command in Resume).
- **browser eyeball** — user (agent can't drive browser visual).
- **final whole-branch review** — SKIPPED this session per user (empirical validation strong: parity + 30/30 matrix + all gates incl browser smoke + 5 clean per-task reviews).
- **string sorted-map** (`sorted_map_int` sibling) — would upgrade the size guideline from tentative→confirmed (single key-type now).
- **btreemap-no-std-alloc-floor** — roadmap TBD (size-differential follow-up).
- **parallel-bench-execution** — roadmap TBD (speed up `bench:all`; CAVEAT: perf-contention vs cv-discipline).
- **benches-tests-not-in-gate** — tech-debt (`benches/**/*.test.ts` outside `pnpm test`; + eslint project-service workaround: bench tests → `validate/`).

## Resume
```
# user pushes + opens PR:
git push -u origin feature/phase-1.2-sorted-map-workload
# compare: https://github.com/uncerso/wasm-rust-cpp-js/compare/master...feature/phase-1.2-sorted-map-workload

# view report (new workload on Size + Perf tabs):
open results/summarized/2026-07-12T11-45-37-082Z/index.html
```

## Stop point
Workload complete on branch; all gates green; guidelines + roadmap harvested; finish-session applied (CLAUDE.md workload-list +`sorted_map_int`; tech-debt `benches-tests-not-in-gate`; roadmap +3 TBD −3 stale PR#14 items −sorted-map-from-stdlib-containers). 3 review Minors closed (`67b71ed`). Remaining: user push/PR + browser eyeball. Headline numbers (run 2026-07-12T11-28-04): cpp ordered −15…−22% gz vs hash; exact-lookup hash 4–11× faster than sorted (rust 11×); range rust `BTreeMap` 2.58× faster than cpp `std::map`, js typed-array competitive.
