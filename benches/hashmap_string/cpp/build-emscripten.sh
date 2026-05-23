#!/usr/bin/env bash
set -euo pipefail

# Args: $1 = profile (speed|size), $2 = output dir
PROFILE="$1"
OUT_DIR="$2"
mkdir -p "$OUT_DIR"
HERE="$(cd "$(dirname "$0")" && pwd)"

EXPORTS='["_alloc","_load_input","_hashmap_string_insert","_hashmap_string_insert_reset","_hashmap_string_lookup","_hashmap_string_lookup_reset","_hashmap_string_delete","_hashmap_string_delete_reset"]'
RT_METHODS='["HEAPU8","wasmMemory"]'

if [[ "$PROFILE" == "speed" ]]; then
  OPT="-O3 -flto"
elif [[ "$PROFILE" == "size" ]]; then
  OPT="-Oz -flto --closure 1"
else
  echo "unknown profile: $PROFILE" >&2; exit 1
fi

WARN_FLAGS="-Wall -Wextra -Wpedantic -Werror \
-Wshadow -Wconversion -Wsign-conversion \
-Wcast-align -Wold-style-cast -Wnon-virtual-dtor \
-Wnull-dereference -Wdouble-promotion"

STD_FLAG="-std=c++23"

emcc \
  "$HERE/src/hashmap_string.cpp" \
  $STD_FLAG \
  $WARN_FLAGS \
  $OPT \
  -fno-rtti \
  -s MODULARIZE=1 -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web,worker,node \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=67108864 \
  -s "EXPORTED_FUNCTIONS=$EXPORTS" \
  -s "EXPORTED_RUNTIME_METHODS=$RT_METHODS" \
  -o "$OUT_DIR/glue.mjs"

# Apply wasm-opt -Oz on size profile (in addition to closure).
if [[ "$PROFILE" == "size" ]]; then
  wasm-opt -Oz \
    --enable-bulk-memory \
    --enable-nontrapping-float-to-int \
    "$OUT_DIR/glue.wasm" -o "$OUT_DIR/glue.wasm"
fi
