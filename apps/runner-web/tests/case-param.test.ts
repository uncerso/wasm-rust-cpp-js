import { describe, expect, it } from "vitest";
import { eqChecksum } from "@bench/harness";
import { decodeCaseParam, encodeCaseParam } from "../src/case-param.js";
import type { WorkerInput } from "../src/worker.js";

function workerInput(expectedChecksum: number | string): WorkerInput {
    return {
        benchmarkId: "demo",
        entry: "demo",
        language: "js",
        toolchain: "idiomatic",
        profile: "speed",
        inputSize: "S",
        fixtureSha256: "0".repeat(64),
        expectedChecksum,
        measureConfig: { warmupIterations: 0, innerIterations: 1, minSamples: 2, maxSamples: 2, semThreshold: 0.1, wallBudgetMs: 100 },
        baseUrl: "http://localhost:5174",
    };
}

describe("case parameter transport", () => {
    it.each([0, -0, 1.25, 275996.81878375803, 8921353.464110956, 213944096178963, "-0", "0", "1.25", "abc"])(
        "preserves checksum value and type for %s",
        (checksum) => {
            const input = workerInput(checksum);
            expect(decodeCaseParam(encodeCaseParam(input))).toEqual(input);
        },
    );

    it("keeps negative-zero validation consistent across the browser boundary", () => {
        const input = decodeCaseParam(encodeCaseParam(workerInput(-0)));
        expect(eqChecksum(-0, input.expectedChecksum)).toBe(true);
        expect(eqChecksum(0, input.expectedChecksum)).toBe(false);
        expect(eqChecksum("-0", input.expectedChecksum)).toBe(false);
    });
});
