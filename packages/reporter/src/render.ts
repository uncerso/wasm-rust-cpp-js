import type { Aggregated, AggregatedBenchmark } from "./aggregate.js";
import type { BenchResult } from "@bench/result-schema";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

function renderRow(r: BenchResult): string {
  const noisyClass = r.stats.noisy ? "noisy" : "";
  const failClass = r.quality.correctnessFailed ? "fail" : "";
  const cls = [noisyClass, failClass].filter(Boolean).join(" ");
  return `<tr class="${cls}">
    <td>${escape(r.env.name)}</td>
    <td>${escape(r.benchmark.language)}/${escape(r.benchmark.toolchain)}/${escape(r.benchmark.profile)}</td>
    <td>${escape(r.benchmark.inputSize)}</td>
    <td>${r.artifacts.wasmRawBytes || "—"}</td>
    <td>${r.artifacts.wasmGzipBytes || "—"}</td>
    <td>${r.artifacts.totalTransferGzipBytes}</td>
    <td>${r.timingsMs.initTotal.toFixed(3)}</td>
    <td>${r.timingsMs.firstCall.toFixed(3)}</td>
    <td>${r.timingsMs.warmMedian.toFixed(3)}</td>
    <td>${r.timingsMs.warmP95.toFixed(3)}</td>
    <td>${r.stats.cv.toFixed(3)}</td>
    <td>${r.quality.validated ? "✓" : "✗"}</td>
  </tr>`;
}

function renderBenchmark(b: AggregatedBenchmark): string {
  const rows = b.cases.map((c) => renderRow(c.result)).join("\n");
  return `<section>
    <h2>${escape(b.id)}</h2>
    <table>
      <thead><tr>
        <th>env</th><th>impl</th><th>size</th>
        <th>wasm raw</th><th>wasm gz</th><th>total gz</th>
        <th>init</th><th>first</th>
        <th>warm med (ms)</th><th>warm p95 (ms)</th><th>cv</th><th>ok</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

export function renderHtml(agg: Aggregated): string {
  const sections = Object.values(agg.benchmarks).map(renderBenchmark).join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>bench results</title>
<style>
  body { font-family: ui-monospace, monospace; max-width: 1400px; margin: 1em auto; padding: 0 1em; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: right; }
  th { background: #f0f0f0; }
  tr.noisy { background: #fff8d0; }
  tr.fail  { background: #ffd0d0; }
  td:first-child, td:nth-child(2), td:nth-child(3) { text-align: left; }
</style></head>
<body>
<h1>wasm-rust-cpp-js results</h1>
<p>Generated ${escape(agg.generatedAt)}.</p>
${sections}
</body></html>`;
}
