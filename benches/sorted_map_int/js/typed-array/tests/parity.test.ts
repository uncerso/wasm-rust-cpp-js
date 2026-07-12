import { describe, it, expect } from "vitest";
import { genIntPairs53 } from "../../../../common/fixtures.js";
import { parsePairs, computeBuild, computeLookup, computeRange } from "../../../validate/reference.js";
import createIdiomatic from "../../idiomatic/src/index.js";
import createTyped from "../../typed-array/src/index.js";

const N = 500;
const SEED = 0x1234_5678;
const ENTRIES = ["sorted_map_int_build", "sorted_map_int_lookup", "sorted_map_int_range"] as const;

describe("sorted_map_int JS parity", () => {
    const fixture = genIntPairs53(N, SEED);
    const pairs = parsePairs(fixture);
    const expected: Record<string, number> = {
        sorted_map_int_build: computeBuild(pairs, N),
        sorted_map_int_lookup: computeLookup(pairs, N),
        sorted_map_int_range: computeRange(pairs, N),
    };

    for (const entry of ENTRIES) {
        it(`${entry}: idiomatic == typed-array == reference`, () => {
            const idi = createIdiomatic(entry);
            idi.loadInput(fixture);
            idi.reset();
            const ci = idi.run(N).checksum;

            const typ = createTyped(entry);
            typ.loadInput(fixture);
            typ.reset();
            const ct = typ.run(N).checksum;

            expect(ci).toBe(expected[entry]);
            expect(ct).toBe(expected[entry]);
        });
    }
});
