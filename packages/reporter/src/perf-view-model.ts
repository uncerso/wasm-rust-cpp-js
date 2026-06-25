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
    cv: number;
    noisy: boolean;
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

export interface ShapeCell {
    layout: string;
    dispatch: string;
    warmMedian: number | null;
}

export interface ShapeSlice {
    size: string;
    profile: string;
    cells: ShapeCell[];
}

export interface PerfModel {
    workloads: PerfWorkload[];
    sizes: string[];
    profiles: string[];
    shapeDispatch: ShapeSlice[] | null;
}

const SHAPE_DISPATCH_GRID: { layout: string; dispatch: string; id: string }[] = [
    { layout: "homo", dispatch: "static", id: "shape_dispatch_homo_static" },
    { layout: "homo", dispatch: "dynamic", id: "shape_dispatch_homo_dyn" },
    { layout: "mixed", dispatch: "static", id: "shape_dispatch_mixed_static" },
    { layout: "mixed", dispatch: "dynamic", id: "shape_dispatch_mixed_dyn" },
];

const SHAPE_DISPATCH_IDS = new Set(SHAPE_DISPATCH_GRID.map((g) => g.id));

function implKey(r: BenchResult): string {
    return `${r.benchmark.language}/${r.benchmark.toolchain}/${r.benchmark.profile}`;
}

function sliceKey(r: BenchResult): string {
    return `${r.benchmark.inputSize}|${r.benchmark.profile}`;
}

function orderBy(values: string[], order: readonly string[]): string[] {
    const rank = (v: string): number => {
        const i = order.indexOf(v);
        return i < 0 ? order.length : i;
    };
    return [...values].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
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

    // Sort multiples by representative warmMedian (node first, fallback first present in ENV_ORDER)
    multiples.sort((a, b) => {
        const wmA = pickRepresentativeWm(a.byEnv, envs);
        const wmB = pickRepresentativeWm(b.byEnv, envs);
        return (wmA ?? Infinity) - (wmB ?? Infinity);
    });

    // Build PerfDetailRow entries — one per (impl, env) present in this slice.
    // Sort: group by impl in ascending representative warmMedian, then by ENV_ORDER within an impl.
    const envRank = (env: string): number => {
        const i = ENV_ORDER.indexOf(env);
        return i < 0 ? ENV_ORDER.length : i;
    };
    const implRepWm = new Map<string, number>();
    for (const [impl, entries] of casesByImpl) {
        const byEnv: Record<string, number> = {};
        for (const e of entries) {
            byEnv[e.env] = e.result.timingsMs.warmMedian;
        }
        implRepWm.set(impl, pickRepresentativeWm(byEnv, envs) ?? Infinity);
    }

    const detail: PerfDetailRow[] = [];
    for (const [impl, entries] of casesByImpl) {
        for (const { env, result: r } of entries) {
            detail.push({
                impl,
                env,
                initTotal: r.timingsMs.initTotal,
                firstCall: r.timingsMs.firstCall,
                warmMedian: r.timingsMs.warmMedian,
                warmP95: r.timingsMs.warmP95,
                cv: r.stats.cv,
                noisy: r.stats.noisy,
                correctnessFailed: r.quality.correctnessFailed,
                validated: r.quality.validated,
            });
        }
    }
    detail.sort((a, b) => {
        const repA = implRepWm.get(a.impl) ?? Infinity;
        const repB = implRepWm.get(b.impl) ?? Infinity;
        if (repA !== repB) {
            return repA - repB;
        }
        if (a.impl !== b.impl) {
            return a.impl.localeCompare(b.impl);
        }
        return envRank(a.env) - envRank(b.env) || a.env.localeCompare(b.env);
    });

    return { size, profile, envs, multiples, detail };
}

function pickRepresentativeWm(byEnv: Record<string, number>, envs: string[]): number | null {
    const nodeVal = byEnv["node"];
    if (nodeVal !== undefined && nodeVal !== null) {
        return nodeVal;
    }
    for (const env of envs) {
        const v = byEnv[env];
        if (v !== undefined && v !== null) {
            return v;
        }
    }
    return null;
}

const SHAPE_PINNED_PREFIX = "node|rust|raw";

