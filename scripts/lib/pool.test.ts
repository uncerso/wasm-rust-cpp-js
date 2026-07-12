import { describe, it, expect } from "vitest";
import { runPool } from "./pool.js";

describe("runPool", () => {
    it("caps concurrency at limit", async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const make = () => async (): Promise<number> => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight--;
            return 1;
        };
        const tasks = Array.from({ length: 20 }, make);
        await runPool(tasks, 4);
        expect(maxInFlight).toBeLessThanOrEqual(4);
        expect(maxInFlight).toBeGreaterThan(1);
    });

    it("preserves result order regardless of finish order", async () => {
        const tasks = [3, 1, 2].map((n) => async (): Promise<number> => {
            await new Promise((r) => setTimeout(r, n * 5));
            return n;
        });
        expect(await runPool(tasks, 3)).toEqual([3, 1, 2]);
    });

    it("rejects on the first task error", async () => {
        const tasks = [
            (): Promise<number> => Promise.resolve(1),
            (): Promise<number> => Promise.reject(new Error("boom")),
            (): Promise<number> => Promise.resolve(3),
        ];
        await expect(runPool(tasks, 2)).rejects.toThrow("boom");
    });

    it("returns [] for empty input", async () => {
        expect(await runPool([], 4)).toEqual([]);
    });

    it("throws on limit < 1", async () => {
        await expect(runPool([(): Promise<number> => Promise.resolve(1)], 0)).rejects.toThrow(/limit/);
    });
});
