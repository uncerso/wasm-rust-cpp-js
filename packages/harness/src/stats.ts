export interface StatsResult {
    median: number;
    p95: number;
    p99: number;
    stddev: number;
    min: number;
    max: number;
    mean: number;
    cv: number;
    mad: number;
    relSem: number;
    n: number;
}

export function computeStats(samples: readonly number[]): StatsResult {
    if (samples.length === 0) {
        throw new Error("computeStats: empty samples");
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((s, x) => s + x, 0) / n;
    const variance =
        n === 1 ? 0 : sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
    const stddev = Math.sqrt(variance);
    const median = percentile(sorted, 50);
    const absDev = sorted.map((x) => Math.abs(x - median)).sort((a, b) => a - b);
    const mad = percentile(absDev, 50);
    return {
        n,
        min: sorted[0]!,
        max: sorted[n - 1]!,
        mean,
        median,
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        stddev,
        cv: mean === 0 ? 0 : stddev / mean,
        mad,
        relSem: mean === 0 ? 0 : stddev / (mean * Math.sqrt(n)),
    };
}

function percentile(sorted: readonly number[], p: number): number {
    const n = sorted.length;
    if (n === 0) {
        throw new Error("percentile: empty");
    }
    if (n === 1) {
        return sorted[0]!;
    }
    const rank = (p / 100) * (n - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    if (lo === hi) {
        return sorted[lo]!;
    }
    const frac = rank - lo;
    return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}
