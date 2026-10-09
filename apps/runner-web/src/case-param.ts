import type { WorkerInput } from "./worker.js";

export function encodeCaseParam(input: WorkerInput): string {
    // JSON.stringify turns -0 into 0; carry its sign separately until the page restores it.
    return btoa(JSON.stringify({
        ...input,
        expectedChecksumIsNegativeZero: Object.is(input.expectedChecksum, -0),
    }));
}

export function decodeCaseParam(value: string): WorkerInput {
    const { expectedChecksumIsNegativeZero, ...input } = JSON.parse(atob(value)) as WorkerInput & {
        expectedChecksumIsNegativeZero?: boolean;
    };
    if (expectedChecksumIsNegativeZero === true && input.expectedChecksum === 0) {
        input.expectedChecksum = -0;
    }
    return input;
}
