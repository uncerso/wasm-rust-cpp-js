# hashmap-stdlib-no-glue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `rust/raw` + `cpp/wasi-sdk` minimal-overhead toolchain variants to the `hashmap_int` and `hashmap_string` workloads — same stdlib container + default hasher as the glue variants, stripping only the auto-glue.

**Architecture:** `rust/raw` = `std` cdylib with manual `extern "C"` exports (no wasm-bindgen). `cpp/wasi-sdk` = the existing shared `.cpp` linked against static libc++/libc + a trap-shim TU so the module has zero WASI imports. Both are consumed by the existing `raw-wasm` loader (instantiates with empty imports `{}`). `spec.json.supported` drives the build matrix; `expectedChecksums` are unchanged (hasher-independent) so correctness is enforced automatically.

**Tech Stack:** Rust 2024 (`wasm32-unknown-unknown` cdylib), wasi-sdk clang++ (`wasm32-wasi`, libc++), binaryen `wasm-opt`, pnpm/tsx orchestrators, Node `WebAssembly` for import inspection.

---

## Execution Protocol

**Routing (hybrid inline/subagent — per `feedback_execution_strategy`):** every task below is tagged `[I]` (inline). The work is mechanical (mirror validated bindgen/cpp code) or exploratory-with-human-in-loop (the W0 link spikes need fast reaction to linker/import output). No task is dispatched to a subagent. Per `docs/workflow.md` Phase 6: all-`[I]` ⇒ execute inline, do NOT re-ask the harness.

**Sandbox:** `pnpm build:*` / `smoke` / `bench` / `run-matrix` / `fixtures` bind a tsx IPC pipe the sandbox blocks → run those with `dangerouslyDisableSandbox: true` (CLAUDE.md § tsx+sandbox). `cargo build` / `cargo clippy` / `pnpm typecheck` / `pnpm test` / `pnpm lint:ts` run inside the sandbox.

**Static break-points (STOP, hand control to user):**
- **BP1 — after Wave 0** (both spikes): report import-section results (zero imports?) + artifact sizes before committing to the full matrix. If either spike cannot reach zero imports without breaking held-constant fairness → escalate with fallback alternatives (spec § Risks; `feedback_surface_planned_risks`), do NOT silently apply a fallback.
- **BP2 — after Wave 1** (all gates green): `build:all` + typecheck + lint:all + test + smoke. Recommend `/finish-session` if user wants to break; do NOT auto-invoke.
- **BP3 — after Wave 2** (bench + guidelines + close): gates green → push + PR (user action) → recommend `/finish-session`.

**Per-task break-check (CLAUDE.md cost discipline):** ≤2 attempts at the same approach per step; then STOP and rethink, don't hammer. Read before edit; grep callers.

---

## File Structure

**Create:**
- `benches/hashmap_int/rust/raw/Cargo.toml` — raw crate manifest (std cdylib, no deps).
- `benches/hashmap_int/rust/raw/src/lib.rs` — manual `extern "C"` exports over `std::collections::HashMap<u64,u64>`.
- `benches/hashmap_string/rust/raw/Cargo.toml` — same for string.
- `benches/hashmap_string/rust/raw/src/lib.rs` — `HashMap<String,u64>` variant.
- `benches/hashmap_int/cpp/build-wasi-sdk.sh` — wasi-sdk libc++ build script.
- `benches/hashmap_int/cpp/src/wasi-shims.cpp` — trap-based `abort`/`_Exit` shims.
- `benches/hashmap_string/cpp/build-wasi-sdk.sh` — same for string.
- `benches/hashmap_string/cpp/src/wasi-shims.cpp` — same shims.

**Modify:**
- `Cargo.toml` (workspace root) — add 2 raw crates to `members`.
- `benches/hashmap_int/spec.json` — `supported.toolchains`: `rust += "raw"`, `cpp += "wasi-sdk"`.
- `benches/hashmap_string/spec.json` — same.
- `docs/roadmap.md` — remove `hashmap-stdlib-no-glue`; add `hashmap-raw-shared-crate` candidate.
- `docs/guidelines.md` — harvest pass (≥1 claim).

**Untouched:** loaders, harness, fixtures, `expectedChecksums`, the shared `cpp/src/hashmap_*.cpp`.

---

## Wave 0 — feasibility spikes (zero-import gate)

### Task 1: hashmap_int rust/raw crate `[I]`

**Files:**
- Create: `benches/hashmap_int/rust/raw/Cargo.toml`
- Create: `benches/hashmap_int/rust/raw/src/lib.rs`
- Modify: `Cargo.toml` (workspace `members`)

- [ ] **Step 1: Create the crate manifest**

`benches/hashmap_int/rust/raw/Cargo.toml`:

```toml
[package]
name = "hashmap-int-rust-raw"
version.workspace = true
edition.workspace = true
publish.workspace = true

[lib]
crate-type = ["cdylib"]

[dependencies]

[lints]
workspace = true
```

- [ ] **Step 2: Write `lib.rs`** (mirrors `rust/bindgen` logic; manual exports instead of wasm-bindgen; leaked-`Vec` `alloc` instead of bindgen-managed memory)

