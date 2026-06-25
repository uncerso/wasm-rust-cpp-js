import { describe, expect, it } from "vitest";
import { renderSizeView } from "../src/render-size.js";
import type { SizeData } from "../src/size-data.js";

// Fixture: one rust/raw binary whose floor splits across three facilities so the
// selective-label rule (only the single largest-raw floor is labeled) is exercised,
// plus an observed band. `data` (#bac2cd, light) is the largest floor → labeled with
// dark text; `allocator` (#6e7b8c, mid) and `structural` (#c8cfd7, light) are smaller
// floors → label-less. `observed` (#34b88a, dark-enough) → labeled, white text.
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
                    { facility: "data", scaling: "paid-once", share: 0.5, approxBytes: 500 },
                    { facility: "allocator", scaling: "paid-once", share: 0.2, approxBytes: 200 },
                    { facility: "structural", scaling: "paid-once", share: 0.05, approxBytes: 50 },
                    { facility: "observed", scaling: "observed", share: 0.25, approxBytes: 250 },
                ],
            },
        },
    ],
};

describe("renderSizeView", () => {
    it("renders a segmented sticky tray with all four control surfaces", () => {
        const html = renderSizeView(data);
        expect(html).toContain('class="sh-tray"');
        expect(html).toContain('data-ctrl="compression"');
        expect(html).toContain('data-ctrl="sizeProfile"');
        expect(html).toContain('data-tc="raw"');           // one toolchain pill
        expect(html).toContain('data-sw="observedOnly"');  // the switch
        // legacy controls are gone:
        expect(html).not.toContain('class="size-controls"');
        expect(html).not.toContain('name="compression"');
    });

    it("defaults compression=raw and profile=all to the .on segment", () => {
        const html = renderSizeView(data);
        expect(html).toContain('<span data-val="raw" class="on">raw</span>');
        expect(html).toContain('<span data-val="all" class="on">all</span>');
        // observedOnly switch defaults OFF → no .on on the .sh-sw:
        expect(html).toContain('<span class="sh-sw" data-sw="observedOnly">');
    });

    it("renders the legend swatches via segmentColor backgrounds", () => {
        const html = renderSizeView(data);
        expect(html).toContain('class="sh-legend"');
        expect(html).toContain('style="background:#6e7b8c"');  // floor key
        expect(html).toContain('style="background:#d8be73"');  // glue key
        expect(html).toContain('style="background:#34b88a"');  // observed key
        expect(html).toContain('style="background:#e0a8a8"');  // unattr key
    });

    it("emits floor and observed segments with byte data attributes on every seg", () => {
        const html = renderSizeView(data);
        expect(html).toContain('class="seg"');
        expect(html).toContain("background:#bac2cd");          // data floor shade (largest floor)
        expect(html).toContain("background:#6e7b8c");          // allocator floor shade
        expect(html).toContain("background:#34b88a");          // observed accent
        expect(html).toContain('data-raw="500"');              // data
        expect(html).toContain('data-raw="200"');              // allocator
        expect(html).toContain('data-raw="50"');               // structural
        expect(html).toContain('data-raw="250"');              // observed
        // every seg keeps its compression byte attrs + band + title:
        expect(html).toContain('data-band="floor"');
        expect(html).toContain('data-band="observed"');
        expect(html).toContain("data-gz=");
        expect(html).toContain("data-brotli=");
        expect(html).toContain("title=");
    });

    it("labels only story segments: largest floor + observed, not smaller floors", () => {
        const html = renderSizeView(data);
        // labeled segments render a .seg-lbl span with the byte+facility text:
        const labels = [...html.matchAll(/<span class="seg-lbl"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
        expect(labels).toContain("500 B data");        // largest floor → labeled
        expect(labels).toContain("250 B observed");    // observed band → labeled
        // smaller floors render NO .seg-lbl (the <title> tooltip still carries 200 B / 50 B):
        expect(labels).not.toContain("200 B allocator");   // allocator: not the largest floor
        expect(labels).not.toContain("50 B structural");   // structural: tiny floor
        expect(labels.length).toBe(2);                     // exactly the two story segments
    });

    it("adapts label text color to background luminance", () => {
        const html = renderSizeView(data);
        // observed #34b88a is dark → white label text:
        expect(html).toMatch(/background:#34b88a[^>]*>[^<]*<span class="seg-lbl" style="color:#fff">/);
        // data floor #bac2cd is light → dark label text:
        expect(html).toMatch(/background:#bac2cd[^>]*>[^<]*<span class="seg-lbl" style="color:#1f2530">/);
    });

    it("stores per-facility label text for compression-aware JS relabeling", () => {
        const html = renderSizeView(data);
        // labeled segments carry the facility name in data-fac so SIZE_JS can rebuild
        // the label when the user switches compression:
        expect(html).toContain('data-fac="observed"');
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
        // data cell: raw 500, gz round(0.5*500)=250, brotli round(0.5*450)=225;
        // single row → column max → heat bucket 5.
        expect(html).toMatch(/<td class="xlang-cell xlang-heat-5" data-raw="500" data-gz="250" data-brotli="225">500<\/td>/);
    });

    it("tags table rows with toolchain/profile so client filters can hide them", () => {
        const html = renderSizeView(data);
        expect(html).toMatch(/<tr class="xlang-row"[^>]*data-toolchain="raw"[^>]*data-profile="size"/);
    });

    it("makes the cross-lang table collapsible with heatmap-tinted cells", () => {
        const html = renderSizeView(data);
        expect(html).toContain("<details");
        expect(html).toContain("<summary");
        expect(html).toContain("xlang-heat-");   // heatmap bucket class on data cells
    });
});
