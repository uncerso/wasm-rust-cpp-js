# Session state — 2026-06-02 Phase 1.1.3 shape_dispatch closed

Phase 1.1.3 (shape_dispatch) **executed end-to-end + closed**; Phase 1.1 umbrella
closed. Subagent-driven execution across 6 waves with two-stage review per task.
Session was interrupted once by a usage limit (mid-Wave-2, JS impls) and resumed cleanly.

## TL;DR

- Master HEAD: `2f0ccc9`. Tags placed: `phase-1-1-3` + umbrella `phase-1-1` (both at HEAD).
- 32 commits since plan `f9a381f`. **Not pushed** — agentic commits stay local pending user review.
- 4 binaries (`shape_dispatch_{homo,mixed}_{static,dyn}`) — 2×2 factorial dispatch × layout.
  16 native impls (cpp emscripten+wasi-sdk, rust raw+bindgen × 4 binaries) + 3 JS
  (homo_static skipped for JS — collapses to homo_dyn via monomorphic IC).
- 945-case bench (`results/raw/2026-06-02-phase-1-1-3/`, eval mode, node+chromium+firefox × S,M,L):
  315 shape_dispatch × 0 failures. Cross-binary quantized checksum `14814091960` (S) holds across all toolchains.
- All 6 spec R-risks cleared (none fired): devirt preserved (`call_indirect`>0 on all `*_dyn`
  via llvm-objdump), wasi-sdk placement-new OK (inline `operator new` + libc.a for `log`),
  rust/raw fat-pointer via `*const dyn Shape`, checksum equality holds, reporter R6 not invasive.
- Reporter v2: shape_dispatch 2×2 headline grid (option B — pinned combo node/rust-raw/speed/L
  warm-median per cell + 4 detail tables). commit `dbe3e7e`.
- Guidelines: 9 claims total (5 confirmed + 4 tentative). 3 new from shape_dispatch (commit `52a7865`):
  dispatch-overhead (confirmed), monomorphization-premium (confirmed), JS-IC-cost (tentative).

## Done in this session

### Execution (Waves 0-6, subagent-driven)
- W0 pre-flight: baseline gates green.
- W1 infra: `genShapes` (`benches/common/fixtures.ts`) + `benches/common/shape-reference.ts`
  (quantized order-independent checksum) + 4 spec.json + fixtures + reference wrappers.
  R5 verified twice (fixture SHA + checksum cross-binary identical).
- W2 impls: 16 native + 3 JS, risk-first ordering (mixed_dyn first for R3/R4 fail-fast).
  Close gate: build:all + Vec-discipline + R1 devirt (8 dyn artifacts >0) + eval-mode validation.
- W3 bench: full 945-case matrix, 0 shape_dispatch failures.
- W4 reporter: 2×2 grid (user chose option B).
- W5 guidelines: 3 claims.
- W6 close: roadmap cleanup, /backlog-review, tags, drift-fix.

### 2×2 headline numbers (node/rust-raw/speed/L warm-median ms)
| | static | dynamic |
|---|---|---|
| homo | 0.580 | 0.699 (+20%) |
| mixed | 0.878 | 1.323 (+51%) |
Dispatch overhead scales with call-site monomorphism: homo (one type/loop) +20-28%,
mixed (interleaved, real polymorphic) +51-105% across 4 native toolchains. JS: only +0.6-9%.

### Tech-debt filed this session
- `r1-devirt-objdump-tooling.md` (medium) — `wasm-objdump` absent → false-zero; use `.tools/wasi-sdk-25/bin/llvm-objdump`.
- `hashmap-int-emscripten-L-correctness.md` (**high**, Phase 1.2 candidate) — pre-existing.
- `bench-run-correctness-fail-not-surfaced.md` (medium) — `validated:false` doesn't flip run signal.

### Pitfalls (`docs/pitfalls/2026-06-02-phase-1-1-3-closed.md`)
- P1 objdump sanity-check, P2 0-failures gate gap (record-only — fixes tech-debt'd).
- P3 revert-coupling — inline-applied to CLAUDE.md § Tooling environment.

### Drift fixes (this /finish-session)
- CLAUDE.md:53 workload list + entry enumeration → +shape_dispatch.
- MEMORY.md + project_wasm_benchmarks.md → 1.1.3/1.1 closed.
- roadmap.md → shape-dispatch retired, Phase 1.2 now current, hashmap bug surfaced.
- 2 stale `phase-1.1-candidate` tech-debt markers → `phase-1.2-candidate`.

## Notable finding (out of Phase 1.1.3 scope)

**Pre-existing correctness bug**: `hashmap_int` cpp-emscripten `lookup`+`delete` at L size
produce wrong checksum (12 cases, all 3 envs × 2 profiles), bit-identical to the 1.1.2.1
baseline → NOT a regression. emscripten-only (rust/wasi-sdk/js validate at L). Deterministic,
got-values close to expected (~9e9/4.5e9 off out of ~2.1e14) → small mis-probe at large N.
Surfaced as Phase 1.2 fix-candidate. Root-cause investigation deferred.

## Deferred items

- **Push to origin**: master ahead of origin by 32+ commits. Not pushed (awaiting user review).
- **hashmap_int emscripten L bug**: root-cause + fix (Phase 1.2 candidate, tech-debt high).
- **bench-run gate gap + objdump tooling**: tech-debt, ride /tech-debt-review cadence.
- **Untracked**: `.claude/settings.local.json` + `"Какие есть существующие бенчмарки wasm под браузер.md"` — pre-existing, not touched.

## What the next session needs

- Phase 1.2 is now the current roadmap target (CI & infra, hashmap-stdlib-no-glue, safari,
  + the hashmap correctness bug). `/backlog-review` before 1.2 start to re-triage.
- Reporter pinned-combo grid uses node/rust-raw/speed/L — if 1.2 changes toolchain set, revisit.
- Guidelines dispatch/monomorphization claims are single-workload — a 2nd dispatch-sensitive
  workload would graduate JS-IC-cost from tentative → confirmed.

## Полезные команды

```bash
git log --oneline f9a381f..HEAD          # 32 phase-1.1.3 commits
git tag --points-at HEAD                 # phase-1-1, phase-1-1-3
.tools/wasi-sdk-25/bin/llvm-objdump -d <wasm> | grep -c call_indirect   # R1 check (NOT wasm-objdump)
grep -rl '"validated": false' results/raw/2026-06-02-phase-1-1-3/*.json # correctness scan
pnpm report --in=results/raw/2026-06-02-phase-1-1-3   # regen reporter (2×2 grid)
```

## Stop point

- Phase 1.1.3 + Phase 1.1 **closed**, tagged, gates green, working tree clean.
- 32 commits local on master, not pushed.
- Phase 1.2 is next; no execution started.
