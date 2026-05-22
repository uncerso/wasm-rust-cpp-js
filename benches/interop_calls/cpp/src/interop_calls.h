#pragma once
#include <stdint.h>

extern "C" {
uint32_t alloc(uint32_t sz);
void load_input(uint32_t ptr, uint32_t len);
void interop_calls_noop(void);
uint32_t interop_calls_noop_counter(void);
int32_t interop_calls_add_i32(int32_t a, int32_t b);
double interop_calls_add_f64(double a, double b);
}
