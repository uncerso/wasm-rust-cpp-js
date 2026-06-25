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

# Production: prepend PROD_PATH (.tools/bin) so the wasi-sdk clang -flto driver auto-finds
# wasm-opt and runs it post-link — reproduces the size/perf baseline measured since Phase 1.1.
# The SIZE_ATTR clang++ below runs WITHOUT PROD_PATH (clean PATH) so the name section survives.
PATH="${PROD_PATH:+$PROD_PATH:}$PATH" "$WASI_SDK_PATH/bin/clang++" \
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

if [[ "$PROFILE" == "size" ]]; then
  "${WASM_OPT:-wasm-opt}" -Oz "$OUT_DIR/module.wasm" -o "$OUT_DIR/module.wasm"
fi

# Name-bearing build for size attribution (opt-in via SIZE_ATTR=1). Same flags as the
# production build but WITHOUT -Wl,--strip-all (and no wasm-opt) so wasm-ld keeps the
# "function names" subsection; twiggy reads + demangles it. Never touches module.wasm.
#
# This attr build keeps names because build-cpp.ts runs us WITHOUT wasm-opt on PATH —
# otherwise wasi-sdk clang -flto auto-runs wasm-opt at link and strips the name section
# (the real root cause, see docs/pitfalls/2026-06-25-cpp-wasi-sdk-name-section-env-diff.md).
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
