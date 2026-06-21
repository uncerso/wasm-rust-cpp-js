import { describe, expect, it } from "vitest";
import { categorize, type CategorizeCtx } from "../src/facilities.js";

const ctx: CategorizeCtx = { exportNames: new Set(["matmul", "load_input"]), workloadPrefixes: ["matmul_shared::"] };

describe("categorize", () => {
    it("buckets allocator symbols", () => {
        expect(categorize("dlmalloc", ctx).facility).toBe("allocator");
        expect(categorize("__rust_alloc", ctx).facility).toBe("allocator");
        expect(categorize("operator new(unsigned long)", ctx).facility).toBe("allocator");
    });
    it("buckets hash-map (SipHash/RandomState/libc++)", () => {
        expect(categorize("std::collections::hash::map::RandomState::new", ctx).facility).toBe("hash-map");
        expect(categorize("std::__2::__hash_table<...>::__rehash", ctx).facility).toBe("hash-map");
    });
    it("buckets core::hash machinery into hash-map (Task 1.8)", () => {
        expect(categorize("core::hash::BuildHasher::hash_one::h9ebb4fc48db0d305", ctx).facility).toBe("hash-map");
    });
    it("buckets string separately from hash-map", () => {
        expect(categorize("alloc::string::String::from_utf8", ctx).facility).toBe("string");
        expect(categorize("std::__2::basic_string<...>::__init", ctx).facility).toBe("string");
    });
    it("buckets panic/fmt", () => {
        expect(categorize("core::panicking::panic", ctx).facility).toBe("panic-fmt");
        expect(categorize("__cxa_throw", ctx).facility).toBe("panic-fmt");
    });
    it("buckets unwrap/unwind panic paths (Task 1.8)", () => {
        expect(categorize("core::result::unwrap_failed", ctx).facility).toBe("panic-fmt");
        expect(categorize("__rustc::rust_begin_unwind", ctx).facility).toBe("panic-fmt");
    });
    it("buckets allocator error/glue paths (Task 1.8)", () => {
        expect(categorize("<alloc::alloc::Global>::alloc_impl_runtime", ctx).facility).toBe("allocator");
        expect(categorize("alloc::alloc::handle_alloc_error", ctx).facility).toBe("allocator");
        expect(categorize("std::alloc::rust_oom", ctx).facility).toBe("allocator");
    });
    it("buckets vec/slice growth into dynamic-array (Task 1.8)", () => {
        expect(categorize("<T as alloc::slice::<impl [T]>::to_vec_in::ConvertVec>::to_vec", ctx).facility).toBe("dynamic-array");
        expect(categorize("alloc::raw_vec::capacity_overflow", ctx).facility).toBe("dynamic-array");
    });
    it("buckets low-level mem primitives into compiler-rt (Task 1.8)", () => {
        expect(categorize("core::ptr::swap_nonoverlapping_bytes", ctx).facility).toBe("compiler-rt");
    });
    it("buckets type-signature/magic rows into structural (Task 1.8)", () => {
        expect(categorize("type[8]: (i32, i32, i32, i32, i32) -> i32", ctx).facility).toBe("structural");
        expect(categorize("wasm magic bytes", ctx).facility).toBe("structural");
    });
    it("buckets wasm globals (stack ptr / heap base) into structural (P3 W2)", () => {
        expect(categorize("global[0]", ctx).facility).toBe("structural");
        expect(categorize("global[2]", ctx).facility).toBe("structural");
    });
    it("buckets toolchain-runtime (RandomState lazy init)", () => {
        expect(categorize("std::thread::local::LocalKey<T>::with", ctx).facility).toBe("toolchain-runtime");
        expect(categorize("<std::sync::LazyLock<T,F> as Deref>::deref", ctx).facility).toBe("toolchain-runtime");
    });
    it("marks observed by export name / workload prefix", () => {
        expect(categorize("matmul", ctx)).toEqual({ facility: "observed", scaling: "observed" });
        expect(categorize("matmul_shared::matmul_naive", ctx).facility).toBe("observed");
    });
    it("bench-name workload prefix catches mangled crate path + extern exports (P3 W2)", () => {
        // rustObservedCtx now seeds workloadPrefixes with the bare bench name so a substring
        // match catches both the `<bench>_rust_raw::…` mangled path (shape_dispatch trait-impl
        // / vtable methods) and `<bench>_<entry>` extern exports (interop_calls_noop), which the
        // narrower `<bench>::` prefix missed (crate name carries the `_rust_raw` suffix).
        const dynCtx: CategorizeCtx = { exportNames: new Set(), workloadPrefixes: ["shape_dispatch_homo_dyn"] };
        expect(categorize("<shape_dispatch_homo_dyn_rust_raw::Triangle as shape_dispatch_homo_dyn_rust_raw::Shape>::area", dynCtx).facility).toBe("observed");
        expect(categorize("shape_dispatch_homo_dyn_rust_raw::process::hc6212203242a7769", dynCtx).facility).toBe("observed");
        const interopCtx: CategorizeCtx = { exportNames: new Set(), workloadPrefixes: ["interop_calls"] };
        expect(categorize("interop_calls_noop", interopCtx).facility).toBe("observed"); // function body
        // The `export "…"` table row is structural overhead (matched before the observed check), not observed.
        expect(categorize('export "interop_calls_add_f64"', interopCtx).facility).toBe("structural");
    });
    it("falls through to unattributed", () => {
        expect(categorize("something::totally::unknown", ctx).facility).toBe("unattributed");
    });
    it("excludes non-prod meta rows", () => {
        expect(categorize('custom section ".debug_info"', ctx).facility).toBe("__excluded");
        expect(categorize('"function names" subsection', ctx).facility).toBe("__excluded");
        expect(categorize('"module name" subsection', ctx).facility).toBe("__excluded");
        expect(categorize("producers", ctx).facility).toBe("__excluded");
        expect(categorize("target_features", ctx).facility).toBe("__excluded");
    });
});
