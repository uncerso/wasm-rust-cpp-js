#include "matmul.h"

// We avoid <math.h> so the same source compiles freestanding under wasi-sdk
// (no libc headers). __builtin_* are recognised by clang in both modes.

static const uint32_t HEAP_SIZE = 32u * 1024u * 1024u;
// alignas(8) guarantees the storage address is 8-aligned at link time. The
// bumping allocator (alloc) preserves 8-byte alignment via `(next_off + sz + 7u) & ~7u`,
// so &heap[p] is always 8-aligned for any p returned by alloc(). This makes
// the reinterpret_cast<double*>(uintptr) in run() defined behaviour rather
// than relying on toolchain-incidental layout (emcc / wasi-sdk both happened
// to align static storage to 8 bytes, but that is not guaranteed by either).
alignas(8) static uint8_t heap[HEAP_SIZE];
static uint32_t next_off = 0;

static uint32_t N = 0;
static uint32_t A_OFF = 0;
static uint32_t B_OFF = 0;
static uint32_t C_OFF = 0;

extern "C" uint32_t alloc(uint32_t sz) {
    uint32_t p = next_off;
    next_off = (next_off + sz + 7u) & ~7u;
    if (next_off > HEAP_SIZE) return 0xFFFFFFFFu;
    return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(&heap[p]));
}

extern "C" void load_input(uint32_t ptr, uint32_t len) {
    uint32_t total_f64 = len / 8u;
    uint32_t half = total_f64 / 2u;
    uint32_t n = static_cast<uint32_t>(__builtin_sqrt(static_cast<double>(half)));
    N = n;
    A_OFF = ptr;
    B_OFF = ptr + n * n * 8u;
    C_OFF = alloc(n * n * 8u);
}

extern "C" double run(uint32_t iters) {
    const uint32_t n = N;
// alloc() aligns to 8 bytes ((next_off + sz + 7u) & ~7u), so these
// wasm32 linear-memory offsets are always 8-byte aligned. The
// reinterpret_cast from uintptr_t to double* is safe here.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wcast-align"
    const double* A = reinterpret_cast<const double*>(static_cast<uintptr_t>(A_OFF));
    const double* B = reinterpret_cast<const double*>(static_cast<uintptr_t>(B_OFF));
    double* C = reinterpret_cast<double*>(static_cast<uintptr_t>(C_OFF));
#pragma clang diagnostic pop
    double last = 0.0;
    for (uint32_t it = 0; it < iters; it++) {
        for (uint32_t i = 0; i < n*n; i++) C[i] = 0.0;
        for (uint32_t i = 0; i < n; i++) {
            for (uint32_t k = 0; k < n; k++) {
                const double aik = A[i*n + k];
                for (uint32_t j = 0; j < n; j++) C[i*n + j] += aik * B[k*n + j];
            }
        }
        double s = 0.0;
        for (uint32_t i = 0; i < n*n; i++) s += __builtin_fabs(C[i]);
        last = s;
    }
    return last;
}

extern "C" uint32_t output_ptr() { return C_OFF; }
extern "C" uint32_t output_len() { return N * N * 8u; }
extern "C" void reset() {}
