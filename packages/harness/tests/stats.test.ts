import { describe, expect, it } from "vitest";
import { computeStats } from "../src/stats.js";

describe("computeStats", () => {
    it("computes median, p95, p99, stddev for known data", () => {
        const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const r = computeStats(samples);
        expect(r.median).toBeCloseTo(5.5);
        expect(r.min).toBe(1);
        expect(r.max).toBe(10);
        expect(r.p95).toBeCloseTo(9.55);
        expect(r.stddev).toBeCloseTo(3.028, 2);
        expect(r.cv).toBeCloseTo(3.028 / 5.5, 2);
    });

    it("throws on empty input", () => {
        expect(() => computeStats([])).toThrow();
    });

    it("handles single-element input", () => {
        const r = computeStats([42]);
        expect(r.median).toBe(42);
        expect(r.stddev).toBe(0);
        expect(r.cv).toBe(0);
    });
});
