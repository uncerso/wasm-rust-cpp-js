# Session state — 2026-05-21 (Phase 1.1.0 closed)

Handoff для следующей сессии. Phase 1.1.0 hardening preamble закрыт на master с tag
`phase-1-1-0`. Pitfalls captured в новый раздел `docs/pitfalls/`. Первые 2 claim'а
добавлены в `docs/guidelines.md`. Execution next phase — Phase 1.1.1 writing-plans.

---

## TL;DR — где мы сейчас

- `master` HEAD = **`b5adeb4`** (`docs(pitfalls): capture Phase 1.1.0 execution lessons`).
- Tag `phase-1-1-0` поставлен на `8720f2f` (закрытие Phase 1.1.0).
- **16 commits этой сессии** (range `2ddcc0b..HEAD`).
- **Working tree clean.** Untracked: `.claude/settings.local.json`, «Какие есть существующие бенчмарки wasm под браузер.md» (то же что было).
- **`docs/tech_debt/` state:** 4 non-Phase-1.1 items + README + **1 новый** (`incorporate-pitfalls-2026-05-21.md`) ожидает review.
- **`docs/pitfalls/`:** новая директория, 1 файл + README.
- **`docs/guidelines.md`:** 2 tentative claim'а (первые в файле).
- **Origin not pushed.** Local-only state.

---

## Что прочитать перед стартом (порядок)

1. `CLAUDE.md` — auto-loaded. Обновлено в этой сессии (Phase status + `docs/pitfalls/` reference).
2. Этот файл (handoff).
3. `docs/pitfalls/2026-05-21-phase-1-1-0-execution.md` — **прочитать как минимум первые 3 pitfall'а в § Planning gotchas**, прежде чем стартовать writing-plans Phase 1.1.1. Они говорят: pre-flight master gates, addr_of! lint pitfall, clippy single-char.
4. `docs/tech_debt/incorporate-pitfalls-2026-05-21.md` — drive review pitfalls'ов и dispatch в CLAUDE.md / guidelines / spec template / new tech-debt. Может пройти в начале next session или позже.
5. `docs/superpowers/specs/2026-05-20-phase-1-1-design.md` § **Phase 1.1.1** (interop_calls) — source of truth для следующей sub-phase.
6. `docs/guidelines.md` — посмотреть 2 tentative claim'а (thread_local на wasm32, dead exports). Они станут confirmed после Phase 1.1.1+ workload'ов.

При желании — `docs/roadmap.md` (Phase 1.1 теперь содержит только Workloads cluster).

---

## Что было сделано в session 2026-05-21

### Phase 1.1.0 execution

Plan `docs/superpowers/plans/2026-05-20-phase-1-1-0-hardening-preamble.md` выполнен полностью. Hybrid execution (inline W1-W4, subagent W5). 14 commits + 2 commits «pitfalls/guidelines».

| Wave | Commits | Outcome |
|---|---|---|
| W1 docs | `9f1b636` + `c917c64` | README «Debug timings» section. |
| W2 rust-raw | `fa014f9` + `f618e08` + `d69d03b` | `addr_of!(HEAP.0)` + CPS `with_slices`. Byte-identical wasm. Fixup: `f` → `body` (clippy). |
| Preamble lint | `f538325` | `eslint --fix` 7 pre-existing errors (curly + quotes) в `runner-web/driver.ts`, `scripts/clear.ts`, `scripts/lib/setup-tools.ts`. |
| W3 cpp | `0dea322` + `5089bb9` | `alignas(8)` static heap. Byte size identical (toolchains уже выравнивали naturally). |
| W4 importScripts | `2aa14ad` | Grep verified clean. Resolved-by-prior-work. |
| W5 bindgen | `af475be` + `2dea1d5` + `47300da` + `3935ae7` | Dead API removal + `thread_local!` → `SyncCell`. Outcome (a) — drift полностью устранён. |
| Roadmap closure | `8720f2f` | Removed 3 closed clusters from `docs/roadmap.md` § Phase 1.1. |

