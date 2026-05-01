#include "matmul.h"
#include <math.h>

static const uint32_t HEAP_SIZE = 32u * 1024u * 1024u;
static uint8_t heap[HEAP_SIZE];
static uint32_t next_off = 0;

static uint32_t N = 0;
static uint32_t A_OFF = 0;
static uint32_t B_OFF = 0;
static uint32_t C_OFF = 0;

extern "C" uint32_t alloc(uint32_t sz) {
    uint32_t p = next_off;
    next_off = (next_off + sz + 7u) & ~7u;
    if (next_off > HEAP_SIZE) return 0xFFFFFFFFu;
    return (uint32_t)((uintptr_t)&heap[p]);
}

extern "C" void load_input(uint32_t ptr, uint32_t len) {
    uint32_t total_f64 = len / 8u;
    uint32_t half = total_f64 / 2u;
    uint32_t n = (uint32_t)sqrt((double)half);
    N = n;
    A_OFF = ptr;
    B_OFF = ptr + n * n * 8u;
    C_OFF = alloc(n * n * 8u);
}

extern "C" double run(uint32_t iters) {
    const uint32_t n = N;
    const double* A = (const double*)(uintptr_t)A_OFF;
    const double* B = (const double*)(uintptr_t)B_OFF;
    double* C = (double*)(uintptr_t)C_OFF;
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
        for (uint32_t i = 0; i < n*n; i++) s += fabs(C[i]);
        last = s;
    }
    return last;
}

extern "C" uint32_t output_ptr() { return C_OFF; }
extern "C" uint32_t output_len() { return N * N * 8u; }
extern "C" void reset() {}
