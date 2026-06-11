# Session state — 2026-05-23 (Phase 1.1.2 closed)

Phase 1.1.2 execution complete. Handoff для следующей сессии.

---

## TL;DR — где мы сейчас

- Branch: **`master`** (Phase 1.1.2 merged via `--no-ff` from `feature/phase-1-1-2`).
- Master HEAD: **`6b8073d`** (merge commit).
- Tag: **`phase-1-1-2`** (on feature branch HEAD, pre-merge).
- All gates green: `pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke` (smoke 70/70).
- **NOT pushed** to `origin/master` — user OK pending.
- Bug investigation branch preserved: **`feature/phase-1.1.2-bug`** (HEAD `62a309d`).

---

## Done in this session (2026-05-23)

### Code / infrastructure

| Path | Purpose | Commit |
|---|---|---|
| `benches/common/fixtures.ts` + `.test.ts` | mulberry32 + 3 generators (genF64Array, genAsciiHexKeys, genIntPairs53) | `6e4c8cd` / `5c44361` / `73c97ce` / `97d1ba2` |
| `benches/matmul/fixtures/generate.ts` | refactored to use common genF64Array (byte-preserving) | `1fac09c` |
| `tsconfig.json` | `benches/common/**/*` added to include | `ea2bada` |
| `benches/hashmap_string/` (full workload tree) | spec.json, fixtures, validate/reference, js/idiomatic, rust/bindgen, cpp/emscripten | `aa00688`-`b2a542d` |
| `benches/hashmap_int/` (full workload tree) | same as above для u64 keys | `d541425`-`909940b` |
| `packages/loaders/src/bind-reset.ts` + `.test.ts` | DRY helper: per-entry `<entry>_reset` lookup with generic fallback | `b35f666` |
| `packages/loaders/src/{raw-wasm,rust-bindgen,emscripten}.ts` | use bindReset | `b35f666` |
| `Cargo.toml` (root) | added 2 hashmap rust crates к workspace members | `9adfaff` / `3b8d5a3` |

### Docs

| Path | Purpose | Commit |
|---|---|---|
| `docs/roadmap.md` | removed hashmap-workload from Phase 1.1; added hashmap-stdlib-no-glue to Phase 1.2 | `400a021` |
| `docs/guidelines.md` | 2 new confirmed claims (toolchain choice + V8 deopt code pattern) | `e644a89` |
| `docs/pitfalls/2026-05-23-phase-1-1-2-execution.md` | 7 pitfalls captured (planning, tooling, process) | (this commit) |
| `docs/superpowers/bug-reports/2026-05-23-v8-deopt-*` | full V8 deopt investigation materials (on bug branch) | `62a309d` (bug branch only) |

### Important commits in linear order

```
6e4c8cd feat(common/fixtures): mulberry32 PRNG, lifted from matmul
5c44361 feat(common/fixtures): genF64Array (byte-preserving for matmul)
1fac09c refactor(matmul/fixtures): use common genF64Array (byte-preserving)
73c97ce feat(common/fixtures): genAsciiHexKeys for hashmap_string
97d1ba2 feat(common/fixtures): genIntPairs53 for hashmap_int
ea2bada chore(tsconfig): include benches/common/** for common/fixtures.ts
aa00688 feat(hashmap_string): spec.json skeleton (TBD checksums)
5fe46b6 feat(hashmap_string/fixtures): generator + fixtureSha256 in spec
9a63d21 feat(hashmap_string/validate): reference impl + expectedChecksums
d541425 feat(hashmap_int): spec.json skeleton (TBD checksums)
138dead feat(hashmap_int/fixtures): generator + fixtureSha256 in spec
9913276 feat(hashmap_int/validate): reference impl + expectedChecksums
b35f666 feat(loaders): bindReset helper — per-entry <entry>_reset lookup with generic fallback
5962ee5 feat(hashmap_string): js/idiomatic impl
a060247 feat(hashmap_int): js/idiomatic impl
9adfaff feat(hashmap_string): rust/bindgen impl (std HashMap)
3b8d5a3 feat(hashmap_int): rust/bindgen impl (std HashMap)
b2a542d feat(hashmap_string): cpp/emscripten impl (libc++ unordered_map)
909940b feat(hashmap_int): cpp/emscripten impl (libc++ unordered_map)
400a021 docs(roadmap): remove hashmap-workload (completed in 1.1.2); add hashmap-stdlib-no-glue for 1.2
343c727 chore(lint): fix latent brace-style violations in hashmap_*/validate/reference.ts
0cc508b fix(hashmap_*/js/idiomatic): factory-time entry dispatch (V8 deopt workaround)
e644a89 docs(guidelines): Phase 1.1.2 claims — toolchain/key-type matrix + V8 deopt workaround
6b8073d merge: Phase 1.1.2 (hashmap workload + common/fixtures + bindReset + V8 deopt workaround)
```

