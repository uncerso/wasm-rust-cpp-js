import type { SizeData } from "./size-data.js";
import { buildSizeViewModel, buildCrossLangTables, type BinaryViewModel, type Segment, type WorkloadTable } from "./size-view-model.js";
import { escape } from "./render-perf.js";
import { segmentColor } from "./theme.js";

export const SIZE_CSS = `
  .sh-sw.on .sh-track { background: #36506e; }
  .sh-sw.on .sh-track::after { left: 16px; }
  .size-workload { margin: 1.2em 0; }
  .size-row { display: grid; grid-template-columns: 16em 1fr 8em; gap: 0.6em; align-items: center; margin: 0.3em 0; }
  .size-row .lbl { font-size: 12px; text-align: left; }
  .size-row .total { font-size: 12px; text-align: right; color: #333; }
  .size-bar { height: 26px; border-radius: 5px; background: #eef2f6; display: flex; overflow: hidden; }
  /* min-width:0 lets each flex seg shrink to its byte-proportional width% instead of
     being forced wider by its label's min-content size (which also made proportions
     drift on resize). Padding lives on the label, so unlabeled slivers stay exact. */
  .seg { height: 100%; box-sizing: border-box; border-right: 1px solid #fff; display: flex; align-items: center; min-width: 0; overflow: hidden; }
  .seg:last-child { border-right: none; }
  .seg-lbl { font: 600 9.5px ui-monospace,monospace; color: #fff; white-space: nowrap; overflow: hidden; min-width: 0; padding: 0 6px; }
  .size-row.no-comp .size-bar { opacity: 0.6; }
  .size-note { font-size: 11px; color: #888; }
  table.xlang { border-collapse: collapse; font: 500 10.5px ui-monospace,monospace; width: 100%; margin: 0.5em 0 1em; }
  table.xlang th, table.xlang td { padding: 3px 8px; text-align: right; border-bottom: 1px solid #eef1f5; white-space: nowrap; }
  table.xlang th { font: 700 9px ui-monospace,monospace; letter-spacing: .04em; text-transform: uppercase; color: #8a93a0; border-bottom: 1px solid #d8dce3; }
  table.xlang td:first-child, table.xlang th:first-child { text-align: left; color: #3a4555; }
  table.xlang tbody tr:nth-child(even) { background: #fafbfc; }
  table.xlang td.z { color: #c4ccd6; }
  table.xlang th.tot, table.xlang td.tot { border-left: 1px solid #e3e7ec; }
  table.xlang td.tot { font-weight: 700; color: #1f2530; }
  .xlang-heat-1 { background: #f3f5f8; }
  .xlang-heat-2 { background: #dde3ea; }
  .xlang-heat-3 { background: #c2cbd7; color: #1f2530; }
  .xlang-heat-4 { background: #9aa7b8; color: #fff; }
  .xlang-heat-5 { background: #6e7d92; color: #fff; }
  summary.xlang-toggle { cursor: pointer; font-size: 11px; color: #555; margin: 0.5em 0; user-select: none; }
`;

