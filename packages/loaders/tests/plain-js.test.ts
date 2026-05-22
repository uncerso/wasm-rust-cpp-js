import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { plainJsLoader } from "../src/plain-js.js";

const fixtureUrl = fileURLToPath(
    new URL("./fixtures/hello-bench/hello.js", import.meta.url),
);

describe("plainJsLoader", () => {
    it("loads a JS module and returns a BenchModule + timings", async () => {
        const loaded = await plainJsLoader.load({ artifactUrl: fixtureUrl, entry: "hello" });
        expect(typeof loaded.module.run).toBe("function");
        expect(loaded.module.run(1).checksum).toBe(42);
        expect(loaded.timings.initTotalMs).toBeGreaterThanOrEqual(0);
        expect(loaded.memoryRef).toBeNull();
    });
});
