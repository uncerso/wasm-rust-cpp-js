import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { rawWasmLoader } from "../src/raw-wasm.js";

const fixtureUrl = fileURLToPath(
    new URL("./fixtures/hello-bench/hello.wasm", import.meta.url),
);

const multiEntryUrl = fileURLToPath(
    new URL("./fixtures/multi-entry-raw/module.wasm", import.meta.url),
);

describe("rawWasmLoader", () => {
    it("loads a wasm module conforming to the raw contract", async () => {
        // hello.wasm exports its entry as `run` (legacy name preserved in the
        // pre-existing test fixture).
        const loaded = await rawWasmLoader.load({ artifactUrl: fixtureUrl, entry: "run" });
        expect(loaded.memoryRef).toBeInstanceOf(WebAssembly.Memory);
        expect(loaded.wasmRawBytes).toBeGreaterThan(0);

        loaded.module.loadInput(new Uint8Array([1, 2, 3, 4]));
        const r = loaded.module.run(1);
        expect(r.checksum).toBe(42);
    });

    it("binds run via arity-1 dispatch (matmul-style)", async () => {
        const loaded = await rawWasmLoader.load({ artifactUrl: multiEntryUrl, entry: "alpha" });
        loaded.module.loadInput(new Uint8Array(0));
        // alpha(iters) = iters * 7; with iters=5 → 35
        expect(loaded.module.run(5).checksum).toBe(35);
    });

    it("binds run via arity-2 dispatch (add-style with JS-side accumulator)", async () => {
        const loaded = await rawWasmLoader.load({ artifactUrl: multiEntryUrl, entry: "delta" });
        loaded.module.loadInput(new Uint8Array(0));
        // delta(a, b) = a + b; JS calls delta(i, i*2) for i in [0, 10).
        // Sum = 3 * 9 * 10 / 2 = 135.
        expect(loaded.module.run(10).checksum).toBe(135);
    });

    it("throws when the entry export is absent", async () => {
        await expect(
            rawWasmLoader.load({ artifactUrl: multiEntryUrl, entry: "nonexistent" }),
        ).rejects.toThrow(/not found/);
    });
});
