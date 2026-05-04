// Wave 3 will eliminate static mut entirely (UnsafeCell / thread_local!) —
// until then, suppress the reference-to-mutable-static lint here.
#![allow(
    static_mut_refs,
    reason = "static mut N/A/B/C removed in Wave 3 refactor"
)]
// All unsafe blocks in this file access the module-level static muts that
// Wave 3 will replace with safe alternatives.
#![allow(unsafe_code, reason = "static mut access — removed in Wave 3 refactor")]

use wasm_bindgen::prelude::*;

static mut N: usize = 0;
static mut A: Vec<f64> = Vec::new();
static mut B: Vec<f64> = Vec::new();
static mut C: Vec<f64> = Vec::new();

#[wasm_bindgen]
pub fn load_input(buf: &[u8]) {
    let total_f64 = buf.len() / 8;
    let half = total_f64 / 2;
    // sqrt then truncate to usize is intentional: n is always an exact integer
    // (the caller guarantees n*n == half).  The f64 precision loss and sign are
    // both acceptable here.
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        clippy::cast_precision_loss,
        reason = "isqrt via f64 sqrt: result is always a small exact integer; safe on wasm32"
    )]
    let n = (half as f64).sqrt() as usize;
    debug_assert!(n * n == half);
    // Reinterpret the caller-supplied byte buffer as f64 values.  The caller
    // (JS harness) ensures 8-byte alignment; this is intentional.
    #[allow(
        clippy::cast_ptr_alignment,
        reason = "caller guarantees 8-byte-aligned buffer; intentional byte-to-f64 reinterpret"
    )]
    let f64s: &[f64] = unsafe {
        core::slice::from_raw_parts(buf.as_ptr().cast::<f64>(), total_f64)
    };
    unsafe {
        N = n;
        A = f64s[0..n*n].to_vec();
        B = f64s[n*n..2*n*n].to_vec();
        C = vec![0.0; n*n];
    }
}

#[wasm_bindgen]
pub fn run(iters: u32) -> f64 {
    let mut last = 0.0;
    unsafe {
        for _ in 0..iters {
            C.fill(0.0);
            let n = N;
            for i in 0..n {
                for k in 0..n {
                    let aik = A[i*n+k];
                    for j in 0..n { C[i*n+j] += aik * B[k*n+j]; }
                }
            }
            let mut s = 0.0_f64;
            for &x in &C { s += x.abs(); }
            last = s;
        }
    }
    last
}

#[must_use]
#[wasm_bindgen]
pub fn output_view() -> Vec<u8> {
    unsafe {
        let bytes = core::slice::from_raw_parts(
            C.as_ptr().cast::<u8>(), C.len() * 8,
        );
        bytes.to_vec()
    }
}

#[wasm_bindgen]
pub fn reset() {
    unsafe { C.fill(0.0); }
}

#[must_use]
#[wasm_bindgen]
pub fn wasm_memory() -> JsValue { wasm_bindgen::memory() }
