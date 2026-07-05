import { implOrderRank } from "./impl-order.js";
import type { Aggregated } from "./aggregate.js";
import type { BenchResult } from "@bench/result-schema";

export const ENV_ORDER: readonly string[] = ["node", "chromium", "firefox"];
export const SIZE_ORDER: readonly string[] = ["S", "M", "L"];

export interface PerfImplMultiple {
    impl: string;
    byEnv: Record<string, number>;   // absent env key = "not run" (rendered as —)
}

export interface PerfDetailRow {
    impl: string;
    env: string;
    initTotal: number;
    firstCall: number;
    warmMedian: number;
    warmP95: number;
    warmMad: number;
    cv: number;
    relSem: number;
    meanImprecise: boolean;
    subResolution: boolean;
    correctnessFailed: boolean;
    validated: boolean;
}

export interface PerfSlice {
    size: string;
    profile: string;
    envs: string[];
    multiples: PerfImplMultiple[];
    detail: PerfDetailRow[];
}

export interface PerfWorkload {
    id: string;
    slices: PerfSlice[];
}

export interface ShapeGridCell {
    layout: string;
    dispatch: string;
    warmMedian: number | null;
}

export interface ShapeGridRow {
    impl: string;
    byEnv: Record<string, ShapeGridCell[]>;   // 4 cells/env, order = SHAPE_DISPATCH_GRID
}

export interface ShapeComboDetail {
    layout: string;
    dispatch: string;
    benchId: string;
    rows: PerfDetailRow[];
}

export interface ShapeSection {
    size: string;
    profile: string;
    envs: string[];
    rows: ShapeGridRow[];
    detail: ShapeComboDetail[];
}

export interface PerfModel {
    workloads: PerfWorkload[];
    sizes: string[];
    profiles: string[];
    shapeDispatch: ShapeSection[] | null;
}

const SHAPE_DISPATCH_GRID: { layout: string; dispatch: string; id: string }[] = [
    { layout: "homo", dispatch: "static", id: "shape_dispatch_homo_static" },
    { layout: "homo", dispatch: "dynamic", id: "shape_dispatch_homo_dyn" },
    { layout: "mixed", dispatch: "static", id: "shape_dispatch_mixed_static" },
    { layout: "mixed", dispatch: "dynamic", id: "shape_dispatch_mixed_dyn" },
];

const SHAPE_DISPATCH_IDS = new Set(SHAPE_DISPATCH_GRID.map((g) => g.id));

function implKey(r: BenchResult): string {
    // JS ships one bundle with no size/speed build — drop the meaningless profile so the
    // impl reads `js/idiomatic` (not `js/idiomatic/speed`) and groups across profile slices.
    if (r.benchmark.language === "js") {
        return `${r.benchmark.language}/${r.benchmark.toolchain}`;
    }
    return `${r.benchmark.language}/${r.benchmark.toolchain}/${r.benchmark.profile}`;
}

function implKeyRank(implKey: string): number {
    const [language, toolchain] = implKey.split("/");
    return implOrderRank(language ?? "", toolchain ?? "");
}

