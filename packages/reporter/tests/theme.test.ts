// packages/reporter/tests/theme.test.ts
import { describe, expect, it } from "vitest";
import { segmentColor } from "../src/theme.js";

describe("segmentColor", () => {
    it("maps accent bands to fixed accents", () => {
        expect(segmentColor({ band: "glue", facility: "glue (JS)" })).toBe("#d8be73");
        expect(segmentColor({ band: "observed", facility: "observed" })).toBe("#34b88a");
        expect(segmentColor({ band: "unattributed", facility: "unattributed" })).toBe("#e0a8a8");
    });
    it("maps floor facilities to distinct slate shades", () => {
        const alloc = segmentColor({ band: "floor", facility: "allocator" });
        const struct = segmentColor({ band: "floor", facility: "structural" });
        expect(alloc).toBe("#6e7b8c");
        expect(struct).not.toBe(alloc);
    });
    it("falls back to a mid slate for unknown floor facilities", () => {
        expect(segmentColor({ band: "floor", facility: "mystery" })).toBe("#a8b2bf");
    });
});
