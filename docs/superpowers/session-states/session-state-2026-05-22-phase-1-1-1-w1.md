# Session state — 2026-05-22 (Phase 1.1.1 Wave 1)

Handoff для следующей сессии. Phase 1.1.1 Wave 1 (scaffolding) выполнен полностью
на ветке `feature/phase-1-1-1`. Wave 2 (interop_calls implementations) и
Wave 3 (bench:all + reporter + claim) — pending.

---

## TL;DR — где мы сейчас

- Branch: **`feature/phase-1-1-1`** (созданa от `ed709b1` master).
- HEAD: **`e21b5f7`** (`docs(plans): Phase 1.1.1 implementation plan`).
- Master HEAD: `ed709b1`. Tag `phase-1-1-0` на месте.
- **15 commits этой сессии** (`cfa441e..e21b5f7`).
- **Working tree clean.** Untracked: `.claude/settings.local.json`, «Какие есть существующие бенчмарки wasm под браузер.md» (legacy, как было).
- **Не запушено.** Local-only branch.
- **Все master gates зелёные** на HEAD: `pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke`.

---

## Что было сделано в сессии 2026-05-22 (Wave 1)

Plan: `docs/superpowers/plans/2026-05-22-phase-1-1-1-interop-calls.md` (3 waves
× 27 tasks). Wave 1 = Tasks 0-14 (scaffolding + matmul ABI rename).

