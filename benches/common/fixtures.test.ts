import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mulberry32, genF64Array, genAsciiHexKeys, genIntPairs53, genShapes } from "./fixtures.js";

describe("mulberry32", () => {
    it("produces deterministic sequence for given seed", () => {
        const rng = mulberry32(0xC0FFEE_01);
        const first3 = [rng(), rng(), rng()];
        // Golden values — captured from running matmul's existing mulberry32 with seed 0xC0FFEE_01.
        // Will be filled in step 3 after implementation, after running once to capture actual values.
        expect(first3).toEqual([0.481826086062938, 0.9094102564267814, 0.2581043802201748]);
    });

    it("different seeds produce different sequences", () => {
        const a = mulberry32(1);
        const b = mulberry32(2);
        expect(a()).not.toEqual(b());
    });
});

describe("genF64Array", () => {
    it("produces byte-identical fixture for known (n, seed) — matmul S precedent", () => {
        // n=64, seed=0xC0FFEE_01 matches matmul S — SHA256 must equal existing
        // value in benches/matmul/spec.json (defends against silent drift).
        const buf = genF64Array(64, 0xC0FFEE_01);
        const sha = createHash("sha256").update(buf).digest("hex");
        expect(sha).toBe("a2c4b66989d6b157b19a6fb23ab883afba487c45880e4c1b149aab9ee9c2803e");
    });

    it("output size == 2n² × 8 bytes", () => {
        expect(genF64Array(4, 1).byteLength).toBe(2 * 4 * 4 * 8);
    });
});

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
        expect(sha).toBe("2953f375ce7d76e4453ad898f9dd7719e56123ebc07ebc5521b1b5a8b1540339");
    });
});

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
        expect(sha).toBe("7f1f20dd560fec44203f2391da5a234ab165b312e65d8609a801db0ccc79d9e3");
    });
});

describe("genShapes", () => {
    it("produces 24 bytes per shape", () => {
        const buf = genShapes(10, 0xFACE_0001);
        expect(buf.length).toBe(240);
    });

    it("tag values ∈ {0, 1, 2}", () => {
        const buf = genShapes(100, 0xFACE_0001);
        const tags = new Set<number>();
        for (let i = 0; i < 100; i++) {
            tags.add(buf[i * 24]);
        }
        expect([...tags].sort()).toEqual([0, 1, 2]);
    });

    it("p1 ∈ [0.5, 5.0) — DataView read", () => {
        const buf = genShapes(100, 0xFACE_0001);
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        for (let i = 0; i < 100; i++) {
            const p1 = view.getFloat64(i * 24 + 8, true);
            expect(p1).toBeGreaterThanOrEqual(0.5);
            expect(p1).toBeLessThan(5.0);
        }
    });

    it("deterministic SHA256 snapshot (n=4, seed=0xFACE_0001)", () => {
        const buf = genShapes(4, 0xFACE_0001);
        const sha = createHash("sha256").update(buf).digest("hex");
        expect(sha).toBe("252c59f12314dc439289493f2ca30a3057c2a8316e2a125c45e3b9b56ef39e50");
    });
});
