# Session state — 2026-05-15 (roadmap+tech-debt system live, Phase 1.1 scope frozen)

Handoff для следующей сессии. Phase 1.1 ещё не начат, но scope зафиксирован, и стоит
полная инфраструктура backlog'а (live index + capture extension + два triage skill'а).
Дальше — `superpowers:brainstorming` → `superpowers:writing-plans` под Phase 1.1.

В этом файле — то, чего нет в спеке/плане/коде/git history. Высокоуровневое состояние и
актуальные указатели. Общие feedback'и — в auto-memory.

---

## TL;DR — где мы сейчас

- `master` HEAD = `15b69f3` (commit `Categorized tech-debts` — previous session's tech-debt triage changes).
- **Uncommitted** в working tree (этой сессии work): новый `docs/roadmap.md`, новый `.claude/skills/backlog-review/`, edits в `CLAUDE.md` + `docs/tech_debt/README.md` + `.claude/skills/tech-debt-review/SKILL.md`, deletion `docs/tech_debt/resolved/scripts-clear-cwd-assertion.md`.
- Phase 1.1 scope-decision **зафиксирован** в `docs/roadmap.md` § Phase 1.1: 3 workloads (interop-calls, hashmap-workload, shape-dispatch) + 8 tech-debt items (bindgen size cluster + rust-raw hardening + 3 solo).
- Phase 1.1 implementation **не начат**. Следующий шаг — brainstorm + writing-plans для compose'а spec/plan.

---

## Что прочитать перед стартом (порядок)

1. `CLAUDE.md` — auto-loaded. Содержит **два** capture protocol'а: «Tech-debt capture» (existing) и «Roadmap capture» (новый в этой сессии).
2. `docs/roadmap.md` — live index. Phase 1.1 bucket = текущий scope, Phase 1.2/2+ = deferred, TBD/Won't do = пусты.
3. `docs/tech_debt/README.md` — формат + status machine. **Updated:** `resolved → delete file`, никакого `resolved/` archive больше.
4. **Если planning Phase 1.1:** `docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md` § Phase 1.1 (~lines 191-206) для original definitions workloads.
5. Этот файл (handoff).

---

## Что было сделано в session 2026-05-15

Длинная сессия по двум темам подряд:

### Часть 1 — tech-debt triage (2026-05-15, ранее в сессии)
- `/tech-debt-review` пройден на 13 seed items.
- Результат: 1 resolved (scripts/clear.ts cwd assertion fix), 10 marked `roadmap: phase-1.1-candidate`, 2 stay-open (cpu-throttling, clang-tidy).
- 1 item discovered as misattributed: `rust-raw-output-view-force-copy` renamed to `bindgen-output-view-force-copy` (по факту касается bindgen, не raw; rust-raw уже zero-copy).
- Bonus finding: `readOutput()` API нигде не вызывается в production (dead API). Зафиксировано в обновлённом item.
- Эти изменения уже в `15b69f3` (committed by user).

### Часть 2 — Phase 1.1 scope-decision + roadmap+tech-debt system (текущие edits, **uncommitted**)
- Сделан scope-decision: Phase 1.1 = 3 workloads + 8 tech-debt (8 = 3 bindgen cluster + 2 rust-raw + 3 solo). Phase 1.2/2+ — deferred.
- Создана инфраструктура:
  - **`docs/roadmap.md`** — live index с buckets Phase 1.1/1.2/2+/TBD/Won't do + Conventions section. Source of truth для формата.
  - **`CLAUDE.md` § Roadmap capture** — passive protocol для AI: при обнаружении feature-level item (новый workload, runtime axis, infra epic) — предлагать добавить one-liner в roadmap.md.
  - **`.claude/skills/backlog-review/SKILL.md`** — `/backlog-review` slash command: format audit → cross-check с tech_debt/ → bucket display → triage (promote/defer/remove/move-to-wontdo/skip) → apply edits → summary.
- Обновлены existing files:
  - `docs/tech_debt/README.md`: status flow `resolved → delete file` (не move в resolved/), cross-ref roadmap.md, граница «tech-debt wontfix не дублируется в roadmap.md».
  - `.claude/skills/tech-debt-review/SKILL.md`: updated resolved flow (delete file), описание + cross-refs roadmap.md.
  - `CLAUDE.md` § Tech-debt capture: «Что НЕ предлагать» расширено для roadmap.md.
- Удалено: `docs/tech_debt/resolved/scripts-clear-cwd-assertion.md` + сам каталог `resolved/` (per new policy).
- Auto-memory: `project_wasm_benchmarks.md` updated (новый раздел «Backlog system»), `MEMORY.md` index entry refreshed.

**Skipped (intentional):** `/discover-backlog` safety-net skill — отложен, пока drift не проявится в practice.

---

## Решения, зафиксированные в этой сессии (не передоговариваться)

| Решение | Где зафиксировано |
|---|---|
| Phase 1.1 scope = 3 workloads + 8 tech-debt | `docs/roadmap.md` § Phase 1.1 |
| Workloads cluster: только A1-A3 (no stdlib containers) | `docs/roadmap.md` § Phase 2+ для stdlib |
| Browsers cluster: всё отложено (Safari, cross-platform) | `docs/roadmap.md` § Phase 1.2 |
| CI cluster: отложено в Phase 1.2 | `docs/roadmap.md` § Phase 1.2 |
| Tech-debt cluster: bindgen + rust-raw оба в Phase 1.1 | `docs/roadmap.md` § Phase 1.1 clusters |
| Roadmap format: phase buckets, single `→`, free-form clusters | `docs/roadmap.md` § Conventions |
| Resolved tech-debt = delete file (не move в resolved/) | `docs/tech_debt/README.md` § Status machine |
| Wontfix tech-debt не дублируется в roadmap.md Won't do | `docs/tech_debt/README.md` + `docs/roadmap.md` § Won't do note |
| Tech-debt wontfix stays в tech_debt/ с status:wontfix | Существующая convention, переподтверждена |
| Won't do entry format: `**Decided <date>:** rationale` | `docs/roadmap.md` § Conventions |
| Capture extension passive (не skill) | `CLAUDE.md` § Roadmap capture |
| Discover-backlog skill — отложен | Этот файл (intentional skip) |

---

## Подводные камни, не очевидные из кода

### 1. Два capture protocol'а в CLAUDE.md — разные scale items

AI в новой сессии auto-loads CLAUDE.md и должен соблюдать **оба** protocol'а:
- **Tech-debt capture** — мелкие process gaps / latent bugs (single file impact).
- **Roadmap capture** — крупные feature items (workload, axis, epic).

Граница в § «Граница tech-debt vs roadmap» внутри Roadmap capture section. Trigger
phrases distinct для обоих.

### 2. `/backlog-review` НЕ может писать specs

Skill только перетасовывает buckets, fix'ит format, и cross-check'ит. **Graduate-to-spec
action** означает «удалить строку, теперь spec — source of truth», но skill не пишет
spec — для этого `superpowers:writing-plans` отдельно.

### 3. Format audit в `/backlog-review` — первый шаг

Если roadmap.md формат drift'нул — `/backlog-review` сначала зафиксирует format (с
confirmation user'а), потом перейдёт к triage. Это **layer 2** защиты от drift'а
(layer 1 — Conventions section в самом roadmap.md, layer 3 — fixed template в capture
extension).

### 4. Tech-debt items с phase target дублированы в roadmap.md

Tech-debt item с `roadmap: phase-X-candidate` frontmatter одновременно:
- Файл `docs/tech_debt/<slug>.md` — source of truth (контент).
- Строка в `docs/roadmap.md` § Phase X.Y — index (one-line link).

`/backlog-review` step 3 cross-checks consistency: orphan candidates (frontmatter, нет в
roadmap.md) + stale links (roadmap.md ссылается на resolved/wontfix item).

### 5. Untracked files игнорировать

`.claude/settings.local.json`, `.pnpm-store/`, `chrome-console.txt`, `firefox-console.txt`,
`Какие есть существующие бенчмарки wasm под браузер.md` — не commit'ить (те же что
были перед сессией).

