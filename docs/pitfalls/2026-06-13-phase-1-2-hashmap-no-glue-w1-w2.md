# Pitfalls — Phase 1.2 hashmap-stdlib-no-glue (W1/W2)

Sibling to `2026-06-13-phase-1-2-hashmap-no-glue-w0.md` (W0 spikes). These two
fired during W1 (string replication) and W2 (`bench:all` eval), both in the
"string was supposed to be a mechanical mirror of int" assumption.

## Tooling

### `std::string` in a wasi-sdk no-glue build pulls libc++'s monolithic `string.cpp.o` → stdio WASI imports

**What happened.** The `cpp/wasi-sdk` build for `hashmap_string`, using the same
trap-shims that gave `hashmap_int` zero imports, instead imported
`fd_write` + `fd_seek` (and `fd_close` under `--gc-sections`) — failing the
empty-import instantiation contract of the raw-wasm loader.

**Root cause.** 16-char `std::string` keys exceed libc++'s 32-bit SSO capacity
(~10 bytes), so copying them uses the out-of-line `__init_copy_ctor_external`,
which lives in libc++'s `string.cpp.o`. That object is one monolithic TU: pulling
it for the copy ctor also drags in `std::to_string` / `std::stoX`, which reference
`snprintf` / `swprintf` / `strto{d,f,ld,l,ll,ul,ull}` / `wcsto*` → the buffered
`FILE*` machinery (`vfprintf` → `__towrite` → `__stdio_exit` → `writev`/`lseek`) →
the `fd_*` imports. We never call `to_string`/`stoX`, but the dead code is
retained because the member is a single section — `-Wl,--gc-sections` cannot
split it (it made things *worse*: +`fd_close`). `hashmap_int` (uint64 keys) never
touches `std::string`, so it was clean with the W0 shims alone.

**Prevention.** [branch 5 — link-only] Diagnose with
`clang++ ... -Wl,--why-extract=why.txt` then diff the extracted-member set
against a known-clean sibling (int): the delta names the culprit TU. The fix —
17 strong `extern "C"` trap-overrides for the exact symbols `string.cpp.o`
references (enumerate with `llvm-nm -u string.cpp.o`) — lives in
`benches/hashmap_string/cpp/src/wasi-shims.cpp` (the `// string-only shims`
block) and is the reference recipe for any future `cpp/wasi-sdk` workload that
uses `std::string` or other monolithic-TU libc++ facilities.

## Process

### The raw-wasm loader cached `memory.buffer` across a memory-growing `alloc` → detached-ArrayBuffer at scale

**What happened.** `bench:all` (eval, all sizes) failed on
`hashmap_int / cpp/wasi-sdk / M` with `TypeError: Cannot perform Construct on a
detached ArrayBuffer` at `raw-wasm.ts:102`. The same case passed at S (smoke) and
in static checks (links, zero imports, instantiates).

**Root cause.** `packages/loaders/src/raw-wasm.ts` captured
`const memBuffer = exports.memory.buffer` at load time, then used it in
`loadInput` *after* calling `exports.alloc()`. `cpp/wasi-sdk` `alloc` is
`::operator new` → wasi `malloc`, which calls `memory.grow` once the fixture no
longer fits the initial heap (M/L but not S). Growth detaches the cached buffer,
so the fixture write throws. The W0 `rust/raw` static-staging-buffer fix
(`611eec3`) had side-stepped this by never growing in `alloc` — but that masked
the loader's latent assumption rather than fixing it; `cpp`'s natural
`operator new` re-exposed it.

**Prevention.** [branch 1 — eliminate] Fixed at the root in `89323e2`: read
`exports.memory.buffer` at the point of use (post-`alloc`) so the live,
non-detached buffer is always used — generic for any growing `alloc`, and it lets
`cpp` keep natural `operator new` (fairer than an artificial staging buffer; the
now-redundant `rust/raw` staging buffer is tracked as roadmap
`rust-raw-drop-staging-buffer`). Reinforces the existing
`docs/workflow.md` § Spike completion rule: a spike's static "pass" (links /
zero imports / instantiates at S) is NOT closure — validate by execution at
representative scale (`--mode=eval`, sizes M/L). Both W0 (unrun ctor) and this
W2 detach fired only above S.
