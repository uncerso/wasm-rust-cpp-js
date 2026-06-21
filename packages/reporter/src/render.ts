import type { Aggregated } from "./aggregate.js";
import type { SizeData } from "./size-data.js";
import { renderPerfView, escape } from "./render-perf.js";
import { renderSizeView, SIZE_CSS, SIZE_JS } from "./render-size.js";

const SHELL_CSS = `
  body { font-family: ui-monospace, monospace; max-width: 1400px; margin: 1em auto; padding: 0 1em; }
  nav.tabs { display: flex; gap: 0.5em; margin: 1em 0; border-bottom: 2px solid #ccc; }
  nav.tabs button { font: inherit; padding: 0.4em 1em; border: 1px solid #ccc; border-bottom: none;
    background: #f0f0f0; cursor: pointer; }
  nav.tabs button.active { background: #fff; font-weight: bold; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
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
    for (const b of document.querySelectorAll('nav.tabs button')) {
      b.classList.toggle('active', b.dataset.tab === name);
    }
  }
  document.addEventListener('DOMContentLoaded', function () {
    for (const b of document.querySelectorAll('nav.tabs button')) {
      b.addEventListener('click', function () { showTab(b.dataset.tab); });
    }
    showTab('size');
  });
`;

export function renderHtml(agg: Aggregated, sizeData: SizeData): string {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>bench results</title>
<style>${SHELL_CSS}${SIZE_CSS}</style></head>
<body>
<h1>wasm-rust-cpp-js results</h1>
<p>Generated ${escape(agg.generatedAt)}.</p>
<nav class="tabs">
  <button data-tab="size">Size</button>
  <button data-tab="perf">Perf</button>
</nav>
<section id="tab-size" class="tab-panel">${renderSizeView(sizeData)}</section>
<section id="tab-perf" class="tab-panel">
${renderPerfView(agg)}
</section>
<script>${TABS_JS}</script>
<script>${SIZE_JS}</script>
</body></html>`;
}
