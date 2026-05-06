// Bindgen crate: state lives in a thread_local RefCell instead of static mut.
// Wasm32 is single-threaded so the thread_local is effectively a singleton.
// Two unsafe blocks remain: byte↔f64 reinterpret in load_input and output_view.
// Both are inherent to the JS↔wasm marshalling boundary and cannot be removed
// without copying via temporary Vec<u8>/Vec<f64>.
#![allow(
    unsafe_code,
    reason = "byte↔f64 reinterpret is inherent to JS↔wasm marshalling at the wasm-bindgen boundary"
)]

use std::cell::RefCell;

use matmul_shared::{abs_sum, matmul_naive};
use wasm_bindgen::prelude::*;

#[derive(Default)]
struct State {
    n: usize,
    a: Vec<f64>,
    b: Vec<f64>,
    c: Vec<f64>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

#[wasm_bindgen]
pub fn load_input(buf: &[u8]) {
    let total_f64 = buf.len() / 8;
    let half = total_f64 / 2;
    let n = half.isqrt();
    debug_assert!(n * n == half);
    // wasm-bindgen copies the JS Uint8Array into the wasm linear memory before
    // handing us this slice; the wasm allocator returns 8-aligned addresses for
    // any non-trivial allocation, so &[u8] data is f64-aligned in practice.
    debug_assert_eq!(buf.as_ptr() as usize % 8, 0);
    // SAFETY: align(f64) ≤ align(buf) (debug_assert above); buf.len() is a
    // multiple of 8 (`total_f64 = buf.len() / 8` is exact when caller passes a
    // serialized matrix pair); we never write through this slice.
    #[allow(
        clippy::cast_ptr_alignment,
        reason = "wasm-bindgen-copied buffers are 8-aligned in practice (V8/SpiderMonkey/wasm allocator); debug_assert above catches platforms that break this"
    )]
    let f64s: &[f64] = unsafe {
        core::slice::from_raw_parts(buf.as_ptr().cast::<f64>(), total_f64)
    };
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        s.n = n;
        s.a = f64s[0..n * n].to_vec();
        s.b = f64s[n * n..2 * n * n].to_vec();
        s.c = vec![0.0; n * n];
    });
}

#[must_use]
#[wasm_bindgen]
pub fn run(iters: u32) -> f64 {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let n = s.n;
        let mut last = 0.0_f64;
        // Borrow checker rejects simultaneous &s.a / &s.b / &mut s.c because s
        // is &mut State; destructure to take three independent &/&mut to
        // distinct fields.
        let State { a, b, c, .. } = &mut *s;
        for _ in 0..iters {
            matmul_naive(a, b, c, n);
            last = abs_sum(c);
        }
        last
    })
}

#[must_use]
#[wasm_bindgen]
pub fn output_view() -> Vec<u8> {
    STATE.with(|s| {
        let c = &s.borrow().c;
        // SAFETY: align(u8) = 1 ≤ align(f64) so the cast cannot misalign;
        // length is c.len() * 8 because each f64 is 8 bytes; the source slice
        // is borrowed (not moved), so its lifetime outlives the slice we
        // construct here, and we only read through it.
        let bytes = unsafe {
            core::slice::from_raw_parts(c.as_ptr().cast::<u8>(), c.len() * 8)
        };
        bytes.to_vec()
    })
}

#[wasm_bindgen]
pub fn reset() {
    STATE.with(|s| {
        s.borrow_mut().c.fill(0.0);
    });
}

#[must_use]
#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}
