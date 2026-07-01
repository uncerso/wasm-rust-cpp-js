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

describe("computeStats robust fields", () => {
    it("computes MAD as the median absolute deviation from the median", () => {
        // [1,2,3,4,5] → median 3 → abs devs [2,1,0,1,2] → median 1
        const s = computeStats([1, 2, 3, 4, 5]);
        expect(s.median).toBe(3);
        expect(s.mad).toBe(1);
    });
    it("computes relSem = stddev / (mean * sqrt(n))", () => {
        const s = computeStats([10, 12, 14, 16, 18]);
        expect(s.relSem).toBeCloseTo(s.stddev / (s.mean * Math.sqrt(s.n)), 12);
    });
    it("keeps relSem finite (0) when mean is 0 (all-zero sub-resolution samples)", () => {
        const s = computeStats([0, 0, 0, 0]);
        expect(s.mean).toBe(0);
        expect(s.cv).toBe(0);
        expect(s.relSem).toBe(0);
        expect(s.min).toBe(0);
    });
});