export const SIZE_JS = `
  function fmtBytes(n) { return n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B'; }
  function segBytes(seg, comp) { return Number(seg.dataset[comp]); }
  function segValue(ctrl) {
    var on = document.querySelector('.sh-seg[data-ctrl="' + ctrl + '"] span.on');
    return on ? on.dataset.val : null;
  }
  function applySizeFilters() {
    var comp = segValue('compression');
    var profile = segValue('sizeProfile');
    var observedOnly = document.querySelector('.sh-sw[data-sw="observedOnly"]').classList.contains('on');
    var checkedTc = Array.prototype.slice.call(document.querySelectorAll('.sh-pill'))
      .filter(function (p) { return !p.classList.contains('off'); })
      .map(function (p) { return p.dataset.tc; });
    var key = comp === 'raw' ? 'raw' : (comp === 'gz' ? 'gz' : 'brotli');
    Array.from(document.querySelectorAll('tr.xlang-row')).forEach(function (tr) {
      var show = (profile === 'all' || tr.dataset.profile === profile || tr.dataset.agnostic === '1') && checkedTc.indexOf(tr.dataset.toolchain) >= 0;
      tr.style.display = show ? '' : 'none';
    });
    Array.from(document.querySelectorAll('.xlang-cell')).forEach(function (td) {
      td.textContent = td.dataset[key];
    });
    // Bars scale PER workload block: each .size-workload uses its own largest visible
    // binary as 100%, so small workloads stay readable (cross-workload absolutes live in
    // the total column + table). A global max would crush a 300 B workload next to a 19 KB one.
    Array.from(document.querySelectorAll('.size-workload')).forEach(function (wl) {
      var rows = Array.from(wl.querySelectorAll('.size-row'));
      var visible = [];
      rows.forEach(function (row) {
        var show = (profile === 'all' || row.dataset.profile === profile || row.dataset.agnostic === '1') && checkedTc.indexOf(row.dataset.toolchain) >= 0;
        row.style.display = show ? '' : 'none';
        if (show) { visible.push(row); }
      });
      var maxBar = 0;
      visible.forEach(function (row) {
        var sum = 0;
        Array.from(row.querySelectorAll('.seg')).forEach(function (seg) {
          var hide = observedOnly && seg.dataset.band !== 'observed';
          sum += hide ? 0 : segBytes(seg, key);
        });
        if (sum > maxBar) { maxBar = sum; }
      });
      visible.forEach(function (row) {
        var segs = Array.from(row.querySelectorAll('.seg'));
        var sum = 0;
        segs.forEach(function (seg) {
          var hide = observedOnly && seg.dataset.band !== 'observed';
          seg.style.display = hide ? 'none' : '';
          if (!hide) { sum += segBytes(seg, key); }
        });
        var barPct = maxBar > 0 ? (sum / maxBar) * 100 : 0;
        row.querySelector('.size-bar').style.width = barPct.toFixed(3) + '%';
        segs.forEach(function (seg) {
          var b = segBytes(seg, key);
          seg.style.width = (sum > 0 && seg.style.display !== 'none') ? ((b / sum) * 100).toFixed(3) + '%' : '0';
          // #9: rebuild the visible label in the selected compression's bytes so the
          // label tracks the bar instead of staying frozen on raw KB.
          var lbl = seg.querySelector('.seg-lbl');
          if (lbl) { lbl.textContent = fmtBytes(b) + ' ' + seg.dataset.fac; }
          // #4: rebuild the tooltip in the selected compression's exact bytes too.
          var approx = seg.dataset.band === 'glue' ? '' : '≈';
          var shareStr = seg.dataset.share ? ' (' + seg.dataset.share + '%)' : '';
          seg.title = seg.dataset.fac + ' ' + approx + b + ' B' + shareStr;
        });
        row.querySelector('.total').textContent = fmtBytes(sum);
      });
    });
    fitLabels();
  }
  // #3: a segment label is only shown when its text actually fits the segment's current
  // pixel width — segment widths are %-based, so the fit can only be known at runtime and
  // changes with the window. Measuring (scrollWidth vs clientWidth) and hiding non-fitting
  // labels avoids mid-glyph clipping; fitLabels re-runs on resize.
  function fitLabels() {
    // Batched to avoid layout thrash now that every segment carries a label: first show all
    // candidate labels (writes), then measure all (reads → one reflow), then hide the
    // non-fitting (writes). Hiding a label can't change another seg's width (min-width:0 +
    // %-widths), so the single measurement pass stays valid.
    var lbls = [];
    Array.prototype.forEach.call(document.querySelectorAll('.size-row'), function (row) {
      if (row.style.display === 'none') { return; }
      Array.prototype.forEach.call(row.querySelectorAll('.seg'), function (seg) {
        var lbl = seg.querySelector('.seg-lbl');
        if (!lbl) { return; }
        if (seg.style.display === 'none') { lbl.style.display = 'none'; return; }
        lbl.style.display = '';
        lbls.push(lbl);
      });
    });
    var hide = lbls.filter(function (lbl) { return lbl.scrollWidth > lbl.clientWidth + 1; });
    hide.forEach(function (lbl) { lbl.style.display = 'none'; });
  }
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.sh-seg').forEach(function (seg) {
      seg.querySelectorAll('span[data-val]').forEach(function (opt) {
        opt.addEventListener('click', function () {
          seg.querySelectorAll('span[data-val]').forEach(function (s) { s.classList.remove('on'); });
          opt.classList.add('on');
          applySizeFilters();
        });
      });
    });
    document.querySelectorAll('.sh-pill').forEach(function (pill) {
      pill.addEventListener('click', function () {
        pill.classList.toggle('off');
        applySizeFilters();
      });
    });
    document.querySelectorAll('.sh-sw').forEach(function (sw) {
      sw.addEventListener('click', function () {
        sw.classList.toggle('on');
        applySizeFilters();
      });
    });
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fitLabels, 100);
    });
    applySizeFilters();
  });
`;

/** Mirror of SIZE_JS fmtBytes — static raw-based label for inline segment text. */
function fmtBytes(n: number): string {
    return n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
}

