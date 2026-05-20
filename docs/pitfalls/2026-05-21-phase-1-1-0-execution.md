# Pitfalls — Phase 1.1.0 execution (2026-05-21)

Lessons из исполнения `docs/superpowers/plans/2026-05-20-phase-1-1-0-hardening-preamble.md`
(8 tech-debt items closed, bindgen drift полностью устранён, commit range
`9f1b636..8720f2f` на master, tag `phase-1-1-0`).

---

## Planning gotchas

### 1. Exit criteria недостижимы если master baseline уже broken

**What happened.** Phase 1.1.0 exit criteria требовали `pnpm lint:all` PASS. На master
(`2ddcc0b` pre-execution) `pnpm lint:ts` падал с 7 errors (curly + quotes) в трёх файлах
вне scope 1.1.0 (`apps/runner-web/src/driver.ts`, `scripts/clear.ts`,
`scripts/lib/setup-tools.ts`). Plan/spec этого не предвидели — пришлось добавить
отдельный `style(lint): apply eslint --fix` commit с user согласия чтобы exit criteria
стали достижимы.

**Root cause.** Spec/plan писались по embedded pre-exploration scope, но **pre-flight
gate check на master** не выполнялся. Когда CI отсутствует, регрессии gates накапливаются
unnoticed.

**Prevention.**
- **В spec template:** добавить «Pre-flight: текущий master зелёный по всем gates
  (`pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke`)?» как obligatory
  step before writing exit criteria. Если не зелёный — это первая задача sub-phase или
  отдельный preamble commit.
- **В plan executor protocol:** Wave 0 ≡ baseline check. Если падает — STOP, surface к
  user, не маскировать.
- **Strategic:** ускорить `ci-github-actions` (Phase 1.2 candidate) — это устранит class
  целиком.

### 2. `addr_of!(struct)` уронит build если поле выходит из use

**What happened.** Plan говорил заменить `(*HEAP.0.get()).as_ptr() as usize` на
`core::ptr::addr_of!(HEAP) as usize`. Компилятор отреагировал `error: field '0' is
never read` — `GlobalHeap.0` больше не reads. Пришлось взять `addr_of!(HEAP.0)` —
читает поле для dead_code lint, плюс семантически точнее (UnsafeCell — `repr(transparent)`
→ addr of `.0` == addr inner storage).

**Root cause.** Plan'овский комментарий «UnsafeCell is repr(transparent), so addr of
HEAP.0 == addr of HEAP» был partially incorrect: addr-of-HEAP == addr-of-HEAP.0 верно
**только** если outer `GlobalHeap` — `#[repr(transparent)]`. На `repr(Rust)` layout
implementation-defined; даже если на practике компилятор всегда кладёт single field
по offset 0, гарантии нет. Plan apply'ed раcческу «addr_of! is bulletproof» без
проверки что dead_code lint не сработает.

**Prevention.**
- При refactor'ах со снятием dereference: подумать, **какое поле теперь не читается**,
  и или (а) `#[repr(transparent)]` на outer struct, или (б) брать addr через поле
  (`addr_of!(STRUCT.field)`), или (в) `#[allow(dead_code, reason = "...")]` с явным
  rationale.
- Plan'ы для unsafe refactor'ов: один paragraph «Что про lint'ы — что должно остаться
  silent после refactor».

### 3. Clippy `many_single_char_names` ловит закрытие в плотной single-char зоне

**What happened.** `with_slices<R>(f: impl FnOnce(&[f64], &[f64], &mut [f64], usize) -> R)`
добавил 5-й single-char param `f` поверх существующих `a, b, c, n`. Clippy bailed
с `-D warnings`. Renamed `f` → `body`. Wasm output остался byte-identical.

**Root cause.** Plan не учёл что closure / function-param naming inherits area's
existing convention. Project enforces `clippy::pedantic`+`nursery` warn (+ `-D warnings`)
— любой 5-й+ single-char триггерит lint.

**Prevention.**
- При добавлении новых closure/fn params в idiomatic mat-code (где `a, b, c, n, i, j, k`
  уже плотно), default на descriptive names: `body`, `cb`, `kont`, `pred`.
- Plan'ы для refactor'ов: проверить existing single-char count в touched fn'ах.

---

## Tooling / operational

### 4. `pnpm` всегда требует sandbox bypass в agent sessions

**What happened.** Первый `pnpm typecheck` упал с `command not found`. Pnpm доступен
только через corepack shim, который пишет в `~/.cache/node/corepack/v1` — вне
sandbox writable paths. Каждый `pnpm <cmd>` требует `dangerouslyDisableSandbox: true`.
Memory упоминала это для bench runs, но проблема **шире** — любая `pnpm` команда.

**Root cause.** Project использует pnpm через corepack без globally installed binary;
sandbox policy запрещает write outside `$TMPDIR / repo / .npm/_logs / .claude/debug`.

**Prevention.**
- Добавить в CLAUDE.md один параграф под Tooling / Sandbox: «`pnpm` через corepack —
  каждая команда требует `dangerouslyDisableSandbox: true`».
- Или: `/sandbox` config расширить writable allowlist на `~/.cache/node/corepack/`.
- Memory уже это упоминала частично — расширить feedback entry.

### 5. `/tmp` write blocked; всегда `$TMPDIR`

**What happened.** Plan'овские `tee /tmp/raw-pre.txt` упали с `Operation not permitted`.
Pivot на `tee "$TMPDIR/raw-pre.txt"` — работает. Между bash-вызовами `$TMPDIR` иногда
изменяется (sandboxed per-call), поэтому `diff $TMPDIR/raw-pre.txt -` мог не найти файл.

