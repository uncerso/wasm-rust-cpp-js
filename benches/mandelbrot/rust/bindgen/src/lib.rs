// Bindgen crate: state is a single Params in a RefCell singleton (SyncCell with a
// vacuous Sync impl — wasm32 is single-threaded). mandelbrot's input is 7 scalar
// params (no array to marshal), so unlike matmul/bindgen there is no byte->f64
// reinterpret: the 7 f64 are read with f64::from_le_bytes (safe).
#![allow(
    unsafe_code,
    reason = "vacuous Sync impl for the wasm32-single-threaded RefCell singleton; no &T ever crosses a thread boundary"
)]

use std::cell::RefCell;

use wasm_bindgen::prelude::*;

#[derive(Clone, Copy)]
struct Params {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    dims_x: u32,
    dims_y: u32,
    max_iter: u32,
}

impl Params {
    const fn zeroed() -> Self {
        Self {
            min_x: 0.0,
            max_x: 0.0,
            min_y: 0.0,
            max_y: 0.0,
            dims_x: 0,
            dims_y: 0,
            max_iter: 0,
        }
    }
}

// Wasm32 single-threaded — RefCell wrapped in SyncCell with a vacuous Sync impl.
// Same pattern as matmul/rust/bindgen.
struct SyncCell<T>(RefCell<T>);
// SAFETY: Sync requires &T to be shareable across threads. wasm32 is
// single-threaded, so no &T ever crosses a thread boundary; the obligation is vacuous.
unsafe impl<T> Sync for SyncCell<T> {}

static STATE: SyncCell<Params> = SyncCell(RefCell::new(Params::zeroed()));

fn read_f64(buf: &[u8], i: usize) -> f64 {
    let mut b = [0_u8; 8];
    b.copy_from_slice(&buf[i * 8..i * 8 + 8]);
    f64::from_le_bytes(b)
}

#[wasm_bindgen]
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "dims_x/dims_y/max_iter are small non-negative integers stored as f64 in the fixture"
)]
pub fn load_input(buf: &[u8]) {
    *STATE.0.borrow_mut() = Params {
        min_x: read_f64(buf, 0),
        max_x: read_f64(buf, 1),
        min_y: read_f64(buf, 2),
        max_y: read_f64(buf, 3),
        dims_x: read_f64(buf, 4) as u32,
        dims_y: read_f64(buf, 5) as u32,
        max_iter: read_f64(buf, 6) as u32,
    };
}

// Canonical escape-time count (order fixed by validate/reference.ts; verbatim).
#[allow(clippy::missing_const_for_fn, reason = "runtime hot loop; const-ness is incidental and unused")]
#[allow(
    clippy::suboptimal_flops,
    reason = "canonical expression order preserves cross-toolchain checksums; mul_add changes rounding"
)]
fn escape(cx: f64, cy: f64, max_iter: u32) -> u32 {
    let mut zx = 0.0_f64;
    let mut zy = 0.0_f64;
    let mut iter = 0_u32;
    while iter < max_iter {
        let zx2 = zx * zx;
        let zy2 = zy * zy;
        if zx2 + zy2 > 4.0 {
            break;
        }
        zy = 2.0 * zx * zy + cy;
        zx = zx2 - zy2 + cx;
        iter += 1;
    }
    iter
}

#[must_use]
#[wasm_bindgen]
#[allow(clippy::cast_precision_loss, reason = "acc = sum of iteration counts, bounded by dims_x*dims_y*max_iter < 2^53")]
#[allow(
    clippy::suboptimal_flops,
    reason = "canonical grid coordinates preserve cross-toolchain checksums; mul_add changes rounding"
)]
pub fn mandelbrot(iters: u32) -> f64 {
    let p = *STATE.0.borrow();
    let step_x = (p.max_x - p.min_x) / f64::from(p.dims_x);
    let step_y = (p.max_y - p.min_y) / f64::from(p.dims_y);
    let mut last = 0.0_f64;
    for _ in 0..iters {
        let mut acc: u64 = 0;
        for py in 0..p.dims_y {
            let cy = p.min_y + f64::from(py) * step_y;
            for px in 0..p.dims_x {
                let cx = p.min_x + f64::from(px) * step_x;
                acc += u64::from(escape(cx, cy, p.max_iter));
            }
        }
        last = acc as f64;
    }
    last
}

#[wasm_bindgen]
#[allow(clippy::missing_const_for_fn, reason = "wasm_bindgen requires non-const fns")]
pub fn reset() {}

#[must_use]
#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}
