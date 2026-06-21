import { describe, expect, it } from "vitest";
import { renderSizeView } from "../src/render-size.js";
import type { SizeData } from "../src/size-data.js";

const data: SizeData = {
    binaries: [
        {
            id: "hashmap_int", language: "rust", toolchain: "raw", profile: "size", label: "rust/raw/size",
            totals: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 450 }, isJs: false,
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
        expect(html).toContain('class="seg seg-floor"');
        expect(html).toContain('class="seg seg-observed"');
        expect(html).toContain('data-raw="600"');
        expect(html).toContain('data-raw="400"');
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
});
