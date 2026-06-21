# Bug report — cpp/wasi-sdk size-attribution: name section drops out (anonymous `code[N]`) when built via `build-wasi-sdk.sh`

**Status:** mechanism **NOT isolated** (open) · impact **contained** via graceful degradation. Phase 1.3 Plan 1/3, Task 1.9.
**Discovered:** 2026-06-21 wiring cpp/wasi-sdk size attribution.
**Affected:** size-attribution path only — `benches/hashmap_string/cpp/build-wasi-sdk.sh` (`SIZE_ATTR=1` build) + `scripts/lib/size-attr-build.ts` (`attributeWasiSdk`). **Production `module.wasm` is unaffected** (smoke green, checksums intact). rust/raw attribution is unaffected (works: unattributed 0.1–2.2% on the exemplars).

---

## TL;DR

To attribute cpp size, we build a name-bearing `module.attr.wasm` (production flags minus `-Wl,--strip-all`, no `wasm-opt`) so `twiggy` can read + demangle the wasm `name` section. When that build runs **through `build-wasi-sdk.sh`** (via `pnpm build:cpp` or a direct `bash build-wasi-sdk.sh size <dir>`), the resulting `module.attr.wasm` has **anonymous `code[N]` functions and no usable "function names" subsection** → ~98% of bytes land in `unattributed`.

The **exact same clang argv**, captured from inside that script run and replayed in a **fresh standalone process**, produces a fully-demangled binary (`code[N]` count = 0, names like `dlmalloc`, `std::__2::__next_prime(unsigned long)`). So the argument vector is correct; something about the in-script execution context strips/suppresses the name section. Mechanism unresolved within budget.

## What was ruled OUT (each tested)

- **`-g`** — *makes it worse*, not the fix. With `-g`, clang emits DWARF (`.debug_*`, ~90% of the file) and the wasm "function names" subsection vanishes entirely. The attr build must **not** pass `-g`.
- **`wasm-opt`** — not the trigger. The `speed` profile runs no `wasm-opt` and still produces `code[N]`.
- **TMPDIR collision** — giving the attr build a fresh `TMPDIR` did not change the outcome in a `bash -c` repro.
- **`-flto` vs not, export set (5 vs 8), `$WARN_FLAGS` (incl. its backslash-newline continuations)** — all produce names when run standalone / via `bash -c`.
- **Args differing** — disproven: a clang wrapper captured the script's literal 40-arg argv; replaying it verbatim in a fresh process gives names.

## What reproduces / doesn't

| invocation | result |
|---|---|
| `pnpm build:cpp hashmap_string` → `dist/hashmap_string/cpp-wasi-sdk-*/module.attr.wasm` | `code[N]`, ~98% unattributed (4/4 runs) |
| `bash benches/hashmap_string/cpp/build-wasi-sdk.sh size <dir>` (with `SIZE_ATTR=1`) | `code[N]` (reproduces) |
| captured argv replayed in a fresh `bash -c` / standalone clang | demangled, `code[N]`=0 |
| hand-written `bash -c` doing prod-strip → wasm-opt → attr with identical flags | demangled, `code[N]`=0 (does **not** reproduce) |

The discriminating axis looks like "run as a script file vs a fresh standalone clang invocation," but a minimal `bash -c` reproduction of the *failure* was never constructed — so even that is not cleanly pinned. Likely confound: the investigation shell here is macOS `bash` 3.2 / zsh tooling (no `mapfile`; zsh does not word-split unquoted `$VAR`), which made several intermediate tests misleading before the argv-capture nailed down that the args are identical.

## Mitigation in place

`attributeWasiSdk` (`scripts/lib/size-attr-build.ts`) computes the composition and, if `unattributedShare > 0.5`, logs a warning and returns `null` — so `meta.json` carries `composition: null` (section-only) instead of a meaningless ~98%-unattributed breakdown. The build script keeps a flat (non-function) attr clang invocation and an explicit "do not add `-g`" note.

## Repro (deterministic)

```bash
pnpm build:cpp hashmap_string   # SIZE_ATTR=1 is set by build-cpp.ts buildWasiSdk
twiggy top -f json -n 2000 dist/hashmap_string/cpp-wasi-sdk-size/module.attr.wasm \
  | python3 -c 'import json,sys; r=json.load(sys.stdin); print(sum(1 for x in r if x["name"].startswith("code[")))'
# prints a nonzero count (anonymous functions) → name section unusable
```

## Open questions for whoever picks this up

1. Replace the clang wrapper experiment with one that diffs the *environment* (not just argv) between the failing in-script call and the passing standalone call (`env`, `PWD`, open fds, `umask`).
2. Try `wasm-ld`-level flags that force-keep the name section (`--keep-section=name`?) or a post-link `wasm-tools`/`llvm-objcopy` step that re-derives names, sidestepping the build-context fragility entirely.
3. Confirm whether emscripten (other cpp toolchain) has the same fragility — its name survival was never probed (Phase 1.3 open-loop).
