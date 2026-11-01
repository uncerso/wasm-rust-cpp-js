import { describe, expect, it } from "vitest";
import { render, type Params } from "./reference.js";
import createIdiomatic from "../js/idiomatic/src/index.js";

// Exercises both in-set and escaping pixels without a full-size render.
const SMALL: Params = {
    minX: -2.5, maxX: 1.0, minY: -1.25, maxY: 1.25,
    dimsX: 64, dimsY: 48, maxIter: 128,
};

function encode(p: Params): Uint8Array {
    const input = new Uint8Array(56);
    const view = new DataView(input.buffer);
    const values = [p.minX, p.maxX, p.minY, p.maxY, p.dimsX, p.dimsY, p.maxIter];
    values.forEach((value, i) => {
        view.setFloat64(i * 8, value, true);
    });
    return input;
}

describe("mandelbrot JS parity", () => {
    it("matches the reference on a small grid", () => {
        const module = createIdiomatic("mandelbrot");
        module.loadInput(encode(SMALL));
        expect(module.run(1).checksum).toBe(render(SMALL));
    });

    it("returns one grid checksum across repeated runs, reset and run(3)", () => {
        const expected = render(SMALL);
        const module = createIdiomatic("mandelbrot");
        module.loadInput(encode(SMALL));
        expect(module.run(1).checksum).toBe(expected);
        expect(module.run(1).checksum).toBe(expected);
        module.reset();
        expect(module.run(1).checksum).toBe(expected);
        expect(module.run(3).checksum).toBe(expected);
        module.reset();
        expect(module.run(3).checksum).toBe(expected);
    });

    it("reads parameters relative to a nonzero input byte offset", () => {
        const input = encode(SMALL);
        const backing = new Uint8Array(input.length + 11).fill(255);
        backing.set(input, 7);
        const module = createIdiomatic("mandelbrot");
        module.loadInput(backing.subarray(7, 7 + input.length));
        expect(module.run(1).checksum).toBe(render(SMALL));
    });

    it("rejects an unknown entry", () => {
        expect(() => createIdiomatic("unknown")).toThrow();
    });
});
