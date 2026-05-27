import { describe, expect, it } from "vitest";
import { parseShapes, computeScore, checksumQuantized, ShapeKind } from "./shape-reference.js";
import { genShapes } from "./fixtures.js";

describe("shape-reference", () => {
    it("parseShapes round-trips genShapes layout", () => {
        const buf = genShapes(10, 0xFACE_0001);
        const shapes = parseShapes(buf);
        expect(shapes.length).toBe(10);
        for (const s of shapes) {
            expect([ShapeKind.Circle, ShapeKind.Square, ShapeKind.Triangle]).toContain(s.kind);
            expect(s.p1).toBeGreaterThanOrEqual(0.5);
            expect(s.p1).toBeLessThan(5.0);
        }
    });

    it("computeScore positive для всех 3 shape types", () => {
        expect(computeScore({ kind: ShapeKind.Circle,   p1: 1.0, p2: 0 })).toBeGreaterThan(0);
        expect(computeScore({ kind: ShapeKind.Square,   p1: 1.0, p2: 0 })).toBeGreaterThan(0);
        expect(computeScore({ kind: ShapeKind.Triangle, p1: 1.0, p2: 1.0 })).toBeGreaterThan(0);
    });

    it("checksumQuantized order-independent", () => {
        const shapes = parseShapes(genShapes(100, 0xFACE_0001));
        const c1 = checksumQuantized(shapes);
        const shuffled = [...shapes].reverse();
        const c2 = checksumQuantized(shuffled);
        expect(c1).toBe(c2);
    });

    it("Math.round equivalent к floor(x+0.5) для positive values", () => {
        // Sanity check that JS Math.round matches our cross-language convention
        expect(Math.round(2.5)).toBe(3);
        expect(Math.round(0.4999999999999999)).toBe(0);
        expect(Math.round(0.5)).toBe(1);
    });
});
