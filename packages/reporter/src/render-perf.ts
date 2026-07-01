import type { Aggregated } from "./aggregate.js";
import { buildPerfModel, SIZE_ORDER, type PerfDetailRow, type PerfImplMultiple, type PerfSlice, type ShapeCell, type ShapeSlice } from "./perf-view-model.js";

const ESCAPES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

export function escape(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

export const PERF_CSS = `
.perf-tray{background:#f6f8fb;border-top:1px solid #eef1f5;border-bottom:1px solid #eef1f5;padding:10px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:0;position:sticky;top:0;z-index:10}
.perf-gl{font:700 9px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:#8a93a0;margin-right:6px}
.perf-grp{display:flex;align-items:center;gap:6px;padding:0 13px}
.perf-grp:first-child{padding-left:0}
.perf-div{align-self:stretch;width:1px;background:#dde2e9}
.perf-seg{display:inline-flex;border:1px solid #ccd3db;border-radius:7px;overflow:hidden}
.perf-seg span{font-weight:600;font-size:11px;color:#4a5563;padding:4px 10px;border-right:1px solid #ccd3db;background:#fff;cursor:pointer}
.perf-seg span:last-child{border-right:none}
.perf-seg span.on{background:#36506e;color:#fff}
.perf-body{padding:10px 16px 16px}
.perf-wl{padding:14px 0}
.perf-wl+.perf-wl{border-top:1px solid #e7eaef}
.perf-eyebrow{font:600 9px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#9aa3b0}
.perf-wlh{font-weight:700;font-size:15px;margin:2px 0 10px}
.em-head{display:flex;align-items:center;gap:14px;margin-bottom:7px}
.em-head .sp{flex:0 0 122px}
.em-head .eh{flex:1;font:700 10px ui-monospace;letter-spacing:.07em;text-transform:uppercase;color:#8a93a0;text-align:center}
.em-row{display:flex;align-items:center;gap:14px;margin:7px 0}
.em-impl{flex:0 0 122px;font:600 12px ui-monospace;color:#3a4555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.em-cell{flex:1;display:flex;align-items:center;gap:8px}
.em-trk{flex:1;height:15px;background:#eef2f6;border:1px solid #dde4ec;border-radius:3px;overflow:hidden}
.em-trk i{display:block;height:100%;background:#a7c8e3}
.em-v{flex:0 0 42px;text-align:right;font:700 11px ui-monospace;color:#1f2530}
.pf-tg{font:600 10px ui-monospace,monospace;color:#9aa3b0;margin:12px 0 5px;cursor:pointer}
.pf-t{border-collapse:collapse;font:500 10.5px ui-monospace,monospace;width:100%}
.pf-t th,.pf-t td{padding:5px 10px;text-align:right;border-bottom:1px solid #eef1f5;white-space:nowrap;border-left:1px solid #ebeef2}
.pf-t th:first-child,.pf-t td:first-child{border-left:none;text-align:left;color:#3a4555}
.pf-t th{font:700 9px ui-monospace;letter-spacing:.04em;text-transform:uppercase;color:#8a93a0;border-bottom:1px solid #d8dce3}
.pf-t tbody tr:nth-child(even){background:#fafbfc}
.pf-t tbody tr.noisy{background:#fdf6da}
.pf-t tbody tr.fail{background:#fbe4e4}
.pf-t tbody td.bad{background:#f6dd86;color:#6e5208;font-weight:700}
.pf-t tbody td.failx{background:#f1b6b6;color:#7e2626;font-weight:700}
.cbox{background:#f6f8fb;border:1px solid #e6ecf3;border-radius:5px;padding:2px 6px;display:inline-flex;align-items:center;gap:6px;width:118px}
.cbox .tk{flex:1;height:12px;background:#eef2f6;border:1px solid #dde4ec;border-radius:3px;overflow:hidden}
.cbox .tk i{display:block;height:100%;background:#cfe1f0}
.cbox .v{flex:0 0 38px;text-align:right;font-weight:700}
.hatch{background:repeating-linear-gradient(45deg,#9bbfdd 0 5px,#ecd98c 5px 10px)!important}
.hatch-fail{background:repeating-linear-gradient(45deg,#9bbfdd 0 5px,#e0a0a0 5px 10px)!important}
.subres{font:600 8px ui-monospace,monospace;color:#8a93a0;margin-left:5px;vertical-align:super}
.shape-heat{border-collapse:separate;border-spacing:6px;margin-top:4px}
.shape-heat th{font:700 9px ui-monospace;letter-spacing:.05em;text-transform:uppercase;color:#8a93a0;padding:2px 6px;text-align:center}
.shape-heat th.rh{text-align:right}
.shape-heat td{width:120px;height:48px;border-radius:7px;text-align:center;vertical-align:middle;font:700 15px ui-monospace;position:relative}
.shape-heat .dlt{font:600 8px ui-monospace;position:absolute;top:4px;right:7px}
.shape-heat td.a1{background:#e9f0f6;color:#1f2530}
.shape-heat td.a2{background:#cfe0ee;color:#1f2530}
.shape-heat td.a3{background:#a7c4dd;color:#143049}
.shape-heat td.a4{background:#7aa0c2;color:#fff}
.shape-heat td.a5{background:#4f7ea6;color:#fff}
.shape-heat td.a1 .dlt,.shape-heat td.a2 .dlt{color:#b5762f}
.shape-heat td.a5 .dlt{color:#fff;opacity:.85}
.shape-cap{font:400 11px ui-sans-serif;color:#9aa3b0;margin:7px 0 0}
`.trim();

// ---------------------------------------------------------------------------
// JS (slice toggle)
// ---------------------------------------------------------------------------

export const PERF_JS = `
(function () {
  function activateSlice(size, profile) {
    document.querySelectorAll('.perf-slice').forEach(function (el) {
      el.style.display = (el.dataset.size === size && el.dataset.profile === profile) ? '' : 'none';
    });
    document.querySelectorAll('.perf-seg[data-ctrl="size"] span').forEach(function (el) {
      el.classList.toggle('on', el.dataset.val === size);
    });
    document.querySelectorAll('.perf-seg[data-ctrl="profile"] span').forEach(function (el) {
      el.classList.toggle('on', el.dataset.val === profile);
    });
  }
  var activeSize = document.querySelector('.perf-seg[data-ctrl="size"] span.on');
  var activeProfile = document.querySelector('.perf-seg[data-ctrl="profile"] span.on');
  var curSize = activeSize ? activeSize.dataset.val : '';
  var curProfile = activeProfile ? activeProfile.dataset.val : '';
  document.querySelectorAll('.perf-seg[data-ctrl="size"] span').forEach(function (el) {
    el.addEventListener('click', function () {
      curSize = el.dataset.val || '';
      activateSlice(curSize, curProfile);
    });
  });
  document.querySelectorAll('.perf-seg[data-ctrl="profile"] span').forEach(function (el) {
    el.addEventListener('click', function () {
      curProfile = el.dataset.val || '';
      activateSlice(curSize, curProfile);
    });
  });
}());
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeGlobalMax(multiples: PerfImplMultiple[]): number {
    let max = 0;
    for (const m of multiples) {
        for (const v of Object.values(m.byEnv)) {
            if (v != null && v > max) {
                max = v;
            }
        }
    }
    return max;
}

function renderCell(value: number | null | undefined, max: number): string {
    if (value == null) {
        return "<div class=\"em-cell\"><span class=\"em-v\">—</span></div>";
    }
    const pct = max > 0 ? Math.round((value / max) * 100) : 0;
    return `<div class="em-cell"><span class="em-trk"><i style="width:${pct}%"></i></span><span class="em-v">${value.toFixed(3)}</span></div>`;
}

function renderSlice(slice: PerfSlice): string {
    const max = computeGlobalMax(slice.multiples);
    const headCols = slice.envs.map((env) => `<span class="eh">${escape(env)}</span>`).join("");
    const head = `<div class="em-head"><span class="sp"></span>${headCols}</div>`;
    const rows = slice.multiples.map((m) => {
        const cells = slice.envs.map((env) => renderCell(m.byEnv[env], max)).join("");
        return `<div class="em-row"><div class="em-impl">${escape(m.impl)}</div>${cells}</div>`;
    }).join("\n");
    const detail = renderPerfDetail(slice);
    return `${head}\n${rows}${detail ? "\n" + detail : ""}`;
}

function renderDataBar(value: number, max: number, fillClass: string): string {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0;
    return `<span class="cbox"><span class="tk"><i style="width:${pct}%" class="${fillClass}"></i></span><span class="v">${value.toFixed(3)}</span></span>`;
}

function renderDetailRow(row: PerfDetailRow, maxInit: number, maxWarm: number): string {
    const isFail = row.correctnessFailed;
    const isImprecise = !isFail && row.meanImprecise;

    const trClass = isFail ? ' class="fail"' : isImprecise ? ' class="noisy"' : "";
    const warmFillClass = isFail ? "hatch-fail" : isImprecise ? "hatch" : "";
    // relSem is the acceptance gate: highlight it as the cell that turned the row amber
    // (the reader's cue for *why* the mean is flagged imprecise).
    const relSemClass = isImprecise ? ' class="bad"' : "";
    const okClass = isFail ? ' class="failx"' : "";
    const okMark = row.validated ? "✓" : "✗";
    const badge = row.subResolution ? '<span class="subres">&lt;res</span>' : "";

    const initCell = `<td>${renderDataBar(row.initTotal, maxInit, "")}</td>`;
    const warmCell = `<td>${renderDataBar(row.warmMedian, maxWarm, warmFillClass)}</td>`;

    return `<tr${trClass}><td>${escape(row.impl)}${badge}</td><td>${escape(row.env)}</td>${initCell}<td>${row.firstCall.toFixed(3)}</td>${warmCell}<td>${row.warmP95.toFixed(3)}</td><td>${row.warmMad.toFixed(3)}</td><td>${row.cv.toFixed(3)}</td><td${relSemClass}>${row.relSem.toFixed(3)}</td><td${okClass}>${okMark}</td></tr>`;
}

function renderPerfDetail(slice: PerfSlice): string {
    if (slice.detail.length === 0) {
        return "";
    }
    const maxInit = slice.detail.reduce((m, r) => Math.max(m, r.initTotal), 0);
    const maxWarm = slice.detail.reduce((m, r) => Math.max(m, r.warmMedian), 0);
    const rows = slice.detail.map((row) => renderDetailRow(row, maxInit, maxWarm)).join("\n");
    return `<details>
<summary class="pf-tg">details · all envs</summary>
<table class="pf-t">
<thead><tr><th>impl</th><th>env</th><th>init</th><th>first</th><th>warm med</th><th>p95</th><th>mad</th><th>cv</th><th>relSem</th><th>ok</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</details>`;
}

function renderSegControl(ctrl: string, values: string[], active: string): string {
    const spans = values.map((v) => {
        const cls = v === active ? ' class="on"' : "";
        return `<span${cls} data-val="${escape(v)}">${escape(v)}</span>`;
    }).join("");
    return `<span class="perf-seg" data-ctrl="${escape(ctrl)}">${spans}</span>`;
}

// ---------------------------------------------------------------------------
// shape_dispatch 2×2 heatmap (pinned: node · rust/raw · speed · L)
// ---------------------------------------------------------------------------

/** Heat bucket 1..5 from a warm-median relative to the max of the 4 pinned cells. */
function shapeBucket(value: number, max: number): number {
    if (max <= 0) {
        return 1;
    }
    return Math.min(5, Math.max(1, Math.round((value / max) * 5)));
}

function renderShapeHeatTable(cells: ShapeCell[]): string {
    const max = cells.reduce((m, c) => (c.warmMedian != null ? Math.max(m, c.warmMedian) : m), 0);
    const at = (layout: string, dispatch: string): ShapeCell | undefined =>
        cells.find((c) => c.layout === layout && c.dispatch === dispatch);
    const renderCellTd = (layout: string, dispatch: string): string => {
        const wm = at(layout, dispatch)?.warmMedian ?? null;
        if (wm == null) {
            return "<td>—</td>";
        }
        let delta = "";
        if (dispatch === "dynamic") {
            const stat = at(layout, "static")?.warmMedian ?? null;
            if (stat != null && stat > 0) {
                const pct = Math.round(((wm - stat) / stat) * 100);
                delta = `<span class="dlt">${pct >= 0 ? "+" : ""}${pct}%</span>`;
            }
        }
        return `<td class="a${shapeBucket(wm, max)}">${wm.toFixed(2)}${delta}</td>`;
    };
    const row = (layout: string): string =>
        `<tr><th class="rh">${escape(layout)}</th>${renderCellTd(layout, "static")}${renderCellTd(layout, "dynamic")}</tr>`;
    return `<table class="shape-heat">
    <thead><tr><th></th><th>static</th><th>dynamic</th></tr></thead>
    <tbody>${row("homo")}${row("mixed")}</tbody>
  </table>`;
}

function renderShapeSection(slices: ShapeSlice[], defaultSize: string, defaultProfile: string): string {
    const blocks = slices.map((slice) => {
        const isActive = slice.size === defaultSize && slice.profile === defaultProfile;
        const display = isActive ? "" : ' style="display:none"';
        return `<div class="perf-slice"${display} data-size="${escape(slice.size)}" data-profile="${escape(slice.profile)}">
  <div class="perf-wlh">shape_dispatch <small>node · rust/raw · ${escape(slice.profile)} · ${escape(slice.size)}</small></div>
  ${renderShapeHeatTable(slice.cells)}
  <p class="shape-cap">color = relative warm-median (darker = slower) · +Δ = dynamic vs static</p>
</div>`;
    }).join("\n");
    return `<div class="perf-wl">
  <span class="perf-eyebrow">warm-median (ms) · node · rust/raw · follows selected size/profile</span>
${blocks}
</div>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderPerfView(agg: Aggregated): string {
    const model = buildPerfModel(agg);

    // Default to the LARGEST available size — its data is the most representative.
    const defaultSize = model.sizes.length
        ? model.sizes.reduce((best, s) => (SIZE_ORDER.indexOf(s) > SIZE_ORDER.indexOf(best) ? s : best))
        : "";
    const defaultProfile = model.profiles.includes("speed") ? "speed" : (model.profiles[0] ?? "");

    // Controls
    const sizeCtrl = renderSegControl("size", model.sizes, defaultSize);
    const profileCtrl = renderSegControl("profile", model.profiles, defaultProfile);
    const controls = `<div class="perf-tray">
  <div class="perf-grp"><span class="perf-gl">size</span>${sizeCtrl}</div>
  <div class="perf-div"></div>
  <div class="perf-grp"><span class="perf-gl">profile</span>${profileCtrl}</div>
</div>`;

    // Per-workload small-multiples blocks
    const workloadSections = model.workloads.map((wl) => {
        const sliceBlocks = wl.slices.map((slice) => {
            const isActive = slice.size === defaultSize && slice.profile === defaultProfile;
            const display = isActive ? "" : ' style="display:none"';
            return `<div class="perf-slice"${display} data-size="${escape(slice.size)}" data-profile="${escape(slice.profile)}">
${renderSlice(slice)}
</div>`;
        }).join("\n");
        return `<div class="perf-wl">
  <span class="perf-eyebrow">warm-median (ms) · lower = faster · shared scale</span>
  <div class="perf-wlh">${escape(wl.id)}</div>
${sliceBlocks}
</div>`;
    }).join("\n");

    const shapeSection = model.shapeDispatch ? renderShapeSection(model.shapeDispatch, defaultSize, defaultProfile) : "";

    return `${controls}
<div class="perf-body">
${workloadSections}
${shapeSection}
</div>`;
}
