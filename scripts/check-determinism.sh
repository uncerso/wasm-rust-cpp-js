#!/usr/bin/env bash
set -euo pipefail
# Build one wasi-sdk workload twice — once clean, once with a decoy `wasm-opt`
# earlier on PATH — and assert the production wasm is byte-identical. This proves
# the ambient PATH no longer influences artifacts (the heisenbug that motivated
# build-hygiene). Run with the sandbox disabled (tsx binds a socket).
W="${1:-matmul}"
ART="dist/$W/cpp-wasi-sdk-speed/module.wasm"
DECOY="$(mktemp -d)"
printf '#!/bin/sh\necho "decoy wasm-opt should never run" >&2\nexit 3\n' > "$DECOY/wasm-opt"
chmod +x "$DECOY/wasm-opt"

pnpm exec tsx scripts/build-cpp.ts "$W" >/dev/null
CLEAN="$(mktemp)"; cp "$ART" "$CLEAN"

PATH="$DECOY:$PATH" pnpm exec tsx scripts/build-cpp.ts "$W" >/dev/null

if cmp -s "$CLEAN" "$ART"; then
  echo "determinism OK: $W production wasm unaffected by decoy wasm-opt on PATH"
else
  echo "DETERMINISM FAIL: $W production wasm changed with decoy wasm-opt on PATH" >&2
  exit 1
fi
