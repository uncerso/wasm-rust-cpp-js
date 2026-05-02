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

# Freestanding build: we don't link wasi-libc; matmul uses no heap and only
# computes math via libcalls (sqrt/fabs) which we provide via builtins.
"$WASI_SDK_PATH/bin/clang++" \
  --target=wasm32 \
  -nostdlib \
  $OPT \
  -fno-exceptions -fno-rtti \
  -fvisibility=hidden \
  -mbulk-memory \
  "$HERE/src/matmul.cpp" \
  -Wl,--no-entry \
  -Wl,--export=alloc -Wl,--export=load_input -Wl,--export=run \
  -Wl,--export=output_ptr -Wl,--export=output_len -Wl,--export=reset \
  -Wl,--export=memory \
  -Wl,--allow-undefined \
  -Wl,--strip-all \
  -o "$OUT_DIR/module.wasm"

if [[ "$PROFILE" == "size" ]]; then
  wasm-opt -Oz "$OUT_DIR/module.wasm" -o "$OUT_DIR/module.wasm"
fi