/**
 * Display label: JS ships one bundle with no size/speed build variant, so its
 * `${lang}/${toolchain}/${profile}` label carries a meaningless profile suffix — drop it
 * (→ `${lang}/${toolchain}`). Applies to every JS toolchain (idiomatic, typed-array).
 */
function dispLabel(label: string, isJs: boolean): string {
    return isJs ? label.replace(/\/[^/]+$/, "") : label;
}

/**
 * Pick a label text color that stays legible on the segment background. Light shades
 * (luminance > 150) get dark ink (#1f2530); dark shades keep white. Luminance uses the
 * standard perceptual weighting (0.299r+0.587g+0.114b). Mirrors mockup `.t-d` intent.
 */
function labelColor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance > 150 ? "#1f2530" : "#fff";
}

function renderSegment(s: Segment): string {
    // Glue bytes are measured exactly (not a pre-opt share estimate), so show them without
    // the "≈" and without a share % (glue's share is 0 — it is not a wasm facility, it is
    // the separate JS-glue artifact). Facility segments keep "≈<bytes> B (<share>%)".
    const shareStr = s.share > 0 ? `${(s.share * 100).toFixed(1)}` : "";
    const pct = shareStr ? ` (${shareStr}%)` : "";
    const approx = s.band === "glue" ? "" : "≈";
    const title = `${s.facility} ${approx}${s.rawBytes} B${pct}`;
    const color = segmentColor(s);
    // data-fac / data-share carry the facility text + raw share% so SIZE_JS can rebuild
    // BOTH the visible label and the tooltip for the selected compression (#9, #4).
    const facAttr = ` data-fac="${escape(s.facility)}" data-share="${shareStr}"`;
    // EVERY segment carries a label; the client (SIZE_JS fitLabels) hides only the labels
    // whose text can't fit the segment's current pixel width, so widening the window surfaces
    // more of them. The <title> tooltip always carries full detail regardless.
    const label = `${fmtBytes(s.rawBytes)} ${s.facility}`;
    const lbl = `<span class="seg-lbl" style="color:${labelColor(color)}">${escape(label)}</span>`;
    return `<span class="seg" data-band="${s.band}" data-raw="${s.rawBytes}" data-gz="${s.gzBytes}" data-brotli="${s.brotliBytes}"${facAttr} style="background:${color}" title="${escape(title)}">${lbl}</span>`;
}

function renderRow(b: BinaryViewModel): string {
    const noComp = b.hasComposition ? "" : " no-comp";
    const note = b.note ? ` <span class="size-note">${escape(b.note)}</span>` : "";
    const bars = b.segments.map((s) => renderSegment(s)).join("");
    // JS has no size/speed build variant — it ships one bundle tagged with a single
    // profile. Mark it profile-agnostic so the profile filter shows it under any profile.
    const agnostic = b.isJs ? ' data-agnostic="1"' : "";
    return `<div class="size-row${noComp}" data-toolchain="${escape(b.toolchain)}" data-profile="${escape(b.profile)}"${agnostic} data-lang="${escape(b.language)}">
      <div class="lbl">${escape(dispLabel(b.label, b.isJs))}${note}</div>
      <div class="size-bar">${bars}</div>
      <div class="total"></div>
    </div>`;
}

/** A segmented control: each value is a `<span data-val>`; the active one gets `.on`. */
function segment(ctrl: string, values: { val: string; label: string }[], active: string): string {
    const spans = values
        .map((v) => {
            const on = v.val === active ? ' class="on"' : "";
            return `<span data-val="${escape(v.val)}"${on}>${escape(v.label)}</span>`;
        })
        .join("");
    return `<span class="sh-seg" data-ctrl="${escape(ctrl)}">${spans}</span>`;
}

function controls(toolchains: string[]): string {
    const compSeg = segment("compression", [
        { val: "raw", label: "raw" },
        { val: "gz", label: "gzip" },
        { val: "brotli", label: "brotli" },
    ], "raw");
    const profileSeg = segment("sizeProfile", [
        { val: "all", label: "all" },
        { val: "size", label: "size" },
        { val: "speed", label: "speed" },
    ], "all");
    const pills = toolchains
        .map((t) => `<span class="sh-pill" data-tc="${escape(t)}">${escape(t)}</span>`)
        .join("");
    return `<div class="sh-tray">
    <div class="sh-filt">
      <div class="sh-grp"><span class="sh-gl">compression</span>${compSeg}</div>
      <div class="sh-div"></div>
      <div class="sh-grp"><span class="sh-gl">profile</span>${profileSeg}</div>
      <div class="sh-div"></div>
      <div class="sh-grp"><span class="sh-gl">toolchains</span>${pills}</div>
      <div class="sh-div"></div>
      <div class="sh-grp"><span class="sh-sw" data-sw="observedOnly"><span class="sh-track"></span>observed only</span></div>
    </div>
    <div class="sh-legend">
      <span class="sh-key"><span class="sh-sw2" style="background:#6e7b8c"></span>floor (slate ramp by facility)</span>
      <span class="sh-key"><span class="sh-sw2" style="background:#d8be73"></span>glue (JS)</span>
      <span class="sh-key"><span class="sh-sw2" style="background:#34b88a"></span>observed / marginal</span>
      <span class="sh-key"><span class="sh-sw2" style="background:#e0a8a8"></span>unattributed</span>
      <span class="sh-note">· shares by raw, abs ≈, scale per workload</span>
    </div>
  </div>`;
}

