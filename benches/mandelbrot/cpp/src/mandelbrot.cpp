#include "mandelbrot.h"

// Pure f64 compute: no libc, no heap growth, no <math.h> (the escape test uses
// only *, -, +, > on doubles). Compiles freestanding under wasi-sdk (-nostdlib)
// exactly like matmul — simpler, since there is no sqrt/fabs libcall at all.

static const uint32_t HEAP_SIZE = 64u; // fixture is 7 * f64 = 56 bytes
// alignas(8) makes &heap[0] 8-aligned at link time; the bump allocator keeps
// 8-byte alignment, so the reinterpret_cast<double*> in load_input is defined.
alignas(8) static uint8_t heap[HEAP_SIZE];
static uint32_t next_off = 0;

static double MIN_X = 0.0;
static double MAX_X = 0.0;
static double MIN_Y = 0.0;
static double MAX_Y = 0.0;
static uint32_t DIMS_X = 0;
static uint32_t DIMS_Y = 0;
static uint32_t MAX_ITER = 0;

extern "C" uint32_t alloc(uint32_t sz) {
    uint32_t p = next_off;
    next_off = (next_off + sz + 7u) & ~7u;
    if (next_off > HEAP_SIZE) {
        return 0xFFFFFFFFu;
    }
    return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(&heap[p]));
}

extern "C" void load_input(uint32_t ptr, [[maybe_unused]] uint32_t len) {
    // Host copied 7 little-endian f64 (region + dims + max_iter) to `ptr`.
    // alloc() returns 8-aligned addresses, so the f64 reads are aligned.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wcast-align"
    const double* d = reinterpret_cast<const double*>(static_cast<uintptr_t>(ptr));
#pragma clang diagnostic pop
    MIN_X = d[0];
    MAX_X = d[1];
    MIN_Y = d[2];
    MAX_Y = d[3];
    DIMS_X = static_cast<uint32_t>(d[4]);
    DIMS_Y = static_cast<uint32_t>(d[5]);
    MAX_ITER = static_cast<uint32_t>(d[6]);
}

// Canonical escape-time count (order fixed by validate/reference.ts; verbatim).
// No FMA: wasm32 has no scalar fma opcode, so `2.0*zx*zy+cy` is never contracted
// regardless of -ffp-contract; combined with no -ffast-math this is bit-identical
// across every toolchain.
static uint32_t escape(double cx, double cy, uint32_t max_iter) {
    double zx = 0.0;
    double zy = 0.0;
    uint32_t iter = 0;
    while (iter < max_iter) {
        const double zx2 = zx * zx;
        const double zy2 = zy * zy;
        if (zx2 + zy2 > 4.0) {
            break;
        }
        zy = 2.0 * zx * zy + cy;
        zx = zx2 - zy2 + cx;
        iter++;
    }
    return iter;
}

extern "C" double mandelbrot(uint32_t iters) {
    const double step_x = (MAX_X - MIN_X) / static_cast<double>(DIMS_X);
    const double step_y = (MAX_Y - MIN_Y) / static_cast<double>(DIMS_Y);
    double last = 0.0;
    for (uint32_t it = 0; it < iters; it++) {
        uint64_t acc = 0;
        for (uint32_t py = 0; py < DIMS_Y; py++) {
            const double cy = MIN_Y + static_cast<double>(py) * step_y;
            for (uint32_t px = 0; px < DIMS_X; px++) {
                const double cx = MIN_X + static_cast<double>(px) * step_x;
                acc += escape(cx, cy, MAX_ITER);
            }
        }
        last = static_cast<double>(acc);
    }
    return last;
}

extern "C" void reset() {}