### Sizes — W5 result vs Wave-3 drift

| | speed raw | size raw |
|---|---|---|
| Pre-Wave-3 baseline (efab4f0) | 14793 B | 12572 B |
| Wave-3 drift (`94f313e`..`2ddcc0b`) | 15949 B (+1156) | 13458 B (+886) |
| Post-W5 (current) | **14482 B (-311 vs baseline)** | **12318 B (-254 vs baseline)** |

Обе профиля **ниже** pre-Wave-3 baseline. Drift полностью устранён + ещё небольшой запас.

### Pitfalls и guidelines

**`docs/pitfalls/` — новый раздел.** README + первый файл (`2026-05-21-phase-1-1-0-execution.md`). 11 pitfall'ов в 3 категориях: planning gotchas (5), tooling friction (3), validated process patterns (3). Каждый pitfall: «What happened» / «Root cause» / «Prevention».

**Tech-debt `incorporate-pitfalls-2026-05-21`** — drive review через 6 каналов (CLAUDE.md / spec template / guidelines / memory / new tech-debt / skip). Suggested workflow в файле.

**`docs/guidelines.md` — первые claim'ы.** 2 tentative в § Code patterns:
- «Не используй `thread_local!` для глобального состояния в wasm32 cdylib — бери `static SyncCell<T>`».
- «Не оставляй `#[wasm_bindgen]` exports «на будущее»».

Оба — `tentative` (single workload — matmul). Confirmation upgrade ожидается в Phase 1.1.1+.

### Memory updated (auto by `/finish-session`)

- `MEMORY.md` description обновлено: Phase 1.1.0 closed + pitfalls/ entry + guidelines first claims.
- `project_wasm_benchmarks.md`: frontmatter rewritten; «Phase 1.1 — DESIGNED» секция заменена на «Phase 1.1.0 — DONE» + «Phase 1.1 — IN PROGRESS».

### Docs drift correction (auto by `/finish-session`)

- `CLAUDE.md` L14 — Phase status line updated.
- `CLAUDE.md` L17 added — `docs/pitfalls/` в canonical sources listing.
- `README.md` L7 — Status line: Phase 1.1.0 closed mentioned, Phase 1.1.1 next.

---

## Решения, зафиксированные в этой сессии (не передоговариваться)

| Решение | Где зафиксировано |
|---|---|
| Hybrid execution — inline W1-W4, subagent W5 — validated pattern | `pitfalls/2026-05-21-...` § 10 + memory feedback |
| Pre-flight master-gates check необходим для exit criteria | pitfall #1 |
| `addr_of!(STRUCT.field)` предпочтительнее `addr_of!(STRUCT)` если поле теряет other reads | pitfall #2 |
| Closure params в idiomatic code: descriptive names (body, cb, kont, pred) | pitfall #3 |
| pnpm в этом репо всегда требует `dangerouslyDisableSandbox: true` | pitfall #4 |
| `$TMPDIR` instead of `/tmp` для writes; capture pre+post в одной Bash call | pitfall #5 + #5b |
| `alignas` на static buffers — typically zero byte-size change; hash drift normal | pitfall #7 |
| Session-state регрессий должна цитировать **конкретный commit**, не «whole wave» | pitfall #8 |
| Numeric baseline в session-state — высокая ценность для future investigations | pitfall #9 |
| Subagent deviation rule: explicit «what counts as cleanup scope» в brief | pitfall #11 |
| Phase 1.1.0 closure tagged как `phase-1-1-0` (consistent с `phase-1-0-X` pattern) | tag annotation |

---

## Подводные камни / нюансы для Phase 1.1.1 planning

### 1. Multi-entry-point pattern впервые

Phase 1.1.1 вводит `spec.json.entries: string[]` + loader factory `createBenchModule(spec, entry?)`. **Crucial test:** убедиться что matmul (single-entry) и interop_calls (3 entries) обслуживаются одним unified flow без специальных шим'ов.

