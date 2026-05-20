# Phase 1.1.0 Hardening Preamble — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть 8 tech-debt items, накопившихся к концу Phase 1.0.6, и зафиксировать size baseline до начала расширения workload-матрицы в 1.1.1.

**Architecture:** Five sequential waves (W1 docs → W2 rust-raw hardening → W3 cpp alignas → W4 runner-web cleanup → W5 bindgen size deep-dive). Каждый wave завершается коммитом изменений + отдельным коммитом удаления соответствующего `docs/tech_debt/<slug>.md` файла (per «resolved → delete file» policy). Workload'ы не трогаются; schema не меняется.

**Tech Stack:** TypeScript (tsx, vitest, eslint), Rust (cargo workspace, wasm-pack для bindgen, raw wasm32-unknown-unknown), C++ (emcc + wasi-sdk freestanding), build orchestration через tsx скрипты.

**Spec reference:** `docs/superpowers/specs/2026-05-20-phase-1-1-design.md` § Phase 1.1.0.

---

## File map

**Modify:**
- `README.md` — W1: документация debug timings.
- `benches/matmul/rust/raw/src/lib.rs` — W2: `addr_of!` для heap base + CPS `with_slices`.
- `benches/matmul/cpp/src/matmul.cpp` — W3: `alignas(8)` на heap буфере.
- `benches/matmul/rust/bindgen/src/lib.rs` — W5: удалить `output_view`, заменить `thread_local!` на static SyncCell.
- `packages/harness/src/types.ts` — W5: удалить `readOutput` из `BenchModule`.
- `packages/harness/tests/measure.test.ts` — W5: убрать `readOutput` из mock.
- `packages/loaders/src/rust-bindgen.ts` — W5: убрать `readOutput` + `output_view` из glue interface.
- `packages/loaders/src/raw-wasm.ts` — W5: убрать `readOutput` из loader.
- `packages/loaders/src/emscripten.ts` — W5: убрать `readOutput` из loader.
- `benches/matmul/js/idiomatic/src/index.ts` — W5: убрать `readOutput`.
- `benches/matmul/js/typed-array/src/index.ts` — W5: убрать `readOutput`.

**Delete (after corresponding wave merge):**
- `docs/tech_debt/bench-debug-timings-docs.md` (W1)
- `docs/tech_debt/rust-raw-heap-ptr-repr-rust.md` (W2)
- `docs/tech_debt/rust-raw-get-slices-ergonomics.md` (W2)
- `docs/tech_debt/matmul-cpp-heap-alignas-latent.md` (W3)
- `docs/tech_debt/worker-importscripts-detection.md` (W4)
- `docs/tech_debt/bindgen-output-view-force-copy.md` (W5)
- `docs/tech_debt/bindgen-thread-local-init-shim-overhead.md` (W5)
- `docs/tech_debt/bindgen-size-regression-investigation.md` (W5)

**Notes on order:** W1 standalone (parallel-friendly). W2-W3 — internal refactors (API unchanged). W4 — grep-only verification (no code change expected, см. Task W4.1). W5 идёт последним: dead-API cleanup может частично resolve'ить investigation сам.

---

## Wave 1 — Documentation: BENCH_DEBUG_TIMINGS

**Item:** `bench-debug-timings-docs`. Single doc addition.

### Task W1.1: Add «Debug timings» sub-section в README

**Files:**
- Modify: `README.md` (под секцию «Запуск бенчмарков», после «Полный пайплайн end-to-end»; около строки 228-229)

- [ ] **Step 1: Read README.md current line numbers**

Run: `grep -n "^###\|^##" README.md | head -30`

Verify section «Запуск бенчмарков» starts около line 162, «Полный пайплайн end-to-end» — line ~220, «Отчёт» — line ~231.

- [ ] **Step 2: Insert «Debug timings» sub-section перед «Отчёт»**

Insert новую sub-section после блока «Долго (десятки минут в `eval`). Используется для финальных замеров.»:

```markdown
### Debug timings (отладка измерений)

Если измерения дают неожиданные значения (high CV, аномальные firstCall, и т.п.) — включаются подробные per-sample логи и проба разрешения `performance.now()`:

```bash
# Node-side
BENCH_DEBUG_TIMINGS=1 pnpm exec tsx apps/runner-node/src/main.ts ...

# Browser-side (через runner-web driver)
BENCH_DEBUG_TIMINGS=1 pnpm --filter @bench-app/runner-web drive ...
```

Что появляется в выводе:

- `[bench-debug] performance.now() resolution: <ms>` — измеренное разрешение high-resolution clock (Node ~ 1µs, Chromium ~ 5µs с COOP+COEP, Firefox ~ 20µs).
- `[bench-debug] sample N: <duration>` — длительность каждого warm sample'а.

Browser-side флаг прокидывается из Node через query param `?debug=1` на page → worker scope. Source: `apps/runner-web/src/driver.ts:127` (Node→URL), `apps/runner-web/src/page.ts:68-69` (page→worker forward), `apps/runner-web/src/worker.ts:49,83` (worker scope setup), `packages/harness/src/measure.ts:22-31` (consumer).

Полезно для investigations типа «почему в Firefox все samples 0 ms» — pivot Wave 4 (см. `docs/superpowers/notes/2026-05-05-perf-now-precision.md`).
```

- [ ] **Step 3: Verify markdown rendering — `pnpm typecheck` стартовый sanity check**

Run: `pnpm typecheck`
Expected: PASS (typecheck не зависит от README, но это quick global gate).

- [ ] **Step 4: Commit doc change**