### Bench results

- **Node-only bench** (size S+M, eval mode): `results/raw/2026-05-23T01-51-06Z/` — 140 results, 0 correctness failures.
  - matmul: 20 (10 combos × 2 sizes)
  - interop_calls: 60 (3 entries × 10 combos × 2 sizes)
  - hashmap_string: 30 (3 entries × 5 combos × 2 sizes)
  - hashmap_int: 30 (3 entries × 5 combos × 2 sizes)
- **Report**: `results/summarized/2026-05-23T01-52-44-263Z/index.html` — 10 measurement IDs, no failed cells.
- **Browsers**: chromium/firefox runs aborted на SessionNotCreatedError mid-run (partial 334 results in `results/raw/2026-05-23T01-42-09-620Z/`, может быть переиспользован для browser-specific guidelines в Phase 1.1.3+ когда WebDriver flakiness investigated).

### Findings (key)

1. **Confirmed: Rust HashMap fastest для u64 keys; JS Map fastest для string keys.** Cross-key-type ratio inverts. См. guidelines.md "Toolchain choice".
2. **Confirmed: V8 JIT deopts на switch-over-closure-const в hot loops** (lookup-specific, eval mode at size S, both hashmap workloads). Fix: factory-time dispatch. Investigation notes preserved на `feature/phase-1.1.2-bug` branch.
3. **Plan oversight #1**: `HashMap::new()` is not const — used `LazyLock` instead. Documented в pitfalls.md.
4. **Plan oversight #2**: invariant `lookup == delete per size` breaks при collisions (hashmap_int L). Documented в pitfalls.md + ioContract caveat в spec.json.
5. **Bundle size deltas** (cross-key-type, hashmap_string vs hashmap_int):
   - Rust bindgen speed: +6KB raw wasm для String over u64
   - Rust bindgen size: +2.6KB для String over u64
   - C++ emscripten: +1KB для libc++ unordered_map<string> over <u64>
   - JS: ~30B difference (key type irrelevant в native Map)

---

## Open risks / known unknowns

1. **V8 JIT deopt не root-caused.** Bug branch `feature/phase-1.1.2-bug` preserves repro materials. Investigation deferred. Next session candidate.
2. **Browsers (chromium, firefox) не measured** при текущем bench:all run. WebDriver flakiness blocked it. Either (a) investigate driver stability и rerun, or (b) defer к Phase 1.1.3 / 1.2.
3. **No L-size runtime data** (only S+M ran во время bench — пшт bench defaults к `--sizes=S,M`). Plan не requires L data but having it would strengthen "confirmed" status of guideline claims. Можно прогнать `pnpm bench --envs=node --sizes=S,M,L` отдельно.
4. **Clangd diagnostics noise** on new C++ files. Captured как tech-debt candidate. Не блокирует, но annoying.

---

## What the next session needs to know

### Phase 1.1.3 (`shape_dispatch`) — next planned phase

Per umbrella spec `docs/superpowers/specs/2026-05-20-phase-1-1-design.md`. Workload:
static (templates/generics) vs dynamic (virtual/dyn Trait/class hierarchy) dispatch.

Important context from this phase:
- Use `feature/phase-1.1.2-bug` reproducer to validate hardening if introducing switch-style
  dispatch в JS impls. Especially: any time `create(entry)` would return a single function
  with `switch(entry)` в hot loop body — design в factory-time dispatch from the start.
- `common/fixtures.ts` exists с 4 generators. shape_dispatch может потребовать new ones
  (e.g., random graph structure для virtual dispatch); add к common when ≥2 workloads
  need them.
- `bindReset` helper в `packages/loaders/src/` covers per-entry reset уже. shape_dispatch
  may use это или introduce a new pattern.

### Phase 1.2 candidates

См. `docs/roadmap.md`:
- `hashmap-stdlib-no-glue` — extend hashmap to rust/raw + cpp/wasi-sdk (no bindgen/emscripten
  glue overhead). Bundle-size delta worth measuring.
- `ci-github-actions` + `cross-platform-installer` — both needed for CI gate enforcement
  (would catch the lint-pipe-exit-code issues identified в pitfalls.md).
- `clangd-config` (new) — small ergonomics fix; add к tech-debt.

### Push status

`origin/master` is **3 commits behind** local master at session start (это были Phase 1.1.2
spec + plan commits from prev session, not yet pushed). After this session, master is
3 + 26 = 29 commits ahead of origin (24 task commits + roadmap + lint-fix + workaround +
guidelines + merge + this session-state). 