`benches/hashmap_int/rust/raw/src/lib.rs`:

```rust
#![allow(
    unsafe_code,
    reason = "raw WASM cdylib: ABI-level unsafe (no_mangle, raw ptrs, from_raw_parts) + SyncCell Sync impl are inherent to the FFI surface"
)]

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::LazyLock;

struct SyncCell<T>(RefCell<T>);
// SAFETY: wasm32 single-threaded — &T never crosses a thread boundary; Sync obligation is vacuous.
unsafe impl<T> Sync for SyncCell<T> {}

struct State {
    pairs: Vec<(u64, u64)>,
    map: HashMap<u64, u64>,
}

static STATE: LazyLock<SyncCell<State>> =
    LazyLock::new(|| SyncCell(RefCell::new(State { pairs: Vec::new(), map: HashMap::new() })));

const PAIR_BYTES: usize = 16;

// Private helper: keeps the panic (`.unwrap()`) out of the public FFI surface
// so clippy::missing_panics_doc does not fire (mirrors rust/bindgen structure).
fn parse_pairs(buf: &[u8]) -> Vec<(u64, u64)> {
    let n = buf.len() / PAIR_BYTES;
    let mut pairs = Vec::with_capacity(n);
    for i in 0..n {
        let base = i * PAIR_BYTES;
        let key = u64::from_le_bytes(buf[base..base + 8].try_into().unwrap());
        let value = u64::from_le_bytes(buf[base + 8..base + 16].try_into().unwrap());
        pairs.push((key, value));
    }
    pairs
}

#[unsafe(no_mangle)]
#[allow(clippy::cast_possible_truncation, reason = "wasm32 address space is always 32-bit")]
pub extern "C" fn alloc(sz: u32) -> u32 {
    let mut buf: Vec<u8> = Vec::with_capacity(sz as usize);
    let ptr = buf.as_mut_ptr() as u32;
    core::mem::forget(buf);
    ptr
}

#[unsafe(no_mangle)]
pub extern "C" fn load_input(ptr: u32, len: u32) {
    // SAFETY: host wrote `len` bytes starting at `ptr` (returned by a prior alloc) before this call.
    let buf = unsafe { core::slice::from_raw_parts(ptr as *const u8, len as usize) };
    let pairs = parse_pairs(buf);
    let mut map = HashMap::with_capacity(pairs.len());
    for (k, v) in &pairs {
        map.insert(*k, *v);
    }
    STATE.0.replace(State { pairs, map });
}

#[unsafe(no_mangle)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "map len bounded by fixture size; < 2^53")]
pub extern "C" fn hashmap_int_insert(iters: u32) -> f64 {
    let mut st = STATE.0.borrow_mut();
    let n = iters as usize;
    let pairs_snapshot: Vec<(u64, u64)> = st.pairs[..n].to_vec();
    for (k, v) in pairs_snapshot {
        st.map.insert(k, v);
    }
    st.map.len() as f64
}

#[unsafe(no_mangle)]
pub extern "C" fn hashmap_int_insert_reset() {
    STATE.0.borrow_mut().map.clear();
}

#[unsafe(no_mangle)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "values in [0, 2^32) per spec ioContract; < 2^53 mantissa")]
pub extern "C" fn hashmap_int_lookup(iters: u32) -> f64 {
    let st = STATE.0.borrow();
    let mut acc: f64 = 0.0;
    for i in 0..iters as usize {
        if let Some(v) = st.map.get(&st.pairs[i].0) {
            acc += *v as f64;
        }
    }
    acc
}

#[unsafe(no_mangle)]
pub const extern "C" fn hashmap_int_lookup_reset() {
    // No-op — lookup is read-only.
}

#[unsafe(no_mangle)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "values in [0, 2^32) per spec ioContract; < 2^53 mantissa")]
pub extern "C" fn hashmap_int_delete(iters: u32) -> f64 {
    let mut st = STATE.0.borrow_mut();
    let keys_snapshot: Vec<u64> = st.pairs[..iters as usize].iter().map(|(k, _)| *k).collect();
    let mut acc: f64 = 0.0;
    for k in keys_snapshot {
        if let Some(v) = st.map.remove(&k) {
            acc += v as f64;
        }
    }
    acc
}

#[unsafe(no_mangle)]
pub extern "C" fn hashmap_int_delete_reset() {
    let mut st = STATE.0.borrow_mut();
    st.map.clear();
    let pairs_snapshot: Vec<(u64, u64)> = st.pairs.clone();
    for (k, v) in pairs_snapshot {
        st.map.insert(k, v);
    }
}
```

- [ ] **Step 3: Register the crate in the workspace**

In `Cargo.toml` (workspace root), add to `members` after the existing `benches/hashmap_int/rust/bindgen` line:

```toml
    "benches/hashmap_int/rust/raw",
```

- [ ] **Step 4: Build the crate directly (bypass orchestrator)**

Run (sandbox OK — cargo binds no socket):
```
cargo build -p hashmap-int-rust-raw --profile=release --target=wasm32-unknown-unknown
```
Expected: builds clean; artifact at `target/wasm32-unknown-unknown/release/hashmap_int_rust_raw.wasm`.

