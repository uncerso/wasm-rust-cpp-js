# Session state — 2026-05-23 (Phase 1.1.1 closed)

Handoff для следующей сессии. Phase 1.1.1 закрыт полностью: Wave 2 (interop_calls
implementations) + Wave 3 (bench:all + reporter + claim + tag) выполнены, merged
в master как `a7d4d5a`, tag `phase-1-1-1` поставлен. Push НЕ сделан per user
директива.

---

## TL;DR — где мы сейчас

- Branch: **`master`** (был `feature/phase-1-1-1`, merged --no-ff).
- Master HEAD: **`a7d4d5a`** merge commit (Phase 1.1.1).
- Tag `phase-1-1-1` на `9fdc63d` (feature branch HEAD, parent of merge).
- **Не запушено.** Local master ahead of `origin/master` by 27 commits.
- **Все gates зелёные** на master HEAD: `pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke`.
- bench:all artefact: `results/raw/2026-05-22T21-06-13-615Z/` (240 results) + report
  `results/summarized/2026-05-22T21-10-17-290Z/index.html`.

---

## Done in this session (2026-05-22..23)

Plan: `docs/superpowers/plans/2026-05-22-phase-1-1-1-interop-calls.md`. Wave 1
(Tasks 0-14) был закрыт в прошлой сессии; эта сессия закрыла Wave 2 (Tasks 15-22)
и Wave 3 (Tasks 23-26).

### Wave 2 — interop_calls implementations (10 commits)

| Task | Commit | Outcome |
|---|---|---|
| 15 | `06099f2` | `benches/interop_calls/{validate/reference.ts,spec.json}` — 3 entries (noop / add_i32 / add_f64), expected checksums per S/M/L captured. |
| 16 | `68311ba` | `benches/interop_calls/fixtures/{generate.ts,.gitignore}` — fixture-less workload (0-байт sentinel files). |
| 17 | `423dbe4` | `benches/interop_calls/js/idiomatic/...` + generalize `pnpm-workspace.yaml` на `benches/*/js/*`. |
| 18 | `c30918b` | `benches/interop_calls/js/typed-array/...` (TypedArray-backed accumulators). |
| 19 | `570abb7` | `benches/interop_calls/rust/raw/...` (no_std, 4 exports + alloc/load_input). |
| 20 | `c8507e1` | `benches/interop_calls/rust/bindgen/...` (wasm-bindgen exports + counter reader). |
| 21 | `8a6e9db` | `benches/interop_calls/cpp/...` + per-bench `build-{emscripten,wasi-sdk}.sh`. |
| 22a | `b381c70` | **Critical fix**: iter-dependent checksum protocol (см. pitfall §P1). Harness больше не валидирует `run(1)` checksum; 3 loaders + 2 JS impls используют counter delta для noop pattern. |
| 22b | `94baeb3` | `SpecInputSizeSchema` получил optional `innerIterations`; runner-node/web переопределяют MeasureConfig из spec'а. |
| 22c | `acd4e06` | Generalize dev infra: `tsconfig.json` include → `benches/*/validate/**/*`; eslint ignore → `benches/*/fixtures/**`; `Cargo.toml` + interop_calls crates; pnpm-workspace generalized. |

### Wave 3 — closure (1 docs commit + tag + merge)

| Task | Commit / action | Outcome |
|---|---|---|
| 23 | `pnpm bench:all` run | 240 results, 0 validation failures. Output `results/raw/2026-05-22T21-06-13-615Z/`. |
| 24 | (no commit) | Reporter sanity-check: HTML содержит 4 sections (matmul, interop_calls_noop, interop_calls_add_i32, interop_calls_add_f64). Leader-highlight enhancement — optional per plan, skipped. |
| 25 | `9fdc63d` | `docs/guidelines.md § Toolchain choice` — tentative claim о wasm-bindgen overhead. `docs/roadmap.md` — interop-calls removed. `docs/tech_debt/firefox-emscripten-noop-5x-slowdown.md` — investigation lead. |
| 26 | `a7d4d5a` + tag | `git tag -a phase-1-1-1`, merge --no-ff в master. |

### Sizes — interop_calls на master HEAD

| Combo | Raw wasm | Gzip wasm | Notes |
|---|---|---|---|
| `js-idiomatic-speed` | 0 | 0 | JS bundle, no wasm |
| `js-typed-array-speed` | 0 | 0 | JS bundle, no wasm |
| `rust-raw-speed` | 314 B | 233 B | minimal no_std |
| `rust-raw-size` | 302 B | 228 B | `wasm-opt -Oz` |
| `rust-bindgen-speed` | 10106 B | ~5560 B (glue) | wasm-bindgen overhead |
| `rust-bindgen-size` | 9001 B | ~5560 B (glue) | |
| `cpp-emscripten-speed` | 451 B | ~8520 B (glue.mjs) | emscripten glue dominates |
| `cpp-emscripten-size` | 451 B | ~3860 B (glue.mjs) | closure-compiled |
| `cpp-wasi-sdk-speed` | 353 B | ~280 B | minimal freestanding |
| `cpp-wasi-sdk-size` | 353 B | ~280 B | |

