import type { BenchResult } from "./schema.js";

/**
 * A case is a correctness failure when the reference checksum did not match
 * (`correctnessFailed`) or validation did not pass. Neither runner throws on
 * mismatch — they write the result with the flag set — so callers use this to
 * surface silent correctness fails (failures.txt + non-zero exit).
 */
export function isCorrectnessFailure(r: BenchResult): boolean {
    return r.quality.correctnessFailed || !r.quality.validated;
}
