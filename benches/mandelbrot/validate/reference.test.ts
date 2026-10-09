import { describe, expect, it } from "vitest";
import { escape, parseParams, render, type Params } from "./reference.js";

const TWO_53 = 0x20000000000000;

const S: Params = {
    minX: -2.5, maxX: 1.0, minY: -1.25, maxY: 1.25,
    dimsX: 280, dimsY: 200, maxIter: 200,
};
const M: Params = { ...S, dimsX: 700, dimsY: 500, maxIter: 500 };
const L: Params = { ...S, dimsX: 1400, dimsY: 1000, maxIter: 1000 };

function encodeParams(p: Params): Uint8Array {
    const buf = new Uint8Array(56);
    const dv = new DataView(buf.buffer);
    const values = [p.minX, p.maxX, p.minY, p.maxY, p.dimsX, p.dimsY, p.maxIter];
    for (let i = 0; i < values.length; i++) {
        dv.setFloat64(i * 8, values[i]!, true);
    }
    return buf;
}

describe("mandelbrot reference", () => {
    it("escape returns maxIter for a point in the set", () => {
        expect(escape(0, 0, 1000)).toBe(1000);
    });

    it("escape returns maxIter for a point in the main cardioid", () => {
        expect(escape(-0.5, 0, 1000)).toBe(1000);
    });

    it("escape counts the update after the magnitude first exceeds four", () => {
        expect(escape(10, 10, 1000)).toBe(1);
    });

    it("escape uses a strict greater-than boundary", () => {
        expect(escape(2, 0, 3)).toBe(2);
    });

    it("renders the canonical S, M, and L checksums exactly", () => {
        expect(render(S)).toBe(2190038);
        expect(render(M)).toBe(31887455);
        expect(render(L)).toBe(248487617);
    });

    it("checksum is a positive safe integer below the all-in-set ceiling", () => {
        const checksum = render(L);
        expect(checksum).toBeGreaterThan(0);
        expect(Number.isInteger(checksum)).toBe(true);
        expect(checksum).toBeLessThan(TWO_53);
        expect(checksum).toBeLessThan(L.dimsX * L.dimsY * L.maxIter);
    });

    it("has both in-set and fast-escape pixels", () => {
        let hasInSet = false;
        let hasEscape = false;
        const stepX = (L.maxX - L.minX) / L.dimsX;
        const stepY = (L.maxY - L.minY) / L.dimsY;
        for (let py = 0; py < L.dimsY && !(hasInSet && hasEscape); py += 50) {
            const cy = L.minY + py * stepY;
            for (let px = 0; px < L.dimsX; px += 50) {
                const cx = L.minX + px * stepX;
                const count = escape(cx, cy, L.maxIter);
                hasInSet ||= count === L.maxIter;
                hasEscape ||= count < L.maxIter;
            }
        }
        expect(hasInSet).toBe(true);
        expect(hasEscape).toBe(true);
    });

    it("parses parameters relative to a nonzero Uint8Array byte offset", () => {
        const expected = encodeParams(S);
        const backing = new Uint8Array(expected.length + 11);
        backing.set(expected, 7);
        expect(parseParams(backing.subarray(7, 7 + expected.length))).toEqual(S);
    });
});
