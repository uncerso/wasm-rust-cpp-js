# Phase 1.1.2 hashmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hashmap workload (2 binaries × 3 entries × 3 sizes × 3 toolchains = 108 measurement cases) + extract `benches/common/fixtures.ts` as rule-of-three refactor, producing ≥1 confirmed claim in `docs/guidelines.md`.

**Architecture:** Two wasm binaries (`hashmap_string`, `hashmap_int`) with per-entry reset companion exports (`<entry>_reset`). Loader contract extended to bind per-entry reset, falling back to generic. Common PRNG + 3 generators extracted into `benches/common/fixtures.ts`; matmul fixture bytes preserved byte-for-byte. Three waves: W1 infra+spec (Tasks 1-13), W2 impls (Tasks 14-21), W3 bench+close (Tasks 22-27).

**Tech Stack:** TypeScript (ESM, esbuild), Rust 1.95.0 (wasm-bindgen, std HashMap), C++23 (Emscripten, libc++ unordered_map), pnpm workspaces, vitest, zod.

**Spec:** [`docs/superpowers/specs/2026-05-23-phase-1-1-2-hashmap-design.md`](../specs/2026-05-23-phase-1-1-2-hashmap-design.md)

---

## Wave 0 — Pre-flight

### Task 0: Verify master gates green

**Files:** none (verification only)

- [ ] **Step 1: Run typecheck + lint + test**

Run: `pnpm typecheck && pnpm lint:all && pnpm test`
Expected: all exit 0. lint warnings допустимы (12 known no-console warnings в reference.ts); errors недопустимы.

- [ ] **Step 2: Run smoke**

Run: `pnpm smoke` (требует `dangerouslyDisableSandbox: true` per CLAUDE.md tsx-sandbox note)
Expected: exit 0; все cases `validated: true`.

- [ ] **Step 3: Verify clean working tree**

Run: `git status`
Expected: branch master, in sync with origin/master; untracked `.claude/settings.local.json` + `Какие есть существующие бенчмарки wasm под браузер.md` OK; no other untracked/modified.

If gates red — STOP. Surface to user before proceeding. Не маскировать через out-of-scope lint:fix commit (per CLAUDE.md "Plan executor protocol").

---

## Wave 1 — Infrastructure + spec

### Task 1: Create `benches/common/fixtures.ts` with mulberry32

**Files:**
- Create: `benches/common/fixtures.ts`
- Create: `benches/common/fixtures.test.ts`

- [ ] **Step 1: Write failing test for mulberry32 determinism**

Create `benches/common/fixtures.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mulberry32 } from "./fixtures.js";

describe("mulberry32", () => {
    it("produces deterministic sequence for given seed", () => {
        const rng = mulberry32(0xC0FFEE_01);
        const first3 = [rng(), rng(), rng()];
        // Golden values — captured from running matmul's existing mulberry32 with seed 0xC0FFEE_01.
        // Will be filled in step 3 after implementation, after running once to capture actual values.
        expect(first3).toEqual([0, 0, 0]); // PLACEHOLDER — will fail
    });

    it("different seeds produce different sequences", () => {
        const a = mulberry32(1);
        const b = mulberry32(2);
        expect(a()).not.toEqual(b());
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bench/harness exec vitest run benches/common/fixtures.test.ts` — actually this won't work, we need to run from root or set up package. Use root instead:

