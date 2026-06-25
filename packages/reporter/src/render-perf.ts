import type { Aggregated } from "./aggregate.js";
import { buildPerfModel, type PerfImplMultiple, type PerfSlice } from "./perf-view-model.js";

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
.perf-tray{background:#f6f8fb;border-top:1px solid #eef1f5;border-bottom:1px solid #eef1f5;padding:10px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:0}
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
    return `${head}\n${rows}`;
}

function renderSegControl(ctrl: string, values: string[], active: string): string {
    const spans = values.map((v) => {
        const cls = v === active ? ' class="on"' : "";
        return `<span${cls} data-val="${escape(v)}">${escape(v)}</span>`;
    }).join("");
    return `<span class="perf-seg" data-ctrl="${ctrl}">${spans}</span>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderPerfView(agg: Aggregated): string {
    const model = buildPerfModel(agg);

    const defaultSize = model.sizes.includes("L") ? "L" : (model.sizes[0] ?? "");
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

    return `${controls}
<div class="perf-body">
${workloadSections}
</div>`;
}
