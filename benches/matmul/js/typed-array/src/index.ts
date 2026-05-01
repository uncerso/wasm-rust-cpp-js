// Typed-array optimised JS: views directly into f64 buffers. This is the
// strong baseline; matches what a Wasm port would do internally.

interface BenchModule {
  loadInput(input: Uint8Array): void;
  run(iterations: number): { checksum: number };
  readOutput(): Float64Array;
  reset(): void;
}

export default function create(): BenchModule {
  let n = 0;
  let A = new Float64Array();
  let B = new Float64Array();
  let C = new Float64Array();

  return {
    loadInput(input: Uint8Array) {
      const totalF64 = input.byteLength / 8;
      const half = totalF64 / 2;
      n = Math.round(Math.sqrt(half));
      if (n * n !== half) throw new Error(`matmul: half=${half} not a perfect square`);
      const copy = new ArrayBuffer(input.byteLength);
      new Uint8Array(copy).set(input);
      const f = new Float64Array(copy);
      A = f.subarray(0, n * n);
      B = f.subarray(n * n, 2 * n * n);
      C = new Float64Array(n * n);
    },

    run(iterations: number): { checksum: number } {
      let last = 0;
      for (let it = 0; it < iterations; it++) {
        C.fill(0);
        for (let i = 0; i < n; i++) {
          const aRow = i * n;
          const cRow = i * n;
          for (let k = 0; k < n; k++) {
            const a = A[aRow + k];
            const bRow = k * n;
            for (let j = 0; j < n; j++) {
              C[cRow + j] += a * B[bRow + j];
            }
          }
        }
        last = 0;
        for (let i = 0; i < C.length; i++) last += Math.abs(C[i]);
      }
      return { checksum: last };
    },

    readOutput(): Float64Array { return C.slice(); },
    reset() { C.fill(0); },
  };
}