interface CellOpts {
    bucket?: number;   // heatmap bucket 1..5 (omitted for muted-zero / total cells)
    zero?: boolean;    // muted zero contributor
    tot?: boolean;     // emphasized total column
}

function cell(c: { rawBytes: number; gzBytes: number; brotliBytes: number }, opts: CellOpts = {}): string {
    const classes = ["xlang-cell"];
    if (opts.tot) {
        classes.push("tot");
    } else if (opts.zero) {
        classes.push("z");
    } else if (opts.bucket) {
        classes.push(`xlang-heat-${opts.bucket}`);
    }
    return `<td class="${classes.join(" ")}" data-raw="${c.rawBytes}" data-gz="${c.gzBytes}" data-brotli="${c.brotliBytes}">${c.rawBytes}</td>`;
}

const ZERO_CELL = { rawBytes: 0, gzBytes: 0, brotliBytes: 0 };

/**
 * Heat bucket 1..5 from a raw value relative to its column max — deterministic, raw-based (spec §9.4).
 * `round` (not `ceil`) spreads the gradation evenly: the column max still lands in bucket 5, but values
 * below it distribute across 1..4 instead of saturating the top bucket.
 */
function heatBucket(value: number, columnMax: number): number {
    if (columnMax <= 0 || value <= 0) {
        return 1;
    }
    return Math.min(5, Math.max(1, Math.round((value / columnMax) * 5)));
}

function renderTable(t: WorkloadTable): string {
    const head = t.facilities.map((f) => `<th>${escape(f)}</th>`).join("");
    const colMax = new Map<string, number>();
    for (const f of t.facilities) {
        colMax.set(f, t.rows.reduce((m, r) => Math.max(m, r.byFacility[f]?.rawBytes ?? 0), 0));
    }
    const rows = t.rows
        .map((r) => {
            const cells = t.facilities
                .map((f) => {
                    const c = r.byFacility[f] ?? ZERO_CELL;
                    return c.rawBytes <= 0
                        ? cell(c, { zero: true })
                        : cell(c, { bucket: heatBucket(c.rawBytes, colMax.get(f) ?? 0) });
                })
                .join("");
            const agnostic = r.isJs ? ' data-agnostic="1"' : "";
            return `<tr class="xlang-row" data-toolchain="${escape(r.toolchain)}" data-profile="${escape(r.profile)}"${agnostic}><td>${escape(dispLabel(r.label, r.isJs))}</td>${cells}${cell(r.total, { tot: true })}</tr>`;
        })
        .join("\n");
    return `<details class="xlang-wrap"><summary class="xlang-toggle">table · ${escape(t.id)} · bytes</summary>
    <p class="size-note">cross-language table — bytes by selected compression (shares by raw, abs ≈)</p>
    <table class="xlang"><thead><tr><th>impl</th>${head}<th class="tot">total</th></tr></thead><tbody>${rows}</tbody></table></details>`;
}

export function renderSizeView(data: SizeData): string {
    const vm = buildSizeViewModel(data);
    const toolchains = [...new Set(vm.binaries.map((b) => b.toolchain))].sort();
    const tables = buildCrossLangTables(vm);
    const byWorkload = new Map<string, BinaryViewModel[]>();
    for (const b of vm.binaries) {
        const arr = byWorkload.get(b.id) ?? [];
        arr.push(b);
        byWorkload.set(b.id, arr);
    }
    const groups = [...byWorkload.entries()]
        .map(([id, bins]) => {
            const table = tables.find((t) => t.id === id);
            const tableHtml = table ? renderTable(table) : "";
            return `<div class="size-workload"><h2>${escape(id)}</h2>${bins.map(renderRow).join("\n")}\n${tableHtml}</div>`;
        })
        .join("\n");
    return `${controls(toolchains)}\n${groups}`;
}
