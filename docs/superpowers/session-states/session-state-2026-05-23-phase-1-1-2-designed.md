# Session state — 2026-05-23 (Phase 1.1.2 spec + plan committed)

Handoff для следующей сессии. Эта сессия — brainstorm + spec + plan для Phase 1.1.2
(hashmap workload). Никакой код не написан; implementation — отдельная следующая
сессия.

---

## TL;DR — где мы сейчас

- Branch: **`master`** (no feature branch yet).
- Master HEAD: **`fbee594`** (plan commit; spec at `731c0ad`).
- In sync с `origin/master` (push был сделан между Phase 1.1.1 close и этой сессией).
- Все master gates зелёные (typecheck + lint + test verified в начале сессии; smoke не запускался — sandbox-bypass нужен).
- Two commits added в этой сессии:
  - `731c0ad` `docs(specs): Phase 1.1.2 hashmap execution design` (462 lines).
  - `fbee594` `docs(plans): Phase 1.1.2 hashmap implementation plan` (2043 lines, 27 tasks).

---

## Done in this session (2026-05-23)

Session был чисто design-only. Никаких источников или конфигов не трогали; всё —
docs.

### Artifacts created

| Path | Purpose |
|---|---|
| `docs/superpowers/specs/2026-05-23-phase-1-1-2-hashmap-design.md` | Execution spec — refines umbrella `2026-05-20-phase-1-1-design.md § Phase 1.1.2` с конкретными design decisions из brainstorming. |
| `docs/superpowers/plans/2026-05-23-phase-1-1-2-hashmap.md` | 27-task implementation plan, 3 waves, каждый task с file paths + complete code + exact commands. |

### Decisions zafiksirovany (не передоговариваться)

| Решение | Где зафиксировано (spec section) |
|---|---|
| Scope: 2 binaries × 3 entries × 3 sizes × 3 toolchains = 108 cases | spec § Scope |
| Deferred to roadmap `hashmap-stdlib-no-glue` (Phase 1.2): rust/raw + cpp/wasi-sdk | spec § Out of scope |
| Rejected: js/typed-array (re-implements stdlib, not stdlib usage) | spec § Scope > Rejected explicitly |
| State model: per-entry `<entry>_reset` companion exports (наследует `<entry>_counter` precedent из 1.1.1) | spec § Workload contract > State |
| Numeric layout: keys в [0, 2^53), values в [0, 2^32) — JS Map<number, number> safe | spec § Fixture format |
| Delete checksum: sum-of-removed-values (НЕ map.size() = 0 — слабая валидация против stub-bugs) | spec § Workload contract > Checksum per entry |
| common/fixtures.ts: minimal lift — Mulberry32 + 3 generators (genF64Array, genAsciiHexKeys, genIntPairs53). genBytes исключён (YAGNI). | spec § Common infrastructure |
| Matmul refactor byte-preserve invariant — SHA256 фикстур matmul не должен измениться | spec § Common infrastructure > Matmul refactor |
| Loader changes: `bindReset` helper в новом `packages/loaders/src/bind-reset.ts`, DRY-applied к raw-wasm/rust-bindgen/emscripten loaders | spec § Loader changes |
| SEEDS naming convention extension: `0xDEAD_0001..03` (hashmap_string), `0xBEEF_0001..03` (hashmap_int). Matmul `0xC0FFEE_01..03` untouched. | spec § Fixture format > Seeds |
| Wave structure: W1 infra+spec (Tasks 1-13), W2 impls (Tasks 14-21), W3 bench+close (Tasks 22-27). Pre-flight Task 0 первым. | spec § Wave structure |
| Phase merge style: feature branch → `--no-ff` merge в master с subject `merge: Phase 1.1.2 (hashmap...)` (precedent 1.0.5/1.0.6/1.1.1) | plan Task 26 |

### Что НЕ сделано (намеренно — следующая сессия)

- Никакого кода не написано (no code touched).
- Никаких build / smoke / test runs не запускалось (только верификация gates в начале сессии).
- Feature branch `feature/phase-1-1-2` НЕ создан — start of Task 0 / 1 решит.

---

## Open risks / known unknowns (см. spec § Open risks)

Эти риски осознанные и могут материализоваться в execution; не баги, но flag'и:

1. **Warmup vs sample state asymmetry для insert/delete** (см. spec § Open risks bullet 1). loadInput pre-fills map (общий path для трёх entries). Warmup для insert работает на pre-filled (upserts), samples — на empty (после insert_reset). JIT tier-up exercises same hot code — acceptable. Не баг, документировано.
2. **Matmul SHA256 drift при `genF64Array` refactor**: P1 §1 byte-preserve violation. Plan Task 2 Step 5 имеет explicit checkpoint — diff против `benches/matmul/spec.json` existing fixtureSha256. Если drift → STOP, fix `genF64Array`, не идти дальше.
3. **wasm-bindgen `String` overhead** на hashmap_string — может быть interesting bundle-size data point (Pred 1.1.2 evidence-base).
4. **emscripten `std::unordered_map<std::string>` glue size** — libc++ string symbols могут существенно увеличить glue.mjs. Если > 20 KB на size profile — confirmed guideline candidate.
5. **Firefox-emscripten 5x slowdown** (открытый tech-debt из 1.1.1, `docs/tech_debt/firefox-emscripten-noop-5x-slowdown.md`) — может recurr на hashmap. Если recur — escalate в confirmed guideline.
6. **`scripts/build-cpp.ts` wasi-sdk skip** — plan Task 19 Step 5 предполагает что orchestrator skip'нет combos без `cpp/build-wasi-sdk.sh`. Если нет — отдельный patch (plan Task 19 surfaces this).

