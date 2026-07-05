import { describe, it, expect } from "vitest";
import { isCorrectnessFailure } from "../src/index.js";
import type { BenchResult } from "../src/index.js";

function withQuality(validated: boolean, correctnessFailed: boolean): BenchResult {
    // Only .quality is read by isCorrectnessFailure; cast a minimal shape.
    return { quality: { validated, correctnessFailed } } as unknown as BenchResult;
}

describe("isCorrectnessFailure", () => {
    it("passes a validated result", () => {
        expect(isCorrectnessFailure(withQuality(true, false))).toBe(false);
    });
    it("flags correctnessFailed", () => {
        expect(isCorrectnessFailure(withQuality(false, true))).toBe(true);
    });
    it("flags not-validated even if correctnessFailed is false", () => {
        expect(isCorrectnessFailure(withQuality(false, false))).toBe(true);
    });
});
