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

# Freestanding build: no wasi-libc; matmul uses no heap and only
# computes math via libcalls (sqrt/fabs) which we provide via builtins.

"$WASI_SDK_PATH/bin/clang++" \
  --target=wasm32 \
  $STD_FLAG \
  $WARN_FLAGS \
  -nostdlib \
  $OPT \
  -fno-exceptions -fno-rtti \
  -fvisibility=hidden \
  -mbulk-memory \
  "$HERE/src/matmul.cpp" \
  -Wl,--no-entry \
  -Wl,--export=alloc -Wl,--export=load_input -Wl,--export=matmul \
  -Wl,--export=output_ptr -Wl,--export=output_len -Wl,--export=reset \
  -Wl,--export=memory \
  -Wl,--allow-undefined \
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
    --target=wasm32 \
    $STD_FLAG \
    $WARN_FLAGS \
    -nostdlib \
    $OPT \
    -fno-exceptions -fno-rtti \
    -fvisibility=hidden \
    -mbulk-memory \
    "$HERE/src/matmul.cpp" \
    -Wl,--no-entry \
    -Wl,--export=alloc -Wl,--export=load_input -Wl,--export=matmul \
    -Wl,--export=output_ptr -Wl,--export=output_len -Wl,--export=reset \
    -Wl,--export=memory \
    -Wl,--allow-undefined \
    -o "${ATTR_OUT:-$OUT_DIR}/module.attr.wasm"
fi
