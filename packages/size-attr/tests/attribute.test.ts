import { describe, expect, it } from "vitest";
import { buildComposition } from "../src/attribute.js";
import type { CategorizeCtx } from "../src/facilities.js";

const ctx: CategorizeCtx = { exportNames: new Set(["matmul"]), workloadPrefixes: [] };

describe("buildComposition", () => {
    const rows = [
        { name: "matmul", shallowSize: 520 },
        { name: "dlmalloc", shallowSize: 400 },
        { name: 'custom section ".debug_info"', shallowSize: 700 }, // excluded
        { name: "mystery::sym", shallowSize: 80 },                  // unattributed
    ];
    const prod = { rawBytes: 800, gzipBytes: 400, brotliBytes: 360 };

    it("excludes meta rows from the denominator", () => {
        const c = buildComposition(rows, ctx, prod);
        expect(c.preOptTotalBytes).toBe(1000); // 520 + 400 + 80, NOT 1700
    });
    it("shares sum to 1 (incl unattributed)", () => {
        const c = buildComposition(rows, ctx, prod);
        const sum = c.facilities.reduce((a, f) => a + f.share, 0) + c.unattributedShare;
        expect(sum).toBeCloseTo(1, 6);
    });
    it("calibrates approxBytes to production raw total", () => {
        const c = buildComposition(rows, ctx, prod);
        const sum = c.facilities.reduce((a, f) => a + f.approxBytes, 0);
        expect(sum).toBeLessThanOrEqual(prod.rawBytes);          // rounding never overshoots total
        expect(c.calibrationFactor).toBeCloseTo(800 / 1000, 6);
        const observed = c.facilities.find((f) => f.facility === "observed");
        expect(observed?.approxBytes).toBe(Math.round(0.52 * 800)); // 520/1000 * 800
    });
    it("surfaces unattributed as its own share", () => {
        const c = buildComposition(rows, ctx, prod);
        expect(c.unattributedShare).toBeCloseTo(80 / 1000, 6);
    });
});
