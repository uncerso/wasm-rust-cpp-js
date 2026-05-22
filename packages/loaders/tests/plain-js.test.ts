import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { plainJsLoader } from "../src/plain-js.js";

const fixtureUrl = fileURLToPath(
    new URL("./fixtures/hello-bench/hello.js", import.meta.url),
);

const multiEntryUrl = fileURLToPath(
    new URL("./fixtures/multi-entry-bench/module.js", import.meta.url),
);

describe("plainJsLoader", () => {
    it("loads a JS module and returns a BenchModule + timings", async () => {
        const loaded = await plainJsLoader.load({ artifactUrl: fixtureUrl, entry: "hello" });
        expect(typeof loaded.module.run).toBe("function");
        expect(loaded.module.run(1).checksum).toBe(42);
        expect(loaded.timings.initTotalMs).toBeGreaterThanOrEqual(0);
        expect(loaded.memoryRef).toBeNull();
    });

    it("passes entry to the factory so multi-entry modules can dispatch", async () => {
        const alpha = await plainJsLoader.load({ artifactUrl: multiEntryUrl, entry: "alpha" });
        const beta = await plainJsLoader.load({ artifactUrl: multiEntryUrl, entry: "beta" });
        expect(alpha.module.run(10).checksum).toBe(20);
        expect(beta.module.run(10).checksum).toBe(30);
    });
});
