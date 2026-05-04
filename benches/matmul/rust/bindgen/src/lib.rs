// Wave 3 will eliminate static mut entirely (UnsafeCell / thread_local!) —
// until then, suppress the reference-to-mutable-static lint here.
#![allow(
    static_mut_refs,
    reason = "static mut N/A/B/C removed in Wave 3 refactor"
)]
// Wave 3 replaces the static-mut state shape with thread_local!+RefCell, but
// the byte-to-f64 reinterpret in load_input/output_view stays — that unsafe
// is inherent to the JS↔wasm marshalling, not to the state representation.
#![allow(
    unsafe_code,
    reason = "static mut state replaced in Wave 3; byte-to-f64 reinterpret unsafe is inherent and remains"
)]

use wasm_bindgen::prelude::*;

static mut N: usize = 0;
static mut A: Vec<f64> = Vec::new();
static mut B: Vec<f64> = Vec::new();
static mut C: Vec<f64> = Vec::new();

#[wasm_bindgen]
pub fn load_input(buf: &[u8]) {
    let total_f64 = buf.len() / 8;
    let half = total_f64 / 2;
    let n = half.isqrt();
    debug_assert!(n * n == half);
    // Reinterpret the caller-supplied byte buffer as f64 values.  Both V8 and
    // SpiderMonkey allocate ArrayBuffer storage on at least 8-byte boundaries,
    // and wasm-bindgen copies the Uint8Array into the wasm heap which is
    // 8-byte-aligned for non-trivial allocations — so this is sound today, but
    // misalignment would be UB.  debug_assert below catches any platform that
    // breaks the assumption.
    debug_assert_eq!(buf.as_ptr() as usize % 8, 0);
    #[allow(
        clippy::cast_ptr_alignment,
        reason = "wasm-bindgen-copied buffers are 8-aligned in practice (V8/SpiderMonkey/wasm allocator); debug_assert above catches platforms that break this"
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
