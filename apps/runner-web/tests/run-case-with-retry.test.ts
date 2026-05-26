import { describe, expect, it, vi } from "vitest";
import { runCaseWithRetry, type DriverSessionLike } from "../src/run-case-with-retry.js";
import type { CaseInput, CaseResult } from "../src/driver.js";

function mkInput(overrides: Partial<CaseInput> = {}): CaseInput {
    return {
        benchmark: "matmul",
        entry: "matmul",
        language: "rust",
        toolchain: "raw",
        profile: "speed",
        size: "S",
        mode: "quick",
        ...overrides,
    };
}

function mkResult(): CaseResult {
    return {
        result: {} as CaseResult["result"],
        fileName: "matmul__rust-raw-speed__S__chromium.json",
    };
}

function mkSessionRef(initial: DriverSessionLike) {
    return { current: initial };
}

describe("runCaseWithRetry", () => {
    it("returns result on 1st-attempt success without relaunch", async () => {
        const expected = mkResult();
        const sess: DriverSessionLike = {
            runCase: vi.fn().mockResolvedValue(expected),
            quit: vi.fn(),
        };
        const ref = mkSessionRef(sess);
        const failures: Array<{ caseId: string; error: string }> = [];
        const create = vi.fn();

        const got = await runCaseWithRetry(ref, mkInput(), failures, create);

        expect(got).toBe(expected);
        expect(sess.runCase).toHaveBeenCalledOnce();
        expect(sess.quit).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
        expect(failures).toEqual([]);
    });

    it("relaunches and retries on 1st-attempt error; returns 2nd-attempt result", async () => {
        const expected = mkResult();
        const session1: DriverSessionLike = {
            runCase: vi.fn().mockRejectedValue(new Error("first attempt boom")),
            quit: vi.fn().mockResolvedValue(undefined),
        };
        const session2: DriverSessionLike = {
            runCase: vi.fn().mockResolvedValue(expected),
            quit: vi.fn(),
        };
        const ref = mkSessionRef(session1);
        const failures: Array<{ caseId: string; error: string }> = [];
        const create = vi.fn().mockResolvedValue(session2);

        const got = await runCaseWithRetry(ref, mkInput(), failures, create);

        expect(got).toBe(expected);
        expect(session1.runCase).toHaveBeenCalledOnce();
        expect(session1.quit).toHaveBeenCalledOnce();
        expect(create).toHaveBeenCalledOnce();
        expect(session2.runCase).toHaveBeenCalledOnce();
        expect(ref.current).toBe(session2);
        expect(failures).toEqual([]);
    });

    it("returns null and records failure when both attempts fail", async () => {
        const session1: DriverSessionLike = {
            runCase: vi.fn().mockRejectedValue(new Error("attempt 1 boom")),
            quit: vi.fn().mockResolvedValue(undefined),
        };
        const session2: DriverSessionLike = {
            runCase: vi.fn().mockRejectedValue(new Error("attempt 2 boom")),
            quit: vi.fn(),
        };
        const ref = mkSessionRef(session1);
        const failures: Array<{ caseId: string; error: string }> = [];
        const create = vi.fn().mockResolvedValue(session2);

        const got = await runCaseWithRetry(ref, mkInput({ entry: "matmul" }), failures, create);

        expect(got).toBeNull();
        expect(session2.runCase).toHaveBeenCalledOnce();
        expect(ref.current).toBe(session2);
        expect(failures).toHaveLength(1);
        expect(failures[0]?.caseId).toContain("matmul");
        expect(failures[0]?.error).toBe("attempt 2 boom");
    });

    it("propagates relaunch failure as case failure (no third attempt)", async () => {
        const session1: DriverSessionLike = {
            runCase: vi.fn().mockRejectedValue(new Error("attempt 1 boom")),
            quit: vi.fn().mockResolvedValue(undefined),
        };
        const ref = mkSessionRef(session1);
        const failures: Array<{ caseId: string; error: string }> = [];
        const create = vi.fn().mockRejectedValue(new Error("relaunch failed"));

        const got = await runCaseWithRetry(ref, mkInput(), failures, create);

        expect(got).toBeNull();
        expect(failures).toHaveLength(1);
        expect(failures[0]?.error).toBe("relaunch failed");
    });
});
