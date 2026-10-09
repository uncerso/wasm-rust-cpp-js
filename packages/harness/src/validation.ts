export function f64ChecksumSumAbs(arr: Float64Array): number {
    let s = 0;
    for (let i = 0; i < arr.length; i++) {
        s += Math.abs(arr[i]!);
    }
    return s;
}

export function eqChecksum(a: number | string, b: number | string): boolean {
    if (typeof a === "number" && typeof b === "number") {
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
            return false;
        }
    }
    // For finite binary64 values, Object.is also distinguishes +0 from -0.
    return Object.is(a, b);
}
