import type { Band } from "./size-view-model.js";

// ---------------------------------------------------------------------------
// Floor facility slate-ramp (spec §2: allocator darkest → structural lightest)
// ---------------------------------------------------------------------------

/** Ordered floor facilities, darkest to lightest in the slate ramp. */
export const FLOOR_FACILITY_ORDER: string[] = [
    "allocator",
    "toolchain-runtime",
    "emscripten-runtime",
    "hash-map",
    "panic-fmt",
    "compiler-rt",
    "data",
    "dynamic-array",
    "structural",
];

const FLOOR_COLORS: Record<string, string> = {
    "allocator": "#6e7b8c",
    "toolchain-runtime": "#828f9f",
    "emscripten-runtime": "#828f9f",
    "hash-map": "#96a1af",
    "panic-fmt": "#a8b2bf",
    "compiler-rt": "#bac2cd",
    "data": "#bac2cd",
    "dynamic-array": "#c8cfd7",
    "structural": "#c8cfd7",
};

const FLOOR_FALLBACK = "#a8b2bf";

// ---------------------------------------------------------------------------
// Accent colors for non-floor bands
// ---------------------------------------------------------------------------

const BAND_ACCENT: Partial<Record<Band, string>> = {
    "glue": "#d8be73",
    "observed": "#34b88a",
    "unattributed": "#e0a8a8",
    "unknown": "#cfcfcf",
};

// ---------------------------------------------------------------------------
// segmentColor
// ---------------------------------------------------------------------------

/**
 * Return a CSS hex color for a size-bar segment.
 *
 * - Non-floor bands → fixed accent per band.
 * - Floor band → slate ramp lookup by facility; falls back to mid-slate
 *   (#a8b2bf) for unknown facilities.
 */
export function segmentColor(seg: { band: Band; facility: string }): string {
    if (seg.band !== "floor") {
        return BAND_ACCENT[seg.band] ?? FLOOR_FALLBACK;
    }
    return FLOOR_COLORS[seg.facility] ?? FLOOR_FALLBACK;
}

// ---------------------------------------------------------------------------
// SHELL_CSS — shared chrome (header, tabs, sticky tray, app container)
// Values copied verbatim from mockups s9-assembled.html (.fin-*) and
// p5-perf-assembled.html (.pf-*); spec §3 governs intent.
// ---------------------------------------------------------------------------

export const SHELL_CSS = `
*{box-sizing:border-box}
body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#1f2530;margin:0;padding:12px 16px;background:#fff}
.app{background:#fff;border:1px solid #e0e4ea;border-radius:9px;overflow:hidden;margin-top:8px}
.sh-head{display:flex;align-items:center;justify-content:space-between;padding:13px 16px 11px}
.sh-ttl{font-weight:800;font-size:16px;letter-spacing:-.015em}
.sh-ttl small{font-weight:500;font-size:11px;color:#9aa3b0;font-family:ui-monospace,monospace;margin-left:8px}
.tabbar{display:flex;gap:18px}
.tabbar button{font-weight:600;font-size:13px;color:#aab2bd;cursor:pointer;background:none;border:none;border-bottom:2px solid transparent;padding:0;font-family:inherit}
.tabbar button.on{color:#1f2530;border-bottom:2px solid #36506e;padding-bottom:3px}
.sh-tray{background:#f6f8fb;border-top:1px solid #eef1f5;border-bottom:1px solid #eef1f5;padding:10px 16px;position:sticky;top:0;z-index:10}
.sh-filt{display:flex;flex-wrap:wrap;align-items:center;gap:8px 0}
.sh-gl{font:700 9px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:#8a93a0;margin-right:6px}
.sh-grp{display:flex;align-items:center;gap:6px;padding:0 13px}
.sh-grp:first-child{padding-left:0}
.sh-div{align-self:stretch;width:1px;background:#dde2e9}
.sh-seg{display:inline-flex;border:1px solid #ccd3db;border-radius:7px;overflow:hidden}
.sh-seg span{font-weight:600;font-size:11px;color:#4a5563;padding:4px 10px;border-right:1px solid #ccd3db;background:#fff;cursor:pointer}
.sh-seg span:last-child{border-right:none}
.sh-seg span.on{background:#36506e;color:#fff}
.sh-pill{font-weight:600;font-size:11px;color:#fff;background:#36506e;border:1px solid transparent;border-radius:20px;padding:4px 11px;cursor:pointer}
.sh-pill.off{background:#e7ecf2;color:#7a8493}
.sh-sw{display:inline-flex;align-items:center;gap:7px;font-weight:600;font-size:11px;color:#46546a;cursor:pointer}
.sh-track{width:32px;height:18px;border-radius:10px;background:#cfd7e2;position:relative}
.sh-track::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff}
.sh-legend{display:flex;flex-wrap:wrap;gap:6px 15px;margin-top:9px;font-size:10.5px;color:#56606e;align-items:center}
.sh-key{display:flex;align-items:center;gap:5px}
.sh-sw2{width:11px;height:11px;border-radius:2px;display:inline-block}
.sh-note{font-size:10px;color:#9aa3b0;font-family:ui-monospace,monospace}
.sh-body{padding:6px 16px 16px}
`.trim();
