import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Mulberry32 PRNG — simple, deterministic, no deps.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildFixture(n: number, seed: number): Uint8Array {
  const rng = mulberry32(seed);
  const total = 2 * n * n;
  const f = new Float64Array(total);
  for (let i = 0; i < total; i++) f[i] = rng() * 2 - 1;
  return new Uint8Array(f.buffer);
}

const SIZES = { S: 64, M: 256, L: 1024 } as const;
const SEEDS = { S: 0xC0FFEE_01, M: 0xC0FFEE_02, L: 0xC0FFEE_03 } as const;

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  await mkdir(here, { recursive: true });

  const result: Record<string, { bytes: number; sha256: string }> = {};
  for (const [size, n] of Object.entries(SIZES) as [keyof typeof SIZES, number][]) {
    const buf = buildFixture(n, SEEDS[size]);
    const path = join(here, `${size.toLowerCase()}.bin`);
    await writeFile(path, buf);
    const sha = createHash("sha256").update(buf).digest("hex");
    result[size] = { bytes: buf.byteLength, sha256: sha };
    console.log(`${size}: n=${n} bytes=${buf.byteLength} sha256=${sha}`);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
