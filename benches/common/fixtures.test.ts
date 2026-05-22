import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mulberry32, genF64Array } from "./fixtures.js";

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
