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

# Unlike the freestanding workloads, sorted_map needs a heap (std::map nodes)
# and libc++. Link libc++/libc++abi/libc + builtins statically in
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
  "$HERE/src/sorted_map_int.cpp" \
  "$HERE/src/wasi-shims.cpp" \
  "$SYSROOT_LIB/libc++.a" \
  "$SYSROOT_LIB/libc++abi.a" \
  "$SYSROOT_LIB/libc.a" \
  "$WASI_BUILTINS" \
  -Wl,--no-entry \
  -Wl,--export=alloc -Wl,--export=load_input \
  -Wl,--export=sorted_map_int_build -Wl,--export=sorted_map_int_build_reset \
  -Wl,--export=sorted_map_int_lookup -Wl,--export=sorted_map_int_lookup_reset \
  -Wl,--export=sorted_map_int_range -Wl,--export=sorted_map_int_range_reset \
  -Wl,--export-memory \
  -Wl,--strip-all \
  -o "$OUT_DIR/module.wasm"


# Name-bearing build for size attribution (opt-in via SIZE_ATTR=1). Same flags as the
# production build but WITHOUT -Wl,--strip-all (and no wasm-opt) so wasm-ld keeps the
# "function names" subsection; twiggy reads + demangles it. Never touches module.wasm.
#
# This attr build keeps names because no wasm-opt ever touches it: build-cpp.ts runs the
# shell with an empty PATH (so the -flto driver can't auto-find wasm-opt) and the explicit
# wasm-opt pass runs only on module.wasm in build-cpp.ts, never on module.attr.wasm.
if [[ "${SIZE_ATTR:-0}" == "1" ]]; then
  mkdir -p "${ATTR_OUT:-$OUT_DIR}"
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
    "$HERE/src/sorted_map_int.cpp" \
    "$HERE/src/wasi-shims.cpp" \
    "$SYSROOT_LIB/libc++.a" \
    "$SYSROOT_LIB/libc++abi.a" \
    "$SYSROOT_LIB/libc.a" \
    "$WASI_BUILTINS" \
    -Wl,--no-entry \
    -Wl,--export=alloc -Wl,--export=load_input \
    -Wl,--export=sorted_map_int_build -Wl,--export=sorted_map_int_build_reset \
    -Wl,--export=sorted_map_int_lookup -Wl,--export=sorted_map_int_lookup_reset \
    -Wl,--export=sorted_map_int_range -Wl,--export=sorted_map_int_range_reset \
    -Wl,--export-memory \
    -o "${ATTR_OUT:-$OUT_DIR}/module.attr.wasm"
fi
