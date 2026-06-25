import type { SizeData } from "./size-data.js";
import { buildSizeViewModel, buildCrossLangTables, type BinaryViewModel, type Segment, type WorkloadTable } from "./size-view-model.js";
import { escape } from "./render-perf.js";
import { segmentColor } from "./theme.js";

export const SIZE_CSS = `
  .size-controls { display: flex; flex-wrap: wrap; gap: 1.2em; margin: 1em 0; font-size: 13px; align-items: center; }
  .size-controls fieldset { border: 1px solid #ccc; padding: 0.3em 0.6em; }
  .size-controls legend { font-size: 11px; color: #555; }
  .size-workload { margin: 1.2em 0; }
  .size-row { display: grid; grid-template-columns: 16em 1fr 8em; gap: 0.6em; align-items: center; margin: 0.3em 0; }
  .size-row .lbl { font-size: 12px; text-align: left; }
  .size-row .total { font-size: 12px; text-align: right; color: #333; }
  .size-bar { height: 26px; border-radius: 5px; background: #eef2f6; display: flex; overflow: hidden; }
  .seg { height: 100%; box-sizing: border-box; border-right: 1px solid #fff; display: flex; align-items: center; padding: 0 6px; }
  .seg:last-child { border-right: none; }
  .seg-lbl { font: 600 9.5px ui-monospace,monospace; color: #fff; white-space: nowrap; overflow: hidden; }
  .size-row.no-comp .size-bar { opacity: 0.6; }
  .size-note { font-size: 11px; color: #888; }
  .legend-band { display: inline-block; width: 0.9em; height: 0.9em; vertical-align: middle; margin-right: 0.3em; }
  table.xlang { width: auto; margin: 0.5em 0 1em; font-size: 11px; }
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
  function applySizeFilters() {
    var comp = document.querySelector('input[name="compression"]:checked').value;
    var profile = document.querySelector('input[name="sizeProfile"]:checked').value;
    var observedOnly = document.querySelector('input[name="observedOnly"]').checked;
    var checkedTc = Array.from(document.querySelectorAll('input[name="toolchain"]:checked')).map(function (c) { return c.value; });
    var key = comp === 'raw' ? 'raw' : (comp === 'gz' ? 'gz' : 'brotli');
    Array.from(document.querySelectorAll('tr.xlang-row')).forEach(function (tr) {
      var show = (profile === 'all' || tr.dataset.profile === profile) && checkedTc.indexOf(tr.dataset.toolchain) >= 0;
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
        var show = (profile === 'all' || row.dataset.profile === profile) && checkedTc.indexOf(row.dataset.toolchain) >= 0;
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
        });
        row.querySelector('.total').textContent = fmtBytes(sum);
      });
    });
  }
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.size-controls input').forEach(function (el) {
      el.addEventListener('change', applySizeFilters);
    });
    applySizeFilters();
  });
`;

/** Mirror of SIZE_JS fmtBytes — static raw-based label for inline segment text. */
function fmtBytes(n: number): string {
    return n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
}

function renderSegment(s: Segment): string {
    // Glue bytes are measured exactly (not a pre-opt share estimate), so show them without
    // the "≈" and without a share % (glue's share is 0 — it is not a wasm facility, it is
    // the separate JS-glue artifact). Facility segments keep "≈<bytes> B (<share>%)".
    const pct = s.share > 0 ? ` (${(s.share * 100).toFixed(1)}%)` : "";
    const approx = s.band === "glue" ? "" : "≈";
    const title = `${s.facility} ${approx}${s.rawBytes} B${pct}`;
    const color = segmentColor(s);
    const label = `${fmtBytes(s.rawBytes)} ${s.facility}`;
    return `<span class="seg" data-band="${s.band}" data-raw="${s.rawBytes}" data-gz="${s.gzBytes}" data-brotli="${s.brotliBytes}" style="background:${color}" title="${escape(title)}"><span class="seg-lbl">${escape(label)}</span></span>`;
}

function renderRow(b: BinaryViewModel): string {
    const noComp = b.hasComposition ? "" : " no-comp";
    const note = b.note ? ` <span class="size-note">${escape(b.note)}</span>` : "";
    return `<div class="size-row${noComp}" data-toolchain="${escape(b.toolchain)}" data-profile="${escape(b.profile)}" data-lang="${escape(b.language)}">
      <div class="lbl">${escape(b.label)}${note}</div>
      <div class="size-bar">${b.segments.map(renderSegment).join("")}</div>
      <div class="total"></div>
    </div>`;
}

function controls(toolchains: string[]): string {
    const tcBoxes = toolchains
        .map((t) => `<label><input type="checkbox" name="toolchain" value="${escape(t)}" checked> ${escape(t)}</label>`)
        .join(" ");
    return `<div class="size-controls">
    <fieldset><legend>compression</legend>
      <label><input type="radio" name="compression" value="raw" checked> raw</label>
      <label><input type="radio" name="compression" value="gz"> gzip</label>
      <label><input type="radio" name="compression" value="brotli"> brotli</label>
    </fieldset>
    <fieldset><legend>profile</legend>
      <label><input type="radio" name="sizeProfile" value="all" checked> all</label>
      <label><input type="radio" name="sizeProfile" value="size"> size</label>
      <label><input type="radio" name="sizeProfile" value="speed"> speed</label>
    </fieldset>
    <fieldset><legend>toolchains</legend>${tcBoxes}</fieldset>
    <label><input type="checkbox" name="observedOnly"> только наблюдаемое</label>
    <span class="size-note"><span class="legend-band" style="background:#6e7b8c"></span>floor (paid-once) <span class="legend-band" style="background:#d8be73"></span>glue (JS) <span class="legend-band" style="background:#34b88a"></span>observed/marginal <span class="legend-band" style="background:#e0a8a8"></span>не атрибутировано — доли по raw, абсолют ≈, шкала баров — на workload</span>
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

/** Heat bucket 1..5 from a raw value relative to its column max — deterministic, raw-based (spec §9.4). */
function heatBucket(value: number, columnMax: number): number {
    if (columnMax <= 0 || value <= 0) {
        return 1;
    }
    return Math.min(5, Math.max(1, Math.ceil((value / columnMax) * 5)));
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
            return `<tr class="xlang-row" data-toolchain="${escape(r.toolchain)}" data-profile="${escape(r.profile)}"><td>${escape(r.label)}</td>${cells}${cell(r.total, { tot: true })}</tr>`;
        })
        .join("\n");
    return `<details class="xlang-wrap"><summary class="xlang-toggle">таблица · ${escape(t.id)} · байты</summary>
    <p class="size-note">кросс-языковая таблица — байты по выбранному сжатию (доли по raw, абсолют ≈)</p>
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
