# Session state — 2026-05-05 (Wave 3 done)

Снапшот для следующей сессии. Phase 1.0.5 (Housekeeping), ветка `feature/phase-1-0-5`. Wave 3 закрыт, тег `wave-3-done` поставлен. Этот файл — handoff для Wave 4.

В этом файле — только то, чего нет в спеке/плане/коде/git history. Высокоуровневое состояние и общие feedback'и уже в auto-memory.

---

## TL;DR

- Branch `feature/phase-1-0-5` (без изменений с прошлой сессии до Wave 3).
- Tag `wave-3-done` на HEAD (`94f313e`).
- 9 коммитов в Wave 3 поверх `wave-2-done` (+ pre-Wave-3 session-state commit `349da49` = 10 ahead).
- Spec: `docs/superpowers/specs/2026-05-04-housekeeping-design.md`. План: `docs/superpowers/plans/2026-05-04-housekeeping-phase-1-0-5.md`.
- Следующее: Wave 4 (Tasks 15-19) — investigation Firefox/Chrome `performance.now` precision (3 gates), conditional fixes per gate.
- Execution mode: subagent-driven-development. Implementer (sonnet) → spec reviewer (haiku) → code reviewer flow. Wave 3 показал: схема работает, но code reviewer находит важные follow-ups (orphan Cargo.lock, lint-script-deviations, test-target lint gaps) — не пропускать.

---

## Состояние репозитория

| Что | Куда указывает |
|---|---|
| `feature/phase-1-0-5` HEAD | `94f313e refactor(rust): use slice::fill in shared/bindgen zeroing paths` |
| tag `wave-3-done` | `94f313e` |
| tag `wave-2-done` | `efab4f0` (без изменений) |
| tag `wave-1-done` | `3384aba` (без изменений) |
| `master` | `c9a00c3` (без изменений с Phase 1.0) |
| Untracked | `Какие есть существующие бенчмарки wasm под браузер.md` (input от пользователя, **не коммитить**) |
| Untracked | `docs/superpowers/session-state-2026-05-05-wave-3.md` (этот файл — пользователь решит коммитить) |

---

## Wave 3 — что сделано