### 2. Auto-discovery in build-all.ts

Заменить hardcoded `const benches = ["matmul"]` на `glob("benches/*/spec.json")`. Mock тесты для multi-entry binary — обязательно перед reаl impl'ами.

### 3. Fixture-less benchmark — first case

interop_calls: `fixtureBytes = 0`, `fixtureSha256 = SHA256("")` = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. Schema не меняется. Validation pipeline должен принять.

### 4. Pre-flight check перед exit criteria

Lesson из pitfall #1 — перед writing-plans Phase 1.1.1 убедиться что master green по всем gates. `pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke` — должны все exit 0. На момент написания этого session-state — все зелены.

---

## Workflow notes (без изменений)

- `--no-gpg-sign` обязателен на каждом коммите.
- `pnpm` всегда требует `dangerouslyDisableSandbox: true` (pitfall #4).
- WASI_SDK_PATH, emcc через `.tools/emsdk`, Rust toolchain 1.95.0.
- Hybrid execution: subagent для multi-file complex, inline для тривиального.
- `Bash run_in_background: true` + `dangerouslyDisableSandbox: true` для long bench runs.
- Proactive `/finish-session` suggestion в natural stopping points.

---

## Старт next session — checklist

1. Read `CLAUDE.md` (auto-loaded).
2. `git rev-parse HEAD` — capture base SHA (должно быть `b5adeb4` или descendant). `git tag -l "phase-1-1-*"` — должен показать `phase-1-1-0`.
3. `git status` — verify working tree clean (untracked legacy игнорируется).
4. Read этот файл (handoff).
5. Read `docs/pitfalls/2026-05-21-phase-1-1-0-execution.md` § Planning gotchas (минимум первые 3).
6. Read `docs/superpowers/specs/2026-05-20-phase-1-1-design.md` § Phase 1.1.1.
7. **Sanity check master gates green** (per pitfall #1):
   ```bash
   pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke
   ```
8. **Start writing-plans для Phase 1.1.1.** Skill: `superpowers:writing-plans`. Spec-driven, использовать spec § Phase 1.1.1 как input.

При желании — `/tech-debt-review` или `/backlog-review` для sanity-check (1 new tech-debt появилось — `incorporate-pitfalls-2026-05-21`). Можно также сначала dispatch'нуть pitfalls в CLAUDE.md/spec template/guidelines чтобы next phase planning сразу использовал улучшенные templates.

---

## Stop point

- Phase 1.1.0 **closed** на master, tagged.
- Pitfalls **captured**.
- First guidelines claim'ы **добавлены** (tentative).
- Docs (CLAUDE.md/README.md) и memory **обновлены**.
- Tech-debt `incorporate-pitfalls-2026-05-21` — **ожидает review** в next session или раньше.
- Execution Phase 1.1.1 **не начато** — следующий шаг.

В следующей сессии: pre-flight gates check → optionally dispatch pitfalls (через `incorporate-pitfalls-2026-05-21`) → `superpowers:writing-plans` Phase 1.1.1 (interop_calls + multi-entry-point infra).

---

## Полезные команды

```bash
# Базовый ориентир
git rev-parse HEAD                                       # should be b5adeb4 or descendant
git tag -l "phase-1-1-*"                                 # phase-1-1-0
git log --oneline -16                                    # последние commits сессии

# Phase 1.1 artifacts
cat docs/superpowers/specs/2026-05-20-phase-1-1-design.md
cat docs/pitfalls/2026-05-21-phase-1-1-0-execution.md

# Backlog state
cat docs/roadmap.md                                      # Phase 1.1 теперь только Workloads
ls docs/tech_debt/                                       # 5 .md + README (4 non-1.1 + 1 pitfalls-review)

# Guidelines first claims
cat docs/guidelines.md                                   # 2 tentative claims в Code patterns

# Pre-flight master green check (per pitfall #1)
pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke
```
