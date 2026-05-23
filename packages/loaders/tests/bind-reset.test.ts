import { describe, expect, it, vi } from "vitest";
import { bindReset } from "../src/bind-reset.js";

describe("bindReset", () => {
    it("returns per-entry reset companion when present", () => {
        const entryReset = vi.fn();
        const generic = vi.fn();
        const out = bindReset({ foo_reset: entryReset, reset: generic }, "foo");
        out?.();
        expect(entryReset).toHaveBeenCalledOnce();
        expect(generic).not.toHaveBeenCalled();
    });

    it("falls back to generic reset when no per-entry companion", () => {
        const generic = vi.fn();
        const out = bindReset({ reset: generic }, "foo");
        out?.();
        expect(generic).toHaveBeenCalledOnce();
    });

    it("returns undefined when neither present", () => {
        expect(bindReset({}, "foo")).toBeUndefined();
    });

    it("ignores non-function values at either lookup", () => {
        expect(bindReset({ foo_reset: "nope", reset: 42 }, "foo")).toBeUndefined();
    });
});
