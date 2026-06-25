import type { ScalingKind } from "@bench/result-schema";

export interface CategorizeCtx {
    exportNames: Set<string>;
    workloadPrefixes: string[];
}

export interface FacilityResult {
    facility: string;
    scaling: ScalingKind;
}

interface Rule {
    facility: string;
    scaling: ScalingKind | "__meta";
    re: RegExp;
}

// Non-prod rows wasm-opt strips: excluded from the denominator entirely.
// `names?" subsection` catches both `"function names" subsection` and `"module name" subsection`.
const EXCLUDE_RE = /^custom section|names?" subsection|^producers$|^target_features$|\.debug/i;

// Ordered: first match wins. Patterns grounded in W0 probe + Task 1.8 unattributed-cluster review.
const RULES: Rule[] = [
    { facility: "panic-fmt", scaling: "paid-once", re: /panic|core::fmt|::fmt::|begin_panic|begin_unwind|__rust_start_panic|slice_index|panicking|unwrap_failed|__cxa_throw|__cxa_allocate_exception|__throw_/ },
    { facility: "toolchain-runtime", scaling: "paid-once", re: /__wbindgen|__wbg_|LazyLock|thread::local|LocalKey|FnOnce::call_once|core::cell::.*borrow|RefCell<.*borrow/ },
    { facility: "allocator", scaling: "paid-once", re: /dlmalloc|dlfree|dlrealloc|dlcalloc|__rust_alloc|__rust_realloc|__rust_dealloc|alloc::Global|alloc_impl|handle_alloc_error|rust_oom|sbrk|prepend_alloc|operator new|operator delete|^malloc$|^free$|get_new_handler/ },
    { facility: "hash-map", scaling: "paid-once", re: /HashMap|RandomState|SipHash|sip::|hashbrown|__hash_table|__hash_node|unordered_map|__next_prime|u8to64|BuildHasher|core::hash/ },
    { facility: "string", scaling: "paid-once", re: /alloc::string|::String|str::|from_utf8|basic_string|char_traits|__init_copy_ctor/ },
    { facility: "dynamic-array", scaling: "paid-once", re: /RawVec|raw_vec|alloc::vec|alloc::slice|::Vec<|to_vec|capacity_overflow|__split_buffer|::vector/ },
    { facility: "compiler-rt", scaling: "paid-once", re: /__multi3|__udiv|__umod|__div|memcpy|memmove|memset|memcmp|swap_nonoverlapping|compiler_builtins/ },
    { facility: "data", scaling: "paid-once", re: /^data segment|\.rodata|\.data/ },
    { facility: "structural", scaling: "paid-once", re: /^export |^elem|^table|^type[ \[]|^global\[|code section|magic|function table/ },
];

export function categorize(name: string, ctx: CategorizeCtx): FacilityResult {
    if (EXCLUDE_RE.test(name)) {
        return { facility: "__excluded", scaling: "paid-once" };
    }
    for (const r of RULES) {
        if (r.re.test(name)) {
            return { facility: r.facility, scaling: r.scaling === "__meta" ? "paid-once" : r.scaling };
        }
    }
    const bare = name.replace(/^export "?|"?$/g, "");
    if (ctx.exportNames.has(bare) || ctx.workloadPrefixes.some((p) => name.includes(p))) {
        return { facility: "observed", scaling: "observed" };
    }
    return { facility: "unattributed", scaling: "paid-once" };
}