---

## What the next session needs to know

### Чтобы стартовать execution

1. **Прочитать в порядке:**
   - `CLAUDE.md` (auto-loaded).
   - `docs/superpowers/session-states/session-state-2026-05-23-phase-1-1-1-closed.md` (предыдущий handoff, особенно для Phase 1.1.1 closing context).
   - Этот файл (handoff для 1.1.2).
   - `docs/superpowers/specs/2026-05-23-phase-1-1-2-hashmap-design.md` — execution spec.
   - `docs/superpowers/plans/2026-05-23-phase-1-1-2-hashmap.md` — 27 tasks, start с Task 0.
   - `docs/pitfalls/2026-05-23-phase-1-1-1-execution.md` § P1 — iter-dependent checksum protocol (hashmap inherits same контракт).

2. **Sanity check master gates (Task 0):**
   ```bash
   git checkout master && git pull
   pnpm typecheck && pnpm lint:all && pnpm test
   pnpm smoke    # dangerouslyDisableSandbox per CLAUDE.md tsx-sandbox note
   ```
   Должны exit 0. Если падает — STOP, surface к user, не маскировать.

3. **Создать feature branch перед Wave 1:**
   ```bash
   git checkout -b feature/phase-1-1-2
   ```

4. **Execution skill:** plan recommend'ит **`superpowers:subagent-driven-development`** (fresh subagent per task, two-stage review) или **`superpowers:executing-plans`** (inline batched). Plan structured для обоих.

### Принципиальные напоминания

- **`--no-gpg-sign` на каждом коммите** (per CLAUDE.md + project memory feedback_gpg_no_sign).
- **`dangerouslyDisableSandbox: true`** для всех tsx-launched команд (smoke, build, fixtures, bench, exec tsx). Pure pnpm typecheck/test/lint:* — sandbox OK.
- **Task ordering matters**: Task 2 (matmul byte-preserve sanity) blocks Task 3 (matmul refactor). Don't reorder.
- **Each task = ~one commit**. Plan tasks already split by commit boundary.

---

## Deferred / Out of scope

### Из этой сессии — пере-направлено

- **Pitfalls capture skip** для этой сессии: friction signals в design были weak (две stylistic reformulations — SEEDS naming + Q5 rationale request — обе resolved в одном round-trip). Не критично, не fixируем.

### Из Phase 1.1.2 scope (см. spec § Out of scope)

- **`rust/raw` hashmap** — no_std incompatible с std::collections::HashMap → roadmap entry `hashmap-stdlib-no-glue` (Phase 1.2).
- **`cpp/wasi-sdk` hashmap** — current freestanding setup без libc++ unordered_map → same roadmap entry.
- **Non-default hashers** (FxHash / ahash) — fair-baseline comparison требует stock stdlib defaults.
- **`shape_dispatch`** (workload) — Phase 1.1.3.
- **Reporter v2** — Phase 1.1.3.

### Open tech-debt (carry-over)

- `docs/tech_debt/firefox-emscripten-noop-5x-slowdown.md` — investigation lead из Phase 1.1.1. Может recurr на hashmap; если recur → escalate confirmed guideline.
- `docs/tech_debt/incorporate-pitfalls-2026-05-22.md` — bulk-deferred items из Phase 1.1.1 Wave 1. Periodic review via `/tech-debt-review`.

### Push status

`origin/master` уже sync с master HEAD (push был сделан между сессиями). Если будут новые коммиты в master (после Phase 1.1.2 close) — push на усмотрение user'а, не входит в скоуп phase-close.

---

## Старт next session — checklist

1. Read `CLAUDE.md` (auto-loaded).
2. `git checkout master && git rev-parse HEAD` — capture base SHA (`fbee594` or descendant).
3. `git status` — verify working tree clean.
4. Read этот файл (handoff for 1.1.2).
5. Read execution spec + plan files (см. "Чтобы стартовать execution" above).
6. Sanity check master gates (Task 0).
7. Create feature branch `feature/phase-1-1-2`.
8. Choose execution skill (subagent-driven recommended).
9. Start с Task 1 (common/fixtures.ts mulberry32 TDD-style).

---

## Полезные команды

```bash
# Базовый ориентир
git rev-parse HEAD                                       # should be fbee594 or descendant
git branch --show-current                                # master (before feature branch creation)
git log --oneline master..origin/master                  # commits behind (0 expected)
git log --oneline origin/master..master                  # commits ahead (0 expected — same point)
git tag -l "phase-1-1-*"                                 # phase-1-1-0, phase-1-1-1

# Phase 1.1.2 artifacts
cat docs/superpowers/specs/2026-05-23-phase-1-1-2-hashmap-design.md
cat docs/superpowers/plans/2026-05-23-phase-1-1-2-hashmap.md

# Pre-flight check (Task 0)
pnpm typecheck && pnpm lint:all && pnpm test
# pnpm smoke требует dangerouslyDisableSandbox через tsx

# Phase 1.1.2 spec section в umbrella (контекст вокруг execution spec)
sed -n '/### Phase 1\.1\.2/,/### Phase 1\.1\.3/p' docs/superpowers/specs/2026-05-20-phase-1-1-design.md
```

---

## Stop point

- Phase 1.1.2 **design phase complete** (spec + plan committed на master).
- **Никакого кода не написано** — feature branch не создан, gates только verified в начале сессии.
- Memory **updated** (MEMORY.md index + project_wasm_benchmarks.md frontmatter + body + sequencing pointer).
- Phase 1.1.2 **execution не начат** — следующий шаг.

В следующей сессии: pre-flight gates → создать feature branch → выбрать execution skill → начать с Task 1.
