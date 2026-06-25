import { describe, expect, it } from "vitest";
import { bandOf, buildSizeViewModel, buildCrossLangTables } from "../src/size-view-model.js";
import type { SizeBinary } from "../src/size-data.js";

function bin(over: Partial<SizeBinary> = {}): SizeBinary {
    return {
        id: "hashmap_int", language: "rust", toolchain: "raw", profile: "size",
        label: "rust/raw/size",
        totals: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 450 },
        glue: null, composition: null, isJs: false,
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

    it("degrades null composition (non-JS) to one 'unknown' bar with an honest note", () => {
        const vm = buildSizeViewModel({ binaries: [bin({ composition: null })] });
        const b = vm.binaries[0]!;
        expect(b.hasComposition).toBe(false);
        expect(b.segments).toHaveLength(1);
        expect(b.segments[0]!.rawBytes).toBe(1000);
        expect(b.segments[0]!.band).toBe("unknown");
        expect(b.segments[0]!.facility).toBe("(не атрибутировано)");
        expect(b.note).toContain("rust/raw");
    });

    it("marks JS as a single observed bar (floor 0)", () => {
        const js = bin({ language: "js", toolchain: "idiomatic", profile: "speed", label: "js/idiomatic/speed", isJs: true, composition: null });
        const vm = buildSizeViewModel({ binaries: [js] });
        const b = vm.binaries[0]!;
        expect(b.segments[0]!.band).toBe("observed");
        expect(b.note).toContain("JS");
    });
});

describe("buildCrossLangTables", () => {
    it("aligns facilities into shared columns per workload", () => {
        const vm = buildSizeViewModel({ binaries: [
            bin({ composition }),
            bin({ language: "cpp", toolchain: "wasi-sdk", label: "cpp/wasi-sdk/size",
                totals: { rawBytes: 800, gzipBytes: 400, brotliBytes: 360 },
                composition: {
                    source: "pre-opt-twiggy",
                    productionTotal: { rawBytes: 800, gzipBytes: 400, brotliBytes: 360 },
                    preOptTotalBytes: 850, calibrationFactor: 0.94, unattributedShare: 0,
                    facilities: [{ facility: "allocator", scaling: "paid-once", share: 1, approxBytes: 800 }],
                } }),
        ] });
        const tables = buildCrossLangTables(vm);
        expect(tables).toHaveLength(1);
        const t = tables[0]!;
        expect(t.id).toBe("hashmap_int");
        expect(t.facilities).toContain("allocator");
        expect(t.facilities).toContain("observed");
        expect(t.rows).toHaveLength(2);
        const cpp = t.rows.find((r) => r.label === "cpp/wasi-sdk/size")!;
        expect(cpp.byFacility["allocator"]!.rawBytes).toBe(800);
        expect(cpp.byFacility["allocator"]!.gzBytes).toBe(400); // share 1 × 400 gz total
        expect(cpp.byFacility["observed"]?.rawBytes ?? 0).toBe(0);
        expect(cpp.total).toEqual({ rawBytes: 800, gzBytes: 400, brotliBytes: 360 });
        expect(cpp.toolchain).toBe("wasi-sdk");
        expect(cpp.profile).toBe("size");
    });
});

it("adds a glue band from measured jsGlue (not derived from wasm)", () => {
    const data = { binaries: [{
        id: "x", language: "rust", toolchain: "bindgen", profile: "size",
        label: "rust/bindgen/size", isJs: false,
        totals: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 400 },     // wasm only
        glue: { rawBytes: 5000, gzipBytes: 1500, brotliBytes: 1300 },     // measured glue
        composition: {
            source: "pre-opt-twiggy", productionTotal: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 400 },
            preOptTotalBytes: 1000, calibrationFactor: 1, unattributedShare: 0,
            facilities: [{ facility: "observed", scaling: "observed", share: 1, approxBytes: 1000 }],
        },
    }] };
    const vm = buildSizeViewModel(data as never);
    const glue = vm.binaries[0]!.segments.find((s) => s.facility === "glue (JS)");
    expect(glue).toBeDefined();
    expect(glue!.band).toBe("glue");
    expect(glue!.rawBytes).toBe(5000);     // measured, not 1000*ratio
    expect(glue!.gzBytes).toBe(1500);
});
