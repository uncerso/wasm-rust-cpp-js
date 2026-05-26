import { describe, expect, it, vi } from "vitest";
import { quitWithTimeout } from "../src/driver.js";

describe("quitWithTimeout", () => {
    it("resolves when quitFn resolves quickly", async () => {
        const quit = vi.fn().mockResolvedValue(undefined);
        await quitWithTimeout(quit, 1_000);
        expect(quit).toHaveBeenCalledOnce();
    });

    it("resolves within timeout window when quitFn hangs", async () => {
        const quit = vi.fn(() => new Promise<void>(() => { /* never resolves */ }));
        const start = Date.now();
        await quitWithTimeout(quit, 50);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(50);
        expect(elapsed).toBeLessThan(500);
        expect(quit).toHaveBeenCalledOnce();
    });

    it("swallows rejection from quitFn (does not throw)", async () => {
        const quit = vi.fn().mockRejectedValue(new Error("boom"));
        await expect(quitWithTimeout(quit, 1_000)).resolves.toBeUndefined();
    });
});