**Root cause.** Sandbox writable allowlist не включает `/tmp` напрямую. `$TMPDIR`
подменяется на per-session writable path.

**Prevention.**
- В plan templates: использовать `$TMPDIR/…` не `/tmp/…`.
- Capture pre+post hashes в одной Bash call (tee обоих файлов одной командой), не
  полагаться на persistence `$TMPDIR` между invocations.

### 6. `pnpm typecheck` пропускает `scripts/`

**What happened.** Lint-fix preamble затронул `scripts/clear.ts` и
`scripts/lib/setup-tools.ts`. Typecheck показал «8 of 9 workspace projects» — `scripts/`
не входит. Если бы lint:fix внёс type error — не заметили бы до runtime.

**Root cause.** `scripts/` не workspace package, `tsc --noEmit` не запускается там.
Известный tech-debt (`docs/tech_debt/pnpm-typecheck-skips-scripts.md`), Phase 1.2
candidate.

**Prevention.**
- При edit'ах в `scripts/`: explicit `pnpm exec tsx --check scripts/<file>.ts` или
  `pnpm exec tsc --noEmit scripts/lib/...ts`.
- Закрыть tech-debt в Phase 1.2 (`ci-github-actions` track).

---

## Process patterns

### 7. `alignas` на static buffer — typically no byte-level change, hash drift normal

**What happened.** Plan ожидал «may or may not change wasm output by < 8 bytes». На
practice — оба toolchain'а уже выравнивали `uint8_t heap[32MB]` natively (большой
буфер default-aligned ≥ 8). Byte size byte-identical (864/1205/760/985 pre = post);
hash drift только из-за section/metadata reordering.

**Root cause.** Toolchain default behavior для large static arrays обычно даёт
8-byte alignment naturally. `alignas` для таких случаев — documentation of invariant,
не runtime fix.

**Prevention.**
- При reasoning о alignment refactor'ах: ожидать **byte size = identical**, hash drift
  acceptable. Wave/commit message формулирует pre/post **size**, не hash.
- Worth noting в guidelines (если pattern reproducible across other workloads):
  «explicit `alignas` over toolchain defaults для `reinterpret_cast<T*>` targets» —
  пишет invariant в код, runtime impact = 0.

### 8. Session-state должна цитировать конкретный commit, не «whole wave»

**What happened.** `session-state-2026-05-05-wave-3.md` приписывал bindgen size drift
«Wave 3 (Rust raw refactor)». На самом деле раw был byte-identical; drift жил в
**commit `bf98a11`** в той же сессии («refactor(rust/bindgen): extract algorithm to
shared; replace static mut with thread_local!»). Без поднятия git log forensic answer
был бы неполным.

**Root cause.** Sessions могут содержать несколько commits; «Wave N» как unit смешивает
attribution. Bug-causing commit specific, не wave-level.

**Prevention.**
- Session-state записи: при упоминании регрессии **цитировать sha** (`commit <short-sha>:
  <subject>`), не только wave-name.
- При open investigation tech-debt — `source:` поле должно cite commit, не just session.

### 9. Numeric baseline в session-state — high-leverage для future investigations

**What happened.** Forensic decision (W5.4 outcome a/b/c) опирался на numeric baseline
из `session-state-2026-05-05-wave-3.md` — точные «14793 / 12572 B». Без такого snapshot
investigation outcome был бы defaulted к (c) «document current as new baseline».
Decisive evidence пришёл от ad-hoc записи в старом session-state.

**Root cause.** Ad-hoc numeric snapshots в session-state выживают context-loss между
сессиями лучше чем in-conversation memory.

**Prevention.** **Validated pattern**, держать. При size/perf shift'ах — фиксировать
numeric baseline в session-state (raw bytes, gzip bytes, profile, source commit). Не
полагаться только на git log.

### 10. Hybrid execution: inline для тривиального, subagent для multi-file complex

**What happened.** W1-W4 inline (тривиальные edits + verification grep). W5
(multi-file dead-API cleanup + thread_local replacement + investigation outcome) через
subagent с comprehensive brief — отработал без блокеров.

**Root cause.** Subagent overhead не оправдан для < 5 min work; для multi-step
multi-file work — overhead < benefit (fresh context, focused execution).

**Prevention.** **Validated pattern**, держать. Memory feedback уже captures это.

### 11. Subagent может intentionally deviate с явным rationale

**What happened.** W5 subagent оставил `output_ptr`/`output_len` (raw) и
`_output_ptr/_output_len` (emscripten) в TS interfaces как type-only declarations,
несмотря на удаление `readOutput`. Explicit deviation note в report. Не блокер
(no runtime/bundle impact), но сами TS fields теперь dead.

**Root cause.** Subagent сделал judgment call: type-only ⇒ no bundle/runtime impact.
Не ошибка, но micro-tech-debt не captured.

**Prevention.**
- Subagent brief'ы — explicit policy «what counts as cleanup scope». Если в `output_view`
  removal scope входит и type-only field cleanup — указать.
- Capture dead-TS-interface-fields как micro-tech-debt после reviewing subagent
  deviation note.

---

## Что НЕ pitfall (но наблюдение)

- **15 commits для одной sub-phase = много, читаемо.** Bite-sized commits по policy
  работают. Git log self-documenting. Validated pattern, не pitfall.
- **`alignas(8)`-fix → size identical** — это **expected outcome** для invariant-only
  refactor'а. Plan правильно this anticipated «may or may not change»; на practice
  identical. Не pitfall — observation для guidelines candidate.
