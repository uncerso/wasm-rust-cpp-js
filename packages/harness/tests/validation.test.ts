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
    it("requires exact equality unless float mode is explicit", () => {
        expect(eqChecksum(213_944_096_178_963, 213_944_096_178_963)).toBe(true);
        expect(eqChecksum(1.0, 1.0 + 1e-10)).toBe(false);
        expect(eqChecksum(1.0, 1.0 + 1e-10, "exact")).toBe(false);
    });
    it("compares numbers within tolerance in float mode", () => {
        expect(eqChecksum(1.0, 1.0 + 1e-10, "float")).toBe(true);
        expect(eqChecksum(1.0, 1.001, "float")).toBe(false);
        expect(eqChecksum(0, 0, "float")).toBe(true);
        expect(eqChecksum(0, 1e-12, "float")).toBe(false);
    });
    it.each([NaN, Infinity, -Infinity])("rejects nonfinite checksum %s", (value) => {
        expect(eqChecksum(value, value)).toBe(false);
        expect(eqChecksum(value, value, "float")).toBe(false);
    });
    it("compares strings strictly", () => {
        expect(eqChecksum("abc", "abc")).toBe(true);
        expect(eqChecksum("abc", "abd")).toBe(false);
        expect(eqChecksum("213944096178963", "213944096278963", "float")).toBe(false);
    });
    it("returns false on type mismatch", () => {
        expect(eqChecksum("1", 1)).toBe(false);
        expect(eqChecksum("1", 1, "float")).toBe(false);
    });
});
