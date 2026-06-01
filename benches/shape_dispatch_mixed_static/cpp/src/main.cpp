#include <stdint.h>
#include <stddef.h>

// Math via __builtin_* — same source compiles freestanding (wasi-sdk -nostdlib)
// and under emscripten (libc available). __builtin_memcpy lowers to wasm
// memory.copy under -mbulk-memory (passed in the wasi-sdk build script).
namespace {
constexpr double PI = 3.14159265358979323846;
}

// ---------------------------------------------------------------------------
// Bump allocator over a static heap (matmul-style). wasi-sdk freestanding
// has no malloc; using a static heap keeps both toolchains on the same code
// path. L size needs ~2.4 MB (100000 shapes); 32 MB is comfortable.
// ---------------------------------------------------------------------------
static const uint32_t HEAP_SIZE = 32u * 1024u * 1024u;
alignas(8) static uint8_t heap[HEAP_SIZE];
static uint32_t next_off = 0;

extern "C" uint32_t alloc(uint32_t sz) {
    uint32_t p = next_off;
    next_off = (next_off + sz + 7u) & ~7u;
    if (next_off > HEAP_SIZE) {
        return 0xFFFFFFFFu;
    }
    return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(&heap[p]));
}

// ---------------------------------------------------------------------------
// Single inline-tagged struct. Dispatch via switch(kind) inside an inlinable
// area_complex. NO vtable, no call_indirect — branches resolved on the tag.
// ---------------------------------------------------------------------------
struct TaggedShape {
    uint8_t kind;
    double  p1;
    double  p2;
};

static inline double area_complex(const TaggedShape& s) {
    double a;
    double p;
    switch (s.kind) {
        case 0u:
            a = PI * s.p1 * s.p1;
            p = 2.0 * PI * s.p1;
            break;
        case 1u:
            a = s.p1 * s.p1;
            p = 4.0 * s.p1;
            break;
        default:
            a = 0.5 * s.p1 * s.p2;
            p = s.p1 + s.p2 + __builtin_sqrt(s.p1 * s.p1 + s.p2 * s.p2);
            break;
    }
    return a * __builtin_sqrt(p / (a + 1.0)) + __builtin_log(a + p + 1.0);
}

namespace state {
    static TaggedShape* shapes = nullptr;
    static size_t       count  = 0;
}

extern "C" void load_input(uint32_t ptr, uint32_t len) {
    const uint8_t* buf = reinterpret_cast<const uint8_t*>(static_cast<uintptr_t>(ptr));
    const size_t n = len / 24u;

    const uint32_t arr_off = alloc(static_cast<uint32_t>(n) * static_cast<uint32_t>(sizeof(TaggedShape)));
    state::shapes = reinterpret_cast<TaggedShape*>(static_cast<uintptr_t>(arr_off));
    state::count  = n;

    for (size_t i = 0; i < n; ++i) {
        const uint8_t tag = buf[i * 24u];
        double p1;
        double p2;
        __builtin_memcpy(&p1, buf + i * 24u + 8u, sizeof(double));
        __builtin_memcpy(&p2, buf + i * 24u + 16u, sizeof(double));
        state::shapes[i].kind = tag;
        state::shapes[i].p1   = p1;
        state::shapes[i].p2   = p2;
    }
}

extern "C" double shape_dispatch_mixed_static(uint32_t iters) {
    (void)iters;  // array already sized to N; iterate the single stored array.
    uint64_t acc = 0;
    const TaggedShape* const arr = state::shapes;
    for (size_t i = 0; i < state::count; ++i) {
        acc += static_cast<uint64_t>(area_complex(arr[i]) * 1e6 + 0.5);
    }
    return static_cast<double>(acc);
}

extern "C" void reset() {
    // Read-only state after load_input — no-op. Provided for loader contract
    // symmetry with other workloads.
}