export function buildPerfModel(agg: Aggregated): PerfModel {
    const sizeSet = new Set<string>();
    const profileSet = new Set<string>();
    const workloads: PerfWorkload[] = [];

    for (const bench of Object.values(agg.benchmarks)) {
        if (SHAPE_DISPATCH_IDS.has(bench.id)) {
            continue;
        }

        // Group cases by (size, profile) -> impl -> [{env, result}]
        const sliceMap = new Map<string, Map<string, { env: string; result: BenchResult }[]>>();

        for (const { result } of bench.cases) {
            const sk = sliceKey(result);
            const ik = implKey(result);
            const env = result.env.name;

            sizeSet.add(result.benchmark.inputSize);
            profileSet.add(result.benchmark.profile);

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

        // Build slices and sort them
        const slices: PerfSlice[] = [];
        for (const [sk, implMap] of sliceMap) {
            const [size, profile] = sk.split("|") as [string, string];
            slices.push(buildSlice(size, profile, implMap));
        }

        // Sort slices: SIZE_ORDER then profile
        slices.sort((a, b) => {
            const sizeRankA = SIZE_ORDER.indexOf(a.size) < 0 ? SIZE_ORDER.length : SIZE_ORDER.indexOf(a.size);
            const sizeRankB = SIZE_ORDER.indexOf(b.size) < 0 ? SIZE_ORDER.length : SIZE_ORDER.indexOf(b.size);
            if (sizeRankA !== sizeRankB) {
                return sizeRankA - sizeRankB;
            }
            return a.profile.localeCompare(b.profile);
        });

        workloads.push({ id: bench.id, slices });
    }

    // Build shapeDispatch: one ShapeSlice per (size, profile) present in shape data,
    // each pinned to node·rust/raw (only size + profile vary in the case key).
    const shapeSizeSet = new Set<string>();
    const shapeProfileSet = new Set<string>();
    const shapePairs = new Set<string>(); // "profile|size"
    for (const id of SHAPE_DISPATCH_IDS) {
        const b = agg.benchmarks[id];
        if (!b) {
            continue;
        }
        for (const c of b.cases) {
            const r = c.result;
            if (r.env.name !== "node" || r.benchmark.language !== "rust" || r.benchmark.toolchain !== "raw") {
                continue;
            }
            const profile = r.benchmark.profile;
            const size = r.benchmark.inputSize;
            shapeSizeSet.add(size);
            shapeProfileSet.add(profile);
            shapePairs.add(`${profile}|${size}`);
        }
    }

    let shapeDispatch: ShapeSlice[] | null = null;
    const shapeSlices: ShapeSlice[] = [];
    for (const pair of shapePairs) {
        const [profile, size] = pair.split("|") as [string, string];
        const pinnedKey = `${SHAPE_PINNED_PREFIX}|${profile}|${size}`;
        const cells: ShapeCell[] = SHAPE_DISPATCH_GRID.map(({ layout, dispatch, id }) => {
            const b = agg.benchmarks[id];
            const hit = b?.cases.find((c) => c.key === pinnedKey);
            return {
                layout,
                dispatch,
                warmMedian: hit ? hit.result.timingsMs.warmMedian : null,
            };
        });
        if (cells.some((c) => c.warmMedian != null)) {
            shapeSlices.push({ size, profile, cells });
        }
    }
    if (shapeSlices.length > 0) {
        shapeSlices.sort((a, b) => {
            const sizeRankA = SIZE_ORDER.indexOf(a.size) < 0 ? SIZE_ORDER.length : SIZE_ORDER.indexOf(a.size);
            const sizeRankB = SIZE_ORDER.indexOf(b.size) < 0 ? SIZE_ORDER.length : SIZE_ORDER.indexOf(b.size);
            if (sizeRankA !== sizeRankB) {
                return sizeRankA - sizeRankB;
            }
            return a.profile.localeCompare(b.profile);
        });
        shapeDispatch = shapeSlices;
        // Shape sizes/profiles flow into the control unions so the segmented
        // controls expose them even if no non-shape workload uses that size.
        for (const s of shapeSizeSet) {
            sizeSet.add(s);
        }
        for (const p of shapeProfileSet) {
            profileSet.add(p);
        }
    }

    const sizes = orderBy([...sizeSet], SIZE_ORDER);
    const profiles = [...profileSet].sort();

    return { workloads, sizes, profiles, shapeDispatch };
}
