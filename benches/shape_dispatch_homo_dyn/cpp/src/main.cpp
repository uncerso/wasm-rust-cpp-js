#include <stdint.h>
#include <stddef.h>

// Placement-new declaration. wasi-sdk freestanding (-nostdlib) does not
// provide <new>; declaring this inline keeps a single source compiling
// under both wasi-sdk (freestanding) and emscripten.
inline void* operator new(size_t, void* p) noexcept { return p; }

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
// Polymorphic shape hierarchy. Three concrete types; objects partitioned into
// 3 per-type pointer arrays. Each dispatch loop iterates one type's pointer
// array → monomorphic call site (BTB-predictable) but still a real
// call_indirect (virtual dispatch).
// ---------------------------------------------------------------------------
struct Shape {
    virtual double score() const = 0;
    virtual ~Shape() = default;
};

// Stub operator delete (wasi-sdk freestanding only). virtual ~Shape() emits a
// deleting destructor that references `operator delete`. We placement-new'd
// objects into a bump-allocated static heap and never call `delete` on them,
// but the symbol must still resolve at link time. Emscripten supplies this
// via libc++; wasi-sdk freestanding does not, so we define a no-op here.
#ifndef __EMSCRIPTEN__
void operator delete(void*) noexcept {}
void operator delete(void*, size_t) noexcept {}
#endif

struct Circle : Shape {
    double r;
    explicit Circle(double r_) : r(r_) {}
    double score() const override {
        const double a = PI * r * r;
        const double p = 2.0 * PI * r;
        return a * __builtin_sqrt(p / (a + 1.0)) + __builtin_log(a + p + 1.0);
    }
};

struct Square : Shape {
    double s;
    explicit Square(double s_) : s(s_) {}
    double score() const override {
        const double a = s * s;
        const double p = 4.0 * s;
        return a * __builtin_sqrt(p / (a + 1.0)) + __builtin_log(a + p + 1.0);
    }
};

struct Triangle : Shape {
    double b, h;
    Triangle(double b_, double h_) : b(b_), h(h_) {}
    double score() const override {
        const double a = 0.5 * b * h;
        const double p = b + h + __builtin_sqrt(b * b + h * h);
        return a * __builtin_sqrt(p / (a + 1.0)) + __builtin_log(a + p + 1.0);
    }
};

// Anti-devirtualization sink. Storing each freshly-constructed Shape* through
// a volatile pointer prevents the optimizer from proving the concrete type at
// the call site even when load_input is inlined. wasm32 clang does not accept
// gas-style register constraints (`"g"`/`"r"`), so we use a volatile-write
// barrier — same effect for type analysis purposes.
static Shape* volatile g_anti_devirt_sink = nullptr;

namespace state {
    static Shape** circles    = nullptr;
    static Shape** squares    = nullptr;
    static Shape** triangles  = nullptr;
    static size_t  n_circle   = 0;
    static size_t  n_square   = 0;
    static size_t  n_triangle = 0;
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

    // Per-type object storage (concrete-size strides) + per-type pointer arrays.
    const uint32_t circle_store   = alloc(static_cast<uint32_t>(cnt[0]) * static_cast<uint32_t>(sizeof(Circle)));
    const uint32_t square_store   = alloc(static_cast<uint32_t>(cnt[1]) * static_cast<uint32_t>(sizeof(Square)));
    const uint32_t triangle_store = alloc(static_cast<uint32_t>(cnt[2]) * static_cast<uint32_t>(sizeof(Triangle)));

    const uint32_t circle_arr   = alloc(static_cast<uint32_t>(cnt[0]) * static_cast<uint32_t>(sizeof(Shape*)));
    const uint32_t square_arr   = alloc(static_cast<uint32_t>(cnt[1]) * static_cast<uint32_t>(sizeof(Shape*)));
    const uint32_t triangle_arr = alloc(static_cast<uint32_t>(cnt[2]) * static_cast<uint32_t>(sizeof(Shape*)));

    Circle*   cstore = reinterpret_cast<Circle*>(static_cast<uintptr_t>(circle_store));
    Square*   sstore = reinterpret_cast<Square*>(static_cast<uintptr_t>(square_store));
    Triangle* tstore = reinterpret_cast<Triangle*>(static_cast<uintptr_t>(triangle_store));

    state::circles   = reinterpret_cast<Shape**>(static_cast<uintptr_t>(circle_arr));
    state::squares   = reinterpret_cast<Shape**>(static_cast<uintptr_t>(square_arr));
    state::triangles = reinterpret_cast<Shape**>(static_cast<uintptr_t>(triangle_arr));

    // Pass 2: placement-new each into its type's storage, store ptr, anti-devirt.
    size_t ci = 0;
    size_t si = 0;
    size_t ti = 0;
    for (size_t i = 0; i < n; ++i) {
        const uint8_t tag = buf[i * 24u];
        double p1;
        double p2;
        __builtin_memcpy(&p1, buf + i * 24u + 8u, sizeof(double));
        __builtin_memcpy(&p2, buf + i * 24u + 16u, sizeof(double));

        Shape* sh;
        switch (tag) {
            case 0u:
                sh = new (&cstore[ci]) Circle(p1);
                state::circles[ci] = sh;
                ci++;
                break;
            case 1u:
                sh = new (&sstore[si]) Square(p1);
                state::squares[si] = sh;
                si++;
                break;
            default:
                sh = new (&tstore[ti]) Triangle(p1, p2);
                state::triangles[ti] = sh;
                ti++;
                break;
        }
        // Anti-devirt: write through volatile sink so the compiler cannot
        // prove sh's dynamic type at the call sites below.
        g_anti_devirt_sink = sh;
    }
}

extern "C" double shape_dispatch_homo_dyn(uint32_t iters) {
    (void)iters;  // per-type arrays already sized to N; iterate stored arrays.
    uint64_t acc = 0;
    Shape* const* const ca = state::circles;
    Shape* const* const sa = state::squares;
    Shape* const* const ta = state::triangles;
    for (size_t i = 0; i < state::n_circle; ++i) {
        acc += static_cast<uint64_t>(ca[i]->score() * 1e6 + 0.5);
    }
    for (size_t i = 0; i < state::n_square; ++i) {
        acc += static_cast<uint64_t>(sa[i]->score() * 1e6 + 0.5);
    }
    for (size_t i = 0; i < state::n_triangle; ++i) {
        acc += static_cast<uint64_t>(ta[i]->score() * 1e6 + 0.5);
    }
    return static_cast<double>(acc);
}

extern "C" void reset() {
    // Read-only state after load_input — no-op. Provided for loader contract
    // symmetry with other workloads.
}
