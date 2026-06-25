import type { Aggregated } from "./aggregate.js";
import type { BenchResult } from "@bench/result-schema";

export const ENV_ORDER: readonly string[] = ["node", "chromium", "firefox"];
export const SIZE_ORDER: readonly string[] = ["S", "M", "L"];

export interface PerfImplMultiple {
    impl: string;
    byEnv: Record<string, number | null>;
}

export interface PerfDetailRow {
    impl: string;
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

export interface PerfModel {
    workloads: PerfWorkload[];
    sizes: string[];
    profiles: string[];
    shapeDispatch: ShapeCell[] | null;
}

const SHAPE_DISPATCH_PINNED_KEY = "node|rust|raw|speed|L";

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
        const byEnv: Record<string, number | null> = {};
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

    // Build PerfDetailRow entries — one per impl, from the node case (fallback: first env present)
    const detail: PerfDetailRow[] = [];
    for (const [impl, entries] of casesByImpl) {
        const nodeEntry = entries.find((e) => e.env === "node");
        const fallbackEntry = envs.map((env) => entries.find((e) => e.env === env)).find(Boolean);
        const chosen = nodeEntry ?? fallbackEntry;
        if (!chosen) {
            continue;
        }
        const r = chosen.result;
        detail.push({
            impl,
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
    detail.sort((a, b) => a.warmMedian - b.warmMedian);

    return { size, profile, envs, multiples, detail };
}

function pickRepresentativeWm(byEnv: Record<string, number | null>, envs: string[]): number | null {
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

export function buildPerfModel(agg: Aggregated): PerfModel {
    const sizeSet = new Set<string>();
    const profileSet = new Set<string>();
    const workloads: PerfWorkload[] = [];
    let hasAnyShape = false;

    // Check if any shape dispatch ids are present
    for (const id of SHAPE_DISPATCH_IDS) {
        if (agg.benchmarks[id]) {
            hasAnyShape = true;
            break;
        }
    }

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

    // Build shapeDispatch cells
    let shapeDispatch: ShapeCell[] | null = null;
    if (hasAnyShape) {
        shapeDispatch = SHAPE_DISPATCH_GRID.map(({ layout, dispatch, id }) => {
            const b = agg.benchmarks[id];
            const hit = b?.cases.find((c) => c.key === SHAPE_DISPATCH_PINNED_KEY);
            return {
                layout,
                dispatch,
                warmMedian: hit ? hit.result.timingsMs.warmMedian : null,
            };
        });
    }

    const sizes = orderBy([...sizeSet], SIZE_ORDER);
    const profiles = [...profileSet].sort();

    return { workloads, sizes, profiles, shapeDispatch };
}
