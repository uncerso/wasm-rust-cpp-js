import { describe, it, expect } from "vitest";
import { genIntPairs53 } from "../../common/fixtures.js";
import { parsePairs, computeBuild, computeLookup, computeRange, TWO_53, MAX_KEY, WINDOW_KEYS } from "./reference.js";

const L_N = 100000;
const L_SEED = 0xBEEF_0003;

describe("sorted_map_int reference", () => {
    const pairs = parsePairs(genIntPairs53(L_N, L_SEED));

    it("is deterministic (same input → same range checksum)", () => {
        expect(computeRange(pairs, L_N)).toBe(computeRange(pairs, L_N));
    });

    it("build checksum equals unique-key count and matches hashmap_int pin (L=99996)", () => {
        expect(computeBuild(pairs, L_N)).toBe(99996);
    });

    it("lookup checksum matches hashmap_int pin (L)", () => {
        expect(computeLookup(pairs, L_N)).toBe(213944096178963);
    });

    it("range sum stays < 2^53 (JS-safe) and > 0", () => {
        const r = computeRange(pairs, L_N);
        expect(r).toBeGreaterThan(0);
        expect(r).toBeLessThan(TWO_53);
    });

    it("range windows are bounded (no pathological O(n) window)", () => {
        // Reconstruct sorted keys, measure the max keys-in-window across all anchors.
        const keys = [...new Set(pairs.map((p) => p.key))].sort((a, b) => a - b);
        const span = Math.floor(TWO_53 / pairs.length) * WINDOW_KEYS;
        let maxCount = 0;
        for (let i = 0; i < pairs.length; i++) {
            const lo = pairs[i]!.key;
            const hi = Math.min(lo + span, MAX_KEY);
            // linear count is fine for a test
            let c = 0;
            for (const k of keys) {
                if (k >= lo && k <= hi) {
                    c++;
                }
                if (k > hi) {
                    break;
                }
            }
            if (c > maxCount) {
                maxCount = c;
            }
        }
        // expected ~16; assert comfortably bounded (Poisson tail)
        expect(maxCount).toBeLessThan(200);
    });
});
