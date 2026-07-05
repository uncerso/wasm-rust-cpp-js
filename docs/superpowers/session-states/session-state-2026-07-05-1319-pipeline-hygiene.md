# Session state — Phase 1.2 pipeline-hygiene batch

## TL;DR
- Branch `feature/phase-1.2-pipeline-hygiene` (from master `182ebf4`), HEAD `1cb5ad9`, **not pushed**.
- 7 commits: spec (`61f9b19`) + spec-revise-B (`c7a64d1`) + plan (`bb33435`) + C (`4017d87`) + D (`90573f2`) + A (`ae508bd`) + B (`1cb5ad9`).
- Batch = 4 independent hygiene fixes, all done; full gate-set (build:all + typecheck + lint:all + test + smoke) **green**; reporter visually verified by user.
  - **C** correctness-fail-surfacing: `isCorrectnessFailure` in result-schema + runner-node exit(1) + run-matrix node/browser accumulate → `failures.txt` + non-zero exit. Closed the long-standing gate gap.
  - **D** hashmap_string emplace→operator[] (lines 51/107): latent (2⁶⁴ keys, no dups → checksum unchanged, 12/12 validated) but wasm **−4…6%** across all 4 cpp artifacts (redundant template instantiation removed).
  - **A** dropped inline emscripten `wasm-opt` (×8 scripts) + `WASM_OPT` env → emcc-internal binaryen only; size **+0…35B** (2nd -Oz near-idempotent); determinism-guard green.
  - **B** perf shape_dispatch: single pinned `node·rust/raw` 2×2 → impl×env heatmap grid (+Δ%) + 4 collapsed combo detail tables; js real row + explained `homo_static` dash (language property).
- finish-session applied: guidelines.md dup-key claim extended with size-bonus (`285`) + stale wasm-opt caveat fixed (`150`); memory `next` refreshed. M1 (typecheck-gap live example) skipped — already in `docs/tech_debt/pnpm-typecheck-skips-scripts.md`.

## What the next session needs
- **User: push + PR** (Yubikey SSH, gh absent — agent can't push). Then review on GitHub, merge.
- After merge: `/iterate` → next Phase 1.2 slice. `bindgen-size-opt-level` remains ready (C/D done this batch; A/B done).

## Deferred / open-loops
- **Push + PR** — pending (user action). Commands below.
- **Full-matrix re-bench (schema v2)** — still pending user action. D re-benched **only** hashmap_string cpp into `$TMPDIR` (scratch, not committed); committed results/raw unchanged. cpp hashmap_string size-attr numbers in guidelines may lag by −4…6% (minor; re-baseline is that pending measurement pass).
- **`fixtures.test.ts:101` TS2345** — pre-existing latent type-error the gates miss (root-tsconfig gap); documented in `docs/tech_debt/pnpm-typecheck-skips-scripts.md`, not this batch's to fix.
- **dispatch-static-typing guideline** — decided NOT to add (explanatory, not actionable; already in reporter caption). Re-deferred = closed, not silent.

## Resume
```
# user pushes + opens PR:
git push -u origin feature/phase-1.2-pipeline-hygiene
# compare: https://github.com/uncerso/wasm-rust-cpp-js/compare/master...feature/phase-1.2-pipeline-hygiene
# after merge → /iterate → next Phase 1.2 slice (bindgen-size-opt-level ready)
```

## Stop point
pipeline-hygiene batch (C+D+A+B) complete on `feature/phase-1.2-pipeline-hygiene`; all gates green; reporter eyeballed. finish-session doc/memory edits applied + committed. Awaiting user push + PR.
