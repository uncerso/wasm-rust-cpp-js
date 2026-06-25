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

# Mostly freestanding build: -nostdlib avoids pulling wasi-libc startup,
# malloc, etc.; we link only the math/builtin objects we actually need.
#
# Placement-new is declared inline in main.cpp (no <new> header freestanding).
# Memory copy uses __builtin_memcpy lowered to wasm memory.copy under
# -mbulk-memory.
#
# wasi-sdk-25 places `log` (and other libm symbols) inside libc.a (musl's
# libm is merged into libc); the empty libm.a is a historical stub. We pass
# libc.a explicitly so __builtin_log resolves to musl's bit-exact log and
# the wasm has no env-imported math (which would crash in raw-wasm loader).
# libclang_rt.builtins-wasm32.a provides compiler-rt helpers (e.g.
# __extendhfsf2) that musl log may reference under -flto.
WASI_LIBC="$WASI_SDK_PATH/share/wasi-sysroot/lib/wasm32-wasi/libc.a"
WASI_BUILTINS="$WASI_SDK_PATH/lib/clang/19/lib/wasi/libclang_rt.builtins-wasm32.a"

# Production: prepend PROD_PATH (.tools/bin) so the wasi-sdk clang -flto driver auto-finds
# wasm-opt and runs it post-link — reproduces the size/perf baseline measured since Phase 1.1.
# The SIZE_ATTR clang++ below runs WITHOUT PROD_PATH (clean PATH) so the name section survives.
PATH="${PROD_PATH:+$PROD_PATH:}$PATH" "$WASI_SDK_PATH/bin/clang++" \
  --target=wasm32-wasi \
  $STD_FLAG \
  $WARN_FLAGS \
  -nostdlib \
  $OPT \
  -fno-exceptions -fno-rtti \
  -fvisibility=hidden \
  -mbulk-memory \
  "$HERE/src/main.cpp" \
  "$WASI_LIBC" \
  "$WASI_BUILTINS" \
  -Wl,--no-entry \
  -Wl,--export=alloc -Wl,--export=load_input \
  -Wl,--export=shape_dispatch_homo_dyn \
  -Wl,--export=reset \
  -Wl,--export=memory \
  -Wl,--allow-undefined \
  -Wl,--strip-all \
  -o "$OUT_DIR/module.wasm"

if [[ "$PROFILE" == "size" ]]; then
  "${WASM_OPT:-wasm-opt}" -Oz \
    --enable-bulk-memory \
    --enable-nontrapping-float-to-int \
    "$OUT_DIR/module.wasm" -o "$OUT_DIR/module.wasm"
fi

# Name-bearing build for size attribution (opt-in via SIZE_ATTR=1). Same flags as the
# production build but WITHOUT -Wl,--strip-all (and no wasm-opt) so wasm-ld keeps the
# "function names" subsection; twiggy reads + demangles it. Never touches module.wasm.
#
# This attr build keeps names because build-cpp.ts runs us WITHOUT wasm-opt on PATH —
# otherwise wasi-sdk clang -flto auto-runs wasm-opt at link and strips the name section
# (the real root cause, see docs/pitfalls/2026-06-25-cpp-wasi-sdk-name-section-env-diff.md).
# Do NOT add -g either: DWARF also suppresses the name subsection.
if [[ "${SIZE_ATTR:-0}" == "1" ]]; then
  mkdir -p "${ATTR_OUT:-$OUT_DIR}"
  "$WASI_SDK_PATH/bin/clang++" \
    --target=wasm32-wasi \
    $STD_FLAG \
    $WARN_FLAGS \
    -nostdlib \
    $OPT \
    -fno-exceptions -fno-rtti \
    -fvisibility=hidden \
    -mbulk-memory \
    "$HERE/src/main.cpp" \
    "$WASI_LIBC" \
    "$WASI_BUILTINS" \
    -Wl,--no-entry \
    -Wl,--export=alloc -Wl,--export=load_input \
    -Wl,--export=shape_dispatch_homo_dyn \
    -Wl,--export=reset \
    -Wl,--export=memory \
    -Wl,--allow-undefined \
    -o "${ATTR_OUT:-$OUT_DIR}/module.attr.wasm"
fi
