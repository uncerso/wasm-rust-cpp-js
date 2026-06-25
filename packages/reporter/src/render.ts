import type { Aggregated } from "./aggregate.js";
import type { SizeData } from "./size-data.js";
import { renderPerfView, escape, PERF_JS } from "./render-perf.js";
import { renderSizeView, SIZE_CSS, SIZE_JS } from "./render-size.js";
import { SHELL_CSS } from "./theme.js";

// Thin local CSS: tab-panel visibility (shell behaviour) plus the legacy
// perf-table styling that still flows through the unchanged perf renderer.
// The table rules migrate into PERF_CSS when the Perf tab is rebuilt (Tasks 6–7).
const SHELL_LOCAL_CSS = `
.tab-panel{display:none}
.tab-panel.active{display:block}
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: right; }
th { background: #f0f0f0; }
tr.noisy { background: #fff8d0; }
tr.fail  { background: #ffd0d0; }
td:first-child, td:nth-child(2), td:nth-child(3) { text-align: left; }
table.grid { width: auto; margin: 0.5em 0 1em; }
table.grid th { text-align: left; }
table.grid td { text-align: right; min-width: 6em; }
p.grid-label { font-size: 12px; color: #555; margin: 0.25em 0; }
`;

const TABS_JS = `
  function showTab(name) {
    for (const p of document.querySelectorAll('.tab-panel')) {
      p.classList.toggle('active', p.id === 'tab-' + name);
    }
    for (const b of document.querySelectorAll('.tabbar button')) {
      b.classList.toggle('on', b.dataset.tab === name);
    }
  }
  document.addEventListener('DOMContentLoaded', function () {
    for (const b of document.querySelectorAll('.tabbar button')) {
      b.addEventListener('click', function () { showTab(b.dataset.tab); });
    }
    showTab('size');
  });
`;

export function renderHtml(agg: Aggregated, sizeData: SizeData): string {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>bench results</title>
<style>${SHELL_CSS}${SHELL_LOCAL_CSS}${SIZE_CSS}</style></head>
<body>
<div class="app">
  <header class="sh-head">
    <div class="sh-ttl">wasm-rust-cpp-js results <small>${escape(agg.generatedAt)}</small></div>
    <nav class="tabbar">
      <button data-tab="size">Size</button>
      <button data-tab="perf">Perf</button>
    </nav>
  </header>
  <section id="tab-size" class="tab-panel">${renderSizeView(sizeData)}</section>
  <section id="tab-perf" class="tab-panel">
${renderPerfView(agg)}
  </section>
</div>
<script>${TABS_JS}</script>
<script>${SIZE_JS}</script>
<script>${PERF_JS}</script>
</body></html>`;
}
