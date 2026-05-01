# matmul workload

Naive `C = A * B` for square dense `f64` matrices, row-major. Sizes S=64, M=256, L=1024.

## I/O contract

The harness allocates one buffer in linear memory holding A then B (`2*n*n` f64s).
The bench module exposes:

- `alloc(size: i32) -> i32` — bump allocation; returns ptr
- `load_input(ptr: i32, len: i32) -> void` — receives fixture bytes
- `run(iters: i32) -> f64` — runs matmul `iters` times, returns `sum(abs(C))` of the LAST iteration
- `output_ptr() -> i32`, `output_len() -> i32` — point into linear memory at C
- `reset() -> void` — for stateful runs (no-op here)

For wasm-bindgen / Emscripten the same operations are exposed via their conventions (see `loaders/`).

## Determinism

Inputs are generated with a Mulberry32 PRNG seeded from `0xC0FFEE_0{1..3}`. Re-running `fixtures/generate.ts` reproduces them bit-for-bit.

The expected output checksum is `sum(|C[i,j]|)` over all `n*n` cells of the result.
