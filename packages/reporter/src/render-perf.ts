import type { Aggregated, AggregatedBenchmark } from "./aggregate.js";
import type { BenchResult } from "@bench/result-schema";

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

function renderRow(r: BenchResult): string {
    const noisyClass = r.stats.noisy ? "noisy" : "";
    const failClass = r.quality.correctnessFailed ? "fail" : "";
    const cls = [noisyClass, failClass].filter(Boolean).join(" ");
    return `<tr class="${cls}">
    <td>${escape(r.env.name)}</td>
    <td>${escape(r.benchmark.language)}/${escape(r.benchmark.toolchain)}/${escape(r.benchmark.profile)}</td>
    <td>${escape(r.benchmark.inputSize)}</td>
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
        <th>init (ms)</th><th>first (ms)</th>
        <th>warm med (ms)</th><th>warm p95 (ms)</th><th>cv</th><th>ok</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

const SHAPE_DISPATCH_PINNED_KEY = "node|rust|raw|speed|L";
const SHAPE_DISPATCH_GRID: { layout: string; dispatch: string; id: string }[] = [
    { layout: "homo", dispatch: "static", id: "shape_dispatch_homo_static" },
    { layout: "homo", dispatch: "dynamic", id: "shape_dispatch_homo_dyn" },
    { layout: "mixed", dispatch: "static", id: "shape_dispatch_mixed_static" },
    { layout: "mixed", dispatch: "dynamic", id: "shape_dispatch_mixed_dyn" },
];
const SHAPE_DISPATCH_IDS = new Set(SHAPE_DISPATCH_GRID.map((g) => g.id));

function pinnedCell(agg: Aggregated, id: string): string {
    const b = agg.benchmarks[id];
    const hit = b?.cases.find((c) => c.key === SHAPE_DISPATCH_PINNED_KEY);
    return hit ? hit.result.timingsMs.warmMedian.toFixed(3) : "—";
}

function renderShapeDispatchSection(agg: Aggregated): string {
    const cell = (layout: string, dispatch: string): string => {
        const entry = SHAPE_DISPATCH_GRID.find((g) => g.layout === layout && g.dispatch === dispatch);
        return entry ? pinnedCell(agg, entry.id) : "—";
    };
    const grid = `<table class="grid">
      <thead><tr><th></th><th>static</th><th>dynamic</th></tr></thead>
      <tbody>
        <tr><th>homo</th><td>${cell("homo", "static")}</td><td>${cell("homo", "dynamic")}</td></tr>
        <tr><th>mixed</th><td>${cell("mixed", "static")}</td><td>${cell("mixed", "dynamic")}</td></tr>
      </tbody>
    </table>`;
    const details = SHAPE_DISPATCH_GRID
        .map((g) => agg.benchmarks[g.id])
        .filter((b): b is AggregatedBenchmark => Boolean(b))
        .map(renderBenchmark)
        .join("\n");
    return `<section class="shape-dispatch">
    <h2>shape_dispatch (2×2 factorial)</h2>
    <p class="grid-label">headline: rust/raw speed L node — warm-median (ms)</p>
    ${grid}
    ${details}
  </section>`;
}

export function renderPerfView(agg: Aggregated): string {
    const flat = Object.values(agg.benchmarks)
        .filter((b) => !SHAPE_DISPATCH_IDS.has(b.id))
        .map(renderBenchmark)
        .join("\n");
    const hasShapeDispatch = Object.values(agg.benchmarks).some((b) => SHAPE_DISPATCH_IDS.has(b.id));
    return hasShapeDispatch ? `${flat}\n${renderShapeDispatchSection(agg)}` : flat;
}
