import { describe, expect, it } from "vitest";
import { renderSizeView } from "../src/render-size.js";
import type { SizeData } from "../src/size-data.js";

const data: SizeData = {
    binaries: [
        {
            id: "hashmap_int", language: "rust", toolchain: "raw", profile: "size", label: "rust/raw/size",
            totals: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 450 }, glue: null, isJs: false,
            composition: {
                source: "pre-opt-twiggy",
                productionTotal: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 450 },
                preOptTotalBytes: 1100, calibrationFactor: 0.9, unattributedShare: 0,
                facilities: [
                    { facility: "allocator", scaling: "paid-once", share: 0.6, approxBytes: 600 },
                    { facility: "observed", scaling: "observed", share: 0.4, approxBytes: 400 },
                ],
            },
        },
    ],
};

describe("renderSizeView", () => {
    it("renders a bar per binary with filter controls", () => {
        const html = renderSizeView(data);
        expect(html).toContain('class="size-controls"');
        expect(html).toContain('name="compression"');
        expect(html).toContain('name="observedOnly"');
        expect(html).toContain('class="size-bar"');
        expect(html).toContain('data-toolchain="raw"');
        expect(html).toContain('data-profile="size"');
    });

    it("emits floor and observed segments with byte data attributes", () => {
        const html = renderSizeView(data);
        expect(html).toContain('class="seg"');
        expect(html).toContain('style="background:#6e7b8c"');  // allocator floor shade
        expect(html).toContain('style="background:#34b88a"');  // observed accent
        expect(html).toContain('data-raw="600"');
        expect(html).toContain('data-raw="400"');
    });

    it("emits facility-colored segments with inline labels", () => {
        const html = renderSizeView(data);
        // per-facility color comes from theme, not a single seg-floor class:
        expect(html).toContain("background:#6e7b8c");   // allocator floor shade
        expect(html).toContain("background:#34b88a");   // observed accent
        // inline label on a wide segment (raw bytes + facility):
        expect(html).toContain("600 B");                // allocator approxBytes label
        // tooltip still present:
        expect(html).toContain("title=");
    });

    it("escapes the binary label", () => {
        const evil: SizeData = { binaries: [{ ...data.binaries[0]!, label: "<x>" }] };
        const html = renderSizeView(evil);
        expect(html).not.toContain("<x>");
        expect(html).toContain("&lt;x&gt;");
    });

    it("renders a cross-language facility table", () => {
        const html = renderSizeView(data);
        expect(html).toContain('class="xlang"');
        expect(html).toContain("<th>allocator</th>");
    });

    it("emits per-cell raw/gz/brotli data attributes for compression-aware totals", () => {
        const html = renderSizeView(data);
        // allocator cell: raw 600, gz round(0.6*500)=300, brotli round(0.6*450)=270
        expect(html).toMatch(/<td class="xlang-cell" data-raw="600" data-gz="300" data-brotli="270">600<\/td>/);
    });

    it("tags table rows with toolchain/profile so client filters can hide them", () => {
        const html = renderSizeView(data);
        expect(html).toMatch(/<tr class="xlang-row"[^>]*data-toolchain="raw"[^>]*data-profile="size"/);
    });
});
