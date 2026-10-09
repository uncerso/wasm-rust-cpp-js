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
    it.each([1, 100_000])("rejects integer checksum error +%i by default", (error) => {
        expect(eqChecksum(213_944_096_178_963 + error, 213_944_096_178_963)).toBe(false);
    });
    it("accepts identical finite numbers", () => {
        expect(eqChecksum(213_944_096_178_963, 213_944_096_178_963)).toBe(true);
        expect(eqChecksum(1.25, 1.25)).toBe(true);
        expect(eqChecksum(0, 0)).toBe(true);
        expect(eqChecksum(-0, -0)).toBe(true);
    });
    it.each([
        [1, 1.0000000000000002],
        [275996.81878375803, 275996.8187837581],
        [8921353.464110956, 8921353.464110958],
    ])("rejects adjacent binary64 values %s and %s", (expected, actual) => {
        expect(eqChecksum(actual, expected)).toBe(false);
    });
    it("distinguishes the sign bit of zero", () => {
        expect(eqChecksum(0, -0)).toBe(false);
        expect(eqChecksum(-0, 0)).toBe(false);
    });
    it.each([NaN, Infinity, -Infinity])("rejects nonfinite checksum %s", (value) => {
        expect(eqChecksum(value, value)).toBe(false);
    });
    it("compares strings strictly", () => {
        expect(eqChecksum("abc", "abc")).toBe(true);
        expect(eqChecksum("abc", "abd")).toBe(false);
    });
    it("returns false on type mismatch", () => {
        expect(eqChecksum("1", 1)).toBe(false);
    });
});
