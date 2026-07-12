import type { Aggregated } from "./aggregate.js";
import { buildPerfModel, SIZE_ORDER, type PerfDetailRow, type PerfImplMultiple, type PerfSlice, type ShapeComboDetail, type ShapeGridCell, type ShapeSection } from "./perf-view-model.js";

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
.pf-t{border-collapse:collapse;font:500 10.5px ui-monospace,monospace;width:100%;table-layout:fixed}
.pf-t th,.pf-t td{padding:5px 10px;text-align:right;border-bottom:1px solid #eef1f5;white-space:nowrap;border-left:1px solid #ebeef2;overflow:hidden;text-overflow:ellipsis}
.pf-t th:first-child,.pf-t td:first-child{border-left:none;text-align:left;color:#3a4555;width:17%}
.pf-t th:nth-child(2),.pf-t td:nth-child(2){width:8%}
.pf-t th:nth-child(3),.pf-t td:nth-child(3){width:13%}
.pf-t th:nth-child(4),.pf-t td:nth-child(4){width:9%}
.pf-t th:nth-child(5),.pf-t td:nth-child(5){width:13%}
.pf-t th:nth-child(6),.pf-t td:nth-child(6){width:9%}
.pf-t th:nth-child(7),.pf-t td:nth-child(7){width:9%}
.pf-t th:nth-child(8),.pf-t td:nth-child(8){width:7%}
.pf-t th:nth-child(9),.pf-t td:nth-child(9){width:8%}
.pf-t th:nth-child(10),.pf-t td:nth-child(10){width:7%}
.pf-t th{font:700 9px ui-monospace;letter-spacing:.04em;text-transform:uppercase;color:#8a93a0;border-bottom:1px solid #d8dce3}
.pf-t tbody tr:nth-child(even){background:#fafbfc}
.pf-t tbody tr.noisy{background:#fdf6da}
.pf-t tbody tr.fail{background:#fbe4e4}
.pf-t tbody td.bad{background:#f6dd86;color:#6e5208;font-weight:700}
.pf-t tbody td.failx{background:#f1b6b6;color:#7e2626;font-weight:700}
.cbox{background:#f6f8fb;border:1px solid #e6ecf3;border-radius:5px;padding:2px 6px;display:inline-flex;align-items:center;gap:6px;width:100%;box-sizing:border-box}
.cbox .tk{flex:1;height:12px;background:#eef2f6;border:1px solid #dde4ec;border-radius:3px;overflow:hidden}
.cbox .tk i{display:block;height:100%;background:#cfe1f0}
.cbox .v{flex:0 0 38px;text-align:right;font-weight:700}
.hatch{background:repeating-linear-gradient(45deg,#9bbfdd 0 5px,#ecd98c 5px 10px)!important}
.hatch-fail{background:repeating-linear-gradient(45deg,#9bbfdd 0 5px,#e0a0a0 5px 10px)!important}
.subres{font:600 8px ui-monospace,monospace;color:#8a93a0;margin-left:5px;vertical-align:super}
.par{font:600 8px ui-monospace,monospace;color:#5b6b8a;border:1px solid #b9c4dd;border-radius:3px;padding:0 3px;margin-left:3px}
.shape-grid{display:grid;gap:6px 6px;align-items:center;margin-top:8px}
.sh-eh{grid-column:span 2;text-align:center;font:700 9px ui-monospace;letter-spacing:.05em;text-transform:uppercase;color:#8a93a0;border-bottom:1px solid #e0e5ec;padding-bottom:3px}
.sh-sub{text-align:center;font:600 10px ui-monospace;color:#9aa3b0}
.sh-impl{grid-row:span 2;font:600 12px ui-monospace;color:#3a4555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sh-lay{font:600 10px ui-monospace;color:#9aa3b0;text-align:right;padding-right:2px}
.sh-c{display:flex;align-items:center;gap:4px}
.sh-c.sh-na .sh-trk{visibility:hidden}
.sh-c.sh-na .sh-v{color:#c2c9d2}
.sh-trk{flex:1;height:12px;background:#eef2f6;border:1px solid #dde4ec;border-radius:3px;overflow:hidden}
.sh-trk i{display:block;height:100%;background:#a7c8e3}
.sh-v{flex:0 0 22px;text-align:right;font:700 10.5px ui-monospace;color:#1f2530}
.sh-d{flex:0 0 25px;text-align:left;font:600 8px ui-monospace;color:#b5762f}
.shape-cap{font:400 11px ui-sans-serif;color:#9aa3b0;margin:9px 0 2px;line-height:1.5}
.shape-cap code{font:600 10px ui-monospace;background:#eef2f6;border-radius:3px;padding:0 3px}
.perf-legend{flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:9px;font-size:10.5px;color:#56606e;align-items:center}
.pl-key{display:flex;align-items:center;gap:6px}
.pl-sw{width:14px;height:11px;border-radius:2px;display:inline-block;border:1px solid rgba(0,0,0,.08)}
.pl-badge{font:600 8px ui-monospace,monospace;color:#8a93a0;border:1px solid #cfd6de;border-radius:3px;padding:0 3px}
.perf-guide{margin:2px 0 8px;border:1px solid #cdd9e6;background:#f3f8fc;border-radius:9px}
.perf-guide>summary{font:700 10px ui-monospace,monospace;letter-spacing:.05em;text-transform:uppercase;color:#4a6c90;cursor:pointer;padding:10px 14px}
.perf-guide>summary::before{content:"ⓘ "}
.perf-guide[open]>summary{border-bottom:1px solid #e0e9f1;padding-bottom:8px}
.pg-in{padding:11px 14px 13px}
.grp-lab{font:700 8.5px ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:#8a93a0;margin:11px 0 4px}
.grp-lab:first-child{margin-top:0}
.gl2{display:grid;grid-template-columns:92px 1fr;gap:4px 12px;align-items:baseline;margin:0}
.gl2 dt{font:700 10.5px ui-monospace,monospace;color:#2f3a49;text-align:right;margin:0}
.gl2 dd{margin:0;font-size:11px;color:#4a5563;line-height:1.5}
.gl2 dd em{color:#6e5208;font-style:normal;font-weight:600}
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

  // Spoiler state is shared across (size,profile) slices by semantic data-sync key,
  // so toggling a detail in one filter keeps it open/closed in every other filter.
  var syncing = false;
  document.querySelectorAll('.perf-body details[data-sync]').forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (syncing) { return; }
      syncing = true;
      var key = d.dataset.sync;
      document.querySelectorAll('details[data-sync="' + CSS.escape(key) + '"]').forEach(function (o) {
        if (o !== d && o.open !== d.open) { o.open = d.open; }
      });
      syncing = false;
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

function renderSlice(slice: PerfSlice, workloadId: string): string {
    const max = computeGlobalMax(slice.multiples);
    const headCols = slice.envs.map((env) => `<span class="eh">${escape(env)}</span>`).join("");
    const head = `<div class="em-head"><span class="sp"></span>${headCols}</div>`;
    const rows = slice.multiples.map((m) => {
        const cells = slice.envs.map((env) => renderCell(m.byEnv[env], max)).join("");
        return `<div class="em-row"><div class="em-impl">${escape(m.impl)}</div>${cells}</div>`;
    }).join("\n");
    const detail = renderPerfDetail(slice, workloadId);
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
    const parBadge = row.parallel ? '<span class="par">&#8741;</span>' : "";

    const initCell = `<td>${renderDataBar(row.initTotal, maxInit, "")}</td>`;
    const warmCell = `<td>${renderDataBar(row.warmMedian, maxWarm, warmFillClass)}</td>`;

    return `<tr${trClass}><td>${escape(row.impl)}${badge}${parBadge}</td><td>${escape(row.env)}</td>${initCell}<td>${row.firstCall.toFixed(3)}</td>${warmCell}<td>${row.warmP95.toFixed(3)}</td><td>${row.warmMad.toFixed(3)}</td><td>${row.cv.toFixed(3)}</td><td${relSemClass}>${row.relSem.toFixed(3)}</td><td${okClass}>${okMark}</td></tr>`;
}

function renderPerfDetail(slice: PerfSlice, workloadId: string): string {
    if (slice.detail.length === 0) {
        return "";
    }
    const maxInit = slice.detail.reduce((m, r) => Math.max(m, r.initTotal), 0);
    const maxWarm = slice.detail.reduce((m, r) => Math.max(m, r.warmMedian), 0);
    const rows = slice.detail.map((row) => renderDetailRow(row, maxInit, maxWarm)).join("\n");
    return `<details data-sync="${escape(workloadId)}:all">
<summary class="pf-tg">details · all envs</summary>
<table class="pf-t">
<thead><tr><th>impl</th><th>env</th><th>init</th><th>first</th><th>warm med</th><th>p95</th><th>mad</th><th>cv</th><th>relSem</th><th>ok</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</details>`;
}

function renderPerfLegend(): string {
    return `<div class="perf-legend">
  <span class="pl-key"><span class="pl-sw" style="background:#fdf6da"></span>mean not pinned to 3% → see mad/cv</span>
  <span class="pl-key"><span class="pl-sw" style="background:#fbe4e4"></span>correctness fail (ok ✗)</span>
  <span class="pl-key"><span class="pl-badge">&lt;res</span>below timer resolution — only the mean is reliable</span>
  <span class="pl-key"><span class="par">&#8741;</span>measured under --parallel-envs (host concurrency; ±~2–9% bias)</span>
</div>`;
}

function renderPerfGuide(): string {
    return `<details class="perf-guide" open>
  <summary>how to read this tab</summary>
  <div class="pg-in">
    <div class="grp-lab">timing · ms</div>
    <dl class="gl2">
      <dt>init</dt><dd>load + compile + instantiate (cold start)</dd>
      <dt>first</dt><dd>first call, incl. JIT warm-up</dd>
      <dt>warm med</dt><dd>median of warm calls — <em>the headline</em>, lower = faster</dd>
      <dt>p95</dt><dd>95th percentile (tail)</dd>
    </dl>
    <div class="grp-lab">spread · precision</div>
    <dl class="gl2">
      <dt>mad</dt><dd>median absolute deviation, ms — spread, robust to outliers</dd>
      <dt>cv</dt><dd>coefficient of variation = σ / mean — relative run-to-run spread</dd>
      <dt>relSem</dt><dd>rel. standard error of the mean = cv / √n — precision of the mean; accept gate ≤ 3% (above it, the cell is highlighted and the row turns amber)</dd>
    </dl>
    <div class="grp-lab">correctness</div>
    <dl class="gl2">
      <dt>ok</dt><dd>reference checksum matched (✓ / ✗)</dd>
    </dl>
  </div>
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
// shape_dispatch impl×env heatmap grid + 4 collapsed per-combo detail tables
// ---------------------------------------------------------------------------

// The 4 grid cells per env are in SHAPE_DISPATCH_GRID order:
// [0] homo·static, [1] homo·dynamic, [2] mixed·static, [3] mixed·dynamic.
// Each grid row shows two sub-rows (H, M); each carries a static + dynamic cell.
const SHAPE_LAYOUT_ROWS: { label: string; staticIdx: number; dynIdx: number }[] = [
    { label: "homo", staticIdx: 0, dynIdx: 1 },
    { label: "mixed", staticIdx: 2, dynIdx: 3 },
];

const SHAPE_CAPTION =
    "<p class=\"shape-cap\">bar length = warm-median, scaled per env (max of that env, incl. js) — comparable within an env; "
    + "across envs compare the ms number · +Δ% = dynamic vs static · — = not applicable. "
    + "Static/dynamic dispatch is a static-typing concept; for a dynamically-typed language (js) the static form of "
    + "homogeneous data is identical to the dynamic form, so <code>homo_static·js</code> does not exist.</p>";

function renderShapeBar(cell: ShapeGridCell | undefined, staticSibling: ShapeGridCell | undefined, envMax: number): string {
    const wm = cell?.warmMedian ?? null;
    if (wm == null) {
        return "<div class=\"sh-c sh-na\"><span class=\"sh-trk\"></span><span class=\"sh-v\">—</span><span class=\"sh-d\"></span></div>";
    }
    let delta = "";
    if (cell?.dispatch === "dynamic") {
        const stat = staticSibling?.warmMedian ?? null;
        if (stat != null && stat > 0) {
            const pct = Math.round(((wm - stat) / stat) * 100);
            delta = `${pct >= 0 ? "+" : ""}${pct}%`;
        }
    }
    const w = envMax > 0 ? Math.min(100, Math.round((wm / envMax) * 100)) : 0;
    // value + Δ% live in fixed-width slots so tracks stay equal length and numbers align down the column.
    return `<div class="sh-c"><span class="sh-trk"><i style="width:${w}%"></i></span><span class="sh-v">${wm.toFixed(2)}</span><span class="sh-d">${escape(delta)}</span></div>`;
}

// CSS-grid small-multiples: impl rows × 3 wide env groups; each env group splits into
// static|dynamic sub-columns, and each (impl,env) intersection is a 2×2 block of 4 bars
// (homo/mixed rows × static/dynamic cols). Bars scaled per env (incl. js) so a short wasm
// bar reads as "much faster". Empty spacer cells separate env groups; the impl label spans
// its 2 (homo/mixed) rows.
function renderShapeGrid(section: ShapeSection): string {
    const envMax: Record<string, number> = {};
    for (const env of section.envs) {
        let m = 0;
        for (const row of section.rows) {
            for (const cell of row.byEnv[env] ?? []) {
                if (cell.warmMedian != null && cell.warmMedian > m) {
                    m = cell.warmMedian;
                }
            }
        }
        envMax[env] = m;
    }
    // 2 lead cols (impl, layout) + per env "1fr 1fr" (static, dynamic), 12px spacer between envs.
    const cols = `100px 40px ${section.envs.map(() => "1fr 1fr").join(" 12px ")}`;
    const sp = "<div class=\"sh-sp\"></div>";
    const corner = "<div class=\"sh-corner\"></div>";
    const envHead = section.envs.map((env) => `<div class="sh-eh">${escape(env)}</div>`).join(sp);
    const subHead = section.envs.map(() => "<div class=\"sh-sub\">static</div><div class=\"sh-sub\">dynamic</div>").join(sp);
    const body = section.rows.map((row) => SHAPE_LAYOUT_ROWS.map((lr, i) => {
        const cells = section.envs.map((env) => {
            const arr = row.byEnv[env] ?? [];
            const m = envMax[env] ?? 0;
            return renderShapeBar(arr[lr.staticIdx], undefined, m) + renderShapeBar(arr[lr.dynIdx], arr[lr.staticIdx], m);
        }).join(sp);
        const impl = i === 0 ? `<div class="sh-impl">${escape(row.impl)}</div>` : "";
        return `${impl}<div class="sh-lay">${escape(lr.label)}</div>${cells}`;
    }).join("")).join("");
    return `<div class="shape-grid" style="grid-template-columns:${cols}">${corner}${corner}${envHead}${corner}${corner}${subHead}${body}</div>`;
}

function renderShapeComboDetail(combo: ShapeComboDetail): string {
    if (combo.rows.length === 0) {
        return "";
    }
    const maxInit = combo.rows.reduce((m, r) => Math.max(m, r.initTotal), 0);
    const maxWarm = combo.rows.reduce((m, r) => Math.max(m, r.warmMedian), 0);
    const rows = combo.rows.map((r) => renderDetailRow(r, maxInit, maxWarm)).join("\n");
    return `<details data-sync="shape:${escape(combo.layout)}:${escape(combo.dispatch)}">
<summary class="pf-tg">details · ${escape(combo.layout)}·${escape(combo.dispatch)}</summary>
<table class="pf-t">
<thead><tr><th>impl</th><th>env</th><th>init</th><th>first</th><th>warm med</th><th>p95</th><th>mad</th><th>cv</th><th>relSem</th><th>ok</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</details>`;
}

function renderShapeSection(sections: ShapeSection[], defaultSize: string, defaultProfile: string): string {
    const blocks = sections.map((section) => {
        const isActive = section.size === defaultSize && section.profile === defaultProfile;
        const display = isActive ? "" : ' style="display:none"';
        const details = section.detail.map(renderShapeComboDetail).join("\n");
        return `<div class="perf-slice"${display} data-size="${escape(section.size)}" data-profile="${escape(section.profile)}">
  <div class="perf-wlh">shape_dispatch <small>${escape(section.profile)} · ${escape(section.size)}</small></div>
  ${renderShapeGrid(section)}
  ${SHAPE_CAPTION}
${details}
</div>`;
    }).join("\n");
    return `<div class="perf-wl">
  <span class="perf-eyebrow">warm-median (ms) · impl × env · each cell = 2×2 (homo/mixed × static/dynamic) · scaled per env (incl. js) · shorter = faster · +Δ% = dyn vs static</span>
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
  ${renderPerfLegend()}
</div>`;

    // Per-workload small-multiples blocks
    const workloadSections = model.workloads.map((wl) => {
        const sliceBlocks = wl.slices.map((slice) => {
            const isActive = slice.size === defaultSize && slice.profile === defaultProfile;
            const display = isActive ? "" : ' style="display:none"';
            return `<div class="perf-slice"${display} data-size="${escape(slice.size)}" data-profile="${escape(slice.profile)}">
${renderSlice(slice, wl.id)}
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
${renderPerfGuide()}
${workloadSections}
${shapeSection}
</div>`;
}
