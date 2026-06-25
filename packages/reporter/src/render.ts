import type { Aggregated } from "./aggregate.js";
import type { SizeData } from "./size-data.js";
import { renderPerfView, escape, PERF_JS } from "./render-perf.js";
import { renderSizeView, SIZE_CSS, SIZE_JS } from "./render-size.js";
import { SHELL_CSS } from "./theme.js";

// Thin local CSS: just tab-panel visibility (shell behaviour). Every table in
// the report (.xlang / .pf-t / .shape-heat) now carries its own complete
// styling in SIZE_CSS / PERF_CSS — no shared generic table rules, which would
// otherwise paint stray #ccc borders onto the redesigned tables.
const SHELL_LOCAL_CSS = `
.tab-panel{display:none}
.tab-panel.active{display:block}
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
