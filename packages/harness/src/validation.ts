import type { ChecksumMode } from "@bench/result-schema";

export function f64ChecksumSumAbs(arr: Float64Array): number {
    let s = 0;
    for (let i = 0; i < arr.length; i++) {
        s += Math.abs(arr[i]!);
    }
    return s;
}

const FLOAT_TOLERANCE = 1e-9;

export function eqChecksum(a: number | string, b: number | string, mode: ChecksumMode = "exact"): boolean {
    if (typeof a === "number" && typeof b === "number") {
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
            return false;
        }
        if (mode === "float" && a !== b) {
            const denom = Math.max(Math.abs(a), Math.abs(b));
            return Math.abs(a - b) / denom < FLOAT_TOLERANCE;
        }
    }
    return a === b;
}
