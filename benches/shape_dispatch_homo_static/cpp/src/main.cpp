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
// path. L size needs ~3.6 MB (100000 shapes); 32 MB is comfortable.
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
// POD shape structs. NO virtual — dispatch is static (template-instantiated
// 3×). Each concrete type lives in its own typed array.
// ---------------------------------------------------------------------------
struct Circle   { double r; };
struct Square   { double s; };
struct Triangle { double b, h; };

static inline double area_complex_circle(const Circle& c) {
    const double a = PI * c.r * c.r;
    const double p = 2.0 * PI * c.r;
    return a * __builtin_sqrt(p / (a + 1.0)) + __builtin_log(a + p + 1.0);
}
static inline double area_complex_square(const Square& sq) {
    const double a = sq.s * sq.s;
    const double p = 4.0 * sq.s;
    return a * __builtin_sqrt(p / (a + 1.0)) + __builtin_log(a + p + 1.0);
}
static inline double area_complex_triangle(const Triangle& t) {
    const double a = 0.5 * t.b * t.h;
    const double p = t.b + t.h + __builtin_sqrt(t.b * t.b + t.h * t.h);
    return a * __builtin_sqrt(p / (a + 1.0)) + __builtin_log(a + p + 1.0);
}

// Static dispatch: monomorphized 3× over (struct type, score fn). No vtable,
// no call_indirect — the call is resolved at compile time.
template <typename S, double (*FN)(const S&)>
static uint64_t process(const S* arr, size_t n) {
    uint64_t acc = 0;
    for (size_t i = 0; i < n; ++i) {
        acc += static_cast<uint64_t>(FN(arr[i]) * 1e6 + 0.5);
    }
    return acc;
}

namespace state {
    static Circle*   circles    = nullptr;
    static Square*   squares    = nullptr;
    static Triangle* triangles  = nullptr;
    static size_t    n_circle   = 0;
    static size_t    n_square   = 0;
    static size_t    n_triangle = 0;
}

extern "C" void load_input(uint32_t ptr, uint32_t len) {
    const uint8_t* buf = reinterpret_cast<const uint8_t*>(static_cast<uintptr_t>(ptr));
    const size_t n = len / 24u;

    // Pass 1: count per type.
    size_t cnt[3] = {0, 0, 0};
    for (size_t i = 0; i < n; ++i) {
        const uint8_t tag = buf[i * 24u];
        cnt[tag < 3u ? tag : 2u]++;
    }
    state::n_circle   = cnt[0];
    state::n_square   = cnt[1];
    state::n_triangle = cnt[2];

    const uint32_t circle_off   = alloc(static_cast<uint32_t>(cnt[0]) * static_cast<uint32_t>(sizeof(Circle)));
    const uint32_t square_off   = alloc(static_cast<uint32_t>(cnt[1]) * static_cast<uint32_t>(sizeof(Square)));
    const uint32_t triangle_off = alloc(static_cast<uint32_t>(cnt[2]) * static_cast<uint32_t>(sizeof(Triangle)));

    state::circles   = reinterpret_cast<Circle*>(static_cast<uintptr_t>(circle_off));
    state::squares   = reinterpret_cast<Square*>(static_cast<uintptr_t>(square_off));
    state::triangles = reinterpret_cast<Triangle*>(static_cast<uintptr_t>(triangle_off));

    // Pass 2: fill per-type arrays.
    size_t ci = 0;
    size_t si = 0;
    size_t ti = 0;
    for (size_t i = 0; i < n; ++i) {
        const uint8_t tag = buf[i * 24u];
        double p1;
        double p2;
        __builtin_memcpy(&p1, buf + i * 24u + 8u, sizeof(double));
        __builtin_memcpy(&p2, buf + i * 24u + 16u, sizeof(double));
        switch (tag) {
            case 0u:
                state::circles[ci++].r = p1;
                break;
            case 1u:
                state::squares[si++].s = p1;
                break;
            default:
                state::triangles[ti].b = p1;
                state::triangles[ti].h = p2;
                ti++;
                break;
        }
    }
}

extern "C" double shape_dispatch_homo_static(uint32_t iters) {
    (void)iters;  // per-type arrays already sized to N; iterate stored arrays.
    uint64_t acc = 0;
    acc += process<Circle,   area_complex_circle>(state::circles, state::n_circle);
    acc += process<Square,   area_complex_square>(state::squares, state::n_square);
    acc += process<Triangle, area_complex_triangle>(state::triangles, state::n_triangle);
    return static_cast<double>(acc);
}

extern "C" void reset() {
    // Read-only state after load_input — no-op. Provided for loader contract
    // symmetry with other workloads.
}
