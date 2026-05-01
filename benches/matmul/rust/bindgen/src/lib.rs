use wasm_bindgen::prelude::*;

static mut N: usize = 0;
static mut A: Vec<f64> = Vec::new();
static mut B: Vec<f64> = Vec::new();
static mut C: Vec<f64> = Vec::new();

#[wasm_bindgen]
pub fn load_input(buf: &[u8]) {
    let total_f64 = buf.len() / 8;
    let half = total_f64 / 2;
    let n = (half as f64).sqrt() as usize;
    debug_assert!(n * n == half);
    let f64s: &[f64] = unsafe {
        core::slice::from_raw_parts(buf.as_ptr() as *const f64, total_f64)
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
            for x in C.iter_mut() { *x = 0.0; }
            let n = N;
            for i in 0..n {
                for k in 0..n {
                    let aik = A[i*n+k];
                    for j in 0..n { C[i*n+j] += aik * B[k*n+j]; }
                }
            }
            let mut s = 0.0_f64;
            for &x in C.iter() { s += x.abs(); }
            last = s;
        }
    }
    last
}

#[wasm_bindgen]
pub fn output_view() -> Vec<u8> {
    unsafe {
        let bytes = core::slice::from_raw_parts(
            C.as_ptr() as *const u8, C.len() * 8,
        );
        bytes.to_vec()
    }
}

#[wasm_bindgen]
pub fn reset() {
    unsafe { for x in C.iter_mut() { *x = 0.0; } }
}

#[wasm_bindgen]
pub fn wasm_memory() -> JsValue { wasm_bindgen::memory() }
