#pragma once
#include <stdint.h>

extern "C" {
uint32_t alloc(uint32_t sz);
void load_input(uint32_t ptr, uint32_t len);
double mandelbrot(uint32_t iters);
void reset(void);
}
