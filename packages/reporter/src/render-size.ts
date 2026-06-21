import type { SizeData } from "./size-data.js";
import { buildSizeViewModel, type BinaryViewModel, type Segment } from "./size-view-model.js";
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
  .seg-observed { background: #2f6f4f; }
  .seg-unattributed { background: #e0a0a0; }
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
    var rows = Array.from(document.querySelectorAll('.size-row'));
    var visible = [];
    rows.forEach(function (row) {
      var show = (profile === 'all' || row.dataset.profile === profile) && checkedTc.indexOf(row.dataset.toolchain) >= 0;
      row.style.display = show ? '' : 'none';
      if (show) { visible.push(row); }
    });
    var maxBar = 0;
    visible.forEach(function (row) {
      var segs = Array.from(row.querySelectorAll('.seg'));
      var sum = 0;
      segs.forEach(function (seg) {
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
  }
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.size-controls input').forEach(function (el) {
      el.addEventListener('change', applySizeFilters);
    });
    applySizeFilters();
  });
`;

function renderSegment(s: Segment): string {
    const title = `${s.facility} ≈${s.rawBytes} B (${(s.share * 100).toFixed(1)}%)`;
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
    <span class="size-note"><span class="legend-band" style="background:#b9c6d6"></span>floor (paid-once) <span class="legend-band" style="background:#2f6f4f"></span>observed/marginal — доли по raw, абсолют ≈</span>
  </div>`;
}

export function renderSizeView(data: SizeData): string {
    const vm = buildSizeViewModel(data);
    const toolchains = [...new Set(vm.binaries.map((b) => b.toolchain))].sort();
    const byWorkload = new Map<string, BinaryViewModel[]>();
    for (const b of vm.binaries) {
        const arr = byWorkload.get(b.id) ?? [];
        arr.push(b);
        byWorkload.set(b.id, arr);
    }
    const groups = [...byWorkload.entries()]
        .map(([id, bins]) => `<div class="size-workload"><h2>${escape(id)}</h2>${bins.map(renderRow).join("\n")}</div>`)
        .join("\n");
    return `${controls(toolchains)}\n${groups}`;
}
