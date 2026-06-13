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
