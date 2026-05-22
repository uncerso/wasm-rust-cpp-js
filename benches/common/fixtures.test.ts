import { describe, expect, it } from "vitest";
import { mulberry32 } from "./fixtures.js";

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