| Task | Commits | Заметки |
|---|---|---|
| Task 10 — workspace root + edition 2024 | `ac61288`, `093bf90` | Создан корневой `Cargo.toml` (resolver=3, edition=2024, workspace.lints, **профили в root** — Cargo 1.95 даёт hard error на профили в non-root members). raw `#[no_mangle]` → `#[unsafe(no_mangle)]`, `addr_of!` → `&raw const`. `lint:rust` упрощён до `cargo clippy --workspace --target wasm32-unknown-unknown` (`--all-targets` несовместимо с no_std + panic_handler raw crate). Follow-up: orphan per-crate `Cargo.lock` файлы (`raw/`, `bindgen/`) удалены, `.gitignore` обновлён, plan §10.6 retroactively уточнён про `--all-targets`. |
| Task 11 — shared crate | `5b48043`, `09d511c` | `benches/matmul/rust/shared/{Cargo.toml,src/lib.rs}` с `#![cfg_attr(not(test), no_std)]`, `matmul_naive`, `abs_sum`, 3 unit tests. Implementer корректно добавил `#[must_use]` + tightened iter loop вместо allow'ов. Follow-up: `f64::abs` доступен в core с Rust 1.85 (мы на 1.95) — кастомный `abs` helper удалён. `lint:rust` extended `cargo clippy -p matmul-shared --all-targets` чтобы lint shared's test module на host (раньше wasm32-only gate skipped tests). |
| Task 12 — raw refactor | `7650a95`, `9128ef0` | `static mut` заменён на `UnsafeCell<GlobalHeap>/<GlobalState>` + `unsafe impl Sync` (vacuous на wasm32). Algorithm via shared. **10 unsafe items** (2 impl Sync, 1 unsafe fn, 7 unsafe blocks) — над spec target ≤4 но в plan'е принято (UnsafeCell ergonomics: each `*STATE.x.get()` access is unsafe). Wasm size **byte-identical** к baseline (1912 / 1636 B). Implementer вернул `const extern "C" fn reset()` (clippy::missing_const_for_fn). Follow-up: SAFETY-комментарии на `unsafe impl Sync` и `get_slices` укреплены (раньше были tautological). |
| Task 13 — bindgen refactor | `bf98a11`, `987e28d`, `94f313e` | `static mut` заменён на `thread_local!{RefCell<State>}`. Algorithm via shared. **2 unsafe blocks** (load_input cast, output_view cast). `run()` использует destructure `let State { a, b, c, .. } = &mut *s;` hoisted out of inner loop. Implementer сохранил `half.isqrt()` (от Wave 2) вместо float-roundtrip `(half as f64).sqrt() as usize` из spec/plan текста — правильный выбор. Follow-up 1: Cargo.lock не попал в Tasks 12+13 commits (plan defect — plan'а в `git add` list не было) — отдельный commit `987e28d`. Follow-up 2: `for x in &mut s.borrow_mut().c { *x = 0.0; }` → `s.borrow_mut().c.fill(0.0)` + аналогично shared's `matmul_naive` zeroing prelude (commit `94f313e`). Это сэкономило ~250 B в bindgen wasm. |
| Task 14 — Wave 3 closeout | (нет нового commit, только tag) | Decision-point §3.5: shared cleanly cover оба crate'а, fallback не активирован. `pnpm lint:all` exit 0 (TS: 11 acceptable no-console warnings; Rust: clean). `pnpm smoke` → smoke OK. `pnpm clear && pnpm bench:all` → 60 results, **all 60 validated, 30 × S=8505.752465030815, 30 × M=275996.81878375803** (matches Phase 1.0 baseline). Tag `wave-3-done`. |

Все 4 task'а прошли implementer→spec reviewer (haiku) → code reviewer flow. Code reviewer на каждом task'е находил important follow-ups — все inline-зафикшены без re-dispatch implementer'а.

---

## Известная регрессия — bindgen wasm size

После Wave 3 bindgen wasm стал на **+0.9-1.0 KB больше** (~+7%) по сравнению с wave-2-done baseline. Точные цифры:

| Profile | Baseline (`efab4f0`) | After Wave 3 (`94f313e`) | Δ |
|---|---|---|---|
| `release` (speed, no wasm-opt) | 14793 B | 15949 B | **+1156 B (+7.8%)** |
| `release` + wasm-opt -Oz (size) | 12572 B | 13458 B | **+886 B (+7.0%)** |

raw cdylib **byte-identical** к baseline (1912 / 1636 B unchanged) — регрессия только в bindgen.

Что пробовали:
- `#[inline]` на shared crate's `matmul_naive` / `abs_sum` — **не помог** (`lto = "fat"` уже инлайнит).
- `slice::fill(0.0)` вместо explicit loop — **сэкономило ~250 B**.

Гипотезы (для Phase 1.0.6 / 1.1 investigation):
- `thread_local!{RefCell<State>}` лазейнит-init shim добавляет фиксированный overhead.
- wasm-bindgen генерирует разный glue для cross-crate symbols (matmul_shared functions) vs in-crate.
- Возможно, `output_view()` копирует через `bytes.to_vec()` который теперь обрабатывается оптимизатором иначе.

**Не блокер.** Принимается как cost of Wave 3 (unsafe localization + algorithm dedup outweigh +1 KB). Документируется в этом session-state.

Diagnostic plan (если будет копать):
1. `cargo build --release --emit=llvm-ir` для bindgen на wave-2-done и wave-3-done. `diff` IR файлов.
2. `wasm2wat` обоих модулей, искать новые symbols / functions.
3. `wasm-objdump -h` сравнить sections (особенно `code`, `data`).

---

## Чтение перед стартом Wave 4 (порядок)

1. **`docs/superpowers/specs/2026-05-04-housekeeping-design.md` §4** (lines ~429-471) — Wave 4 раздел: 3 gates, conditional fix per gate. Investigation-only, fix зависит от findings.
2. **`docs/superpowers/plans/2026-05-04-housekeeping-phase-1-0-5.md` Tasks 15-19** — пошаговые steps. Task 15 (Gate 1 — baseline data + instrumentation), Task 16 (Gate 2 — quantization), Task 17 (Gate 3 — Liftoff/JIT prefs), Task 18 (Wave 4 closeout), Task 19 (tool-versions extension).
3. **Auto-memory** `project_wasm_benchmarks.md` — обновлена.
4. **Этот файл** (handoff).

---

## Открытые тикеты от code reviewers Wave 3 (не сделано, для Wave 4 или позже)

### Из Task 11 review

- Если test module shared crate'а вырастет, `#[allow(clippy::float_cmp, reason = "...")]` на `mod tests` стоит пересмотреть — текущий reason ссылается на «exactly representable f64s», что верно для нынешних тестов (`assert_eq!(c, [2.0, 3.0, ...])`), но не масштабируется для tests с произвольными значениями. Когда добавятся новые tests — либо tighten reason, либо использовать `assert!((a - b).abs() < EPS)`.

### Из Task 12 review

- **M3:** `unsafe fn get_slices<'a>()` возвращает slice с caller-chosen `'a`. Сейчас работает потому что есть единственный caller (`run`). Более robust сигнатура — `with_slices<R>(f: impl FnOnce(&[f64], &[f64], &mut [f64], usize) -> R) -> R` (callback style — невозможен accidental escape). YAGNI argument сейчас, но если будет 2+ caller — задуматься.
- **M5:** `(*HEAP.0.get()).as_ptr() as usize` в `heap_base()` полагается на `repr(Rust)` of `GlobalHeap(UnsafeCell<[u8;HEAP_SIZE]>)` дающее zero offset для single field — strong-but-unwritten optimizer assumption. Byte-identical wasm output это подтверждает на текущем rustc/wasm32, но не формально гарантирует. Bulletproof: `core::ptr::addr_of!(HEAP) as usize`. Не критично.
- **M10:** Comment about wasm32 single-threaded (lines 22-23 of raw lib.rs) сидит между `HEAP_SIZE` const и `GlobalHeap` struct — могут понять как комментирование const'ы. Move to module-level `//!` doc или прямо над struct'ом.

### Из Task 13 review

- **I-1 (Important):** bindgen size regression — описана выше в отдельной секции.
- **I-2 (Important):** Cargo.lock не был включён в Tasks 12+13 implementer's `git add` list (plan defect — plan не упоминал lock). **При следующем изменении `[dependencies]` в любом Cargo.toml — помнить про `git add Cargo.lock`.** Я добавил эту заметку в auto-memory и в plan'е (но это для Tasks 12-13 already too late). Wave 4 не должно трогать deps так что low risk.
- **M3:** `output_view()` возвращает `Vec<u8>` (force copy). Это identical pre-refactor behaviour (no regression), но dominant allocation cost of read path. Если `output_view` появится на профилях в Phase 1.1 — рассмотреть `pub fn output_ptr_len() -> (u32, u32)` API + `wasm_memory()` access из JS.

### Из Task 6/7/8 review (Wave 2 carry-over)

Эти всё ещё open от прошлой сессии:
- `benches/matmul/validate/reference.ts:43` — `main().catch(e => { console.error(e); process.exit(1); })` two-statement-per-line nit. Cosmetic.
- `alignas(8) static uint8_t heap[HEAP_SIZE]` в matmul.cpp — latent absolute-alignment gap. На emcc 5.0.x не firing, low priority.
- `#pragma clang diagnostic ignored "-Wcast-align"` в matmul.cpp — preventative, на текущем clang не firing. Удалить или оставить — YAGNI.

---

## Wave 4 — план в одну строчку для каждой task

- **Task 15** (Gate 1 — baseline timing data + instrumentation): добавить `probePerformanceNowResolution()` helper в `packages/harness/src/measure.ts`, gating через `BENCH_DEBUG_TIMINGS=1` env-var (Node) / `globalThis.__BENCH_DEBUG_TIMINGS__` (browser). Wire в `apps/runner-web/src/driver.ts` → `context.addInitScript`. Прокинуть `console.log("[bench-debug] ...")` из browser page в node parent. Запустить baseline в Node, Chromium, Firefox для M-size cpp/emscripten/size; записать findings в `docs/superpowers/notes/2026-05-XX-perf-now-precision.md`. **Subagent (sonnet)** — multi-file (measure.ts + driver.ts + worker.ts + new notes file), требует careful instrumentation.
- **Task 16** (Gate 2 — quantization hypothesis): анализ findings Gate 1. Если Firefox res = 1-2 ms, Chrome ≪ 1 ms — fix через dynamic iteration count: bump iterations так чтобы каждая sample ≥ 10 ms во всех средах. Изменения в `packages/harness/src/measure.ts` (warmup loop). Если не подтвердилось — переход к Gate 3. **Subagent (sonnet)** — algorithmic change в harness, может потребовать debug.
- **Task 17** (Gate 3 — Liftoff/JIT hypothesis): тестируем `firefoxUserPrefs` в `apps/runner-web/playwright.config.ts` — disable wasm baseline JIT, enable optimizing JIT. Если разница исчезла → fix в playwright config + документирование. Если не исчезла → STOP, документируем findings, переносим в Phase 1.0.6. **Subagent (sonnet)** — small playwright config edit, но может потребовать iterations.
- **Task 18** (Wave 4 closeout): full bench:all с finalized fixes (зависит от gates), validate checksums. Tag `wave-4-done`.
- **Task 19** (tool-versions.json extension): расширить `scripts/lib/tool-versions.ts` (или `tool-versions.json`?) с `url` + `sha256` полями для каждого тула. Подготовка к Wave 5 (auto-deps installer). **Inline-fix** (это data-only edit, не сложно).

Wave 4 — **investigation-heavy**, ожидаемое время ~1.5 дня. Findings определят, сколько Tasks реально выполнится (Gate 2 fix может закрыть Wave 4 без Gate 3).

---

## Execution flow lessons (Wave 3 actuals)

- **Полный subagent flow на task ≈ 8-12 минут реального wall time** в этой сессии (включая мою координацию + bench запуски). Token usage — порядка 50-150k на task. На 4 task'ах Wave 3 это ~40 минут + ~500k tokens. Wave 4 (5 tasks но investigation-heavy) — ожидаю ~50-70 минут + 600-800k.
- **Spec reviewer (haiku) полезен — не пропускать.** На Task 12-13 spec reviewer независимо подтвердил что diff именно syntactic / structural (no algorithmic drift), что критично для refactor задач.
- **Code reviewer (`superpowers:code-reviewer`) на каждом task'е находил important follow-ups.** Wave 3 follow-ups: orphan Cargo.lock files (Task 10), lint script `--all-targets` deviation (Task 10), test module not linted on host (Task 11), tautological SAFETY comments + grammatical errors (Task 12), bindgen size regression (Task 13), Cargo.lock missing from Tasks 12+13 commits (Task 13), `fill(0.0)` vs explicit loop nits (Task 13). Token usage code reviewer'а ~50-80k. **Inline-fix follow-ups работают хорошо** — не нужен fresh subagent для small fixes.
- **Plan defects обнаруживаются в процессе.** Wave 3 нашли два:
  1. Plan §10.6 предписывал `cargo clippy --workspace --all-targets` — несовместимо с no_std + panic_handler. Fix retroactively в plan §10.6.
  2. Plan Tasks 12+13 не упоминали `Cargo.lock` в `git add` list — implementer'ы pre-cisely следовали plan'у и пропустили lock-файл.
- **Профили Cargo workspace.** Cargo 1.95 (текущий) даёт **hard error** `profile 'release-size' is not defined` если профиль определён в non-root member. Профили **обязательно** в workspace root. Plan этого не учёл — implementer Task 10 правильно отклонился.

---

## Workflow notes (без изменений с Wave 1)

- `--no-gpg-sign` обязателен на каждом коммите.
- `WASI_SDK_PATH=/Users/uncerso/wasi-sdk-25` в env (zshrc).
- emcc через `/Users/uncerso/emsdk/upstream/emscripten/emcc` — на PATH.
- Playwright browsers в `~/Library/Caches/ms-playwright/`.
- Rust toolchain 1.95.0 (2026-04-14). `f64::abs` в core с 1.85.

---

## Stop point — где именно мы

Конец Wave 3, ветка чистая (`git status` показывает только untracked input md и этот файл если коммитить). На `feature/phase-1-0-5` от master: 6 Wave 1 + session-state-wave-2 (закоммичен пользователем) + 6 Wave 2 + 9 Wave 3. Готов к Task 15 (Gate 1 baseline data collection).

В новой сессии: после прочтения этого файла + спеки §4 + plan'а Task 15-19 + auto-memory — `git rev-parse HEAD` (capture base SHA) и dispatch implementer subagent на Task 15.

---

## Полезные команды

```bash
git switch feature/phase-1-0-5                           # вернуться на ветку
git log --oneline wave-3-done..HEAD                      # что нового с прошлой сессии
git log --oneline wave-2-done..wave-3-done               # все Wave 3 commits (8)
pnpm smoke                                               # 30s sanity (cpp+rust+ts builds)
pnpm lint:all                                            # ts (eslint) + rust (clippy)
pnpm bench:all                                           # full run (~10 min, 60 results)
git rev-parse HEAD                                       # capture SHA before task
git rev-parse refs/tags/wave-3-done                      # phase 1.0.5 wave 3 marker
BENCH_DEBUG_TIMINGS=1 pnpm bench --envs=node --sizes=M --mode=quick \
    --out=results/raw/wave4-gate1-node 2>&1 | grep "bench-debug"  # Wave 4 Task 15.4
```