| Task | Commit | Outcome |
|---|---|---|
| 1: `SpecSchema` v2 + tests | `cfa441e` | `entries: string[]` + top-level `expectedChecksums` map; 5 new tests pass. |
| 2: matmul/spec.json → v2 | `289205c` | `entries: ["matmul"]`, `expectedChecksums.matmul.{S,M,L}`. |
| 3: `LoaderInput.entry` plumbing | `e57cbda` | Required `entry: string` field; callers updated, loaders pass-through (no dispatch yet). |
| 4: plain-js loader entry-aware | `8f40861` | `factory.default(entry)` signature; multi-entry mock fixture + test; matmul JS modules assert entry. |
| 5: raw-wasm loader entry-aware + matmul alias + build-rust path fix | `0a727db` | Arity-based dispatch (1=matmul-style, 0+counter=noop, 2=add); transitional `matmul` export alias in rust raw/bindgen/cpp; **incidental fix**: `scripts/build-rust.ts` was reading stale wasm from `crateDir/target/` (workspace cargo writes to root `target/`) — Phase 1.1.0 W2 refactors never landed in dist (byte-preserving so smoke kept passing). |
| 6: rust-bindgen loader entry-aware | `9210042` | `glue[entry]` lookup with arity dispatch. |
| 7: emscripten loader entry-aware | `7fb4572` | `inst[\`_${entry}\`]` lookup with arity dispatch. |
| 8: matrix.ts split | `26d33f2` | `BinaryCombination` + `RunCase` types; `enumerateBinaries(spec)` / `enumerateRunCases(spec, sizes, envs)`; `ALL_COMBINATIONS` kept as transitional shim. |
| 9: build-all + per-lang auto-discovery | `2396958` | `build-all.ts` glob'ит `benches/*/spec.json`; `build-{js,rust,cpp}.ts` принимают bench-id argv. |
| 10: `pnpm fixtures` | `936ddaa` | Standalone `scripts/fixtures.ts` с `--bench=<id>` filter; package.json gains `fixtures` script. |
| 11+13: runner-node `--entry` + run-matrix per-entry | `46eede7` | `--entry` required в runner-node + driver; `run-matrix.ts` iterates per-(bench × binary × entry × size × env). Bundled тут (см. pitfall #3). |
| 12: runner-web `--entry` | `0a16a72` | Driver+worker take `--entry`; result filename uses entry. |
| 14: drop matmul `run` alias | `c3e8fa3` | Final rename: matmul wasm export только `matmul` (rust raw/bindgen + cpp); build scripts drop `--export=run`/`_run`. |
| Plan doc | `e21b5f7` | Commit самого plan'а в docs/superpowers/plans/. |

### Sizes — matmul после Wave 1

| Combo | Before (master `ed709b1`) | After Wave 1 HEAD | Diff |
|---|---|---|---|
| `rust-raw-speed` | 1912 B | 1917 B | +5 |
| `rust-raw-size` | 1636 B | 1639 B | +3 |
| `rust-bindgen-speed` | 14491 B | 14485 B | -6 |
| `rust-bindgen-size` | 12327 B | 12321 B | -6 |
| `cpp-emscripten-speed` | 1205 B | 1205 B | 0 |
| `cpp-emscripten-size` | 864 B | 864 B | 0 |
| `cpp-wasi-sdk-speed` | 985 B | 988 B | +3 |
| `cpp-wasi-sdk-size` | 760 B | 763 B | +3 |

Variance в пределах ±6 B на rename `run`→`matmul`. Functional behaviour identical.

### Latent bug fixed (Wave 1 incidental)

`scripts/build-rust.ts:25-27` (commit `0a727db`) — стал читать из workspace
root `target/`, не `<crateDir>/target/`. Phase 1.1.0 W2 wasm-refactors
(`addr_of!(HEAP.0)`, `with_slices`) фактически никогда не доезжали до dist —
просто компилировались. Подробно в `docs/pitfalls/2026-05-22-phase-1-1-1-w1.md`
§ 1.

### Pitfalls & tech-debt captured (на /finish-session)

- **`docs/pitfalls/2026-05-22-phase-1-1-1-w1.md`** — 3 pitfall'а:
  1. cargo workspace target dir trap.
  2. tsx IPC socket требует sandbox bypass (sharpens stale pitfall #4).
  3. Plan executor coupling между Tasks 11/13 (required-flag).
- **`docs/tech_debt/incorporate-pitfalls-2026-05-22.md`** — bulk-defer для pitfall
  #3 (низкоприоритетный, candidate update для writing-plans skill).
- **CLAUDE.md § «Tooling environment»** — inline захвачены 2 hard rules: cargo
  workspace target + tsx sandbox.
- **README.md + CLAUDE.md** — `--entry=matmul` добавлен в Node + browser
  invocation examples; filename pattern rephrased (`<entry>__...`).

---

## Deferred items (Wave 2 & 3 — ещё не сделано)

### Wave 2 — interop_calls implementations (Tasks 15-22)

| Task | Что |
|---|---|
| 15 | `benches/interop_calls/validate/reference.ts` + `spec.json` (3 entries, S/M/L checksums) |
| 16 | `benches/interop_calls/fixtures/generate.ts` (0-байтовые .bin + .gitignore) |
| 17 | `benches/interop_calls/js/idiomatic/{package.json,tsconfig.json,src/index.ts}` |
| 18 | `benches/interop_calls/js/typed-array/...` (TypedArray-backed accumulators) |
| 19 | `benches/interop_calls/rust/raw/{Cargo.toml,src/lib.rs}` + workspace member |
| 20 | `benches/interop_calls/rust/bindgen/{Cargo.toml,src/lib.rs}` + workspace member |
| 21 | `benches/interop_calls/cpp/src/{interop_calls.h,interop_calls.cpp}` + build scripts |
| 22 | Full `pnpm build:all` auto-discovery test + smoke update |

### Wave 3 — bench:all + reporter + claim (Tasks 23-26)

| Task | Что |
|---|---|
| 23 | `pnpm bench:all` полная матрица (~400 cases) |
| 24 | Reporter v0 cross-workload validation (optional leader highlighting) |
| 25 | ≥1 tentative claim в `docs/guidelines.md` |
| 26 | Phase 1.1.1 closure: gates + tag `phase-1-1-1` + roadmap update + merge to master |

### Open tech-debt (этой сессии)

- `docs/tech_debt/incorporate-pitfalls-2026-05-22.md` — bulk-defer pitfall #3
  (plan-executor coupling), low priority.

---

## Что следующая сессия должна знать

### Чтобы стартовать Wave 2

1. **Прочитать в порядке:**
   - `CLAUDE.md` (auto-loaded, includes new tooling section).
   - Этот файл (handoff).
   - `docs/pitfalls/2026-05-22-phase-1-1-1-w1.md` — особенно § 1 (cargo workspace
     target) перед Tasks 19/20 (новые rust crates) и § 3 (plan coupling)
     если writing-plans pattern будет повторяться.
   - `docs/superpowers/plans/2026-05-22-phase-1-1-1-interop-calls.md` §§ Tasks
     15-22 — source of truth для Wave 2 implementations.
   - `docs/superpowers/specs/2026-05-20-phase-1-1-design.md` § Phase 1.1.1
     (для определения семантики interop_calls workload'а).

2. **Sanity check master gates:**
   ```bash
   git checkout feature/phase-1-1-1
   pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke
   ```
   Должны все exit 0.

3. **Старт Wave 2 — Task 15** (`interop_calls reference + spec.json`). После него
   Tasks 16-22 идут логически последовательно. Plan dispatch strategy: per memory
   feedback `feedback_execution_strategy.md` — multi-file impl tasks (19/20/21
   = новые rust/cpp crates) могут идти через subagent; mechanical edits (16/17/18)
   — inline.

### Решения, зафиксированные (не передоговариваться)

| Решение | Где зафиксировано |
|---|---|
| Spec.json layout: top-level `expectedChecksums: { entry: { S,M,L } }` map | `cfa441e` (`SpecSchema`); `289205c` (matmul migrated) |
| Wasm export name ≡ entry id (no legacy `run` shim) | `c3e8fa3` (matmul ABI rename) |
| Result filename indexed by entry | `46eede7` (runner-node + run-matrix); `0a16a72` (runner-web) |
| interop_calls — JS-side inner loop; wasm-side counter for noop, JS accumulator for add | Plan §§ Task 17/19 specs |
| Cargo workspace target в workspace root, не crate-local | `0a727db` + CLAUDE.md § Tooling environment |
| pnpm builds через tsx subprocess требуют `dangerouslyDisableSandbox` | CLAUDE.md § Tooling environment + pitfall #2 |
| Plan execution: hybrid pattern (inline для mechanical, subagent для multi-file complex) | Memory feedback `feedback_execution_strategy.md` |
| Phase 1.1.1 на feature branch (per user директива в этой сессии) | `feature/phase-1-1-1` |

### Подводные камни для Wave 2 planning

1. **Cargo workspace target** (pitfall #1). Tasks 19+20 добавляют новые crates:
   `benches/interop_calls/rust/{raw,bindgen}`. Root `Cargo.toml` workspace members
   список надо обновить. Все артефакты пойдут в workspace `target/` (build-rust.ts
   уже знает правильный путь — без дополнительных правок).

2. **interop_calls spec.json schema check** (per Task 15). После создания —
   `pnpm exec tsx -e 'import { SpecSchema } from "@bench/result-schema"; ... '`
   будет падать в sandbox (tsx IPC socket); запускать с
   `dangerouslyDisableSandbox: true`. Или fallback на временный `$TMPDIR/...mjs`
   файл (см. как делал Task 2 step 2).

3. **interop_calls cpp build scripts.** Нужны 2 новых файла:
   `benches/interop_calls/cpp/build-emscripten.sh` и `build-wasi-sdk.sh`. Можно
   взять matmul-versions как template, поменять `matmul.cpp` → `interop_calls.cpp`
   и `--export=matmul` → `--export=interop_calls_noop --export=interop_calls_noop_counter
   --export=interop_calls_add_i32 --export=interop_calls_add_f64` + `--export=alloc
   --export=load_input` (`reset` для interop_calls не нужен — loadInput сам ресетит
   counter).

4. **Empty fixtures.** `loadInput(empty Uint8Array)` уже handled by all loaders
   (`if (buf.byteLength > 0)` guard в raw-wasm + emscripten; bindgen calls
   `glue.load_input(empty)` which is wasm-bindgen path — verify в Task 19/20 что
   no_std rust raw + cpp handle len=0 correctly).

5. **interop_calls test data.** Reference impl должен дать exact checksum для
   S=100k, M=1M, L=10M innerIterations. Spec.json plan template имеет placeholders
   `<REPLACE_FROM_REFERENCE>` — Task 15 step 2 capture'ит реальные values запуская
   `tsx benches/interop_calls/validate/reference.ts`.

---

## Workflow notes

- `--no-gpg-sign` на каждом коммите.
- `dangerouslyDisableSandbox: true` для всех `tsx`-launched команд (smoke, build,
  fixtures, exec tsx). Pure `pnpm typecheck/test/lint:*` — sandbox OK.
- Plan tracking: TaskCreate/TaskUpdate. 15/27 tasks completed (#1-15 + #4-7 = …
  see TaskList; mapping TaskID = plan_task + 1).
- WASI_SDK_PATH, emcc через `.tools/emsdk`, Rust toolchain 1.95.0 — все pinned.

---

## Старт next session — checklist

1. Read `CLAUDE.md` (auto-loaded).
2. `git checkout feature/phase-1-1-1 && git rev-parse HEAD` — capture base SHA
   (`e21b5f7` или descendant).
3. `git status` — verify working tree clean (untracked legacy ignored).
4. Read этот файл (handoff).
5. Read pitfall file § 1 (cargo workspace target) — relevant для Tasks 19-20.
6. Read plan § Tasks 15-22.
7. Sanity check master gates (см. выше).
8. Start **Task 15** (interop_calls reference + spec.json). Skill: уже в
   subagent-driven-development mode (продолжаем из текущего plan).

---

## Полезные команды

```bash
# Базовый ориентир
git rev-parse HEAD                                       # should be e21b5f7 or descendant
git branch --show-current                                # feature/phase-1-1-1
git log --oneline phase-1-1-0..HEAD | wc -l              # 15 (or more) commits
git tag -l "phase-1-1-*"                                 # phase-1-1-0

# Wave 1 artifacts
cat docs/pitfalls/2026-05-22-phase-1-1-1-w1.md          # 3 pitfalls
cat docs/tech_debt/incorporate-pitfalls-2026-05-22.md    # bulk-defer item

# Pre-flight check
pnpm typecheck && pnpm lint:all && pnpm test
# pnpm smoke требует dangerouslyDisableSandbox через tsx

# Wave 2 plan section
sed -n '/### Task 15/,/### Task 23/p' docs/superpowers/plans/2026-05-22-phase-1-1-1-interop-calls.md
```

---

## Stop point

- Wave 1 **closed** на `feature/phase-1-1-1`.
- 15 commits + plan file pushed locally (not yet pushed remote).
- Pitfalls **captured**.
- CLAUDE.md + README.md **drift corrected** (`--entry` examples, filename pattern).
- Wave 2 (interop_calls implementations) **не начато** — следующий шаг.
- Phase 1.1.1 tag — **не поставлен** (закроется по итогу Wave 3).
- Merge to master — **не сделан** (закроется по итогу Wave 3, per user директива).

В следующей сессии: pre-flight gates → читать pitfalls § 1 → Task 15 (interop_calls
reference + spec.json) → последовательно Tasks 16-22 → Wave 3.
