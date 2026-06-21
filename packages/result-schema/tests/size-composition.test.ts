import { describe, expect, it } from "vitest";
import { SizeCompositionSchema } from "../src/index.js";

describe("SizeCompositionSchema", () => {
    it("accepts a valid composition", () => {
        const sample = {
            source: "pre-opt-twiggy",
            productionTotal: { rawBytes: 1639, gzipBytes: 900, brotliBytes: 820 },
            preOptTotalBytes: 1988,
            calibrationFactor: 1639 / 1988,
            unattributedShare: 0.0,
            facilities: [
                { facility: "observed", scaling: "observed", share: 0.52, approxBytes: 852 },
                { facility: "allocator", scaling: "paid-once", share: 0.42, approxBytes: 688 },
            ],
        };
        expect(() => SizeCompositionSchema.parse(sample)).not.toThrow();
    });

    it("rejects a share outside [0,1]", () => {
        const bad = {
            source: "pre-opt-twiggy",
            productionTotal: { rawBytes: 1, gzipBytes: 1, brotliBytes: 1 },
            preOptTotalBytes: 1, calibrationFactor: 1, unattributedShare: 0,
            facilities: [{ facility: "x", scaling: "paid-once", share: 2, approxBytes: 1 }],
        };
        expect(() => SizeCompositionSchema.parse(bad)).toThrow();
    });
});
