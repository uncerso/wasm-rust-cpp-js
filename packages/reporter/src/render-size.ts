import type { SizeData } from "./size-data.js";
import { buildSizeViewModel, buildCrossLangTables, type BinaryViewModel, type Segment, type WorkloadTable } from "./size-view-model.js";
import { escape } from "./render-perf.js";

export const SIZE_CSS = `
  .size-controls { display: flex; flex-wrap: wrap; gap: 1.2em; margin: 1em 0; font-size: 13px; align-items: center; }
  .size-controls fieldset { border: 1px solid #ccc; padding: 0.3em 0.6em; }
  .size-controls legend { font-size: 11px; color: #555; }
  .size-workload { margin: 1.2em 0; }
  .size-row { display: grid; grid-template-columns: 16em 1fr 8em; gap: 0.6em; align-items: center; margin: 0.3em 0; }
  .size-row .lbl { font-size: 12px; text-align: left; }
  .size-row .total { font-size: 12px; text-align: right; color: #333; }
  .size-bar { display: flex; height: 1.4em; background: #f6f6f6; border: 1px solid #ddd; overflow: hidden; }
  .seg { height: 100%; box-sizing: border-box; border-right: 1px solid rgba(255,255,255,0.85); }
  .seg:last-child { border-right: none; }
  .seg-floor { background: #b9c6d6; }
  .seg-glue { background: #d8c27a; }
  .seg-observed { background: #2f6f4f; }
  .seg-unattributed { background: #e0a0a0; }
  .seg-unknown { background: #cfcfcf; }
  .size-row.no-comp .size-bar { opacity: 0.6; }
  .size-note { font-size: 11px; color: #888; }
  .legend-band { display: inline-block; width: 0.9em; height: 0.9em; vertical-align: middle; margin-right: 0.3em; }
  table.xlang { width: auto; margin: 0.5em 0 1em; font-size: 11px; }
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

function renderSegment(s: Segment): string {
    // Glue bytes are measured exactly (not a pre-opt share estimate), so show them without
    // the "≈" and without a share % (glue's share is 0 — it is not a wasm facility, it is
    // the separate JS-glue artifact). Facility segments keep "≈<bytes> B (<share>%)".
    const pct = s.share > 0 ? ` (${(s.share * 100).toFixed(1)}%)` : "";
    const approx = s.band === "glue" ? "" : "≈";
    const title = `${s.facility} ${approx}${s.rawBytes} B${pct}`;
    return `<span class="seg seg-${s.band}" data-band="${s.band}" data-raw="${s.rawBytes}" data-gz="${s.gzBytes}" data-brotli="${s.brotliBytes}" title="${escape(title)}"></span>`;
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
    <span class="size-note"><span class="legend-band" style="background:#b9c6d6"></span>floor (paid-once) <span class="legend-band" style="background:#d8c27a"></span>glue (JS) <span class="legend-band" style="background:#2f6f4f"></span>observed/marginal <span class="legend-band" style="background:#cfcfcf"></span>не атрибутировано — доли по raw, абсолют ≈, шкала баров — на workload</span>
  </div>`;
}

function cell(c: { rawBytes: number; gzBytes: number; brotliBytes: number }): string {
    return `<td class="xlang-cell" data-raw="${c.rawBytes}" data-gz="${c.gzBytes}" data-brotli="${c.brotliBytes}">${c.rawBytes}</td>`;
}

const ZERO_CELL = { rawBytes: 0, gzBytes: 0, brotliBytes: 0 };

function renderTable(t: WorkloadTable): string {
    const head = t.facilities.map((f) => `<th>${escape(f)}</th>`).join("");
    const rows = t.rows
        .map((r) => {
            const cells = t.facilities.map((f) => cell(r.byFacility[f] ?? ZERO_CELL)).join("");
            return `<tr class="xlang-row" data-toolchain="${escape(r.toolchain)}" data-profile="${escape(r.profile)}"><td>${escape(r.label)}</td>${cells}${cell(r.total)}</tr>`;
        })
        .join("\n");
    return `<p class="size-note">кросс-языковая таблица — байты по выбранному сжатию (доли по raw, абсолют ≈)</p>
    <table class="xlang"><thead><tr><th>impl</th>${head}<th>total</th></tr></thead><tbody>${rows}</tbody></table>`;
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
