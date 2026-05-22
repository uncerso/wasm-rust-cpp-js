#include "interop_calls.h"

// Wasm32 single-threaded; static storage suffices for the counter.
static uint32_t noop_counter = 0;

extern "C" void interop_calls_noop() {
    noop_counter += 1u;
}

extern "C" uint32_t interop_calls_noop_counter() {
    return noop_counter;
}

// wasm i32.add is two's-complement wrap; signed overflow in C++ is UB, so
// do the add in uint32_t and reinterpret. Matches Rust's wrapping_add and
// JS's `(a + b) | 0` semantics.
extern "C" int32_t interop_calls_add_i32(int32_t a, int32_t b) {
    return static_cast<int32_t>(static_cast<uint32_t>(a) + static_cast<uint32_t>(b));
}

extern "C" double interop_calls_add_f64(double a, double b) {
    return a + b;
}

// Loader contract: alloc(len) + load_input(ptr, len) called before run().
// interop_calls is fixture-less (len=0); load_input doubles as a reset hook so
// each measurement sample starts from counter=0.
extern "C" uint32_t alloc(uint32_t sz) {
    (void)sz;
    return 0u;
}

extern "C" void load_input(uint32_t ptr, uint32_t len) {
    (void)ptr;
    (void)len;
    noop_counter = 0u;
}
