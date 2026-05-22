#pragma once
#include <stdint.h>

extern "C" {
uint32_t alloc(uint32_t sz);
void load_input(uint32_t ptr, uint32_t len);
double matmul(uint32_t iters);
uint32_t output_ptr(void);
uint32_t output_len(void);
void reset(void);
}
