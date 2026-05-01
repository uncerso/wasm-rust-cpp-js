export function f64ChecksumSumAbs(arr: Float64Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += Math.abs(arr[i]!);
  return s;
}

const FLOAT_TOLERANCE = 1e-9;

export function eqChecksum(a: number | string, b: number | string): boolean {
  if (typeof a !== typeof b) return false;
  if (typeof a === "number" && typeof b === "number") {
    if (a === 0 && b === 0) return true;
    const denom = Math.max(Math.abs(a), Math.abs(b));
    return Math.abs(a - b) / denom < FLOAT_TOLERANCE;
  }
  return a === b;
}
