# Session state — build-hygiene implemented on branch

## TL;DR
- Branch `feature/build-hygiene` (**not pushed**), HEAD after `c0c5316` + this session's
  finish-session doc edits (README/CLAUDE.md). 9 impl/doc commits: spec → plan → wasm-opt
  helper+rust → cpp wasm-opt+PATH → postprocess → wasmDisasmPath+debts → determinism-guard →
  docs(spec/guidelines/roadmap) → guidelines speed-table recalc.
- Explicit deterministic `wasm-opt` on all profiles (Option B: speed `-O3`, size `-Oz`) via
  shared `scripts/lib/wasm-opt.ts`; per-invocation PATH (`scripts/lib/build-env.ts`); cpp
  `build-*.sh` → link-only / pinned `${WASM_OPT}`; `PROD_PATH` костыль удалён.
- Gates green (typecheck 0, lint 0, test 122). Full re-bench (user ran `bench:all` →
  `results/raw/2026-07-04T14-56-02-425Z`, 1161 results, 0 correctness-fail).
- **Size: все 32 changed-артефакта меньше, 0 больше** (rust/raw-speed −18…−28%, раньше без
  wasm-opt). **Perf: в пределах run-to-run шума, регрессии нет.** determinism-guard проходит.
- tech-debt 19 → 17 (closed r1-devirt-objdump-tooling + dead-ts-output-fields).

## What the next session needs
- **Push + PR** (user action): `git push -u origin feature/build-hygiene`, затем открыть
  https://github.com/uncerso/wasm-rust-cpp-js/compare/master...feature/build-hygiene
- **After merge:** post-merge memory update `project_wasm_benchmarks.md` — отметить
  build-hygiene done + PR номер; следующий срез = housekeeping (`/backlog-review` по 16
  оставшимся tech-debt / roadmap TBD). Паттерн — как с PR #11 (memory update = post-merge).

## Deferred / open-loops
- **build-hygiene push + PR** — pending (user action; агент не пушит, Yubikey SSH).
- **Post-merge memory update** — отложено до мёржа (НЕ делать пока не смёржено).
- **Housekeeping** (item 4 набора 1+3+4) — не начат; отдельная `/backlog-review`-сессия.
- **hashmap-lookup аномалия** (дизайн-фаза node A/B показал cpp +18.5%) — в полном cross-run
  НЕ воспроизвелась систематически (шум); закрыто как не-находка.

## Resume
```
# push + open PR (user action)
git push -u origin feature/build-hygiene
# after merge: update project memory (build-hygiene done), then /iterate → housekeeping (/backlog-review)
```

## Stop point
build-hygiene реализован на `feature/build-hygiene`, все гейты зелёные, size+perf
re-baseline выполнен (size — все меньше; perf — в шуме), guidelines обновлён (new claim
§ Build flags + 2 пересчитанные таблицы), determinism-guard добавлен. Awaiting push + PR.