function orderBy(values: string[], order: readonly string[]): string[] {
    const rank = (v: string): number => {
        const i = order.indexOf(v);
        return i < 0 ? order.length : i;
    };
    return [...values].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function envRank(env: string): number {
    const i = ENV_ORDER.indexOf(env);
    return i < 0 ? ENV_ORDER.length : i;
}

function sizeRank(size: string): number {
    const i = SIZE_ORDER.indexOf(size);
    return i < 0 ? SIZE_ORDER.length : i;
}

function toDetailRow(impl: string, env: string, r: BenchResult): PerfDetailRow {
    return {
        impl,
        env,
        initTotal: r.timingsMs.initTotal,
        firstCall: r.timingsMs.firstCall,
        warmMedian: r.timingsMs.warmMedian,
        warmP95: r.timingsMs.warmP95,
        warmMad: r.timingsMs.warmMad,
        cv: r.stats.cv,
        relSem: r.stats.relSem,
        meanImprecise: r.stats.meanImprecise,
        subResolution: r.stats.subResolution,
        correctnessFailed: r.quality.correctnessFailed,
        validated: r.quality.validated,
    };
}

function buildSlice(
    size: string,
    profile: string,
    casesByImpl: Map<string, { env: string; result: BenchResult }[]>,
): PerfSlice {
    // Collect all envs present across all impls
    const envSet = new Set<string>();
    for (const entries of casesByImpl.values()) {
        for (const e of entries) {
            envSet.add(e.env);
        }
    }
    const envs = orderBy([...envSet], ENV_ORDER);

    // Build PerfImplMultiple entries
    const multiples: PerfImplMultiple[] = [];
    for (const [impl, entries] of casesByImpl) {
        const byEnv: Record<string, number> = {};
        for (const e of entries) {
            byEnv[e.env] = e.result.timingsMs.warmMedian;
        }
        multiples.push({ impl, byEnv });
    }

    // Sort multiples by canonical IMPL_ORDER (js → rust → cpp), stable across cells.
    multiples.sort((a, b) => implKeyRank(a.impl) - implKeyRank(b.impl) || a.impl.localeCompare(b.impl));

    // Build PerfDetailRow entries — one per (impl, env) present in this slice.
    const detail: PerfDetailRow[] = [];
    for (const [impl, entries] of casesByImpl) {
        for (const { env, result: r } of entries) {
            detail.push(toDetailRow(impl, env, r));
        }
    }
    // Sort: group by canonical impl order, then by ENV_ORDER within an impl.
    detail.sort((a, b) =>
        implKeyRank(a.impl) - implKeyRank(b.impl)
        || a.impl.localeCompare(b.impl)
        || envRank(a.env) - envRank(b.env)
        || a.env.localeCompare(b.env));

    return { size, profile, envs, multiples, detail };
}

// Shape rows are labelled by language/toolchain only — each ShapeSection already
// fixes the profile, so a profile suffix would be redundant (and JS carries none).
function shapeImplKey(r: BenchResult): string {
    return `${r.benchmark.language}/${r.benchmark.toolchain}`;
}

/**
 * Build the shape_dispatch widget model: one ShapeSection per (size, profile),
 * each an impl×env grid of 2×2 (layout × dispatch) warm-median cells plus 4
 * collapsed per-combo detail slices. All impls present in the data are stacked
 * (ordered by implOrderRank). JS is a real participant in 3 of the 4 combos —
 * its `homo_static` cell has no bench, so that cell is null (rendered as a dash).
 * JS ships one profile-agnostic bundle, so (mirroring the small-multiples tab)
 * each JS case is injected into every profile present in the shape data.
 */
function buildShapeSections(agg: Aggregated): {
    sections: ShapeSection[];
    sizes: Set<string>;
    profiles: Set<string>;
} {
    const sizes = new Set<string>();
    const profiles = new Set<string>();
    for (const { id } of SHAPE_DISPATCH_GRID) {
        const b = agg.benchmarks[id];
        if (!b) {
            continue;
        }
        for (const c of b.cases) {
            sizes.add(c.result.benchmark.inputSize);
            profiles.add(c.result.benchmark.profile);
        }
    }
    if (sizes.size === 0) {
        return { sections: [], sizes, profiles };
    }
    const allProfiles = [...profiles];

    interface Acc {
        envs: Set<string>;
        impls: Set<string>;
        grid: Map<string, Map<string, Map<string, number>>>;   // impl -> env -> benchId -> warmMedian
        detailByCombo: Map<string, { impl: string; env: string; result: BenchResult }[]>;
    }
    const acc = new Map<string, Acc>();
    const ensure = (sk: string): Acc => {
        let a = acc.get(sk);
        if (!a) {
            a = { envs: new Set(), impls: new Set(), grid: new Map(), detailByCombo: new Map() };
            acc.set(sk, a);
        }
        return a;
    };

    for (const g of SHAPE_DISPATCH_GRID) {
        const b = agg.benchmarks[g.id];
        if (!b) {
            continue;
        }
        for (const c of b.cases) {
            const r = c.result;
            const isJs = r.benchmark.language === "js";
            const impl = shapeImplKey(r);
            const env = r.env.name;
            const size = r.benchmark.inputSize;
            const targetProfiles = isJs ? allProfiles : [r.benchmark.profile];
            for (const profile of targetProfiles) {
                const a = ensure(`${size}|${profile}`);
                a.envs.add(env);
                a.impls.add(impl);
                let byEnv = a.grid.get(impl);
                if (!byEnv) {
                    byEnv = new Map();
                    a.grid.set(impl, byEnv);
                }
                let byGrid = byEnv.get(env);
                if (!byGrid) {
                    byGrid = new Map();
                    byEnv.set(env, byGrid);
                }
                byGrid.set(g.id, r.timingsMs.warmMedian);
                let cases = a.detailByCombo.get(g.id);
                if (!cases) {
                    cases = [];
                    a.detailByCombo.set(g.id, cases);
                }
                cases.push({ impl, env, result: r });
            }
        }
    }

    const sections: ShapeSection[] = [];
    for (const [sk, a] of acc) {
        const [size, profile] = sk.split("|") as [string, string];
        const envs = orderBy([...a.envs], ENV_ORDER);
        const impls = [...a.impls].sort((x, y) => implKeyRank(x) - implKeyRank(y) || x.localeCompare(y));

        const rows: ShapeGridRow[] = impls.map((impl) => {
            const implGrid = a.grid.get(impl);
            const byEnv: Record<string, ShapeGridCell[]> = {};
            for (const env of envs) {
                const byGrid = implGrid?.get(env);
                byEnv[env] = SHAPE_DISPATCH_GRID.map((g) => ({
                    layout: g.layout,
                    dispatch: g.dispatch,
                    warmMedian: byGrid?.get(g.id) ?? null,
                }));
            }
            return { impl, byEnv };
        });

        const detail: ShapeComboDetail[] = SHAPE_DISPATCH_GRID.map((g) => {
            const cases = a.detailByCombo.get(g.id) ?? [];
            const dRows = cases.map(({ impl, env, result }) => toDetailRow(impl, env, result));
            dRows.sort((x, y) =>
                implKeyRank(x.impl) - implKeyRank(y.impl)
                || x.impl.localeCompare(y.impl)
                || envRank(x.env) - envRank(y.env)
                || x.env.localeCompare(y.env));
            return { layout: g.layout, dispatch: g.dispatch, benchId: g.id, rows: dRows };
        });

        sections.push({ size, profile, envs, rows, detail });
    }

    sections.sort((a, b) => sizeRank(a.size) - sizeRank(b.size) || a.profile.localeCompare(b.profile));
    return { sections, sizes, profiles };
}

export function buildPerfModel(agg: Aggregated): PerfModel {
    const sizeSet = new Set<string>();
    const profileSet = new Set<string>();
    const workloads: PerfWorkload[] = [];

    for (const bench of Object.values(agg.benchmarks)) {
        if (SHAPE_DISPATCH_IDS.has(bench.id)) {
            continue;
        }

        // Group cases by (size, profile) -> impl -> [{env, result}]. JS has no size/speed
        // build variant, so inject each JS case into EVERY profile this workload offers — the
        // profile filter then never hides it (mirrors the size-tab profile-agnostic rows).
        const sliceMap = new Map<string, Map<string, { env: string; result: BenchResult }[]>>();
        const wlProfiles = [...new Set(bench.cases.map((c) => c.result.benchmark.profile))];

        for (const { result } of bench.cases) {
            const isJs = result.benchmark.language === "js";
            const size = result.benchmark.inputSize;
            const ik = implKey(result);
            const env = result.env.name;

            sizeSet.add(size);
            profileSet.add(result.benchmark.profile);

            const targetProfiles = isJs ? wlProfiles : [result.benchmark.profile];
            for (const profile of targetProfiles) {
                const sk = `${size}|${profile}`;
                let implMap = sliceMap.get(sk);
                if (!implMap) {
                    implMap = new Map();
                    sliceMap.set(sk, implMap);
                }
                let entries = implMap.get(ik);
                if (!entries) {
                    entries = [];
                    implMap.set(ik, entries);
                }
                entries.push({ env, result });
            }
        }

        // Build slices and sort them
        const slices: PerfSlice[] = [];
        for (const [sk, implMap] of sliceMap) {
            const [size, profile] = sk.split("|") as [string, string];
            slices.push(buildSlice(size, profile, implMap));
        }

        // Sort slices: SIZE_ORDER then profile
        slices.sort((a, b) => sizeRank(a.size) - sizeRank(b.size) || a.profile.localeCompare(b.profile));

        workloads.push({ id: bench.id, slices });
    }

    // Build shapeDispatch: one ShapeSection per (size, profile) — an impl×env grid
    // of 2×2 (layout × dispatch) warm-median cells + 4 per-combo detail slices.
    const shape = buildShapeSections(agg);
    let shapeDispatch: ShapeSection[] | null = null;
    if (shape.sections.length > 0) {
        shapeDispatch = shape.sections;
        // Shape sizes/profiles flow into the control unions so the segmented
        // controls expose them even if no non-shape workload uses that size.
        for (const s of shape.sizes) {
            sizeSet.add(s);
        }
        for (const p of shape.profiles) {
            profileSet.add(p);
        }
    }

    const sizes = orderBy([...sizeSet], SIZE_ORDER);
    const profiles = [...profileSet].sort();

    return { workloads, sizes, profiles, shapeDispatch };
}
