import { describe, it, expect } from "vitest";
import { categorize } from "../src/facilities.js";

const ctx = { exportNames: new Set<string>(), workloadPrefixes: [] };

describe("wasm-bindgen glue facility", () => {
    it("maps __wbindgen_* and __wbg_* to toolchain-runtime", () => {
        expect(categorize("__wbindgen_malloc", ctx).facility).toBe("toolchain-runtime");
        expect(categorize("__wbg_log_abc123", ctx).facility).toBe("toolchain-runtime");
        expect(categorize("__wbindgen_realloc", ctx).facility).toBe("toolchain-runtime");
    });
});
