import { describe, expect, it } from "vitest";
import { bandOf, buildSizeViewModel } from "../src/size-view-model.js";
import type { SizeBinary } from "../src/size-data.js";

function bin(over: Partial<SizeBinary> = {}): SizeBinary {
    return {
        id: "hashmap_int", language: "rust", toolchain: "raw", profile: "size",
        label: "rust/raw/size",
        totals: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 450 },
        composition: null, isJs: false,
        ...over,
    };
}

const composition = {
    source: "pre-opt-twiggy" as const,
    productionTotal: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 450 },
    preOptTotalBytes: 1100, calibrationFactor: 0.9, unattributedShare: 0.05,
    facilities: [
        { facility: "allocator", scaling: "paid-once" as const, share: 0.45, approxBytes: 450 },
        { facility: "observed", scaling: "observed" as const, share: 0.30, approxBytes: 300 },
        { facility: "monomorphized", scaling: "per-type" as const, share: 0.20, approxBytes: 200 },
    ],
};

describe("bandOf", () => {
    it("maps observed + per-type to observed band, else floor", () => {
        expect(bandOf("observed")).toBe("observed");
        expect(bandOf("per-type")).toBe("observed");
        expect(bandOf("paid-once")).toBe("floor");
    });
});

describe("buildSizeViewModel", () => {
    it("emits floor, observed, then unattributed segments summing to ~total", () => {
        const vm = buildSizeViewModel({ binaries: [bin({ composition })] });
        const b = vm.binaries[0]!;
        expect(b.hasComposition).toBe(true);
        expect(b.segments.map((s) => s.facility)).toEqual(["allocator", "observed", "monomorphized", "unattributed"]);
        expect(b.segments.map((s) => s.band)).toEqual(["floor", "observed", "observed", "unattributed"]);
        const sumRaw = b.segments.reduce((a, s) => a + s.rawBytes, 0);
        expect(sumRaw).toBe(1000); // 450+300+200 + unattr 50
        const sumShare = b.segments.reduce((a, s) => a + s.share, 0);
        expect(sumShare).toBeCloseTo(1, 6);
    });

    it("derives per-segment gz/brotli from share x production totals", () => {
        const vm = buildSizeViewModel({ binaries: [bin({ composition })] });
        const alloc = vm.binaries[0]!.segments.find((s) => s.facility === "allocator")!;
        expect(alloc.gzBytes).toBe(Math.round(0.45 * 500));
        expect(alloc.brotliBytes).toBe(Math.round(0.45 * 450));
    });

    it("degrades null composition to one observed bar with a note", () => {
        const vm = buildSizeViewModel({ binaries: [bin({ composition: null })] });
        const b = vm.binaries[0]!;
        expect(b.hasComposition).toBe(false);
        expect(b.segments).toHaveLength(1);
        expect(b.segments[0]!.rawBytes).toBe(1000);
        expect(b.note).toContain("unavailable");
    });

    it("marks JS as a single observed bar (floor 0)", () => {
        const js = bin({ language: "js", toolchain: "idiomatic", profile: "speed", label: "js/idiomatic/speed", isJs: true, composition: null });
        const vm = buildSizeViewModel({ binaries: [js] });
        const b = vm.binaries[0]!;
        expect(b.segments[0]!.band).toBe("observed");
        expect(b.note).toContain("JS");
    });
});