---

## Workflow notes

Без изменений с Phase 1.0.6:
- `--no-gpg-sign` обязателен на каждом коммите (зафиксировано в `CLAUDE.md`).
- WASI_SDK_PATH, emcc через .tools/emsdk, Rust toolchain 1.95.0.
- Гибридная execution: subagent для сложного, inline для тривиального.
- Длинные bench-прогоны: `Bash run_in_background: true` + `dangerouslyDisableSandbox: true`.

**Новое в этой сессии:**
- При замечании feature-уровня item'а — соблюдай Roadmap capture (один раз предложи).
- При замечании tech-debt — Tech-debt capture (как раньше).
- Не путать. Если сомневаешься — спроси user'а.

---

## Старт next session — checklist

1. Read `CLAUDE.md` (auto-loaded).
2. `git rev-parse HEAD` — capture base SHA (должно быть `15b69f3` или descendant с этими edits committed).
3. `git status` — verify что edits этой сессии (или) committed (или) в working tree.
4. **Если commit'ить edits этой сессии не сделал — это первый шаг.** Suggested commit:
   ```
   chore: introduce docs/roadmap.md + /backlog-review skill

   - New live index docs/roadmap.md with Phase 1.1/1.2/2+/TBD/Won't do buckets.
   - CLAUDE.md § Roadmap capture protocol.
   - .claude/skills/backlog-review/ slash command for triage.
   - tech_debt/README.md: resolved → delete file (no archive).
   - tech-debt-review skill updated for new resolve flow.
   ```
5. Read `docs/roadmap.md` § Phase 1.1 — scope.
6. **`superpowers:brainstorming`** для clarification implementation подхода workloads (interop_calls, hashmap_workload, shape_dispatch).
7. **`superpowers:writing-plans`** для compose'а formal Phase 1.1 spec/plan.

При желании — пере-`/tech-debt-review` или `/backlog-review` для sanity-check (не обязательно, состояние свежее).

---

## Stop point

- Phase 1.1 scope зафиксирован в roadmap.md, но Phase 1.1 plan/spec НЕ написан.
- Backlog system infrastructure committed внутри HEAD `15b69f3`? **Нет** — это новые edits в working tree, ждут commit'а next session (или manual commit пользователя).
- Working tree dirty (см. TL;DR).

В следующей сессии: commit infrastructure edits → brainstorm Phase 1.1 → writing-plans.

---

## Полезные команды

```bash
# Базовый ориентир
git rev-parse HEAD                                       # should be 15b69f3 or descendant
git log --oneline -5                                     # последние commits
git status                                               # untracked + uncommitted

# Backlog state
cat docs/roadmap.md                                      # live index
ls docs/tech_debt/                                       # atomic debt files (no resolved/ anymore)
grep -l "^roadmap:" docs/tech_debt/*.md                  # tech-debt items с phase target

# Triage (если нужно)
# /tech-debt-review                                      # for docs/tech_debt/*
# /backlog-review                                        # for docs/roadmap.md

# Quick smoke / bench (если нужно verify ничего не сломалось)
pnpm smoke

# Orchestrator typecheck
npx tsc --noEmit -p tsconfig.json
```