Run from root: `pnpm exec vitest run benches/common/fixtures.test.ts`
Expected: FAIL with "Cannot find module" (file doesn't exist).

- [ ] **Step 3: Create `benches/common/fixtures.ts` with mulberry32**

Create `benches/common/fixtures.ts`:

```ts
export function mulberry32(seed: number): () => number {
    let t = seed >>> 0;
    return () => {
        t = (t + 0x6D2B79F5) >>> 0;
        let r = t;
        r = Math.imul(r ^ (r >>> 15), r | 1);
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}
```

- [ ] **Step 4: Capture golden values for mulberry32 test**

Run: `pnpm exec tsx -e 'import {mulberry32} from "./benches/common/fixtures.ts"; const r = mulberry32(0xC0FFEE_01); console.log(JSON.stringify([r(), r(), r()]));'`
Expected: prints `[<val1>, <val2>, <val3>]` (3 float numbers in [0, 1)).

Copy those values into the test file's `expect(first3).toEqual([...])` placeholder.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run benches/common/fixtures.test.ts`
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add benches/common/fixtures.ts benches/common/fixtures.test.ts
git commit --no-gpg-sign -m "feat(common/fixtures): mulberry32 PRNG, lifted from matmul"
```

---

### Task 2: Add `genF64Array` (byte-preserving for matmul)

**Files:**
- Modify: `benches/common/fixtures.ts`
- Modify: `benches/common/fixtures.test.ts`

- [ ] **Step 1: Write failing test for genF64Array SHA256 snapshot**

Add to `benches/common/fixtures.test.ts`:

```ts
import { createHash } from "node:crypto";
import { genF64Array } from "./fixtures.js";

describe("genF64Array", () => {
    it("produces byte-identical fixture for known (n, seed) — matmul S precedent", () => {
        // n=64, seed=0xC0FFEE_01 matches matmul S — SHA256 must equal existing
        // value in benches/matmul/spec.json (defends against silent drift).
        const buf = genF64Array(64, 0xC0FFEE_01);
        const sha = createHash("sha256").update(buf).digest("hex");
        // Will fill in step 3 — capture by running once.
        expect(sha).toBe("PLACEHOLDER"); // will fail
    });

    it("output size == 2n² × 8 bytes", () => {
        expect(genF64Array(4, 1).byteLength).toBe(2 * 4 * 4 * 8);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run benches/common/fixtures.test.ts`
Expected: 1 test passes (size); 1 fails (placeholder).

- [ ] **Step 3: Add genF64Array to fixtures.ts**

Append to `benches/common/fixtures.ts`:

```ts
export function genF64Array(n: number, seed: number): Uint8Array {
    const rng = mulberry32(seed);
    const total = 2 * n * n;
    const f = new Float64Array(total);
    for (let i = 0; i < total; i++) {
        f[i] = rng() * 2 - 1;
    }
    return new Uint8Array(f.buffer);
}
```

This is byte-for-byte the same algorithm as matmul's `buildFixture` (line 18-24 of `benches/matmul/fixtures/generate.ts`).

- [ ] **Step 4: Capture SHA256 golden value**

Run: `pnpm exec tsx -e 'import {genF64Array} from "./benches/common/fixtures.ts"; import {createHash} from "node:crypto"; const buf = genF64Array(64, 0xC0FFEE_01); console.log(createHash("sha256").update(buf).digest("hex"));'`
Expected: prints SHA256 hex string.

Copy that value into test placeholder.

- [ ] **Step 5: Sanity check against matmul spec.json**

Run: `grep -A 1 '"S"' benches/matmul/spec.json | head -10`
Expected: shows matmul's existing `fixtureSha256` for S. The hex you captured in Step 4 MUST equal it. If not — byte-preservation violation, fix `genF64Array` before continuing.

- [ ] **Step 6: Run test**

Run: `pnpm exec vitest run benches/common/fixtures.test.ts`
Expected: 4 tests pass (2 mulberry32 + 2 genF64Array).

- [ ] **Step 7: Commit**

```bash
git add benches/common/fixtures.ts benches/common/fixtures.test.ts
git commit --no-gpg-sign -m "feat(common/fixtures): genF64Array (byte-preserving for matmul)"
```

---

### Task 3: Refactor matmul fixtures/generate.ts to use common

**Files:**
- Modify: `benches/matmul/fixtures/generate.ts`

- [ ] **Step 1: Replace matmul's buildFixture with import**

Modify `benches/matmul/fixtures/generate.ts` to:

```ts
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { genF64Array } from "../../common/fixtures.js";

const SIZES = { S: 64, M: 256, L: 1024 } as const;
const SEEDS = { S: 0xC0FFEE_01, M: 0xC0FFEE_02, L: 0xC0FFEE_03 } as const;

async function main() {
    const here = dirname(fileURLToPath(import.meta.url));
    await mkdir(here, { recursive: true });

    const result: Record<string, { bytes: number; sha256: string }> = {};
    for (const [size, n] of Object.entries(SIZES) as [keyof typeof SIZES, number][]) {
        const buf = genF64Array(n, SEEDS[size]);
        const path = join(here, `${size.toLowerCase()}.bin`);
        await writeFile(path, buf);
        const sha = createHash("sha256").update(buf).digest("hex");
        result[size] = { bytes: buf.byteLength, sha256: sha };
        console.log(`${size}: n=${n} bytes=${buf.byteLength} sha256=${sha}`);
    }
    console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run pnpm fixtures and capture output**

Run: `pnpm fixtures`
Expected: writes 3 fixture files for matmul (and others), prints SHA256 per size. The SHA256 for matmul S/M/L MUST match existing values in `benches/matmul/spec.json`.

- [ ] **Step 3: Diff against spec.json**

Run: `grep "fixtureSha256" benches/matmul/spec.json`
Compare with output from Step 2. If any size differs — STOP, this is a byte-preserve violation (pitfall §P1 from `docs/pitfalls/2026-05-22-phase-1-1-1-w1.md`). Debug `genF64Array` before continuing.

- [ ] **Step 4: Verify smoke still passes**

Run: `pnpm smoke` (dangerouslyDisableSandbox)
Expected: all matmul cases `validated: true`. If any fails — fixture drift, fix.

- [ ] **Step 5: Commit**

```bash
git add benches/matmul/fixtures/generate.ts
git commit --no-gpg-sign -m "refactor(matmul/fixtures): use common genF64Array (byte-preserving)"
```

---

### Task 4: Add `genAsciiHexKeys` generator

**Files:**
- Modify: `benches/common/fixtures.ts`
- Modify: `benches/common/fixtures.test.ts`

- [ ] **Step 1: Write failing test**

Add to `benches/common/fixtures.test.ts`:

```ts
import { genAsciiHexKeys } from "./fixtures.js";

describe("genAsciiHexKeys", () => {
    it("output size == n × 24 bytes (16 ASCII + 8 LE u64)", () => {
        expect(genAsciiHexKeys(4, 1).byteLength).toBe(4 * 24);
    });

    it("keys are 16 lowercase hex chars", () => {
        const buf = genAsciiHexKeys(2, 1);
        const k0 = new TextDecoder().decode(buf.slice(0, 16));
        const k1 = new TextDecoder().decode(buf.slice(24, 40));
        expect(k0).toMatch(/^[0-9a-f]{16}$/);
        expect(k1).toMatch(/^[0-9a-f]{16}$/);
    });

    it("value u64 fits in [0, 2^32)", () => {
        const buf = genAsciiHexKeys(1, 1);
        const dv = new DataView(buf.buffer);
        const v = dv.getBigUint64(16, true);
        expect(v).toBeLessThan(1n << 32n);
    });

    it("SHA256 snapshot for (n=4, seed=0xDEAD_0001)", () => {
        const buf = genAsciiHexKeys(4, 0xDEAD_0001);
        const sha = createHash("sha256").update(buf).digest("hex");
        expect(sha).toBe("PLACEHOLDER"); // capture in step 3
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run benches/common/fixtures.test.ts`
Expected: 4 of 6 fail (genAsciiHexKeys not exported).

- [ ] **Step 3: Implement genAsciiHexKeys**

Append to `benches/common/fixtures.ts`:

```ts
const HEX = "0123456789abcdef";

export function genAsciiHexKeys(n: number, seed: number): Uint8Array {
    const rng = mulberry32(seed);
    const PAIR_BYTES = 24;
    const out = new Uint8Array(n * PAIR_BYTES);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < n; i++) {
        const base = i * PAIR_BYTES;
        // 16 hex chars: two u32 outputs from rng, each converted to 8 hex digits.
        const r1 = Math.floor(rng() * 0x100000000) >>> 0;
        const r2 = Math.floor(rng() * 0x100000000) >>> 0;
        for (let j = 0; j < 8; j++) {
            out[base + j] = HEX.charCodeAt((r1 >>> ((7 - j) * 4)) & 0xF);
            out[base + 8 + j] = HEX.charCodeAt((r2 >>> ((7 - j) * 4)) & 0xF);
        }
        // value u64 LE, in [0, 2^32).
        const v = Math.floor(rng() * 0x100000000);
        dv.setBigUint64(base + 16, BigInt(v), true);
    }
    return out;
}
```

- [ ] **Step 4: Capture SHA256 golden value**

Run: `pnpm exec tsx -e 'import {genAsciiHexKeys} from "./benches/common/fixtures.ts"; import {createHash} from "node:crypto"; console.log(createHash("sha256").update(genAsciiHexKeys(4, 0xDEAD_0001)).digest("hex"));'`
Expected: SHA256 hex string. Copy into test placeholder.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run benches/common/fixtures.test.ts`
Expected: all 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add benches/common/fixtures.ts benches/common/fixtures.test.ts
git commit --no-gpg-sign -m "feat(common/fixtures): genAsciiHexKeys for hashmap_string"
```

---

### Task 5: Add `genIntPairs53` generator

**Files:**
- Modify: `benches/common/fixtures.ts`
- Modify: `benches/common/fixtures.test.ts`

- [ ] **Step 1: Write failing test**

Add to `benches/common/fixtures.test.ts`:

```ts
import { genIntPairs53 } from "./fixtures.js";

describe("genIntPairs53", () => {
    it("output size == n × 16 bytes", () => {
        expect(genIntPairs53(4, 1).byteLength).toBe(4 * 16);
    });

    it("keys in [0, 2^53) — JS-safe range", () => {
        const buf = genIntPairs53(10, 1);
        const dv = new DataView(buf.buffer);
        for (let i = 0; i < 10; i++) {
            const k = dv.getBigUint64(i * 16, true);
            expect(k).toBeLessThan(1n << 53n);
        }
    });

    it("values in [0, 2^32)", () => {
        const buf = genIntPairs53(10, 1);
        const dv = new DataView(buf.buffer);
        for (let i = 0; i < 10; i++) {
            const v = dv.getBigUint64(i * 16 + 8, true);
            expect(v).toBeLessThan(1n << 32n);
        }
    });

    it("SHA256 snapshot for (n=4, seed=0xBEEF_0001)", () => {
        const sha = createHash("sha256").update(genIntPairs53(4, 0xBEEF_0001)).digest("hex");
        expect(sha).toBe("PLACEHOLDER");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run benches/common/fixtures.test.ts`
Expected: 4 new tests fail.

- [ ] **Step 3: Implement genIntPairs53**

Append to `benches/common/fixtures.ts`:

```ts
export function genIntPairs53(n: number, seed: number): Uint8Array {
    const rng = mulberry32(seed);
    const PAIR_BYTES = 16;
    const out = new Uint8Array(n * PAIR_BYTES);
    const dv = new DataView(out.buffer);
    const TWO_53 = 0x20000000000000; // 2^53
    const TWO_32 = 0x100000000;       // 2^32
    for (let i = 0; i < n; i++) {
        const k = Math.floor(rng() * TWO_53);   // [0, 2^53)
        const v = Math.floor(rng() * TWO_32);   // [0, 2^32)
        dv.setBigUint64(i * PAIR_BYTES,     BigInt(k), true);
        dv.setBigUint64(i * PAIR_BYTES + 8, BigInt(v), true);
    }
    return out;
}
```

- [ ] **Step 4: Capture SHA256 golden value**

Run: `pnpm exec tsx -e 'import {genIntPairs53} from "./benches/common/fixtures.ts"; import {createHash} from "node:crypto"; console.log(createHash("sha256").update(genIntPairs53(4, 0xBEEF_0001)).digest("hex"));'`
Expected: SHA256 hex string. Copy into test placeholder.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run benches/common/fixtures.test.ts`
Expected: all 11 tests pass.

- [ ] **Step 6: Commit**

```bash
git add benches/common/fixtures.ts benches/common/fixtures.test.ts
git commit --no-gpg-sign -m "feat(common/fixtures): genIntPairs53 for hashmap_int"
```

---

### Task 6: Update tsconfig.json + verify ESLint coverage

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Inspect current tsconfig include**

Run: `grep -A 3 '"include"' tsconfig.json`
Expected: see `"benches/*/validate/**/*"` (from P2 generalization).

- [ ] **Step 2: Add `benches/common/**/*` to include**

Modify `tsconfig.json` — extend the `include` array to also contain `"benches/common/**/*"`.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: exit 0; common/fixtures.ts now type-checked.

- [ ] **Step 4: Run lint**

Run: `pnpm lint:ts`
Expected: exit 0; no parse errors on common/. Existing 12 warnings allowed; no new errors.

- [ ] **Step 5: Commit**

```bash
git add tsconfig.json
git commit --no-gpg-sign -m "chore(tsconfig): include benches/common/** for common/fixtures.ts"
```

---

### Task 7: Create `benches/hashmap_string/spec.json` skeleton

**Files:**
- Create: `benches/hashmap_string/spec.json`

- [ ] **Step 1: Write spec.json with placeholders**

Create `benches/hashmap_string/spec.json`:

```json
{
    "id": "hashmap_string",
    "version": 2,
    "description": "stdlib hashmap workload with 16-byte ASCII hex keys. 3 entry points (insert/lookup/delete) exercise std HashMap/unordered_map/Map. Iter-dependent checksums; per-entry reset companion exports manage state.",
    "entries": ["hashmap_string_insert", "hashmap_string_lookup", "hashmap_string_delete"],
    "inputSizes": {
        "S": { "fixtureBytes": 0, "fixtureSha256": "TBD", "innerIterations": 1000 },
        "M": { "fixtureBytes": 0, "fixtureSha256": "TBD", "innerIterations": 10000 },
        "L": { "fixtureBytes": 0, "fixtureSha256": "TBD", "innerIterations": 100000 }
    },
    "expectedChecksums": {
        "hashmap_string_insert": { "S": 0, "M": 0, "L": 0 },
        "hashmap_string_lookup": { "S": 0, "M": 0, "L": 0 },
        "hashmap_string_delete": { "S": 0, "M": 0, "L": 0 }
    },
    "supported": {
        "languages": ["js", "rust", "cpp"],
        "toolchains": {
            "js": ["idiomatic"],
            "rust": ["bindgen"],
            "cpp": ["emscripten"]
        },
        "profiles": ["speed", "size"]
    },
    "ioContract": {
        "fixtureLayout": "N pairs of (16 ASCII lowercase hex key, u64_value_le); 24N bytes total. Keys uniform 64-bit hex; values in [0, 2^32) for JS-safe lookup sum.",
        "iterSemantics": "Iter-dependent. expectedChecksum валиден только для N = innerIterations[size].",
        "stateModel": "Map state persists between run() calls. Per-entry <entry>_reset: insert→clear; lookup→no-op; delete→clear+refill from stored pairs.",
        "outputLayout": "Single scalar checksum: insert→map.size(); lookup→Σ values; delete→Σ removed values."
    }
}
```

The TBD/0 placeholders will be filled by Tasks 8-9.

- [ ] **Step 2: Verify spec.json parses against zod schema**

Run: `pnpm typecheck` (zod validation happens at runtime, but typecheck ensures schema imports are valid)
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add benches/hashmap_string/spec.json
git commit --no-gpg-sign -m "feat(hashmap_string): spec.json skeleton (TBD checksums)"
```

---

### Task 8: Create `benches/hashmap_string/fixtures/generate.ts` + run

**Files:**
- Create: `benches/hashmap_string/fixtures/generate.ts`
- Modify: `benches/hashmap_string/spec.json` (fill fixtureBytes + fixtureSha256)

- [ ] **Step 1: Write fixture generator**

Create `benches/hashmap_string/fixtures/generate.ts`:

```ts
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { genAsciiHexKeys } from "../../common/fixtures.js";

const SIZES = { S: 1000, M: 10000, L: 100000 } as const;
const SEEDS = { S: 0xDEAD_0001, M: 0xDEAD_0002, L: 0xDEAD_0003 } as const;

async function main() {
    const here = dirname(fileURLToPath(import.meta.url));
    await mkdir(here, { recursive: true });

    const result: Record<string, { bytes: number; sha256: string }> = {};
    for (const [size, n] of Object.entries(SIZES) as [keyof typeof SIZES, number][]) {
        const buf = genAsciiHexKeys(n, SEEDS[size]);
        const path = join(here, `${size.toLowerCase()}.bin`);
        await writeFile(path, buf);
        const sha = createHash("sha256").update(buf).digest("hex");
        result[size] = { bytes: buf.byteLength, sha256: sha };
        console.log(`${size}: n=${n} bytes=${buf.byteLength} sha256=${sha}`);
    }
    console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add `.gitignore` for fixture files**

Create `benches/hashmap_string/fixtures/.gitignore`:

```
*.bin
```

- [ ] **Step 3: Run fixture generator**

Run: `pnpm exec tsx benches/hashmap_string/fixtures/generate.ts` (dangerouslyDisableSandbox)
Expected: writes s.bin (24KB) / m.bin (240KB) / l.bin (2.4MB) and prints per-size `{bytes, sha256}` JSON.

- [ ] **Step 4: Update spec.json with captured values**

Take the JSON output from Step 3 and fill `inputSizes.S/M/L.fixtureBytes` + `.fixtureSha256` in `benches/hashmap_string/spec.json`.

- [ ] **Step 5: Verify pnpm fixtures full run still works**

Run: `pnpm fixtures` (dangerouslyDisableSandbox)
Expected: writes matmul + interop_calls + hashmap_string fixtures; SHA256 per matmul still matches existing spec.json values.

- [ ] **Step 6: Commit**

```bash
git add benches/hashmap_string/fixtures/generate.ts benches/hashmap_string/fixtures/.gitignore benches/hashmap_string/spec.json
git commit --no-gpg-sign -m "feat(hashmap_string/fixtures): generator + fixtureSha256 in spec"
```

---

### Task 9: Create `benches/hashmap_string/validate/reference.ts` + capture expectedChecksums

**Files:**
- Create: `benches/hashmap_string/validate/reference.ts`
- Modify: `benches/hashmap_string/spec.json` (fill expectedChecksums)

- [ ] **Step 1: Write reference impl**

Create `benches/hashmap_string/validate/reference.ts`:

```ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = ["S", "M", "L"] as const;
const PAIR_BYTES = 24;

interface Pair { key: string; value: number; }

function parsePairs(buf: Uint8Array): Pair[] {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const n = buf.byteLength / PAIR_BYTES;
    const pairs: Pair[] = [];
    const decoder = new TextDecoder("ascii");
    for (let i = 0; i < n; i++) {
        const base = i * PAIR_BYTES;
        const key = decoder.decode(buf.subarray(base, base + 16));
        const value = Number(dv.getBigUint64(base + 16, true));
        pairs.push({ key, value });
    }
    return pairs;
}

function computeInsert(pairs: Pair[]): number {
    const map = new Map<string, number>();
    for (const { key, value } of pairs) {
        map.set(key, value);
    }
    return map.size;
}

function computeLookup(pairs: Pair[]): number {
    const map = new Map<string, number>();
    for (const { key, value } of pairs) { map.set(key, value); }
    let acc = 0;
    for (const { key } of pairs) {
        acc += map.get(key) ?? 0;
    }
    return acc;
}

function computeDelete(pairs: Pair[]): number {
    const map = new Map<string, number>();
    for (const { key, value } of pairs) { map.set(key, value); }
    let acc = 0;
    for (const { key } of pairs) {
        const v = map.get(key);
        if (v !== undefined) { acc += v; map.delete(key); }
    }
    return acc;
}

async function main(): Promise<void> {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixturesDir = join(here, "..", "fixtures");
    const report: Record<string, Record<string, number>> = {
        hashmap_string_insert: {},
        hashmap_string_lookup: {},
        hashmap_string_delete: {},
    };
    for (const size of SIZES) {
        const buf = await readFile(join(fixturesDir, `${size.toLowerCase()}.bin`));
        const pairs = parsePairs(new Uint8Array(buf));
        report["hashmap_string_insert"]![size] = computeInsert(pairs);
        report["hashmap_string_lookup"]![size] = computeLookup(pairs);
        report["hashmap_string_delete"]![size] = computeDelete(pairs);
    }
    console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run reference impl**

Run: `pnpm exec tsx benches/hashmap_string/validate/reference.ts` (dangerouslyDisableSandbox)
Expected: prints JSON with `{insert: {S, M, L}, lookup: {S, M, L}, delete: {S, M, L}}`. Insert checksums must equal N (1000/10000/100000). Lookup and delete checksums must be identical per size.

- [ ] **Step 3: Update spec.json expectedChecksums**

Copy JSON output from Step 2 into `benches/hashmap_string/spec.json` under `expectedChecksums`.

- [ ] **Step 4: Sanity check**

- `expectedChecksums.hashmap_string_insert.S` MUST equal 1000.
- `expectedChecksums.hashmap_string_lookup.S` MUST equal `expectedChecksums.hashmap_string_delete.S`.
- Same for M and L.

If these invariants fail — debug reference impl.

- [ ] **Step 5: Commit**

```bash
git add benches/hashmap_string/validate/reference.ts benches/hashmap_string/spec.json
git commit --no-gpg-sign -m "feat(hashmap_string/validate): reference impl + expectedChecksums"
```

---

### Task 10: Create `benches/hashmap_int/spec.json` skeleton

**Files:**
- Create: `benches/hashmap_int/spec.json`

Same structure as Task 7 but for hashmap_int.

- [ ] **Step 1: Write spec.json**

Create `benches/hashmap_int/spec.json`:

```json
{
    "id": "hashmap_int",
    "version": 2,
    "description": "stdlib hashmap workload with u64 keys (in [0, 2^53) for JS-safety). 3 entry points (insert/lookup/delete) exercise std HashMap/unordered_map/Map. Iter-dependent checksums; per-entry reset companion exports manage state.",
    "entries": ["hashmap_int_insert", "hashmap_int_lookup", "hashmap_int_delete"],
    "inputSizes": {
        "S": { "fixtureBytes": 0, "fixtureSha256": "TBD", "innerIterations": 1000 },
        "M": { "fixtureBytes": 0, "fixtureSha256": "TBD", "innerIterations": 10000 },
        "L": { "fixtureBytes": 0, "fixtureSha256": "TBD", "innerIterations": 100000 }
    },
    "expectedChecksums": {
        "hashmap_int_insert": { "S": 0, "M": 0, "L": 0 },
        "hashmap_int_lookup": { "S": 0, "M": 0, "L": 0 },
        "hashmap_int_delete": { "S": 0, "M": 0, "L": 0 }
    },
    "supported": {
        "languages": ["js", "rust", "cpp"],
        "toolchains": {
            "js": ["idiomatic"],
            "rust": ["bindgen"],
            "cpp": ["emscripten"]
        },
        "profiles": ["speed", "size"]
    },
    "ioContract": {
        "fixtureLayout": "N pairs of (u64_key_le ∈ [0, 2^53), u64_value_le ∈ [0, 2^32)); 16N bytes total. Keys constrained to JS-safe range; values constrained for JS-safe lookup sum.",
        "iterSemantics": "Iter-dependent. expectedChecksum валиден только для N = innerIterations[size].",
        "stateModel": "Map state persists between run() calls. Per-entry <entry>_reset: insert→clear; lookup→no-op; delete→clear+refill from stored pairs.",
        "outputLayout": "Single scalar checksum: insert→map.size(); lookup→Σ values; delete→Σ removed values."
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add benches/hashmap_int/spec.json
git commit --no-gpg-sign -m "feat(hashmap_int): spec.json skeleton (TBD checksums)"
```

---

### Task 11: Create `benches/hashmap_int/fixtures/generate.ts` + run

**Files:**
- Create: `benches/hashmap_int/fixtures/generate.ts`
- Create: `benches/hashmap_int/fixtures/.gitignore`
- Modify: `benches/hashmap_int/spec.json` (fill fixtureBytes + fixtureSha256)

- [ ] **Step 1: Write fixture generator**

Create `benches/hashmap_int/fixtures/generate.ts`:

```ts
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { genIntPairs53 } from "../../common/fixtures.js";

const SIZES = { S: 1000, M: 10000, L: 100000 } as const;
const SEEDS = { S: 0xBEEF_0001, M: 0xBEEF_0002, L: 0xBEEF_0003 } as const;

async function main() {
    const here = dirname(fileURLToPath(import.meta.url));
    await mkdir(here, { recursive: true });

    const result: Record<string, { bytes: number; sha256: string }> = {};
    for (const [size, n] of Object.entries(SIZES) as [keyof typeof SIZES, number][]) {
        const buf = genIntPairs53(n, SEEDS[size]);
        const path = join(here, `${size.toLowerCase()}.bin`);
        await writeFile(path, buf);
        const sha = createHash("sha256").update(buf).digest("hex");
        result[size] = { bytes: buf.byteLength, sha256: sha };
        console.log(`${size}: n=${n} bytes=${buf.byteLength} sha256=${sha}`);
    }
    console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add `.gitignore`**

Create `benches/hashmap_int/fixtures/.gitignore` with `*.bin`.

- [ ] **Step 3: Run generator**

Run: `pnpm exec tsx benches/hashmap_int/fixtures/generate.ts` (dangerouslyDisableSandbox)
Expected: writes s.bin (16KB) / m.bin (160KB) / l.bin (1.6MB).

- [ ] **Step 4: Update spec.json with captured values**

Fill `inputSizes.S/M/L.fixtureBytes` + `.fixtureSha256` from output.

- [ ] **Step 5: Commit**

```bash
git add benches/hashmap_int/fixtures/generate.ts benches/hashmap_int/fixtures/.gitignore benches/hashmap_int/spec.json
git commit --no-gpg-sign -m "feat(hashmap_int/fixtures): generator + fixtureSha256 in spec"
```

---

### Task 12: Create `benches/hashmap_int/validate/reference.ts`

**Files:**
- Create: `benches/hashmap_int/validate/reference.ts`
- Modify: `benches/hashmap_int/spec.json` (fill expectedChecksums)

- [ ] **Step 1: Write reference impl**

Create `benches/hashmap_int/validate/reference.ts`:

```ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = ["S", "M", "L"] as const;
const PAIR_BYTES = 16;

interface Pair { key: number; value: number; }

function parsePairs(buf: Uint8Array): Pair[] {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const n = buf.byteLength / PAIR_BYTES;
    const pairs: Pair[] = [];
    for (let i = 0; i < n; i++) {
        const base = i * PAIR_BYTES;
        const key = Number(dv.getBigUint64(base, true));
        const value = Number(dv.getBigUint64(base + 8, true));
        pairs.push({ key, value });
    }
    return pairs;
}

function computeInsert(pairs: Pair[]): number {
    const map = new Map<number, number>();
    for (const { key, value } of pairs) {
        map.set(key, value);
    }
    return map.size;
}

function computeLookup(pairs: Pair[]): number {
    const map = new Map<number, number>();
    for (const { key, value } of pairs) { map.set(key, value); }
    let acc = 0;
    for (const { key } of pairs) {
        acc += map.get(key) ?? 0;
    }
    return acc;
}

function computeDelete(pairs: Pair[]): number {
    const map = new Map<number, number>();
    for (const { key, value } of pairs) { map.set(key, value); }
    let acc = 0;
    for (const { key } of pairs) {
        const v = map.get(key);
        if (v !== undefined) { acc += v; map.delete(key); }
    }
    return acc;
}

async function main(): Promise<void> {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixturesDir = join(here, "..", "fixtures");
    const report: Record<string, Record<string, number>> = {
        hashmap_int_insert: {},
        hashmap_int_lookup: {},
        hashmap_int_delete: {},
    };
    for (const size of SIZES) {
        const buf = await readFile(join(fixturesDir, `${size.toLowerCase()}.bin`));
        const pairs = parsePairs(new Uint8Array(buf));
        report["hashmap_int_insert"]![size] = computeInsert(pairs);
        report["hashmap_int_lookup"]![size] = computeLookup(pairs);
        report["hashmap_int_delete"]![size] = computeDelete(pairs);
    }
    console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run**

Run: `pnpm exec tsx benches/hashmap_int/validate/reference.ts` (dangerouslyDisableSandbox)
Expected: JSON output. Sanity: insert checksums equal N; lookup == delete per size.

- [ ] **Step 3: Update spec.json expectedChecksums**

Copy JSON into `benches/hashmap_int/spec.json` `expectedChecksums`.

- [ ] **Step 4: Commit**

```bash
git add benches/hashmap_int/validate/reference.ts benches/hashmap_int/spec.json
git commit --no-gpg-sign -m "feat(hashmap_int/validate): reference impl + expectedChecksums"
```

---

### Task 13: Wave 1 close — verify gates

**Files:** none

- [ ] **Step 1: Run all gates**

Run: `pnpm typecheck && pnpm lint:all && pnpm test`
Expected: exit 0. test count growth: +11 from common/fixtures.test.ts (=32 total, was 21).

- [ ] **Step 2: Run smoke**

Run: `pnpm smoke` (dangerouslyDisableSandbox)
Expected: matmul + interop_calls smoke all `validated: true`. hashmap_* combos НЕ запускаются (no wasm impls yet), но smoke не должен падать на их отсутствии — `scripts/build-all.ts` build что-то нашёл из spec.json'ов, но wasm targets ещё нет → smoke может либо skip, либо fail. Verify behavior; если падает — выяснить, нужен ли guard в scripts/run-matrix.ts на наличие artifact'ов.

If smoke fails because of missing hashmap binaries — that's expected for end of Wave 1. Document in commit message that W2 will fix.

- [ ] **Step 3: Commit Wave 1 close marker (if no other changes needed)**

If Step 2 surfaced an issue requiring fix (e.g., script needs to skip missing targets), that fix is its own task. Otherwise Wave 1 is closed via prior commits.

---

## Wave 2 — Implementations

### Task 14: Loader changes — extract `bindReset` helper + 3 loaders use it

DRY refactor: binding logic для reset is now identical in all three loaders. Extract once, reuse, unit-test the helper directly.

**Files:**
- Create: `packages/loaders/src/bind-reset.ts`
- Create: `packages/loaders/tests/bind-reset.test.ts`
- Modify: `packages/loaders/src/raw-wasm.ts`
- Modify: `packages/loaders/src/rust-bindgen.ts`
- Modify: `packages/loaders/src/emscripten.ts`
- Modify: `packages/loaders/src/types.ts` (JSDoc only)

- [ ] **Step 1: Write failing tests for `bindReset` helper**

Create `packages/loaders/tests/bind-reset.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { bindReset } from "../src/bind-reset.js";

describe("bindReset", () => {
    it("returns per-entry reset companion when present", () => {
        const entryReset = vi.fn();
        const generic = vi.fn();
        const out = bindReset({ foo_reset: entryReset, reset: generic }, "foo");
        out?.();
        expect(entryReset).toHaveBeenCalledOnce();
        expect(generic).not.toHaveBeenCalled();
    });

    it("falls back to generic reset when no per-entry companion", () => {
        const generic = vi.fn();
        const out = bindReset({ reset: generic }, "foo");
        out?.();
        expect(generic).toHaveBeenCalledOnce();
    });

    it("returns undefined when neither present", () => {
        expect(bindReset({}, "foo")).toBeUndefined();
    });

    it("ignores non-function values at either lookup", () => {
        expect(bindReset({ foo_reset: "nope", reset: 42 }, "foo")).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bench/loaders exec vitest run tests/bind-reset.test.ts`
Expected: FAIL (`bind-reset.ts` not found).

- [ ] **Step 3: Implement `bindReset`**

Create `packages/loaders/src/bind-reset.ts`:

```ts
/**
 * Resolves the reset function for a BenchModule. Lookup order:
 *   1. `exports[<entry>_reset]` — per-entry companion (Phase 1.1.2+ workloads
 *      with entry-specific reset semantics, e.g. hashmap_string_insert_reset).
 *   2. `exports.reset` — generic reset (matmul/interop_calls precedent).
 * First match wins. Returns undefined if neither is a function.
 *
 * `exports` is wasm-module/glue-shaped: in raw-wasm it's `instance.exports`,
 * in rust-bindgen the glue module namespace, in emscripten the EmModule with
 * `_`-prefixed C-style exports. Callers pass the correctly-keyed object.
 */
export function bindReset(
    exports: Record<string, unknown>,
    entry: string,
): (() => void) | undefined {
    const perEntry = exports[`${entry}_reset`];
    if (typeof perEntry === "function") {
        return perEntry as () => void;
    }
    const generic = exports["reset"];
    if (typeof generic === "function") {
        return generic as () => void;
    }
    return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bench/loaders exec vitest run tests/bind-reset.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Update `raw-wasm.ts` to use helper**

In `packages/loaders/src/raw-wasm.ts`:

Add import near top (after existing imports):
```ts
import { bindReset } from "./bind-reset.js";
```

Replace `reset() { exports.reset?.(); }` block (around lines 105-107) with conditional `reset` spread. The original `module: BenchModule = { ... reset() { ... } }` becomes:

```ts
const resetFn = bindReset(exports as unknown as Record<string, unknown>, input.entry);
const module: BenchModule = {
    loadInput(buf: Uint8Array) {
        let ptr = 0;
        if (buf.byteLength > 0) {
            ptr = exports.alloc(buf.byteLength);
            new Uint8Array(memBuffer).set(buf, ptr);
        }
        exports.load_input(ptr, buf.byteLength);
    },
    run,
    ...(resetFn ? { reset: resetFn } : {}),
};
```

Note: previously `reset` was always present (calling optional `exports.reset?.()`); now it's conditionally spread to match the bindgen pattern. This is correct — `BenchModule.reset` is optional, and harness uses optional chain.

- [ ] **Step 6: Update `rust-bindgen.ts` to use helper**

In `packages/loaders/src/rust-bindgen.ts`, add import:
```ts
import { bindReset } from "./bind-reset.js";
```

Replace lines 101-106:
```ts
const resetFn = glue.reset;
const module: BenchModule = {
    loadInput: (buf: Uint8Array) => glue.load_input(buf),
    run,
    ...(resetFn ? { reset: () => resetFn() } : {}),
};
```

With:
```ts
const resetFn = bindReset(glue as unknown as Record<string, unknown>, input.entry);
const module: BenchModule = {
    loadInput: (buf: Uint8Array) => glue.load_input(buf),
    run,
    ...(resetFn ? { reset: resetFn } : {}),
};
```

- [ ] **Step 7: Update `emscripten.ts` to use helper**

Emscripten emits C functions with `_` prefix. Per-entry reset companion will be `inst["_<entry>_reset"]`, and generic will be `inst._reset`. We need to pass `bindReset` an object where the keys match the lookup format. Strategy: rewrap before calling helper.

In `packages/loaders/src/emscripten.ts`, add import:
```ts
import { bindReset } from "./bind-reset.js";
```

Replace line 93 (`const resetFn = inst._reset?.bind(inst);`) with:
```ts
// Emscripten C exports are underscore-prefixed; bindReset uses unprefixed
// names, so look up with explicit C-style keys.
const reshaped: Record<string, unknown> = {
    [`${input.entry}_reset`]: (inst as Record<string, unknown>)[`_${input.entry}_reset`],
    reset: inst._reset,
};
const resetFn = bindReset(reshaped, input.entry);
```

The rest of `emscripten.ts` (line 105 `...(resetFn ? { reset: () => resetFn() } : {})`) can be simplified to `...(resetFn ? { reset: resetFn } : {})`.

- [ ] **Step 8: Update `types.ts` JSDoc**

In `packages/loaders/src/types.ts`, add to JSDoc above `Loader`:

```ts
/**
 * Loader implementations bind `BenchModule.reset` via `bindReset`:
 *   - Per-entry companion (`<entry>_reset`) if present — Phase 1.1.2+ workloads.
 *   - Generic `reset` if present — matmul/interop_calls precedent.
 *   - Otherwise omit `BenchModule.reset` — harness uses optional chain.
 * Emscripten exports are underscore-prefixed; that loader reshapes the lookup
 * keys before calling bindReset.
 */
export interface Loader {
```

- [ ] **Step 9: Run all loader tests**

Run: `pnpm --filter @bench/loaders test`
Expected: existing tests (raw-wasm + plain-js = 6 tests) + new bind-reset (4 tests) = 10 tests pass.

- [ ] **Step 10: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint:all`
Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add packages/loaders/src/bind-reset.ts packages/loaders/tests/bind-reset.test.ts packages/loaders/src/raw-wasm.ts packages/loaders/src/rust-bindgen.ts packages/loaders/src/emscripten.ts packages/loaders/src/types.ts
git commit --no-gpg-sign -m "feat(loaders): bindReset helper — per-entry <entry>_reset lookup with generic fallback"
```

---

### Task 15: `benches/hashmap_string/js/idiomatic/`

**Files:**
- Create: `benches/hashmap_string/js/idiomatic/package.json`
- Create: `benches/hashmap_string/js/idiomatic/tsconfig.json`
- Create: `benches/hashmap_string/js/idiomatic/src/index.ts`

- [ ] **Step 1: Copy precedent from interop_calls/js/idiomatic**

Run: `ls benches/interop_calls/js/idiomatic/`
Verify: package.json, tsconfig.json, src/.

- [ ] **Step 2: Create package.json**

Create `benches/hashmap_string/js/idiomatic/package.json`:

```json
{
    "name": "@bench-impl/hashmap_string-js-idiomatic",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "scripts": {
        "typecheck": "tsc --noEmit"
    },
    "devDependencies": {
        "typescript": "^5.6.3"
    }
}
```

- [ ] **Step 3: Create tsconfig.json**

Copy from `benches/interop_calls/js/idiomatic/tsconfig.json`. Should extend root config and include `src/**/*`.

- [ ] **Step 4: Create src/index.ts**

Create `benches/hashmap_string/js/idiomatic/src/index.ts`:

```ts
interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

const PAIR_BYTES = 24;

export default function create(entry: string): BenchModule {
    let pairs: Array<readonly [string, number]> = [];
    let map = new Map<string, number>();

    function parsePairs(buf: Uint8Array): void {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const n = buf.byteLength / PAIR_BYTES;
        const decoder = new TextDecoder("ascii");
        const next: Array<readonly [string, number]> = [];
        for (let i = 0; i < n; i++) {
            const base = i * PAIR_BYTES;
            const key = decoder.decode(buf.subarray(base, base + 16));
            const value = Number(dv.getBigUint64(base + 16, true));
            next.push([key, value]);
        }
        pairs = next;
    }

    function refillMap(): void {
        map.clear();
        for (const [k, v] of pairs) {
            map.set(k, v);
        }
    }

    function reset(): void {
        switch (entry) {
            case "hashmap_string_insert": map.clear(); break;
            case "hashmap_string_lookup": break;
            case "hashmap_string_delete": refillMap(); break;
        }
    }

    function run(iters: number): { checksum: number } {
        switch (entry) {
            case "hashmap_string_insert": {
                for (let i = 0; i < iters; i++) {
                    const [k, v] = pairs[i]!;
                    map.set(k, v);
                }
                return { checksum: map.size };
            }
            case "hashmap_string_lookup": {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    acc += map.get(pairs[i]![0]) ?? 0;
                }
                return { checksum: acc };
            }
            case "hashmap_string_delete": {
                let acc = 0;
                for (let i = 0; i < iters; i++) {
                    const k = pairs[i]![0];
                    const v = map.get(k);
                    if (v !== undefined) { acc += v; map.delete(k); }
                }
                return { checksum: acc };
            }
            default:
                throw new Error(`hashmap_string/js-idiomatic: unknown entry "${entry}"`);
        }
    }

    return {
        loadInput(buf) {
            parsePairs(buf);
            refillMap();
        },
        run,
        reset,
    };
}
```

- [ ] **Step 5: Install / link**

Run: `pnpm install` (dangerouslyDisableSandbox if pnpm fetches via tsx)
Expected: workspace discovers new package via `pnpm-workspace.yaml` `benches/*/js/*` glob.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @bench-impl/hashmap_string-js-idiomatic typecheck`
Expected: exit 0.

- [ ] **Step 7: Full typecheck + lint**

Run: `pnpm typecheck && pnpm lint:all`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add benches/hashmap_string/js/idiomatic/ pnpm-lock.yaml
git commit --no-gpg-sign -m "feat(hashmap_string): js/idiomatic impl"
```

---

### Task 16: `benches/hashmap_int/js/idiomatic/`

**Files:**
- Create: `benches/hashmap_int/js/idiomatic/package.json`
- Create: `benches/hashmap_int/js/idiomatic/tsconfig.json`
- Create: `benches/hashmap_int/js/idiomatic/src/index.ts`

Same structure as Task 15 but for hashmap_int. Key type is `number` instead of `string`.

- [ ] **Step 1: Create package.json**

Same as Task 15 Step 2 but name = `@bench-impl/hashmap_int-js-idiomatic`.

- [ ] **Step 2: Create tsconfig.json**

Copy from Task 15.

- [ ] **Step 3: Create src/index.ts**

Same as Task 15 Step 4 but:
- `PAIR_BYTES = 16`
- `pairs: Array<readonly [number, number]>`
- `map: Map<number, number>`
- `parsePairs`: read key from `dv.getBigUint64(base, true)`, value from `dv.getBigUint64(base + 8, true)`. No TextDecoder.
- Replace all `hashmap_string_*` entry names with `hashmap_int_*`.

- [ ] **Step 4: pnpm install + typecheck**

Run: `pnpm install` then `pnpm --filter @bench-impl/hashmap_int-js-idiomatic typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add benches/hashmap_int/js/idiomatic/ pnpm-lock.yaml
git commit --no-gpg-sign -m "feat(hashmap_int): js/idiomatic impl"
```

---

### Task 17: `benches/hashmap_string/rust/bindgen/` crate

**Files:**
- Create: `benches/hashmap_string/rust/bindgen/Cargo.toml`
- Create: `benches/hashmap_string/rust/bindgen/src/lib.rs`
- Modify: `Cargo.toml` (root, add to workspace members)

- [ ] **Step 1: Inspect existing bindgen crate for precedent**

Run: `cat benches/interop_calls/rust/bindgen/Cargo.toml`
Verify: see `wasm-bindgen` dep, lib.crate-type = ["cdylib"].

- [ ] **Step 2: Create Cargo.toml**

Create `benches/hashmap_string/rust/bindgen/Cargo.toml`:

```toml
[package]
name = "hashmap-string-rust-bindgen"
version = "0.0.0"
edition = "2024"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"

[lints]
workspace = true
```

- [ ] **Step 3: Create src/lib.rs**

Create `benches/hashmap_string/rust/bindgen/src/lib.rs`:

```rust
#![allow(
    unsafe_code,
    reason = "SyncCell wrapper requires unsafe impl Sync; vacuous on wasm32 single-threaded"
)]

use std::cell::RefCell;
use std::collections::HashMap;

use wasm_bindgen::prelude::*;

struct SyncCell<T>(RefCell<T>);
// SAFETY: wasm32 single-threaded — &T never crosses thread boundary; Sync obligation is vacuous.
unsafe impl<T> Sync for SyncCell<T> {}

struct State {
    pairs: Vec<(String, u64)>,
    map: HashMap<String, u64>,
}

impl State {
    const fn new() -> Self {
        Self { pairs: Vec::new(), map: HashMap::new() }
    }
}

static STATE: SyncCell<State> = SyncCell(RefCell::new(State::new()));

const PAIR_BYTES: usize = 24;

fn parse_pairs(buf: &[u8]) -> Vec<(String, u64)> {
    let n = buf.len() / PAIR_BYTES;
    let mut pairs = Vec::with_capacity(n);
    for i in 0..n {
        let base = i * PAIR_BYTES;
        let key = std::str::from_utf8(&buf[base..base + 16])
            .expect("hashmap_string fixture must be ASCII")
            .to_string();
        let value = u64::from_le_bytes(buf[base + 16..base + 24].try_into().unwrap());
        pairs.push((key, value));
    }
    pairs
}

#[wasm_bindgen]
pub fn load_input(buf: &[u8]) {
    let pairs = parse_pairs(buf);
    let mut map = HashMap::with_capacity(pairs.len());
    for (k, v) in &pairs {
        map.insert(k.clone(), *v);
    }
    STATE.0.replace(State { pairs, map });
}

#[wasm_bindgen]
#[must_use]
pub fn hashmap_string_insert(iters: u32) -> f64 {
    let mut st = STATE.0.borrow_mut();
    let n = iters as usize;
    let pairs_snapshot: Vec<(String, u64)> = st.pairs[..n].to_vec();
    for (k, v) in pairs_snapshot {
        st.map.insert(k, v);
    }
    st.map.len() as f64
}

#[wasm_bindgen]
pub fn hashmap_string_insert_reset() {
    STATE.0.borrow_mut().map.clear();
}

#[wasm_bindgen]
#[must_use]
pub fn hashmap_string_lookup(iters: u32) -> f64 {
    let st = STATE.0.borrow();
    let mut acc: f64 = 0.0;
    for i in 0..iters as usize {
        if let Some(v) = st.map.get(&st.pairs[i].0) {
            acc += *v as f64;
        }
    }
    acc
}

#[wasm_bindgen]
pub fn hashmap_string_lookup_reset() {
    // No-op — lookup is read-only.
}

#[wasm_bindgen]
#[must_use]
pub fn hashmap_string_delete(iters: u32) -> f64 {
    let mut st = STATE.0.borrow_mut();
    let mut acc: f64 = 0.0;
    let keys_snapshot: Vec<String> = st.pairs[..iters as usize].iter().map(|(k, _)| k.clone()).collect();
    for k in keys_snapshot {
        if let Some(v) = st.map.remove(&k) {
            acc += v as f64;
        }
    }
    acc
}

#[wasm_bindgen]
pub fn hashmap_string_delete_reset() {
    let mut st = STATE.0.borrow_mut();
    st.map.clear();
    let pairs_snapshot: Vec<(String, u64)> = st.pairs.clone();
    for (k, v) in pairs_snapshot {
        st.map.insert(k, v);
    }
}

#[wasm_bindgen]
#[must_use]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}
```

Note: `RefCell::borrow_mut` + reading from `st.pairs` requires either splitting the borrow or cloning. The above uses `Vec<...>` snapshot to avoid borrow conflicts. Slight perf cost but correctness first. If clippy complains about specific lints (e.g., `cast_precision_loss` for u64→f64), add `#[allow(clippy::cast_precision_loss, reason = "value range bounded; <2^53")]` per-fn.

- [ ] **Step 4: Add to workspace Cargo.toml**

Run: `cat Cargo.toml | grep -A 5 members`
Expected: see list of crates.

Modify root `Cargo.toml` to add `"benches/hashmap_string/rust/bindgen"` to the workspace `members` array (preserving existing entries).

- [ ] **Step 5: Build**

Run: `pnpm exec tsx scripts/build-rust.ts --bench=hashmap_string` if such CLI flag exists; otherwise `pnpm build:rust` to build all (dangerouslyDisableSandbox).
Expected: produces `dist/hashmap_string/rust-bindgen-speed/...` and `dist/hashmap_string/rust-bindgen-size/...`.

- [ ] **Step 6: Run lint:rust**

Run: `pnpm lint:rust`
Expected: exit 0. If clippy warns on cast_precision_loss or missing_const_for_fn — add per-fn `#[allow(...)]` as per spec § Clippy / lints.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml Cargo.lock benches/hashmap_string/rust/bindgen/
git commit --no-gpg-sign -m "feat(hashmap_string): rust/bindgen impl (std HashMap)"
```

---

### Task 18: `benches/hashmap_int/rust/bindgen/` crate

**Files:**
- Create: `benches/hashmap_int/rust/bindgen/Cargo.toml`
- Create: `benches/hashmap_int/rust/bindgen/src/lib.rs`
- Modify: `Cargo.toml` (root)

Same structure as Task 17 but for `HashMap<u64, u64>`.

- [ ] **Step 1: Create Cargo.toml**

Same as Task 17 Step 2 but `name = "hashmap-int-rust-bindgen"`.

- [ ] **Step 2: Create src/lib.rs**

Adapt Task 17 lib.rs:
- `Key = u64` (replace `String` throughout).
- `PAIR_BYTES = 16`.
- `parse_pairs`: read key from `u64::from_le_bytes(&buf[base..base+8])`, value from `&buf[base+8..base+16]`.
- Replace entry names `hashmap_string_*` → `hashmap_int_*`.
- Key cloning becomes `*k` (Copy type), state snapshots simpler.

- [ ] **Step 3: Add to workspace Cargo.toml**

Add `"benches/hashmap_int/rust/bindgen"` to `members`.

- [ ] **Step 4: Build + lint**

Run: `pnpm build:rust && pnpm lint:rust`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock benches/hashmap_int/rust/bindgen/
git commit --no-gpg-sign -m "feat(hashmap_int): rust/bindgen impl (std HashMap)"
```

---

### Task 19: `benches/hashmap_string/cpp/` (emscripten only)

**Files:**
- Create: `benches/hashmap_string/cpp/src/hashmap_string.cpp`
- Create: `benches/hashmap_string/cpp/src/hashmap_string.h`
- Create: `benches/hashmap_string/cpp/build-emscripten.sh`

- [ ] **Step 1: Create header**

Create `benches/hashmap_string/cpp/src/hashmap_string.h`:

```cpp
#pragma once
#include <cstdint>
```

- [ ] **Step 2: Create cpp**

Create `benches/hashmap_string/cpp/src/hashmap_string.cpp`:

```cpp
#include "hashmap_string.h"

#include <cstring>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

struct State {
    std::vector<std::pair<std::string, uint64_t>> pairs;
    std::unordered_map<std::string, uint64_t> map;
};

State g_state;

constexpr size_t PAIR_BYTES = 24;

void parse_pairs(const uint8_t* buf, size_t len) {
    const size_t n = len / PAIR_BYTES;
    g_state.pairs.clear();
    g_state.pairs.reserve(n);
    for (size_t i = 0; i < n; i++) {
        const size_t base = i * PAIR_BYTES;
        std::string key(reinterpret_cast<const char*>(buf + base), 16);
        uint64_t value;
        std::memcpy(&value, buf + base + 16, sizeof(value));
        g_state.pairs.emplace_back(std::move(key), value);
    }
    g_state.map.clear();
    g_state.map.reserve(n);
    for (const auto& [k, v] : g_state.pairs) {
        g_state.map.emplace(k, v);
    }
}

} // namespace

extern "C" uint32_t alloc(uint32_t sz) {
    return reinterpret_cast<uint32_t>(::operator new(sz));
}

extern "C" void load_input(uint32_t ptr, uint32_t len) {
    parse_pairs(reinterpret_cast<const uint8_t*>(ptr), len);
}

extern "C" double hashmap_string_insert(uint32_t iters) {
    for (uint32_t i = 0; i < iters; i++) {
        g_state.map[g_state.pairs[i].first] = g_state.pairs[i].second;
    }
    return static_cast<double>(g_state.map.size());
}

extern "C" void hashmap_string_insert_reset() {
    g_state.map.clear();
}

extern "C" double hashmap_string_lookup(uint32_t iters) {
    double acc = 0.0;
    for (uint32_t i = 0; i < iters; i++) {
        const auto it = g_state.map.find(g_state.pairs[i].first);
        if (it != g_state.map.end()) {
            acc += static_cast<double>(it->second);
        }
    }
    return acc;
}

extern "C" void hashmap_string_lookup_reset() {
    // No-op.
}

extern "C" double hashmap_string_delete(uint32_t iters) {
    double acc = 0.0;
    for (uint32_t i = 0; i < iters; i++) {
        const auto it = g_state.map.find(g_state.pairs[i].first);
        if (it != g_state.map.end()) {
            acc += static_cast<double>(it->second);
            g_state.map.erase(it);
        }
    }
    return acc;
}

extern "C" void hashmap_string_delete_reset() {
    g_state.map.clear();
    g_state.map.reserve(g_state.pairs.size());
    for (const auto& [k, v] : g_state.pairs) {
        g_state.map.emplace(k, v);
    }
}
```

- [ ] **Step 3: Create build-emscripten.sh**

Create `benches/hashmap_string/cpp/build-emscripten.sh` (model on `benches/interop_calls/cpp/build-emscripten.sh`):

```bash
#!/usr/bin/env bash
set -euo pipefail

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

if [[ "$PROFILE" == "size" ]]; then
  wasm-opt -Oz \
    --enable-bulk-memory \
    --enable-nontrapping-float-to-int \
    "$OUT_DIR/glue.wasm" -o "$OUT_DIR/glue.wasm"
fi
```

Note: `-fno-exceptions` is NOT used here (unlike interop_calls) because `std::unordered_map`'s allocation throws bad_alloc. If exceptions cause bundle bloat, revisit later (Phase 1.2). The flag is kept conservative for first cut.

- [ ] **Step 4: Make script executable**

Run: `chmod +x benches/hashmap_string/cpp/build-emscripten.sh`

- [ ] **Step 5: Build**

Run: `pnpm build:cpp` (dangerouslyDisableSandbox)
Expected: produces `dist/hashmap_string/cpp-emscripten-speed/glue.{mjs,wasm}` and `cpp-emscripten-size/...`. wasi-sdk skipped automatically (no build-wasi-sdk.sh).

If wasi-sdk skip doesn't happen automatically — investigate `scripts/build-cpp.ts`. Add explicit skip if combo's build script missing. (This is the risk item from spec.)

- [ ] **Step 6: Lint stays clean**

Run: `pnpm lint:all`
Expected: exit 0 (no new TS/Rust lint changes; cpp not linted by these scripts).

- [ ] **Step 7: Commit**

```bash
git add benches/hashmap_string/cpp/
git commit --no-gpg-sign -m "feat(hashmap_string): cpp/emscripten impl (libc++ unordered_map)"
```

---

### Task 20: `benches/hashmap_int/cpp/` (emscripten only)

**Files:**
- Create: `benches/hashmap_int/cpp/src/hashmap_int.cpp`
- Create: `benches/hashmap_int/cpp/src/hashmap_int.h`
- Create: `benches/hashmap_int/cpp/build-emscripten.sh`

Same structure as Task 19 but for `unordered_map<uint64_t, uint64_t>`.

- [ ] **Step 1: Create header + cpp**

Adapt Task 19 cpp/h:
- `PAIR_BYTES = 16`.
- `parse_pairs`: `memcpy` 8 bytes for key, 8 for value.
- Map type: `std::unordered_map<uint64_t, uint64_t>`.
- Entry names: `hashmap_int_*`.

- [ ] **Step 2: Create build-emscripten.sh**

Adapt Task 19 step 3, replacing `hashmap_string` with `hashmap_int` in EXPORTS and source path. `chmod +x`.

- [ ] **Step 3: Build + verify**

Run: `pnpm build:cpp` (dangerouslyDisableSandbox)
Expected: produces 4 artifacts (speed + size profiles).

- [ ] **Step 4: Commit**

```bash
git add benches/hashmap_int/cpp/
git commit --no-gpg-sign -m "feat(hashmap_int): cpp/emscripten impl (libc++ unordered_map)"
```

---

### Task 21: Wave 2 close — build:all + smoke

**Files:** none (verification + commit)

- [ ] **Step 1: Full build**

Run: `pnpm build:all` (dangerouslyDisableSandbox)
Expected: produces 12 hashmap binaries (2 binaries × 3 toolchains × 2 profiles) in addition to existing matmul/interop_calls artifacts.

Verify:
```bash
ls dist/hashmap_string/ | wc -l   # expect 5 (4 wasm dirs + js bundle dir + fixtures + spec); adjust
ls dist/hashmap_int/ | wc -l
```

- [ ] **Step 2: Run all gates**

Run: `pnpm typecheck && pnpm lint:all && pnpm test`
Expected: exit 0.

- [ ] **Step 3: Run smoke**

Run: `pnpm smoke` (dangerouslyDisableSandbox)
Expected: all cases (matmul + interop_calls + hashmap × all combos × S × Node) → `validated: true`. If ANY hashmap case fails — debug:
- Check `correctnessFailed: true` cases. Compare `finalChecksum` against `expectedChecksum`.
- Likely culprits: reset wiring (loader didn't bind per-entry), reference checksum capture wrong, fixture parsing mismatch between impl and reference.

If 1-3 wasm impls disagree on a checksum that JS reference + ≥1 wasm produce — that wasm is wrong. If all wasm agree but JS reference differs — likely fixture parse difference (e.g., endianness).

- [ ] **Step 4: Commit Wave 2 close**

If Step 3 surfaced no issues — no additional commit needed; Wave 2 is closed via per-task commits. If a bug fix was needed, commit it as its own task before declaring Wave 2 closed.

---

## Wave 3 — Bench + guidelines + close

### Task 22: Full bench run

**Files:** none (produces `results/raw/<ISO>/`)

- [ ] **Step 1: Run bench:all**

Run: `pnpm bench:all` (dangerouslyDisableSandbox; expect 30-60 min)
Expected:
- builds (already done, may rebuild).
- runs all 108 hashmap cases + existing matmul + interop_calls.
- writes to `results/raw/<ISO>/`.
- generates report → `results/summarized/<ISO>/index.html`.

- [ ] **Step 2: Verify result count**

Run: `ls results/raw/<latest-ISO>/ | wc -l`
Expected: ≥(40 existing) + 108 = 148+ results.

- [ ] **Step 3: Verify no correctness failures**

Run: `grep -l '"correctnessFailed": true' results/raw/<latest-ISO>/*.json | head -5`
Expected: empty output (no failures).

If any failures — STOP. Debug before continuing to guidelines.

---

### Task 23: Reporter sanity

**Files:** none (visual check)

- [ ] **Step 1: Open HTML report**

Run: `open results/summarized/<latest-ISO>/index.html` (macOS)

Verify:
- 10 measurement ID sections: matmul, interop_calls_{noop, add_i32, add_f64}, hashmap_{string,int}_{insert,lookup,delete}.
- Each section shows wasm size + runtime samples across toolchains/profiles/sizes.
- No empty/error cells in hashmap rows.

- [ ] **Step 2: Note observations**

Capture any interesting observations for guidelines:
- Largest bundle size gap (cross-toolchain)?
- Per-op cost ratios (insert vs lookup vs delete)?
- Cross-key-type differences (string vs int)?

Write notes scratch (will be used in Task 24).

---

### Task 24: Guidelines harvest

**Files:**
- Modify: `docs/guidelines.md`

- [ ] **Step 1: Re-read existing guidelines structure**

Run: `cat docs/guidelines.md`
Verify: 3 buckets (Build flags, Toolchain choice, Code patterns).

- [ ] **Step 2: Identify ≥1 candidate claim**

Cross-check observations from Task 23 against criterion: confirmed = reproducible через ≥2 sizes × ≥2 key types. Tentative = single-axis observation.

Candidate claims to evaluate (per spec § Open risks):
- Bundle-size cross-key-type pattern (e.g., emscripten libc++ string symbols add ~XX KB vs int).
- Per-op overhead ratio across languages (e.g., delete usually slowest in language X).
- wasm-bindgen overhead for string-returning entries.

- [ ] **Step 3: Add ≥1 claim with required format**

Append to appropriate bucket в `docs/guidelines.md`:

```markdown
### <Imperative claim>
**Status:** confirmed | tentative | needs-more-data
**Evidence:** results/raw/<ISO>/<specific-result-files-or-summary>
**Phase:** introduced 1.1.2
**Caveats:** <when not to apply>
```

If no claim reaches even tentative threshold — write explicit `needs-more-data` claim explaining what was observed and what would graduate it to tentative. NEVER skip this step silently.

- [ ] **Step 4: Commit**

```bash
git add docs/guidelines.md
git commit --no-gpg-sign -m "docs(guidelines): Phase 1.1.2 claims from hashmap workload"
```

---

### Task 25: Roadmap cleanup

**Files:**
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Remove hashmap-workload from Phase 1.1 bucket**

In `docs/roadmap.md` § Phase 1.1 § Workloads, remove the line:
```
- **hashmap-workload** — std::unordered_map vs Rust HashMap vs JS Map (insert/lookup/delete) ([→ design spec § Phase 1.1](superpowers/specs/2026-05-01-wasm-benchmarks-design.md))
```

- [ ] **Step 2: Verify `hashmap-stdlib-no-glue` entry exists in Phase 1.2**

Run: `grep "hashmap-stdlib-no-glue" docs/roadmap.md`
If not present, add to Phase 1.2 bucket:
```
- **hashmap-stdlib-no-glue** — extend hashmap workload to rust/raw + cpp/wasi-sdk without bindgen/emscripten glue overhead. Bundle-size delta для std-only inclusion — investigation question.
```

- [ ] **Step 3: Commit**

```bash
git add docs/roadmap.md
git commit --no-gpg-sign -m "docs(roadmap): remove hashmap-workload (completed in 1.1.2); verify deferred entry"
```

---

### Task 26: Tag + merge

**Files:** none (git ops)

- [ ] **Step 1: Verify current branch + clean tree**

Run: `git status && git branch --show-current`
Expected: on feature branch (e.g. `feature/phase-1-1-2`); working tree clean.

Note: implementation should have happened on a feature branch. If accidentally on master — see Task 27 escape hatch.

- [ ] **Step 2: Tag at branch HEAD**

Run: `git tag -a phase-1-1-2 -m "Phase 1.1.2 — hashmap workload"`
Expected: silent success.

- [ ] **Step 3: Checkout master and merge**

Run:
```bash
git checkout master
git merge --no-ff feature/phase-1-1-2 -m "merge: Phase 1.1.2 (hashmap workload + common/fixtures)" --no-gpg-sign
```
Expected: merge commit created.

- [ ] **Step 4: Verify gates on master post-merge**

Run: `pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke` (dangerouslyDisableSandbox for smoke)
Expected: all green.

- [ ] **Step 5: Do NOT push without user confirmation**

Phase merge style precedent (1.0.5/1.0.6/1.1.1): merge locally, push only with user's explicit OK.

---

### Task 27: Session close — pitfalls + memory + session-state

**Files:**
- Create/modify: `docs/pitfalls/2026-05-??-phase-1-1-2-execution.md` (if any pitfalls captured)
- Modify: `/Users/uncerso/.claude/projects/-Users-uncerso-src-wasm-rust-cpp-js/memory/project_wasm_benchmarks.md`
- Create: `docs/superpowers/session-states/session-state-2026-05-??-phase-1-1-2-closed.md`

- [ ] **Step 1: Capture pitfalls if any**

Review session for friction signals: tool failures, plan deviations, user corrections of AI proposals, planning gaps. If ≥1 — create `docs/pitfalls/2026-05-??-phase-1-1-2-execution.md` per `docs/pitfalls/README.md` format.

- [ ] **Step 2: Update project memory**

Edit `~/.claude/projects/-Users-uncerso-src-wasm-rust-cpp-js/memory/project_wasm_benchmarks.md`:
- Mark Phase 1.1.2 done.
- Note Phase 1.1.3 (shape_dispatch + close) is next.
- Update description if hashmap surfaced significant findings.

- [ ] **Step 3: Write session-state snapshot**

Create `docs/superpowers/session-states/session-state-2026-05-??-phase-1-1-2-closed.md` (mirror structure of `session-state-2026-05-23-phase-1-1-1-closed.md`):
- TL;DR (where we are).
- Done in this session.
- Findings / claims.
- Deferred items.
- Push status.
- What next session needs to know.
- Open tech-debt.

- [ ] **Step 4: Commit all closure artifacts**

```bash
git add docs/pitfalls/2026-05-??-phase-1-1-2-execution.md docs/superpowers/session-states/session-state-2026-05-??-phase-1-1-2-closed.md
git commit --no-gpg-sign -m "docs(session): close Phase 1.1.2 — session-state + pitfalls (if any)"
```

Memory file is outside repo, edit separately (not git-tracked).

---

## Final exit criteria (= Phase 1.1.2 done)

- [ ] 12 wasm binaries в `dist/` (2 binaries × 3 toolchains × 2 profiles).
- [ ] 108 measurement cases в bench results.
- [ ] Reporter HTML shows 10 measurement IDs.
- [ ] ≥1 confirmed или well-justified tentative/needs-more-data claim в `docs/guidelines.md`.
- [ ] Master gates green: `pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke`.
- [ ] Tag `phase-1-1-2` поставлен.
- [ ] Memory + session-state updated.
- [ ] Roadmap cleaned up.
- [ ] Push status documented (user decides).
