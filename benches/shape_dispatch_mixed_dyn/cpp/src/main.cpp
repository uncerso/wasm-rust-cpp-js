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
// path. L size needs ~3.6 MB (100000 shapes × 36 B); 32 MB is comfortable.
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
// Polymorphic shape hierarchy. Three concrete types; mixed array dispatch
// is the polymorphic-3 call site under test.
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

// Worst-case object size = sizeof(Triangle); shared storage region uses that
// stride so any tag can placement-new into slot i.
static const uint32_t SHAPE_STRIDE = sizeof(Triangle);

// Anti-devirtualization sink. Storing each freshly-constructed Shape* through
// a volatile pointer prevents the optimizer from proving the concrete type at
// the call site even when load_input is inlined. wasm32 clang does not accept
// gas-style register constraints (`"g"`/`"r"`), so we use a volatile-write
// barrier — same effect for type analysis purposes.
static Shape* volatile g_anti_devirt_sink = nullptr;

namespace state {
    static Shape** dyn_array = nullptr;
}

extern "C" void load_input(uint32_t ptr, uint32_t len) {
    const uint8_t* buf = reinterpret_cast<const uint8_t*>(static_cast<uintptr_t>(ptr));
    const size_t n = len / 24u;

    const uint32_t storage_off = alloc(static_cast<uint32_t>(n) * SHAPE_STRIDE);
    const uint32_t array_off = alloc(static_cast<uint32_t>(n) * static_cast<uint32_t>(sizeof(Shape*)));

    uint8_t* storage = reinterpret_cast<uint8_t*>(static_cast<uintptr_t>(storage_off));
    state::dyn_array = reinterpret_cast<Shape**>(static_cast<uintptr_t>(array_off));

    for (size_t i = 0; i < n; ++i) {
        const uint8_t tag = buf[i * 24u];
        double p1;
        double p2;
        __builtin_memcpy(&p1, buf + i * 24u + 8u, sizeof(double));
        __builtin_memcpy(&p2, buf + i * 24u + 16u, sizeof(double));

        void* slot = storage + i * SHAPE_STRIDE;
        Shape* sh;
        switch (tag) {
            case 0u:
                sh = new (slot) Circle(p1);
                break;
            case 1u:
                sh = new (slot) Square(p1);
                break;
            default:
                sh = new (slot) Triangle(p1, p2);
                break;
        }
        // Anti-devirt: write through volatile sink so the compiler cannot
        // prove sh's dynamic type at the call site below.
        g_anti_devirt_sink = sh;
        state::dyn_array[i] = sh;
    }
}

extern "C" double shape_dispatch_mixed_dyn(uint32_t iters) {
    uint64_t acc = 0;
    Shape* const* const arr = state::dyn_array;
    for (uint32_t i = 0; i < iters; ++i) {
        const double sc = arr[i]->score();
        acc += static_cast<uint64_t>(sc * 1e6 + 0.5);
    }
    return static_cast<double>(acc);
}

extern "C" void reset() {
    // Read-only state after load_input — no-op. Provided for loader contract
    // symmetry with other workloads.
}
