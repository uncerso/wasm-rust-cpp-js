# Pitfalls — Phase 1.2 hashmap-stdlib-no-glue, Wave 0

W0 added the no-glue toolchain variants (`rust/raw`, `cpp/wasi-sdk`) to `hashmap_int`. Goal: a wasm module the `raw-wasm` loader can instantiate with an **empty import object `{}`** and run. Four toolchain gotchas + one process lesson surfaced. Anyone adding a future no-glue / stdlib-container workload should read this first.

## Tooling

### Rust wasm global allocator grows memory on first alloc → detaches the loader's cached buffer

- **What happened.** The `rust/raw` `alloc` export (`Vec::with_capacity(sz)` + `mem::forget`) returned a pointer at the top of linear memory, and the allocation grew memory. The raw-wasm loader caches `exports.memory.buffer` at load and writes the fixture into it after `alloc()`; the grow had **detached** that ArrayBuffer → `TypeError: Cannot perform Construct on a detached ArrayBuffer`.
- **Root cause.** Rust's `wasm32-unknown-unknown` allocator (dlmalloc) always extends from `memory.size` via `memory.grow`; it **ignores pre-existing free linear memory**, so `--initial-memory` does NOT give it headroom (verified: with 32 MiB initial memory, the first `alloc(16000)` still returned a ptr at the 32 MiB boundary and grew).
- **Prevention.** Hand the host's `alloc` offset out of a **static buffer** (`static [u8; N]` via `addr_of!`), like `matmul/rust/raw`, so `alloc` never grows. The map/`Vec` may keep using the global allocator — their later growth (during `load_input` prefill / `run`) is harmless because the loader never re-reads the buffer after the initial write. Lives in `benches/hashmap_int/rust/raw/src/lib.rs`.

### C++ static global constructors do NOT run under the raw-wasm loader

- **What happened.** `cpp/wasi-sdk` linked with **zero imports** and instantiated, but `load_input`/entries trapped at scale (`null function or function signature mismatch` / `unreachable`) — only at S=1000, not at N=16.
- **Root cause.** A non-trivial `static State g_state;` (with `unordered_map`/`vector`) is dynamically initialized via `.init_array`, run by `__wasm_call_ctors`. On a command module `_start` calls it; on a reactor the host calls `_initialize`; emscripten's glue calls it. Under `-nostdlib --no-entry` + the raw-wasm loader (`instantiate(…, {})`, no `_initialize` call) **nothing runs it** → the map is left zero-initialized (`max_load_factor == 0.0` etc.) → garbage/trap once a rehash hits the broken math. Decisively confirmed: manual `__wasm_call_ctors()` → correct; without → trap. (`--entry=__wasm_call_ctors` to force a wasm `start` section did NOT work.)
- **Prevention.** **Construct-on-first-use** (Rust's `LazyLock` model): build the state lazily on first access so no global-ctor pass is required. The existing `shape_dispatch` wasi-sdk workloads avoid the issue the same way (placement-new on demand). Any wasi-sdk workload with a non-trivial global state needs this.

### `__cxa_guard`-backed function-local static produces garbage under `-nostdlib` wasi-sdk

- **What happened.** The first construct-on-first-use attempt — a Meyers singleton (`State& state() { static State s; return s; }`) — linked and ran but returned **garbage** (insert size 1292 instead of 1000, lookup 7e20 instead of the value sum).
- **Root cause.** A function-local static with a non-trivial ctor is guarded by `__cxa_guard_acquire`/`release`; under the `-nostdlib` wasi-sdk link that guard path does not behave correctly, so the object is treated as constructed when it is not.
- **Prevention.** Use **placement-new into static storage guarded by a plain BSS `bool`** (`alignas(State) unsigned char g_storage[…]; bool g_inited;`), not a function-local static. Same pattern as `shape_dispatch`. Lives in `benches/hashmap_int/cpp/src/hashmap_int.cpp`.

### libc++ default terminate / verbose-abort drags stdio into the module (3 WASI imports)

- **What happened.** The first wasi-sdk link had `fd_close`/`fd_seek`/`fd_write` imports — fatal for the empty-import loader — and the module was ~2× larger (34.5 KB vs 17.3 KB).
- **Root cause.** Under `-fno-exceptions`, libc++'s `__throw_*` helpers route to `std::__libcpp_verbose_abort`, and libc++abi's terminate path routes to `abort_message`; both `fprintf(stderr, …)` before aborting, which references `stderr` and pulls the whole buffered-stdio machinery (fd_* syscalls).
- **Prevention.** Provide **strong trap-shims** (in a wasi-only TU) for `abort`, `_Exit`, `abort_message` (extern "C"), and `std::__libcpp_verbose_abort` (the `std::__2` mangled symbol) → `__builtin_trap()`. The linker then never pulls the fprintf-based archive members → zero imports + half the size. Also pass `-DNDEBUG` (libc++ hardening asserts otherwise reference fd_write). `wasm-ld` does NOT accept `--start-group`/`--end-group` (resolves archives lazily anyway) and needs `--export-memory` (not `--export=memory`, which looks for a data symbol). Lives in `benches/hashmap_int/cpp/{build-wasi-sdk.sh,src/wasi-shims.cpp}`.

## Process

### A feasibility spike isn't closed by a static property — validate by execution

- **What happened.** The cpp/wasi-sdk spike was declared "passed" once the module showed **zero imports** and instantiated. The actual trap (unrun ctors) surfaced only later, on the @S correctness validation.
- **Root cause.** Zero-imports + instantiation is a necessary but not sufficient condition; the failure mode (uninitialized state) is invisible until the code executes on representative data.
- **Prevention.** A Wave-0 spike is closed only after it **runs a representative case and matches the pinned checksum**, not on a static check alone. Captured in `docs/workflow.md` § Spec & plan discipline (Spike completion).
