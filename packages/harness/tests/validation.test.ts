import { describe, expect, it } from "vitest";
import { f64ChecksumSumAbs, eqChecksum } from "../src/validation.js";

describe("f64ChecksumSumAbs", () => {
    it("sums absolute values of f64 array", () => {
        const arr = new Float64Array([1.0, -2.0, 3.5, -4.5]);
        expect(f64ChecksumSumAbs(arr)).toBeCloseTo(11.0);
    });
    it("returns 0 for empty", () => {
        expect(f64ChecksumSumAbs(new Float64Array())).toBe(0);
    });
});

describe("eqChecksum", () => {
    it("compares numbers within tolerance", () => {
        expect(eqChecksum(1.0, 1.0 + 1e-10)).toBe(true);
        expect(eqChecksum(1.0, 1.001)).toBe(false);
    });
    it("compares strings strictly", () => {
        expect(eqChecksum("abc", "abc")).toBe(true);
        expect(eqChecksum("abc", "abd")).toBe(false);
    });
    it("returns false on type mismatch", () => {
        expect(eqChecksum("1", 1)).toBe(false);
    });
});