### Key findings

- **Tentative claim (docs/guidelines.md § Toolchain choice):** wasm-bindgen +10-40%
  per-call overhead vs raw extern "C" для trivial JS↔Wasm signatures. Cross-runtime
  consistent (Node V8, Chromium, Firefox). M=1M iters:
  - noop: raw 1.67 ns/call vs bindgen 2.21 ns/call (+33%)
  - add_i32: raw 2.13 vs bindgen 2.31 (+9%)
  - add_f64: raw 2.99 vs bindgen 3.66 (+22%)
- **Firefox-specific anomaly (tech_debt/):** `cpp-emscripten` на Firefox показал
  ~11 ms vs ~2 ms у других toolchains для interop_calls_noop M (5-6x slowdown).
  Park'нуто как investigation для Phase 1.1.2 — если паттерн повторится на
  hashmap, escalate в confirmed guideline.

### Pitfalls captured (this session)

`docs/pitfalls/2026-05-23-phase-1-1-1-execution.md` — 3 pitfall'а:
- **P1** — iter-dependent checksum protocol (workload contract change, inline applied
  в design spec § «Checksum-семантика workload'а»).
- **P2** — multi-bench eslint/tsconfig generalization (operational, generalized).
- **P3** — `#[wasm_bindgen]` + `pub const fn` collision (clippy lint vs macro).

### Inline doc updates this session

- `CLAUDE.md` § «High-level architecture» + § Common commands — generalize matmul-only
  wording на multi-bench.
- `README.md` § «Что измеряется» + § Структура + § Известные ограничения — multi-workload
  rewording, удалён phase-1-0 «Один workload» bullet.
- `docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md` § «Контракт BenchModule»
  — добавлена subsection «Checksum-семантика workload'а» (P1 inline dispatch).
- `docs/guidelines.md` § Toolchain choice — new tentative claim.
- `docs/roadmap.md` — interop-calls removed from Phase 1.1 bucket.

---

## Deferred items (Phase 1.1 не закрыт)

Phase 1.1 progress: 1.1.0 + 1.1.1 done; 1.1.2 + 1.1.3 to do. Spec source of truth:
`docs/superpowers/specs/2026-05-20-phase-1-1-design.md`.

- **1.1.2 hashmap**: 2 binaries (string + int) × 3 entry points (insert/lookup/delete)
  → 6 IDs. Supported initially только 3 toolchains (js/idiomatic + rust/bindgen +
  cpp/emscripten); rust/raw + cpp/wasi-sdk через roadmap entry `hashmap-stdlib-no-glue`
  в Phase 1.2. Rule-of-three extract `benches/common/fixtures.ts` в этой sub-phase.
- **1.1.3 shape_dispatch + close:** 2 binaries (static, dynamic) × все 6 toolchains;
  reporter v2 final; guidelines harvest pass; Phase 1.1 close.

### Open tech-debt (этой сессии)

- `docs/tech_debt/firefox-emscripten-noop-5x-slowdown.md` — investigation lead для Phase 1.1.2.
- `docs/tech_debt/incorporate-pitfalls-2026-05-22.md` — bulk-defer pitfall item из W1.

### Push status

Local master опережает `origin/master` на 27 commits + 1 tag. **НЕ запушено.**
Push — на усмотрение user'а, не входит в скоуп phase-close per директива.

---

## What the next session needs to know

### Чтобы стартовать Phase 1.1.2 (hashmap)

1. **Прочитать в порядке:**
   - `CLAUDE.md` (auto-loaded, includes generalized multi-bench wording).
   - Этот файл (handoff).
   - `docs/pitfalls/2026-05-23-phase-1-1-1-execution.md` — особенно §P1 (workload
     checksum semantics) перед написанием hashmap spec — hashmap **iter-dependent**
     по характеру (cumulative inserts/lookups), будут те же гари что и в interop_calls.
   - `docs/superpowers/specs/2026-05-20-phase-1-1-design.md` § Phase 1.1.2.
   - `docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md` § «Контракт BenchModule»
     — особенно новая subsection «Checksum-семантика workload'а».

2. **Sanity check master gates:**
   ```bash
   git checkout master
   pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke
   ```
   Должны все exit 0.

3. **Brainstorm + spec → plan для Phase 1.1.2.** Skill: `superpowers:brainstorming` →
   `superpowers:writing-plans`.

### Решения, зафиксированные (не передоговариваться)

| Решение | Где зафиксировано |
|---|---|
| `run(1)` checksum НЕ валидируется harness'ом — нужен только для firstCallMs timing | design spec § Цикл измерения, шаг 3 |
| spec.json `inputSizes[size].innerIterations` — optional, оверрайдит MeasureConfig | `SpecInputSizeSchema`, `run-case.ts`, `driver.ts` |
| Iter-dependent workload'ы документируют 3 инварианта в spec.json | design spec § Checksum-семантика workload'а |
| arity-0 noop pattern loader'а возвращает counter delta, не absolute | 3 loaders + design spec note |
| Multi-bench dev infra paths — `benches/*/`, не `benches/matmul/` | tsconfig.json, eslint.config.js, pnpm-workspace.yaml |
| Phase merge style: `--no-ff` с `merge: Phase X.Y.Z (...)` subject | precedent 1.0.5/1.0.6/1.1.1 |
| Push к origin отдельно от merge — user директива | this session |

### Подводные камни для Phase 1.1.2 planning

1. **Workload checksum semantics (pitfall §P1).** Hashmap inherently iter-dependent
   (state накапливается через inserts). Spec **обязан** проговорить:
   - Iter-семантика: iter-dependent.
   - State leakage: hashmap persistent между `run()` вызовами; нужен либо `reset()`
     export, либо loader-level snapshot/restore.
   - `innerIterations` per size: hashmap insert benchmarks обычно ~10k-1M ops/sample.

2. **Multi-bench dev infra уже generalized.** Hashmap добавляется в `benches/hashmap/`
   без правок tsconfig/eslint/workspace (всё уже на `benches/*/`).

3. **wasm-bindgen + const fn (pitfall §P3).** Hashmap bindgen crate, если будет
   содержать pure helper exports — заранее `#![allow(clippy::missing_const_for_fn)]`
   или per-fn allow.

4. **Reset semantics.** Matmul reset = no-op (idempotent). interop_calls reset =
   counter clear (через load_input). Hashmap reset = clear map. Stateful workloads
   нуждаются в более явном reset contract — нужно проговорить в design spec
   § BenchModule contract.

5. **Reporter v2.** Phase 1.1.3 включает «reporter v2 final». До этого reporter
   v0 (текущий) показывает 4 entries — но с 6+ hashmap entries и 2 dispatch
   entries таблица станет громоздкой. Possible mid-phase work: leader highlighting
   per (workload × profile) — отложено как optional из этой сессии.

---

## Workflow notes

- `--no-gpg-sign` на каждом коммите.
- `dangerouslyDisableSandbox: true` для всех `tsx`-launched команд (smoke, build,
  fixtures, exec tsx, bench). Pure `pnpm typecheck/test/lint:*` — sandbox OK.
- Plan tracking: TaskCreate/TaskUpdate. Phase 1.1.1 plan: 27 tasks, все completed.
- WASI_SDK_PATH, emcc через `.tools/emsdk`, Rust toolchain 1.95.0 — все pinned.
- Browser drivers (chromedriver, geckodriver) — selenium-manager auto-downloads
  при первом запуске; работает без pre-install.

---

## Старт next session — checklist

1. Read `CLAUDE.md` (auto-loaded).
2. `git checkout master && git rev-parse HEAD` — capture base SHA (`a7d4d5a` или descendant).
3. `git status` — verify working tree clean (untracked `.claude/settings.local.json`
   + ephemeral results dir могут быть).
4. Read этот файл (handoff).
5. Read pitfall file §P1 — релевантно для любого нового workload spec'а, especially
   hashmap.
6. Read design spec § Контракт BenchModule (новая subsection «Checksum-семантика»).
7. Sanity check master gates.
8. Brainstorm Phase 1.1.2 (hashmap) — skill `superpowers:brainstorming`.

---

## Полезные команды

```bash
# Базовый ориентир
git rev-parse HEAD                                       # should be a7d4d5a or descendant
git branch --show-current                                # master
git log --oneline phase-1-1-0..phase-1-1-1 | wc -l       # 35 (branch range)
git log --oneline master..origin/master                   # commits behind (0 expected)
git log --oneline origin/master..master | wc -l           # commits ahead push waits (27)
git tag -l "phase-1-1-*"                                  # phase-1-1-0, phase-1-1-1

# Phase 1.1.1 artifacts
cat docs/pitfalls/2026-05-23-phase-1-1-1-execution.md     # 3 pitfalls
cat docs/guidelines.md                                    # 3 tentative claims (bindgen overhead — Phase 1.1.1)
ls results/raw/2026-05-22T21-06-13-615Z/ | wc -l          # 240 cases
open results/summarized/2026-05-22T21-10-17-290Z/index.html

# Pre-flight check
pnpm typecheck && pnpm lint:all && pnpm test
# pnpm smoke требует dangerouslyDisableSandbox через tsx

# Phase 1.1.2 spec section
sed -n '/### 1\.1\.2/,/### 1\.1\.3/p' docs/superpowers/specs/2026-05-20-phase-1-1-design.md
```

---

## Stop point

- Phase 1.1.1 **закрыт** на master (tag `phase-1-1-1`, merge `a7d4d5a`).
- 35 commits между phase-1-1-0 и phase-1-1-1 tags.
- Pitfalls **captured**. Design spec **updated** (Checksum semantics inline).
- CLAUDE.md + README.md **drift corrected** (multi-bench wording).
- Memory `project_wasm_benchmarks.md` **updated** (Phase 1.1.1 DONE section added).
- Push **не сделан** — на усмотрение user'а.
- Phase 1.1.2 (hashmap) **не начат** — следующий шаг.

В следующей сессии: pre-flight gates → читать pitfall §P1 + design spec § Checksum
semantics → brainstorm Phase 1.1.2 (hashmap).