- [ ] **Step 5: clippy gate**

Run: `cargo clippy -p hashmap-int-rust-raw --target wasm32-unknown-unknown -- -D warnings`
Expected: no warnings/errors. If `missing_const_for_fn` / `cast_*` fire on a function not covered by an `#[allow]`, add the matching allow (truthful `reason`) and rebuild (≤2 attempts, then rethink).

- [ ] **Step 6: Inspect imports (the spike's core check)**

Run:
```
node --input-type=module -e "import{readFileSync}from'node:fs';const m=await WebAssembly.compile(readFileSync('target/wasm32-unknown-unknown/release/hashmap_int_rust_raw.wasm'));console.log(JSON.stringify(WebAssembly.Module.imports(m)))"
```
Expected: `[]` (empty). A non-empty list means `RandomState` seeding (or something) pulled an import — STOP, this is the spike's gating finding; record it for BP1 and consult spec § Risks fallback (do not silently apply).

- [ ] **Step 7: Commit**

```bash
git add benches/hashmap_int/rust/raw Cargo.toml
git commit --no-gpg-sign -m "feat(hashmap_int): rust/raw std-HashMap cdylib (no bindgen glue)"
```

### Task 2: hashmap_int cpp/wasi-sdk build + shims `[I]`

**Files:**
- Create: `benches/hashmap_int/cpp/src/wasi-shims.cpp`
- Create: `benches/hashmap_int/cpp/build-wasi-sdk.sh`

- [ ] **Step 1: Write the trap-shim TU**

`benches/hashmap_int/cpp/src/wasi-shims.cpp`:

```cpp
// Trap-based shims: keep the wasi-sdk hashmap module free of WASI imports.
//
// wasi-libc's abort()/_Exit() call __wasi_proc_exit; libc++abi's abort_message
// and libc++'s std::__libcpp_verbose_abort (the __throw_* sink under
// -fno-exceptions) fprintf(stderr,...), which drags in stdio (fd_write/fd_seek/
// fd_close WASI imports). The raw-wasm loader instantiates with an empty import
// object {}, so ANY import fails instantiation. Strong overrides here keep the
// linker from pulling the wasi-libc / fprintf-based versions → zero non-memory
// imports (and ~half the binary size: 34.5KB → 17.3KB).
//
// No explicit [[noreturn]] on abort/_Exit: <cstdlib> already declares them
// non-returning and __builtin_trap() is itself noreturn — adding the C++
// attribute on this (non-first) declaration trips -Werror.
#include <cstdlib>

extern "C" void abort() {
    __builtin_trap();
}

extern "C" void _Exit(int /*status*/) {
    __builtin_trap();
}

extern "C" void abort_message(const char* /*fmt*/, ...) {
    __builtin_trap();
}

// Matches the std::__2 mangled symbol _ZNSt3__222__libcpp_verbose_abortEPKcz.
namespace std {
inline namespace __2 {
[[noreturn]] void __libcpp_verbose_abort(const char* /*fmt*/, ...) {
    __builtin_trap();
}
} // namespace __2
} // namespace std
```

- [ ] **Step 2: Write the build script** (model: `benches/shape_dispatch_homo_dyn/cpp/build-wasi-sdk.sh`, extended with libc++ + heap + shims; `--allow-undefined` deliberately dropped so any missing symbol is a hard link error, not a silent import)

`benches/hashmap_int/cpp/build-wasi-sdk.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Args: $1 = profile (speed|size), $2 = output dir
PROFILE="$1"
OUT_DIR="$2"
mkdir -p "$OUT_DIR"
HERE="$(cd "$(dirname "$0")" && pwd)"
WASI_SDK_PATH="${WASI_SDK_PATH:?WASI_SDK_PATH must point to wasi-sdk install root}"

if [[ "$PROFILE" == "speed" ]]; then
  OPT="-O3 -flto"
elif [[ "$PROFILE" == "size" ]]; then
  OPT="-Oz -flto"
else
  echo "unknown profile: $PROFILE" >&2; exit 1
fi

WARN_FLAGS="-Wall -Wextra -Wpedantic -Werror \
-Wshadow -Wconversion -Wsign-conversion \
-Wcast-align -Wold-style-cast -Wnon-virtual-dtor \
-Wnull-dereference -Wdouble-promotion"

STD_FLAG="-std=c++23"

# Unlike the freestanding workloads, hashmap needs a heap (unordered_map nodes,
# std::string) and libc++. Link libc++/libc++abi/libc + builtins statically in
# a group, with -nostdlib (no crt startup / WASI command model) + --no-entry.
# Trap-shims (wasi-shims.cpp) override abort()/_Exit() so the module imports
# ZERO WASI syscalls. -DNDEBUG disables libc++ hardening asserts (pull fd_write).
SYSROOT_LIB="$WASI_SDK_PATH/share/wasi-sysroot/lib/wasm32-wasi"
WASI_BUILTINS="$WASI_SDK_PATH/lib/clang/19/lib/wasi/libclang_rt.builtins-wasm32.a"

"$WASI_SDK_PATH/bin/clang++" \
  --target=wasm32-wasi \
  $STD_FLAG \
  $WARN_FLAGS \
  -DNDEBUG \
  -nostdlib \
  $OPT \
  -fno-exceptions -fno-rtti \
  -fvisibility=hidden \
  -mbulk-memory \
  "$HERE/src/hashmap_int.cpp" \
  "$HERE/src/wasi-shims.cpp" \
  "$SYSROOT_LIB/libc++.a" \
  "$SYSROOT_LIB/libc++abi.a" \
  "$SYSROOT_LIB/libc.a" \
  "$WASI_BUILTINS" \
  -Wl,--no-entry \
  -Wl,--export=alloc -Wl,--export=load_input \
  -Wl,--export=hashmap_int_insert -Wl,--export=hashmap_int_insert_reset \
  -Wl,--export=hashmap_int_lookup -Wl,--export=hashmap_int_lookup_reset \
  -Wl,--export=hashmap_int_delete -Wl,--export=hashmap_int_delete_reset \
  -Wl,--export-memory \
  -Wl,--strip-all \
  -o "$OUT_DIR/module.wasm"

if [[ "$PROFILE" == "size" ]]; then
  wasm-opt -Oz \
    --enable-bulk-memory \
    --enable-nontrapping-float-to-int \
    "$OUT_DIR/module.wasm" -o "$OUT_DIR/module.wasm"
fi
```

`chmod +x benches/hashmap_int/cpp/build-wasi-sdk.sh`.

- [ ] **Step 3: Spike-build directly + iterate to zero imports**

Resolve the wasi-sdk path, then run the script for the speed profile into a scratch dir (`dangerouslyDisableSandbox: true` — clang/LTO):
```
WASI=$(node --input-type=module -e "import{wasiSdkPath}from'./scripts/lib/tool-paths.js';console.log(wasiSdkPath())")
PATH="$(pwd)/.tools/bin:$PATH" WASI_SDK_PATH="$WASI" bash benches/hashmap_int/cpp/build-wasi-sdk.sh speed "$TMPDIR/wasi-spike"
```
Expected: links clean → `$TMPDIR/wasi-spike/module.wasm`.
- If the LINK fails on a missing symbol: if it is a syscall-shaped symbol (`__wasi_*`, `proc_exit`, `__main_void`, `environ*`, `fd_*`, `__assert_fail`), add a trap-shim/stub to `wasi-shims.cpp`; if it is a libc++/libc symbol, fix the archive group. Rebuild (≤2 attempts, then rethink).
- Verify the clang version segment in `WASI_BUILTINS` matches the installed wasi-sdk (`ls "$WASI/lib/clang"`); fix the `19` if different.

- [ ] **Step 4: Inspect imports**

```
node --input-type=module -e "import{readFileSync}from'node:fs';const m=await WebAssembly.compile(readFileSync(process.env.TMPDIR+'/wasi-spike/module.wasm'));console.log(JSON.stringify(WebAssembly.Module.imports(m)))"
```
Expected: `[]`. Non-empty → add the corresponding trap-shim and rebuild; if a benign import is irreducible, STOP for BP1 (spec § Risks fallback).

- [ ] **Step 5: Commit**

```bash
git add benches/hashmap_int/cpp/build-wasi-sdk.sh benches/hashmap_int/cpp/src/wasi-shims.cpp
git commit --no-gpg-sign -m "feat(hashmap_int): cpp/wasi-sdk libc++ build, zero-import trap-shims"
```

### Task 3: wire hashmap_int new toolchains into the matrix + validate@S `[I]`

**Files:**
- Modify: `benches/hashmap_int/spec.json`

- [ ] **Step 1: Add the toolchains to spec.json**

In `benches/hashmap_int/spec.json`, under `supported.toolchains`:
- change `"rust": ["bindgen"]` → `"rust": ["bindgen", "raw"]`
- change `"cpp": ["emscripten"]` → `"cpp": ["emscripten", "wasi-sdk"]`

- [ ] **Step 2: Build hashmap_int through the orchestrators**

Run (`dangerouslyDisableSandbox: true` — tsx pipe):
```
pnpm exec tsx scripts/build-rust.ts hashmap_int
pnpm exec tsx scripts/build-cpp.ts hashmap_int
```
Expected: logs `built ... rust/raw` and `built wasi-sdk hashmap_int` for both profiles; artifacts under `dist/`.

- [ ] **Step 3: Inspect the orchestrated artifacts' imports**

```
for f in $(find dist -path '*hashmap_int*' \( -path '*raw*' -o -path '*wasi*' \) -name module.wasm); do echo "$f:"; node --input-type=module -e "import{readFileSync}from'node:fs';const m=await WebAssembly.compile(readFileSync('$f'));console.log(JSON.stringify(WebAssembly.Module.imports(m)))"; done
```
Expected: every artifact prints `[]`.

- [ ] **Step 4: Validate@S in Node against pinned checksums**

Run (`dangerouslyDisableSandbox: true`):
```
pnpm exec tsx scripts/run-matrix.ts --benchmarks=hashmap_int --envs=node --sizes=S --mode=quick --out="$TMPDIR/hmint-spike"
```
Expected: all hashmap_int combos at S pass (no correctness halt). The new `rust/raw` + `cpp/wasi-sdk` checksums equal the pinned `expectedChecksums` (insert→1000, lookup/delete→2078117175396).

- [ ] **Step 5: Commit**

```bash
git add benches/hashmap_int/spec.json
git commit --no-gpg-sign -m "feat(hashmap_int): enable rust/raw + cpp/wasi-sdk in build matrix"
```

> **BP1 — STOP.** Report to the user: import-section results for both int spikes (zero?), `dist/` artifact sizes (raw vs bindgen, wasi-sdk vs emscripten), any shims added. Get the go-ahead before Wave 1. If a spike could not reach zero imports → escalate fallback options, do not proceed.

---

## Wave 1 — full matrix + spec.json

### Task 4: hashmap_string rust/raw crate `[I]`

**Files:**
- Create: `benches/hashmap_string/rust/raw/Cargo.toml`
- Create: `benches/hashmap_string/rust/raw/src/lib.rs`
- Modify: `Cargo.toml` (workspace `members`)

- [ ] **Step 1: Create the manifest**

`benches/hashmap_string/rust/raw/Cargo.toml`:

```toml
[package]
name = "hashmap-string-rust-raw"
version.workspace = true
edition.workspace = true
publish.workspace = true

[lib]
crate-type = ["cdylib"]

[dependencies]

[lints]
workspace = true
```

- [ ] **Step 2: Write `lib.rs`** (String key; `PAIR_BYTES = 24`; UTF-8 parse — mirrors `hashmap_string/rust/bindgen` + the int/raw alloc pattern)

`benches/hashmap_string/rust/raw/src/lib.rs`:

```rust
#![allow(
    unsafe_code,
    reason = "raw WASM cdylib: ABI-level unsafe (no_mangle, raw ptrs, from_raw_parts) + SyncCell Sync impl are inherent to the FFI surface"
)]

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::LazyLock;

struct SyncCell<T>(RefCell<T>);
// SAFETY: wasm32 single-threaded — &T never crosses a thread boundary; Sync obligation is vacuous.
unsafe impl<T> Sync for SyncCell<T> {}

struct State {
    pairs: Vec<(String, u64)>,
    map: HashMap<String, u64>,
}

static STATE: LazyLock<SyncCell<State>> =
    LazyLock::new(|| SyncCell(RefCell::new(State { pairs: Vec::new(), map: HashMap::new() })));

const PAIR_BYTES: usize = 24;

// Private helper: keeps the panic out of the public FFI surface so
// clippy::missing_panics_doc does not fire (mirrors rust/bindgen structure).
fn parse_pairs(buf: &[u8]) -> Vec<(String, u64)> {
    let n = buf.len() / PAIR_BYTES;
    let mut pairs = Vec::with_capacity(n);
    for i in 0..n {
        let base = i * PAIR_BYTES;
        let key = std::str::from_utf8(&buf[base..base + 16])
            .expect("hashmap_string fixture must be ASCII")
            .to_string();
        let value = u64::from_le_bytes(buf[base + 16..base + 24].try_into().unwrap());
        pairs.push((key, value));
    }
    pairs
}

#[unsafe(no_mangle)]
#[allow(clippy::cast_possible_truncation, reason = "wasm32 address space is always 32-bit")]
pub extern "C" fn alloc(sz: u32) -> u32 {
    let mut buf: Vec<u8> = Vec::with_capacity(sz as usize);
    let ptr = buf.as_mut_ptr() as u32;
    core::mem::forget(buf);
    ptr
}

#[unsafe(no_mangle)]
pub extern "C" fn load_input(ptr: u32, len: u32) {
    // SAFETY: host wrote `len` bytes starting at `ptr` (returned by a prior alloc) before this call.
    let buf = unsafe { core::slice::from_raw_parts(ptr as *const u8, len as usize) };
    let pairs = parse_pairs(buf);
    let mut map = HashMap::with_capacity(pairs.len());
    for (k, v) in &pairs {
        map.insert(k.clone(), *v);
    }
    STATE.0.replace(State { pairs, map });
}

#[unsafe(no_mangle)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "map len bounded by fixture size; < 2^53")]
pub extern "C" fn hashmap_string_insert(iters: u32) -> f64 {
    let mut st = STATE.0.borrow_mut();
    let n = iters as usize;
    let pairs_snapshot: Vec<(String, u64)> = st.pairs[..n].to_vec();
    for (k, v) in pairs_snapshot {
        st.map.insert(k, v);
    }
    st.map.len() as f64
}

#[unsafe(no_mangle)]
pub extern "C" fn hashmap_string_insert_reset() {
    STATE.0.borrow_mut().map.clear();
}

#[unsafe(no_mangle)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "values in [0, 2^32) per spec ioContract; < 2^53 mantissa")]
pub extern "C" fn hashmap_string_lookup(iters: u32) -> f64 {
    let st = STATE.0.borrow();
    let mut acc: f64 = 0.0;
    for i in 0..iters as usize {
        if let Some(v) = st.map.get(&st.pairs[i].0) {
            acc += *v as f64;
        }
    }
    acc
}

#[unsafe(no_mangle)]
pub const extern "C" fn hashmap_string_lookup_reset() {
    // No-op — lookup is read-only.
}

#[unsafe(no_mangle)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "values in [0, 2^32) per spec ioContract; < 2^53 mantissa")]
pub extern "C" fn hashmap_string_delete(iters: u32) -> f64 {
    let mut st = STATE.0.borrow_mut();
    let keys_snapshot: Vec<String> =
        st.pairs[..iters as usize].iter().map(|(k, _)| k.clone()).collect();
    let mut acc: f64 = 0.0;
    for k in keys_snapshot {
        if let Some(v) = st.map.remove(&k) {
            acc += v as f64;
        }
    }
    acc
}

#[unsafe(no_mangle)]
pub extern "C" fn hashmap_string_delete_reset() {
    let mut st = STATE.0.borrow_mut();
    st.map.clear();
    let pairs_snapshot: Vec<(String, u64)> = st.pairs.clone();
    for (k, v) in pairs_snapshot {
        st.map.insert(k, v);
    }
}
```

- [ ] **Step 3: Register in workspace** — add to `Cargo.toml` `members`:

```toml
    "benches/hashmap_string/rust/raw",
```

- [ ] **Step 4: Build + clippy** (sandbox OK)

```
cargo build -p hashmap-string-rust-raw --profile=release --target=wasm32-unknown-unknown
cargo clippy -p hashmap-string-rust-raw --target wasm32-unknown-unknown -- -D warnings
```
Expected: clean build, no clippy warnings.

- [ ] **Step 5: Commit**

```bash
git add benches/hashmap_string/rust/raw Cargo.toml
git commit --no-gpg-sign -m "feat(hashmap_string): rust/raw std-HashMap cdylib (no bindgen glue)"
```

### Task 5: hashmap_string cpp/wasi-sdk build + shims `[I]`

**Files:**
- Modify: `benches/hashmap_string/cpp/src/hashmap_string.cpp` (construct-on-first-use)
- Create: `benches/hashmap_string/cpp/src/wasi-shims.cpp`
- Create: `benches/hashmap_string/cpp/build-wasi-sdk.sh`

- [ ] **Step 0: construct-on-first-use in `hashmap_string.cpp`** (W0 finding — the raw-wasm loader never runs `__wasm_call_ctors`, so a plain `static State g_state;` is left unconstructed and traps/corrupts at scale under wasi-sdk). Mirror the int fix exactly:
  1. Add `#include <new>` to the includes (after `<cstring>`).
  2. Replace `State g_state;` with the placement-new accessor:

```cpp
// Construct-on-first-use (mirrors the rust/raw + rust/bindgen LazyLock model).
// The wasi-sdk no-glue build is instantiated by the raw-wasm loader without a
// runtime that runs __wasm_call_ctors, so a plain `static State g_state;` would
// be left unconstructed and trap/corrupt on use. Placement-new into static
// storage on first access, guarded by a plain BSS bool — the same pattern the
// shape_dispatch wasi-sdk workloads use. Avoids both global ctors and
// __cxa_guard. emscripten behaves identically (lazy vs eager; same checksums).
alignas(State) unsigned char g_storage[sizeof(State)];
bool g_inited = false;

State& state() {
    if (!g_inited) {
        new (g_storage) State();
        g_inited = true;
    }
    return *reinterpret_cast<State*>(g_storage);
}
```

  3. Replace every `g_state.` with `state().` (replace-all).

  NOTE: a `__cxa_guard`-backed Meyers singleton (`static State instance;`) was tried for int and produced GARBAGE under `-nostdlib` — use placement-new + BSS bool, not a function-local static.

- [ ] **Step 1: Trap-shim TU** — identical content to the int one (file isolated per workload):

`benches/hashmap_string/cpp/src/wasi-shims.cpp`:

```cpp
// Trap-based shims: keep the wasi-sdk hashmap module free of WASI imports.
//
// wasi-libc's abort()/_Exit() call __wasi_proc_exit; libc++abi's abort_message
// and libc++'s std::__libcpp_verbose_abort (the __throw_* sink under
// -fno-exceptions) fprintf(stderr,...), which drags in stdio (fd_write/fd_seek/
// fd_close WASI imports). The raw-wasm loader instantiates with an empty import
// object {}, so ANY import fails instantiation. Strong overrides here keep the
// linker from pulling the wasi-libc / fprintf-based versions → zero non-memory
// imports (and ~half the binary size: 34.5KB → 17.3KB).
//
// No explicit [[noreturn]] on abort/_Exit: <cstdlib> already declares them
// non-returning and __builtin_trap() is itself noreturn — adding the C++
// attribute on this (non-first) declaration trips -Werror.
#include <cstdlib>

extern "C" void abort() {
    __builtin_trap();
}

extern "C" void _Exit(int /*status*/) {
    __builtin_trap();
}

extern "C" void abort_message(const char* /*fmt*/, ...) {
    __builtin_trap();
}

// Matches the std::__2 mangled symbol _ZNSt3__222__libcpp_verbose_abortEPKcz.
namespace std {
inline namespace __2 {
[[noreturn]] void __libcpp_verbose_abort(const char* /*fmt*/, ...) {
    __builtin_trap();
}
} // namespace __2
} // namespace std
```

- [ ] **Step 2: Build script** — same as int's, with `hashmap_string.cpp` source + `hashmap_string_*` exports:

`benches/hashmap_string/cpp/build-wasi-sdk.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Args: $1 = profile (speed|size), $2 = output dir
PROFILE="$1"
OUT_DIR="$2"
mkdir -p "$OUT_DIR"
HERE="$(cd "$(dirname "$0")" && pwd)"
WASI_SDK_PATH="${WASI_SDK_PATH:?WASI_SDK_PATH must point to wasi-sdk install root}"

if [[ "$PROFILE" == "speed" ]]; then
  OPT="-O3 -flto"
elif [[ "$PROFILE" == "size" ]]; then
  OPT="-Oz -flto"
else
  echo "unknown profile: $PROFILE" >&2; exit 1
fi

WARN_FLAGS="-Wall -Wextra -Wpedantic -Werror \
-Wshadow -Wconversion -Wsign-conversion \
-Wcast-align -Wold-style-cast -Wnon-virtual-dtor \
-Wnull-dereference -Wdouble-promotion"

STD_FLAG="-std=c++23"

# See benches/hashmap_int/cpp/build-wasi-sdk.sh for the rationale (libc++ + heap,
# -nostdlib, trap-shims for zero WASI imports, -DNDEBUG).
SYSROOT_LIB="$WASI_SDK_PATH/share/wasi-sysroot/lib/wasm32-wasi"
WASI_BUILTINS="$WASI_SDK_PATH/lib/clang/19/lib/wasi/libclang_rt.builtins-wasm32.a"

"$WASI_SDK_PATH/bin/clang++" \
  --target=wasm32-wasi \
  $STD_FLAG \
  $WARN_FLAGS \
  -DNDEBUG \
  -nostdlib \
  $OPT \
  -fno-exceptions -fno-rtti \
  -fvisibility=hidden \
  -mbulk-memory \
  "$HERE/src/hashmap_string.cpp" \
  "$HERE/src/wasi-shims.cpp" \
  "$SYSROOT_LIB/libc++.a" \
  "$SYSROOT_LIB/libc++abi.a" \
  "$SYSROOT_LIB/libc.a" \
  "$WASI_BUILTINS" \
  -Wl,--no-entry \
  -Wl,--export=alloc -Wl,--export=load_input \
  -Wl,--export=hashmap_string_insert -Wl,--export=hashmap_string_insert_reset \
  -Wl,--export=hashmap_string_lookup -Wl,--export=hashmap_string_lookup_reset \
  -Wl,--export=hashmap_string_delete -Wl,--export=hashmap_string_delete_reset \
  -Wl,--export-memory \
  -Wl,--strip-all \
  -o "$OUT_DIR/module.wasm"

if [[ "$PROFILE" == "size" ]]; then
  wasm-opt -Oz \
    --enable-bulk-memory \
    --enable-nontrapping-float-to-int \
    "$OUT_DIR/module.wasm" -o "$OUT_DIR/module.wasm"
fi
```

`chmod +x benches/hashmap_string/cpp/build-wasi-sdk.sh`.

- [ ] **Step 3: Commit**

```bash
git add benches/hashmap_string/cpp/build-wasi-sdk.sh benches/hashmap_string/cpp/src/wasi-shims.cpp
git commit --no-gpg-sign -m "feat(hashmap_string): cpp/wasi-sdk libc++ build, zero-import trap-shims"
```

### Task 6: enable hashmap_string toolchains + spec.json `[I]`

**Files:**
- Modify: `benches/hashmap_string/spec.json`

- [ ] **Step 1: Edit spec.json** — under `supported.toolchains`:
- `"rust": ["bindgen"]` → `"rust": ["bindgen", "raw"]`
- `"cpp": ["emscripten"]` → `"cpp": ["emscripten", "wasi-sdk"]`

- [ ] **Step 2: Commit**

```bash
git add benches/hashmap_string/spec.json
git commit --no-gpg-sign -m "feat(hashmap_string): enable rust/raw + cpp/wasi-sdk in build matrix"
```

### Task 7: full-suite gates `[I]`

- [ ] **Step 1: Build everything** (`dangerouslyDisableSandbox: true`)

Run: `pnpm build:all`
Expected: succeeds; `dist/` gains 8 new artifacts (hashmap_{int,string} × {raw,wasi-sdk} × {speed,size}).

- [ ] **Step 2: Inspect ALL new artifacts' imports**

```
for f in $(find dist -path '*hashmap_*' \( -path '*raw*' -o -path '*wasi*' \) -name module.wasm); do echo "$f:"; node --input-type=module -e "import{readFileSync}from'node:fs';const m=await WebAssembly.compile(readFileSync('$f'));console.log(JSON.stringify(WebAssembly.Module.imports(m)))"; done
```
Expected: every line `[]`.

- [ ] **Step 3: Static gates** (sandbox OK)

Run: `pnpm typecheck` → expect pass.
Run: `pnpm lint:all` → expect pass (clippy includes both new raw crates).
Run: `pnpm test` → expect pass.

- [ ] **Step 4: Smoke** (`dangerouslyDisableSandbox: true`)

Run: `pnpm smoke`
Expected: `smoke OK`. Covers all combos × S × Node — the 4 new (binary×toolchain) validate against pinned `expectedChecksums` (hashmap_int: insert 1000 / lookup,delete 2078117175396; hashmap_string: insert 1000 / lookup,delete 2159782707395).

- [ ] **Step 5: Commit** (only if `pnpm build:all` produced tracked changes beyond artifacts — `dist/` is typically gitignored; if nothing tracked changed, skip)

```bash
git status --short
# commit any tracked changes (e.g. meta), else no-op
```

> **BP2 — STOP.** All gates green. Report results; recommend `/finish-session` if the user wants a break (do NOT auto-invoke).

---

## Wave 2 — bench + guidelines + close

### Task 8: full benchmark run + report `[I]`

- [ ] **Step 1: Run the full matrix in eval mode** (`dangerouslyDisableSandbox: true`; heavy)

Run: `pnpm bench:all`
Expected: builds + benches all combos (`--mode=eval`) + writes report. New raw/wasi-sdk rows present for both hashmap workloads, zero correctness failures.

- [ ] **Step 2: Sanity-check the report**

Open the generated report (`results/summarized/...` HTML). Confirm: hashmap_int + hashmap_string each show 5 toolchain columns (js/idiomatic, rust/bindgen, rust/raw, cpp/emscripten, cpp/wasi-sdk) with size + runtime numbers.

- [ ] **Step 3: Commit** any results/report changes intended to be tracked (per repo convention — check `git status`; raw results under `results/raw/` may be gitignored).

```bash
git status --short
git add -A results 2>/dev/null || true
git commit --no-gpg-sign -m "bench(hashmap): full matrix incl rust/raw + cpp/wasi-sdk" || true
```

### Task 9: guidelines harvest `[I]`

**Files:**
- Modify: `docs/guidelines.md`

- [ ] **Step 1: Analyze the size deltas** from the report:
  - **Glue overhead:** `rust/raw` vs `rust/bindgen` and `cpp/wasi-sdk` vs `cpp/emscripten` (same container + hasher) — raw/gzip/brotli, per profile, per key-type.
  - **std-inclusion delta:** `hashmap_*/rust/raw` (std) vs `matmul/rust/raw` (no_std) — the cost of pulling std + HashMap into an otherwise-minimal wasm.
  - **Runtime:** per-op (insert/lookup/delete) raw vs glue — does stripping glue change warm-sample throughput, or only artifact size?

- [ ] **Step 2: Write claims** into `docs/guidelines.md` following the file's format header. Mark **confirmed** only where the signal is consistent across ≥2 sizes × ≥2 key-types; otherwise **tentative**. Target ≥1 confirmed claim (likely: "wasm-bindgen / emscripten glue adds a fixed ~N KB floor independent of container size" — verify direction + magnitude against the numbers, do not assume).

- [ ] **Step 3: Commit**

```bash
git add docs/guidelines.md
git commit --no-gpg-sign -m "docs(guidelines): glue-overhead + std-inclusion claims from hashmap-no-glue"
```

### Task 10: roadmap cleanup `[I]`

**Files:**
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Remove** the `hashmap-stdlib-no-glue` item from `### Workload expansion` (Phase 1.2).

- [ ] **Step 2: Add** the deferred unification candidate under `### Workload expansion`:

```markdown
- **hashmap-raw-shared-crate** — DRY raw+bindgen hashmap logic into a shared crate per binary; only if measurement shows unification does NOT regress size/perf (currently duplicated to keep variants isolated). ([→ spec § Scope](superpowers/specs/2026-06-13-hashmap-stdlib-no-glue-design.md))
```

- [ ] **Step 3: Commit**

```bash
git add docs/roadmap.md
git commit --no-gpg-sign -m "docs(roadmap): close hashmap-stdlib-no-glue; add hashmap-raw-shared-crate"
```

> **BP3 — STOP / phase close.** Verify master gates green on the branch. Hand off push + PR to the user (`! git push -u origin feature/phase-1-2-hashmap-stdlib-no-glue` + compare link). Then recommend `/finish-session` (capture markers triage + session-state). Do NOT push or auto-invoke finish-session.

---

## Self-review notes

- **Spec coverage:** rust/raw (A) → T1,T4; cpp/wasi-sdk (B) → T2,T5; spec.json (C) → T3,T6; loaders untouched (D) → no task by design; W0 spikes → T1-T3; guidelines → T9; roadmap incl. shared-crate candidate → T10. All spec sections mapped.
- **No new fixtures / no checksum regen** — confirmed: validation reuses pinned `expectedChecksums`.
- **Type/name consistency:** crate names `hashmap-{int,string}-rust-raw` → cdylib `hashmap_{int,string}_rust_raw.wasm` (matches `buildRaw` expectation); export names match `spec.json.entries` + `<entry>_reset` companions (raw-wasm `bindReset`); clang version `19` flagged for verification in T2 S3.
