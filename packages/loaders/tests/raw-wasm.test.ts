import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { rawWasmLoader } from "../src/raw-wasm.js";

const fixtureUrl = fileURLToPath(
    new URL("./fixtures/hello-bench/hello.wasm", import.meta.url),
);

describe("rawWasmLoader", () => {
    it("loads a wasm module conforming to the raw contract", async () => {
        const loaded = await rawWasmLoader.load({ artifactUrl: fixtureUrl, entry: "hello" });
        expect(loaded.memoryRef).toBeInstanceOf(WebAssembly.Memory);
        expect(loaded.wasmRawBytes).toBeGreaterThan(0);

        loaded.module.loadInput(new Uint8Array([1, 2, 3, 4]));
        const r = loaded.module.run(1);
        expect(r.checksum).toBe(42);
    });
});