```bash
git add README.md
git commit --no-gpg-sign -m "docs(readme): document BENCH_DEBUG_TIMINGS + ?debug=1

Закрывает tech-debt bench-debug-timings-docs. Раскрывает существующий debug aid
для будущих investigations (Phase 1.1+ workloads, runtime regressions)."
```

### Task W1.2: Delete tech-debt file

- [ ] **Step 1: Remove tech-debt file**

```bash
git rm docs/tech_debt/bench-debug-timings-docs.md
```

- [ ] **Step 2: Commit deletion**

```bash
git commit --no-gpg-sign -m "chore(tech-debt): resolve bench-debug-timings-docs

Documented в README § «Debug timings (отладка измерений)». Per docs/tech_debt/README.md
policy: resolved → delete file."
```

---

## Wave 2 — Rust-raw hardening: addr_of! + CPS slices

**Items:** `rust-raw-heap-ptr-repr-rust` (use `addr_of!` для HEAP base) + `rust-raw-get-slices-ergonomics` (CPS-style `with_slices`).

Approach: byte-identical wasm output expected (or near). Capture baseline hash before refactor, verify after.

### Task W2.1: Capture pre-refactor baseline

**Files:**
- Read: `benches/matmul/rust/raw/src/lib.rs`

- [ ] **Step 1: Build raw rust crate (speed profile, both профиля если doesn't add time)**

Run: `pnpm build:rust`
Expected: success; writes `dist/matmul/rust-raw-speed/` и `dist/matmul/rust-raw-size/`.

- [ ] **Step 2: Capture baseline wasm hashes**

Run:
```bash
shasum -a 256 dist/matmul/rust-raw-speed/module.wasm dist/matmul/rust-raw-size/module.wasm | tee /tmp/raw-pre.txt
```

Save output. Use to compare после refactor.

- [ ] **Step 3: Run existing rust tests**

Run: `pnpm --filter @bench/result-schema test && pnpm --filter @bench/harness test`
Expected: PASS.

### Task W2.2: Replace heap_base() с addr_of!

**Files:**
- Modify: `benches/matmul/rust/raw/src/lib.rs:49-52`

- [ ] **Step 1: Replace `heap_base()` implementation**

Current (lines 48-52):
```rust
#[inline]
fn heap_base() -> usize {
    // SAFETY: HEAP is a 'static GlobalHeap; we only read its base address.
    unsafe { (*HEAP.0.get()).as_ptr() as usize }
}
```

Replace with:
```rust
#[inline]
fn heap_base() -> usize {
    // addr_of! gives a stable address derivation independent of repr(Rust)
    // field layout. UnsafeCell is repr(transparent), so addr of HEAP.0 == addr
    // of HEAP == addr of the inner [u8; HEAP_SIZE] storage.
    core::ptr::addr_of!(HEAP) as usize
}
```

- [ ] **Step 2: Rebuild раw crate**

Run: `pnpm build:rust`
Expected: success.

- [ ] **Step 3: Verify byte-identical wasm output**

Run:
```bash
shasum -a 256 dist/matmul/rust-raw-speed/module.wasm dist/matmul/rust-raw-size/module.wasm | diff /tmp/raw-pre.txt -
```

Expected: no diff (byte-identical).

Если diff появляется: probably compiler optimized addr_of! differently. Compare via `wasm2wat`:
```bash
.tools/wabt/wasm2wat dist/matmul/rust-raw-speed/module.wasm > /tmp/raw-after.wat
.tools/wabt/wasm2wat (предварительно saved копия) > /tmp/raw-before.wat
diff /tmp/raw-before.wat /tmp/raw-after.wat
```

Если разница — только в const symbol addresses или debug info, accept. Иначе документировать в commit message.

- [ ] **Step 4: Smoke test**

Run: `pnpm smoke`
Expected: green; rust-raw-speed-S matmul correctness == reference.

- [ ] **Step 5: Lint Rust**

Run: `pnpm lint:rust`
Expected: PASS.

### Task W2.3: Replace get_slices() с CPS-style with_slices()

**Files:**
- Modify: `benches/matmul/rust/raw/src/lib.rs:87-104,107-116`

- [ ] **Step 1: Replace get_slices() signature и run() callsite**

Current `get_slices` (lines 87-104):
```rust
// SAFETY: caller guarantees that load_input was called and set STATE.{n, a_off,
// b_off, c_off} so that each offset points at a non-overlapping region of
// n*n*8 valid f64-aligned bytes inside HEAP. Returned slices share their
// caller-chosen lifetime 'a; caller must not retain them across any subsequent
// load_input/alloc that may reshape STATE. Wasm32 single-threaded → exclusive
// &mut [f64] for C is upheld by control flow (only run() calls this).
unsafe fn get_slices<'a>() -> (&'a [f64], &'a [f64], &'a mut [f64], usize) {
    unsafe {
        let n = *STATE.n.get();
        let a_off = *STATE.a_off.get();
        let b_off = *STATE.b_off.get();
        let c_off = *STATE.c_off.get();
        let a = core::slice::from_raw_parts(a_off as *const f64, n * n);
        let b = core::slice::from_raw_parts(b_off as *const f64, n * n);
        let c = core::slice::from_raw_parts_mut(c_off as *mut f64, n * n);
        (a, b, c, n)
    }
}
```

Replace with CPS form:
```rust
// CPS-style API: lifetime of slices is closed inside the closure scope, so
// compiler enforces no escape across STATE reshapes (load_input/alloc).
// Equivalent to the previous get_slices() but type-safe at the borrow level.
//
// SAFETY: caller guarantees load_input was called and set STATE.{n, a_off,
// b_off, c_off} to non-overlapping regions of n*n*8 valid f64-aligned bytes
// inside HEAP. Wasm32 single-threaded → exclusive &mut [f64] is upheld by
// control flow (only run() calls this).
unsafe fn with_slices<R>(
    f: impl FnOnce(&[f64], &[f64], &mut [f64], usize) -> R,
) -> R {
    unsafe {
        let n = *STATE.n.get();
        let a_off = *STATE.a_off.get();
        let b_off = *STATE.b_off.get();
        let c_off = *STATE.c_off.get();
        let a = core::slice::from_raw_parts(a_off as *const f64, n * n);
        let b = core::slice::from_raw_parts(b_off as *const f64, n * n);
        let c = core::slice::from_raw_parts_mut(c_off as *mut f64, n * n);
        f(a, b, c, n)
    }
}
```

Current `run()` (lines 106-116):
```rust
#[unsafe(no_mangle)]
pub extern "C" fn run(iters: u32) -> f64 {
    // SAFETY: load_input was called by JS host before run; A/B/C are valid.
    let (a, b, c, n) = unsafe { get_slices() };
    let mut last = 0.0_f64;
    for _ in 0..iters {
        matmul_naive(a, b, c, n);
        last = abs_sum(c);
    }
    last
}
```

Replace with:
```rust
#[unsafe(no_mangle)]
pub extern "C" fn run(iters: u32) -> f64 {
    // SAFETY: load_input was called by JS host before run; A/B/C are valid.
    unsafe {
        with_slices(|a, b, c, n| {
            let mut last = 0.0_f64;
            for _ in 0..iters {
                matmul_naive(a, b, c, n);
                last = abs_sum(c);
            }
            last
        })
    }
}
```

- [ ] **Step 2: Rebuild raw crate**

Run: `pnpm build:rust`
Expected: success.

- [ ] **Step 3: Verify byte-identical wasm output (or close)**

Run:
```bash
shasum -a 256 dist/matmul/rust-raw-speed/module.wasm dist/matmul/rust-raw-size/module.wasm
```

Closure inlines в wasm для simple case — output expected byte-identical с pre-W2.2. Если diff: проверь `wasm2wat` — структура должна совпадать modulo register allocation. Accept если loop semantics одинаковая.

Размер не должен значимо измениться (>50 bytes — flag for investigation).

- [ ] **Step 4: Smoke test**

Run: `pnpm smoke`
Expected: green; rust-raw correctness preserved.

- [ ] **Step 5: Lint Rust**

Run: `pnpm lint:rust`
Expected: PASS.

### Task W2.4: Commit W2 + delete tech-debt files

- [ ] **Step 1: Run global gates**

Run: `pnpm typecheck && pnpm lint:all && pnpm test`
Expected: PASS.

- [ ] **Step 2: Commit refactor**

```bash
git add benches/matmul/rust/raw/src/lib.rs
git commit --no-gpg-sign -m "refactor(rust-raw): addr_of! heap base + CPS with_slices

- heap_base() via core::ptr::addr_of!(HEAP) — bulletproof против repr(Rust)
  layout changes (closes rust-raw-heap-ptr-repr-rust).
- get_slices() → with_slices(f) CPS-style — lifetime закрыт в closure scope,
  compiler-enforced safety (closes rust-raw-get-slices-ergonomics).

Wasm output byte-identical (verified via shasum); closure inlined."
```

- [ ] **Step 3: Delete tech-debt files**

```bash
git rm docs/tech_debt/rust-raw-heap-ptr-repr-rust.md docs/tech_debt/rust-raw-get-slices-ergonomics.md
git commit --no-gpg-sign -m "chore(tech-debt): resolve rust-raw hardening pair

Resolved via refactor: addr_of! + with_slices CPS. Per resolved → delete policy."
```

---

## Wave 3 — C++ alignas fix

**Item:** `matmul-cpp-heap-alignas-latent`. Add `alignas(8)` к static heap buffer.

### Task W3.1: Add alignas(8) to heap declaration

**Files:**
- Modify: `benches/matmul/cpp/src/matmul.cpp:7`

- [ ] **Step 1: Capture pre-fix cpp wasm hashes**

Run:
```bash
pnpm build:cpp
shasum -a 256 dist/matmul/cpp-*/*.wasm | tee /tmp/cpp-pre.txt
```

- [ ] **Step 2: Add alignas(8) to heap declaration**

Current line 7:
```cpp
static uint8_t heap[HEAP_SIZE];
```

Replace with:
```cpp
// alignas(8) guarantees the storage address is 8-aligned at link time. The
// bumping allocator (alloc) preserves 8-byte alignment via `(next_off + sz + 7u) & ~7u`,
// so &heap[p] is always 8-aligned for any p returned by alloc(). This makes
// the reinterpret_cast<double*>(uintptr) in run() defined behaviour rather
// than relying on toolchain-incidental layout (emcc / wasi-sdk both happened
// to align static storage to 8 bytes, but that is not guaranteed by either).
alignas(8) static uint8_t heap[HEAP_SIZE];
```

- [ ] **Step 3: Rebuild cpp**

Run: `pnpm build:cpp`
Expected: success.

- [ ] **Step 4: Verify wasm output**

Run: `shasum -a 256 dist/matmul/cpp-*/*.wasm`

Сравни с `/tmp/cpp-pre.txt`. alignas may or may not change wasm output:
- If unchanged: emcc/wasi-sdk already aligned naturally — alignas now makes that guaranteed.
- If changed by < 8 bytes: padding alignment minor change.
- If changed by > 64 bytes: investigate (linker section reorganization).

Document outcome in commit message.

- [ ] **Step 5: Smoke test**

Run: `pnpm smoke`
Expected: green; matmul cpp correctness preserved.

### Task W3.2: Commit W3 + delete tech-debt file

- [ ] **Step 1: Run global gates**

Run: `pnpm typecheck && pnpm lint:all && pnpm test`
Expected: PASS.

- [ ] **Step 2: Commit fix**

```bash
git add benches/matmul/cpp/src/matmul.cpp
git commit --no-gpg-sign -m "fix(cpp): alignas(8) on static heap buffer

Closes matmul-cpp-heap-alignas-latent. Previously relied on toolchain-incidental
8-byte alignment of static storage (emcc / wasi-sdk both happened to provide
it; not guaranteed). reinterpret_cast<double*> in run() is now well-defined.

Wasm output: <delta note here from Step 4>."
```

(Заменить `<delta note here from Step 4>` на актуальный outcome — «byte-identical» или «N bytes delta from padding», и т.п.)

- [ ] **Step 3: Delete tech-debt file**

```bash
git rm docs/tech_debt/matmul-cpp-heap-alignas-latent.md
git commit --no-gpg-sign -m "chore(tech-debt): resolve matmul-cpp-heap-alignas-latent

Fixed via alignas(8). Per resolved → delete policy."
```

---

## Wave 4 — Runner-web cleanup: importScripts detection

**Item:** `worker-importscripts-detection`. Per pre-exploration: код уже не содержит `importScripts` runtime detection (removed во время Phase 1.0.6 selenium migration). Verification + tech-debt closure only.

### Task W4.1: Verify no importScripts detection remains

**Files:**
- Read-only: вся codebase.

- [ ] **Step 1: Comprehensive grep across все TS/JS**

Run:
```bash
grep -rn "importScripts" --include="*.ts" --include="*.tsx" --include="*.mts" --include="*.js" --include="*.mjs" .
```

Expected: no output (no matches).

- [ ] **Step 2: Grep на похожие worker detection patterns**

Run:
```bash
grep -rn "WorkerGlobalScope\|DedicatedWorkerGlobalScope\|self.location" --include="*.ts" --include="*.tsx" --include="*.mts" apps/ packages/
```

Expected: only `apps/runner-web/src/worker.ts:20` `declare const self: DedicatedWorkerGlobalScope` (TS typing — not runtime check).

Если найдены runtime checks типа `typeof importScripts === "function"` или похожие — это означает, что detection остался. Подробно investigate, удалить или заменить на reliable check (`typeof DedicatedWorkerGlobalScope !== "undefined"` либо удалить если context статически известен).

- [ ] **Step 3: Document verification result**

Если grep подтверждает «no detection» — переходи к W4.2.

Если grep выявил что-то — extend этот wave с дополнительными tasks (read site, decide fix, apply, verify). Не bloat изначальный plan.

### Task W4.2: Delete tech-debt file

- [ ] **Step 1: Delete file**

```bash
git rm docs/tech_debt/worker-importscripts-detection.md
```

- [ ] **Step 2: Commit deletion**

```bash
git commit --no-gpg-sign -m "chore(tech-debt): resolve worker-importscripts-detection

Verified via grep — no importScripts runtime detection в текущем codebase
(удалено во время Phase 1.0.6 selenium migration). TS-level
\`declare const self: DedicatedWorkerGlobalScope\` (worker.ts:20) — type-only,
не runtime check. Per resolved → delete policy."
```

---

## Wave 5 — Bindgen size deep-dive

**Items (sequence):** `bindgen-output-view-force-copy` → `bindgen-thread-local-init-shim-overhead` → `bindgen-size-regression-investigation`.

Approach: Cleanup dead API первым (может частично resolve investigation сам), затем thread_local replacement, затем re-bench → investigation outcome.

### Task W5.1: Capture pre-W5 bindgen baseline

**Files:**
- Read-only: build dirs.

- [ ] **Step 1: Build bindgen crate**

Run: `pnpm build:rust`
Expected: writes `dist/matmul/rust-bindgen-speed/` и `dist/matmul/rust-bindgen-size/`.

- [ ] **Step 2: Capture sizes (raw + gzip + brotli)**

Run:
```bash
for f in dist/matmul/rust-bindgen-speed/module.wasm dist/matmul/rust-bindgen-size/module.wasm; do
  echo "=== $f ==="
  ls -l "$f" | awk '{print "raw:", $5}'
  gzip -9 -c "$f" | wc -c | awk '{print "gzip:", $1}'
  if command -v brotli >/dev/null; then
    brotli -q 11 -c "$f" | wc -c | awk '{print "brotli:", $1}'
  fi
done | tee /tmp/bindgen-pre.txt
```

Used для measuring W5 deltas.

- [ ] **Step 3: Note historical pre-Wave-3 baseline**

Read context: `docs/superpowers/session-state-2026-05-05-wave-3.md` (если присутствует — найди cited bindgen sizes до Wave 3, e.g. «pre-Wave-3 baseline = X.X KB»).

Если session-state файл не нашёлся — fallback: записать «historical baseline unknown — investigation outcome будет 'document current as new baseline'» в W5.5 commit.

### Task W5.2: Remove output_view (dead API cleanup)

**Files:**
- Modify: `benches/matmul/rust/bindgen/src/lib.rs:76-90`
- Modify: `packages/loaders/src/rust-bindgen.ts:12-22,49-54`
- Modify: `packages/loaders/src/raw-wasm.ts` (remove readOutput from module construction)
- Modify: `packages/loaders/src/emscripten.ts` (remove readOutput from module construction)
- Modify: `packages/harness/src/types.ts:6`
- Modify: `packages/harness/tests/measure.test.ts:12`
- Modify: `benches/matmul/js/idiomatic/src/index.ts:7,78`
- Modify: `benches/matmul/js/typed-array/src/index.ts:7,56`

#### Step 1: Remove `output_view` from bindgen Rust crate

`benches/matmul/rust/bindgen/src/lib.rs` — delete lines 76-90:

```rust
#[must_use]
#[wasm_bindgen]
pub fn output_view() -> Vec<u8> {
    STATE.with(|s| {
        let c = &s.borrow().c;
        // SAFETY: align(u8) = 1 ≤ align(f64) so the cast cannot misalign;
        // length is c.len() * 8 because each f64 is 8 bytes; the source slice
        // is borrowed (not moved), so its lifetime outlives the slice we
        // construct here, and we only read through it.
        let bytes = unsafe {
            core::slice::from_raw_parts(c.as_ptr().cast::<u8>(), c.len() * 8)
        };
        bytes.to_vec()
    })
}
```

Also remove the related unsafe-allow comment block (lines 1-9) if нот needed после removal. Re-check после edit — `unsafe` всё ещё используется в `load_input` (`core::slice::from_raw_parts` cast u8→f64), так что allow остаётся, но reasoning comment update:

Старый комментарий (lines 1-5):
```rust
// Bindgen crate: state lives in a thread_local RefCell instead of static mut.
// Wasm32 is single-threaded so the thread_local is effectively a singleton.
// Two unsafe blocks remain: byte↔f64 reinterpret in load_input and output_view.
// Both are inherent to the JS↔wasm marshalling boundary and cannot be removed
// without copying via temporary Vec<u8>/Vec<f64>.
```

Replace с:
```rust
// Bindgen crate: state lives in a thread_local RefCell instead of static mut.
// Wasm32 is single-threaded so the thread_local is effectively a singleton.
// One unsafe block remains: byte→f64 reinterpret in load_input. It is inherent
// to the JS↔wasm marshalling boundary and cannot be removed without copying
// via a temporary Vec<u8>/Vec<f64>.
```

(W5.3 ниже заменит thread_local на SyncCell + дополнительно обновит этот комментарий. Здесь мы только убираем mention `output_view`.)

#### Step 2: Remove `output_view` from bindgen TS glue interface

`packages/loaders/src/rust-bindgen.ts` lines 12-22:

```ts
interface BindgenGlue {
    default: (input?: { module_or_path?: string | BufferSource | WebAssembly.Module }) => Promise<unknown>;
    load_input: (buf: Uint8Array) => void;
    run: (iters: number) => number;
    output_view: () => Uint8Array;
    wasm_memory: () => WebAssembly.Memory;
    reset: () => void;
    __wasm_byte_length?: () => number;
}
```

Delete `output_view: ...` line. Also update doc-comment (lines 6-11):

Старый:
```ts
/**
 * wasm-bindgen glue exports: an `init(url)` async function plus named exports
 * matching #[wasm_bindgen] attributes on the Rust side. The bench's bindgen
 * implementation MUST expose: init(), load_input(Uint8Array), run(iters)->number,
 * output_view()->Uint8Array, memory()->WebAssembly.Memory, reset().
 */
```

Заменить с:
```ts
/**
 * wasm-bindgen glue exports: an `init(url)` async function plus named exports
 * matching #[wasm_bindgen] attributes on the Rust side. The bench's bindgen
 * implementation MUST expose: init(), load_input(Uint8Array), run(iters)->number,
 * wasm_memory()->WebAssembly.Memory, reset().
 */
```

И remove `readOutput` из BenchModule construction (line 52):

Старый:
```ts
const module: BenchModule = {
    loadInput: (buf: Uint8Array) => glue.load_input(buf),
    run: (iters: number): RunResult => ({ checksum: glue.run(iters) }),
    readOutput: () => glue.output_view().slice(),
    reset: () => glue.reset(),
};
```

Заменить с:
```ts
const module: BenchModule = {
    loadInput: (buf: Uint8Array) => glue.load_input(buf),
    run: (iters: number): RunResult => ({ checksum: glue.run(iters) }),
    reset: () => glue.reset(),
};
```

#### Step 3: Remove `readOutput` from `BenchModule` interface

`packages/harness/src/types.ts` line 6:

```ts
export interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): RunResult;
    readOutput(): Float64Array | Int32Array | Uint8Array;
    reset?(): void;
    dispose?(): void;
}
```

Delete `readOutput` line:

```ts
export interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): RunResult;
    reset?(): void;
    dispose?(): void;
}
```

#### Step 4: Remove readOutput from raw-wasm loader

`packages/loaders/src/raw-wasm.ts` — find `readOutput` construction (около строки 45) и remove method. Re-read файл если требуется:

```bash
sed -n '40,60p' packages/loaders/src/raw-wasm.ts
```

Удалить весь `readOutput(): Uint8Array { ... }` блок.

#### Step 5: Remove readOutput from emscripten loader

`packages/loaders/src/emscripten.ts` — same as Step 4, удалить `readOutput` блок около строки 52.

#### Step 6: Remove readOutput from JS impl idiomatic

`benches/matmul/js/idiomatic/src/index.ts` — delete `readOutput` from interface (line 7) и implementation (line 78). Pre-read для точных границ:

```bash
sed -n '1,20p;70,90p' benches/matmul/js/idiomatic/src/index.ts
```

#### Step 7: Remove readOutput from JS impl typed-array

`benches/matmul/js/typed-array/src/index.ts` — same as Step 6, lines 7 + 56.

#### Step 8: Remove readOutput from harness test mock

`packages/harness/tests/measure.test.ts:12`:

```ts
function mockModule(opts: { checksum: number }): BenchModule {
    return {
        loadInput: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- iters is part of BenchModule.run signature but unused in this stub
        run: vi.fn((_iters: number) => {
            return { checksum: opts.checksum };
        }),
        readOutput: () => new Uint8Array(),
        reset: vi.fn(),
    };
}
```

Delete `readOutput: () => new Uint8Array(),` line.

#### Step 9: Verify nothing else references readOutput/output_view

```bash
grep -rn "readOutput\|output_view" --include="*.ts" --include="*.tsx" --include="*.mts" --include="*.rs" packages/ apps/ benches/
```

Expected: no output.

#### Step 10: Build everything

Run: `pnpm build:all`
Expected: success. Bindgen `pkg/` regenerated без `output_view` entry — wasm-bindgen will produce smaller glue.

#### Step 11: Measure bindgen size delta

Run:
```bash
for f in dist/matmul/rust-bindgen-speed/module.wasm dist/matmul/rust-bindgen-size/module.wasm; do
  echo "=== $f ==="
  ls -l "$f" | awk '{print "raw:", $5}'
  gzip -9 -c "$f" | wc -c | awk '{print "gzip:", $1}'
done | tee /tmp/bindgen-post-w5.2.txt
diff /tmp/bindgen-pre.txt /tmp/bindgen-post-w5.2.txt
```

Note delta — expected reduction по dead-API cleanup hypothesis. Запиши в commit message.

#### Step 12: Run все tests + smoke

Run: `pnpm typecheck && pnpm lint:all && pnpm test`
Expected: PASS.

Run: `pnpm smoke`
Expected: PASS (matmul correctness across all combos).

#### Step 13: Commit W5.2

```bash
git add -A
git commit --no-gpg-sign -m "refactor(bindgen): remove dead output_view() + readOutput() API

Closes bindgen-output-view-force-copy. output_view + readOutput nigde не вызываются
в production (verification: harness/measure.ts uses checksum, not bytes).
Удаление высвобождает wasm-side Vec<u8> alloc + glue entry.

Размер bindgen-speed wasm: <delta> bytes, gzip: <delta>."
```

(Заменить `<delta>` на actual numbers из Step 11.)

### Task W5.3: Replace thread_local! с static SyncCell

**Files:**
- Modify: `benches/matmul/rust/bindgen/src/lib.rs`

- [ ] **Step 1: Replace State init + thread_local с static SyncCell pattern**

Текущий код (после W5.2; thread_local block около lines 24-26 и all `STATE.with(|s| ...)` callsites).

Update top-of-file comment (lines ~1-5):

Текущий (после W5.2):
```rust
// Bindgen crate: state lives in a thread_local RefCell instead of static mut.
// Wasm32 is single-threaded so the thread_local is effectively a singleton.
// One unsafe block remains: byte→f64 reinterpret in load_input. It is inherent
// to the JS↔wasm marshalling boundary and cannot be removed without copying
// via a temporary Vec<u8>/Vec<f64>.
```

Replace с:
```rust
// Bindgen crate: state lives in a static SyncCell<State> singleton (RefCell
// wrapped with vacuous Sync impl). Wasm32 single-threaded → no thread crossing.
// Eliminates the lazy thread_local init shim (см. closed tech-debt
// bindgen-thread-local-init-shim-overhead).
// One unsafe block remains: byte→f64 reinterpret in load_input. It is inherent
// to the JS↔wasm marshalling boundary and cannot be removed without copying
// via a temporary Vec<u8>/Vec<f64>.
```

Update use + struct + thread_local block:

```rust
use std::cell::RefCell;

use matmul_shared::{abs_sum, matmul_naive};
use wasm_bindgen::prelude::*;

#[derive(Default)]
struct State {
    n: usize,
    a: Vec<f64>,
    b: Vec<f64>,
    c: Vec<f64>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}
```

Replace с:

```rust
use std::cell::RefCell;

use matmul_shared::{abs_sum, matmul_naive};
use wasm_bindgen::prelude::*;

struct State {
    n: usize,
    a: Vec<f64>,
    b: Vec<f64>,
    c: Vec<f64>,
}

impl State {
    const fn new() -> Self {
        Self { n: 0, a: Vec::new(), b: Vec::new(), c: Vec::new() }
    }
}

// Wasm32 single-threaded — RefCell wrapped in SyncCell with vacuous Sync impl.
// Same pattern as the raw crate's UnsafeCell singleton.
struct SyncCell<T>(RefCell<T>);
// SAFETY: Sync requires &T to be safely shareable across threads. wasm32 is
// single-threaded, so no &T ever crosses a thread boundary; the obligation
// is vacuous.
unsafe impl<T> Sync for SyncCell<T> {}

static STATE: SyncCell<State> = SyncCell(RefCell::new(State::new()));
```

- [ ] **Step 2: Update load_input callsite**

Найди:
```rust
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        s.n = n;
        s.a = f64s[0..n * n].to_vec();
        s.b = f64s[n * n..2 * n * n].to_vec();
        s.c = vec![0.0; n * n];
    });
```

Заменить с:
```rust
    let mut s = STATE.0.borrow_mut();
    s.n = n;
    s.a = f64s[0..n * n].to_vec();
    s.b = f64s[n * n..2 * n * n].to_vec();
    s.c = vec![0.0; n * n];
```

- [ ] **Step 3: Update run() callsite**

Найди:
```rust
pub fn run(iters: u32) -> f64 {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let n = s.n;
        let mut last = 0.0_f64;
        let State { a, b, c, .. } = &mut *s;
        for _ in 0..iters {
            matmul_naive(a, b, c, n);
            last = abs_sum(c);
        }
        last
    })
}
```

Заменить с:
```rust
pub fn run(iters: u32) -> f64 {
    let mut s = STATE.0.borrow_mut();
    let n = s.n;
    let mut last = 0.0_f64;
    let State { a, b, c, .. } = &mut *s;
    for _ in 0..iters {
        matmul_naive(a, b, c, n);
        last = abs_sum(c);
    }
    last
}
```

- [ ] **Step 4: Update reset() callsite**

Найди:
```rust
pub fn reset() {
    STATE.with(|s| {
        s.borrow_mut().c.fill(0.0);
    });
}
```

Заменить с:
```rust
pub fn reset() {
    STATE.0.borrow_mut().c.fill(0.0);
}
```

- [ ] **Step 5: Verify wasm_memory() function unchanged**

`wasm_memory()` не зависит от STATE — should compile без изменений. Verify через сборку.

- [ ] **Step 6: Rebuild bindgen crate**

Run: `pnpm build:rust`
Expected: success.

Если compile errors: смотри detail, скорее всего нужны mut-pinning изменения borrow_mut или конст init issues с Vec::new(). Vec::new() is const in stable Rust since 1.39; should work на rustc 1.95.0 used by project.

- [ ] **Step 7: Measure size delta (cumulative с W5.2)**

Run:
```bash
for f in dist/matmul/rust-bindgen-speed/module.wasm dist/matmul/rust-bindgen-size/module.wasm; do
  echo "=== $f ==="
  ls -l "$f" | awk '{print "raw:", $5}'
  gzip -9 -c "$f" | wc -c | awk '{print "gzip:", $1}'
done | tee /tmp/bindgen-post-w5.3.txt
diff /tmp/bindgen-post-w5.2.txt /tmp/bindgen-post-w5.3.txt
```

Note delta — expected reduction по thread_local shim hypothesis.

- [ ] **Step 8: Run global gates + smoke**

Run: `pnpm typecheck && pnpm lint:all && pnpm test`
Expected: PASS.

Run: `pnpm smoke`
Expected: PASS.

- [ ] **Step 9: Commit W5.3**

```bash
git add benches/matmul/rust/bindgen/src/lib.rs
git commit --no-gpg-sign -m "refactor(bindgen): replace thread_local! с static SyncCell

Closes bindgen-thread-local-init-shim-overhead. Wasm32 single-threaded → lazy
thread_local init shim — pure overhead. Replaced with static SyncCell<State>
+ vacuous Sync impl (same pattern as raw crate's UnsafeCell singleton).

Размер delta vs post-W5.2:
- bindgen-speed wasm: <delta> bytes, gzip: <delta>
- bindgen-size wasm: <delta> bytes, gzip: <delta>"
```

### Task W5.4: Re-bench bindgen и compare с historical baseline

- [ ] **Step 1: Full bindgen re-bench at M-size**

Run:
```bash
pnpm bench --envs=node --sizes=M --mode=quick \
  --out=results/raw/phase-1-1-0-w5-final-check
```

Expected: results files for rust-bindgen-{speed,size}-M cases written.

- [ ] **Step 2: Compare с pre-W5 numbers**

Compare:
- Raw/gzip/brotli sizes из `/tmp/bindgen-pre.txt` против `/tmp/bindgen-post-w5.3.txt` (cumulative W5.2+W5.3 effect).
- Bench results (warmMedian, init phases) если доступны в historical session-state.

Documented baseline reference: `docs/superpowers/session-state-2026-05-05-wave-3.md` § Wave 3 sizes (если содержит). Если в session-state указаны конкретные KB numbers — use them. Иначе fall back на «document current as new baseline».

- [ ] **Step 3: Decide outcome**

Three outcomes:

**(a) Root cause resolved** — current bindgen size ≤ pre-Wave-3 baseline. W5 успешно закрывает investigation.

**(b) Significant reduction но не до baseline** — drift частично resolved. Document remaining gap + best-effort hypothesis (e.g., «оставшийся 0.3 KB drift — vendored hashbrown в std HashMap, не тестируем дальше — accepted»).

**(c) Drift не уменьшился** — W5 hypotheses (dead API + thread_local) opt-out. Document outcome + open follow-up roadmap item if material. Не блокировать closure 1.1.0 — drift becomes accepted baseline.

Записать outcome в notes для W5.5 commit.

### Task W5.5: Commit investigation outcome + delete tech-debt files

- [ ] **Step 1: Write investigation outcome в commit**

```bash
git commit --no-gpg-sign --allow-empty -m "docs(bindgen): investigation outcome for size regression

Closes bindgen-size-regression-investigation.

Pre-W5 sizes (rust-bindgen-speed/size, raw wasm bytes): <X>, <Y>
Post-W5 sizes: <X'>, <Y'>
Pre-Wave-3 baseline (from session-state-2026-05-05-wave-3.md): <Z>, <W> (или 'not documented')

Outcome: <(a) | (b) | (c) — per W5.4 Step 3 decision>.

Hypotheses validated:
- output_view + readOutput dead API removal — <delta KB> reduction.
- thread_local init shim → SyncCell — <delta KB> reduction.

<Additional notes если outcome (b) или (c).>"
```

Если outcome — (c) и есть material hypothesis (e.g., LLVM IR diff показывает specific intrinsic): add roadmap entry. Иначе закрыть полностью.

- [ ] **Step 2: Delete bindgen tech-debt files**

```bash
git rm docs/tech_debt/bindgen-output-view-force-copy.md \
       docs/tech_debt/bindgen-thread-local-init-shim-overhead.md \
       docs/tech_debt/bindgen-size-regression-investigation.md
```

- [ ] **Step 3: Commit deletions**

```bash
git commit --no-gpg-sign -m "chore(tech-debt): resolve bindgen size deep-dive trio

- output-view-force-copy: dead API removed (W5.2).
- thread-local-init-shim-overhead: replaced с SyncCell (W5.3).
- size-regression-investigation: outcome documented in previous commit.

Per resolved → delete policy."
```

---

## Phase 1.1.0 closure

### Task C.1: Full matrix verification

- [ ] **Step 1: Full rebuild**

Run: `pnpm clear && pnpm build:all`
Expected: success.

- [ ] **Step 2: Smoke**

Run: `pnpm smoke`
Expected: green.

- [ ] **Step 3: Global lint + typecheck + tests**

Run: `pnpm typecheck && pnpm lint:all && pnpm test`
Expected: PASS.

- [ ] **Step 4: Verify tech-debt directory clean**

Run: `ls docs/tech_debt/*.md`

Expected: только `README.md` + `clang-tidy-cpp.md` + `cpu-throttling-lock-macos.md` + `cargo-lock-stage-discipline.md` + `pnpm-typecheck-skips-scripts.md` (4 items не из Phase 1.1 scope + README).

Confirm no Phase 1.1.0 items remain:

```bash
grep -l "phase-1-1-candidate" docs/tech_debt/*.md 2>/dev/null
```

Expected: no output (no remaining Phase 1.1 candidates after preamble — последующие waves затронут только новые workload-specific items, если они появятся).

### Task C.2: Update roadmap (optional)

Per spec: после Phase 1.1.0 closing, `docs/roadmap.md` § Phase 1.1 теряет два cluster'а (bindgen size deep-dive + rust-raw hardening) — они закрыты. Solo items тоже.

- [ ] **Step 1: Remove resolved items from `docs/roadmap.md` § Phase 1.1**

В `docs/roadmap.md` найди § Phase 1.1. Согласно current structure (см. session-state):

```markdown
### Bindgen size deep-dive
- **bindgen-size-regression-investigation** — ...
- **bindgen-thread-local-init-shim-overhead** — ...
- **bindgen-output-view-force-copy** — ...

### rust-raw hardening
- **rust-raw-heap-ptr-repr-rust** — ...
- **rust-raw-get-slices-ergonomics** — ...

### Solo
- **worker-importscripts-detection** — ...
- **matmul-cpp-heap-alignas-latent** — ...
- **bench-debug-timings-docs** — ...
```

Remove **whole `Bindgen size deep-dive`, `rust-raw hardening`, и `Solo` cluster sub-sections** — все 8 items resolved. Phase 1.1 bucket теперь содержит только Workloads cluster.

- [ ] **Step 2: Commit roadmap update**

```bash
git add docs/roadmap.md
git commit --no-gpg-sign -m "docs(roadmap): close Phase 1.1.0 hardening preamble entries

Removed bindgen size deep-dive cluster (3 items), rust-raw hardening cluster
(2 items), and solo items (3) — все 8 resolved via Phase 1.1.0 waves W1-W5.
Phase 1.1 bucket теперь содержит только Workloads cluster (interop-calls,
hashmap-workload, shape-dispatch). История через git log."
```

### Task C.3: Phase 1.1.0 close

- [ ] **Step 1: Verify exit criteria**

From spec § Phase 1.1.0 Exit criteria:

- ✓ All 8 tech_debt files deleted (per C.1 Step 4 verification).
- ✓ matmul re-bench на M-size — covered by W5.4 outcome (documented).
- ✓ `pnpm smoke` зелёный (C.1 Step 2).
- ✓ `pnpm typecheck && pnpm lint:all && pnpm test` зелёный (C.1 Step 3).

- [ ] **Step 2: Suggest session close**

Phase 1.1.0 finished. Sub-phase closed на отдельный merge'ом в master.

Естественный момент закрыть сессию через `/finish-session` (per spec § Workflow notes:
proactive session-close suggestion).

Если user продолжает дальше — natural next step: `superpowers:writing-plans` для Phase 1.1.1
(interop_calls).

---

## Notes для executor'а

- **Commits.** Все commit messages используют `--no-gpg-sign` (existing project convention).
- **Wave order.** W1-W4 могут идти parallel при желании, но единственная зависимость — W5 после W2 (если кто-то решил мигрировать раw crate UnsafeCell pattern в bindgen first). По умолчанию — sequential per default plan.
- **Tech-debt deletion timing.** Delete файл **сразу** после landing wave's code change. Это commit pair: «refactor» + «chore(tech-debt) resolved». Не batch deletions в конец.
- **Размер delta capturing.** На W3 и W5 запиши actual numbers в commit messages — будущим reviewer'ам важно видеть concrete reduction.
- **Out of scope (повтор из spec):** schema changes, multi-entry pattern (1.1.1), toolchain version bumps. Если в процессе обнаружится, что один из items требует schema change — это **signal stop и обратись к spec/plan author** перед continuation. Не bloat scope автоматически.
