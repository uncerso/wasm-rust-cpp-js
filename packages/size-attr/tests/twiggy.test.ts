import { describe, expect, it } from "vitest";
import { parseTwiggyJson } from "../src/twiggy.js";

describe("parseTwiggyJson", () => {
    it("parses twiggy top -f json output", () => {
        const json = JSON.stringify([
            { name: "matmul", shallow_size: 480, shallow_size_percent: 16.41 },
            { name: "data segment \".rodata\"", shallow_size: 521, shallow_size_percent: 17.81 },
        ]);
        const rows = parseTwiggyJson(json);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({ name: "matmul", shallowSize: 480 });
    });
    it("throws on non-array", () => {
        expect(() => parseTwiggyJson("{}")).toThrow();
    });
});
