import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function matmul(n: number, A: Float64Array, B: Float64Array, C: Float64Array): void {
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const a = A[i * n + k]!;
      for (let j = 0; j < n; j++) C[i * n + j]! += a * B[k * n + j]!;
    }
  }
}

function sumAbs(arr: Float64Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += Math.abs(arr[i]!);
  return s;
}

const SIZES = { S: 64, M: 256, L: 1024 } as const;

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturesDir = join(here, "..", "fixtures");
  const out: Record<string, number> = {};
  for (const [size, n] of Object.entries(SIZES) as [keyof typeof SIZES, number][]) {
    const buf = await readFile(join(fixturesDir, `${size.toLowerCase()}.bin`));
    const f = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
    const A = f.subarray(0, n * n);
    const B = f.subarray(n * n, 2 * n * n);
    const C = new Float64Array(n * n);
    matmul(n, A, B, C);
    out[size] = sumAbs(C);
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