**Не пушил без user OK.** Decision deferred to user — phase merge style precedent (1.0.5/1.0.6/1.1.1).

---

## Deferred / Out of scope

### Из этой сессии — пере-направлено

- **V8 JIT deopt root-cause investigation** — preserved на bug branch. Investigation
  list: V8 tracing flags (`--trace-deopt`, `--trace-turbo`), Node 20 vs 24 testing,
  harness vs manual difference. See bug-report file for full plan.
- **Browser bench data** — chromium SessionNotCreatedError aborted. Either retry с retry-logic
  или accept node-only данные until WebDriver stability addressed.

### Из Phase 1.1.2 scope (см. spec § Out of scope)

- `rust/raw` hashmap (no_std incompatible with std::collections::HashMap) → roadmap
  `hashmap-stdlib-no-glue`.
- `cpp/wasi-sdk` hashmap (current freestanding setup без libc++ unordered_map) → same.
- Non-default hashers (FxHash / ahash).
- L-size bench data (plan defaulted к S+M).

### Open tech-debt (carry-over + new)

- `docs/tech_debt/firefox-emscripten-noop-5x-slowdown.md` — open from 1.1.1. Did not recur
  на hashmap workloads (not measured because browsers unreachable).
- `docs/tech_debt/incorporate-pitfalls-2026-05-22.md` — open from 1.1.1.
- **New tech-debt candidates** (см. pitfalls.md):
  - `.clangd` config (or compile_commands.json generator) для C++23 diagnostics — IDE ergonomics.
  - `set -o pipefail` или explicit PIPESTATUS handling for gate commands — captured в pitfalls
    «Tooling > pipeline discipline». Should be in CLAUDE.md или /finish-session check.
  - WebDriver session retry-logic для bench-runner — captured в pitfalls «browsers fragile».
  - Smoke eval-mode validation gate — captured в pitfalls «Smoke at S only».
- **New roadmap candidate**: V8 deopt investigation — could be its own small phase / spec
  если turns out reproducible outside this project.

---

## Старт next session — checklist

1. Read `CLAUDE.md` (auto-loaded).
2. `git checkout master && git rev-parse HEAD` — should be `6b8073d` or descendant.
3. `git status` — clean tree (modulo `.claude/settings.local.json` and notes file).
4. `git tag -l "phase-1-1-*"` — should see 1-1-0, 1-1-1, 1-1-2.
5. Read this file + `docs/pitfalls/2026-05-23-phase-1-1-2-execution.md`.
6. Read `docs/guidelines.md` — 2 new claims to absorb context.
7. Sanity check master gates:
   ```bash
   pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke
   ```
   All should exit 0. smoke shows 70 results.
8. Decide direction:
   - **Investigate V8 JIT deopt** (use `feature/phase-1.1.2-bug` reproducer) — small focused
     session, materials ready.
   - **Phase 1.1.3 (shape_dispatch)** — start с brainstorm + spec writing.
   - **Browser bench retry** — investigate chromedriver stability, rerun chromium/firefox
     portion of bench:all.
   - **Push to origin?** — user decision.

---

## Полезные команды

```bash
# Базовый ориентир
git rev-parse HEAD                                       # should be 6b8073d
git branch --show-current                                # master
git log --oneline phase-1-1-2..master                    # 1 commit ahead (merge commit)
git log --oneline origin/master..master                  # N commits ahead, push pending
git tag -l "phase-1-1-*"                                 # phase-1-1-0, 1-1-1, 1-1-2

# Phase 1.1.2 artifacts
cat docs/guidelines.md
cat docs/pitfalls/2026-05-23-phase-1-1-2-execution.md
ls results/raw/2026-05-23T01-51-06Z/                    # 140 result files
open results/summarized/2026-05-23T01-52-44-263Z/index.html

# V8 deopt repro (on bug branch)
git checkout feature/phase-1.1.2-bug
cat docs/superpowers/bug-reports/2026-05-23-v8-deopt-switch-over-closure-const.md
node docs/superpowers/bug-reports/2026-05-23-v8-deopt-repro/manual-runner.mjs

# Pre-flight check
pnpm typecheck && pnpm lint:all && pnpm test
pnpm smoke    # dangerouslyDisableSandbox per CLAUDE.md tsx-sandbox note
```

---

## Stop point

- Phase 1.1.2 **execution complete**, merged к master, tag set.
- **NOT pushed**.
- **All gates green** локально.
- Memory will be updated separately (`~/.claude/projects/.../memory/project_wasm_benchmarks.md`,
  outside repo).
- V8 deopt bug acknowledged + workaround applied + reproducer preserved для следующей сессии.

Next session opens at: master `6b8073d` + memory updates + readiness для Phase 1.1.3
brainstorm OR V8 deopt investigation OR browser bench retry.
