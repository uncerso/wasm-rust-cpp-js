import type { Aggregated } from "./aggregate.js";
import type { SizeData } from "./size-data.js";
import { renderPerfView, escape } from "./render-perf.js";

export function renderHtml(agg: Aggregated, _sizeData: SizeData): string {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>bench results</title></head>
<body>
<h1>${escape("wasm-rust-cpp-js results")}</h1>
<p>Generated ${escape(agg.generatedAt)}.</p>
${renderPerfView(agg)}
</body></html>`;
}
