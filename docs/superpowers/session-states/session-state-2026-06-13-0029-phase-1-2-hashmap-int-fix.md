# Session state — 2026-06-13 0029 · phase-1-2 hashmap-int fix

## TL;DR

- **master untouched.** Two unmerged feature branches, both awaiting push + PR (user action):
  - `feature/phase-1-2-hashmap-int-emscripten-fix` — HEAD `8cf09e3`: hashmap_int cpp dup-key correctness fix (Phase 1.2) + bug-report + tech-debt resolved + roadmap line + guideline.
  - `feature/tsx-sandbox-verify-close` — HEAD `9e56dd6`: closes the tsx-sandbox verify open-loop → wontfix; CLAUDE.md gotcha + tech-debt updated.
- Phase 1.2 hashmap_int correctness bug **fixed + verified** (emscripten artifacts rebuilt, L × {speed,size} × 3 entries validated in Node). `/finish-session` ran: guideline claim + memory updated; no new pitfall.

## What the next session needs

- Push both branches + open both PRs (commands in Resume).
- Optionally run the bench re-validation (see Deferred) before picking the next Phase 1.2 slice.

## Deferred / open-loops

- **Push + PR ×2** (user action — SSH Yubikey-backed, `gh` absent). Both branch off master independently; order doesn't matter.
- **bench:all eval re-run** (optional, heavy) — regenerates correct hashmap_int cpp-emscripten L numbers + report. Old `results/raw/` JSON for those 12 cases (lookup/delete × L × 3 envs × 2 profiles) is now invalid (pre-fix wrong checksums). Not blocking; do before any guideline leans on hashmap_int cpp-emscripten L runtime.
- **sandbox verify — CLOSED this session** (not deferred): `tsx -e` with no bypass + `allowAllUnixSockets:true` still `listen EPERM`s; regular-file write into the same dir succeeds ⇒ it's the unix-socket bind, unliftable → `wontfix`. tsx commands keep needing `dangerouslyDisableSandbox: true`.
- **Next Phase 1.2 slice** — roadmap candidates: hashmap-stdlib-no-glue, CI/GitHub-Actions, safari-implementation (`docs/roadmap.md` § Phase 1.2). The `### Bug fixes` cluster is now empty (this fix cleared it).

## Resume

```bash
# Push + PR (user runs):
git checkout feature/phase-1-2-hashmap-int-emscripten-fix && git push -u origin feature/phase-1-2-hashmap-int-emscripten-fix
git checkout feature/tsx-sandbox-verify-close && git push -u origin feature/tsx-sandbox-verify-close
# Compare links: master...feature/phase-1-2-hashmap-int-emscripten-fix  &  master...feature/tsx-sandbox-verify-close

# Next iteration: /iterate (Phase 0 reads this snapshot; both branches merged ⇒ START FRESH → pick next 1.2 slice)
```

## Stop point

Phase 1.2 hashmap_int dup-key fix complete: root-caused (`unordered_map::emplace` first-wins vs reference last-wins; only L has 4 dup keys; 2:1 lookup:delete diff fingerprint), fixed `8cf09e3`, verified on rebuilt emscripten artifacts. tsx-sandbox open-loop closed → wontfix (`9e56dd6`). Both branches need push/PR. finish-session done (1 guideline claim, 2 guideline/memory drift fixes).
