// Bindgen crate: state lives in a static SyncCell<State> singleton (RefCell
// wrapped with vacuous Sync impl). Wasm32 single-threaded → no thread crossing.
// Eliminates the lazy thread_local init shim (см. closed tech-debt
// bindgen-thread-local-init-shim-overhead).
// One unsafe block remains: byte→f64 reinterpret in load_input. It is inherent
// to the JS↔wasm marshalling boundary and cannot be removed without copying
// via a temporary Vec<u8>/Vec<f64>.
#![allow(
    unsafe_code,
    reason = "byte↔f64 reinterpret is inherent to JS↔wasm marshalling at the wasm-bindgen boundary"
)]

use std::cell::RefCell;

use matmul_shared::{abs_sum, matmul_naive};
use wasm_bindgen::prelude::*;

struct State {
    n: usize,
    a: Vec<f64>,
    b: Vec<f64>,
    c: Vec<f64>,
}

impl State {
    const fn new() -> Self {
        Self { n: 0, a: Vec::new(), b: Vec::new(), c: Vec::new() }
    }
}

// Wasm32 single-threaded — RefCell wrapped in SyncCell with vacuous Sync impl.
// Same pattern as the raw crate's UnsafeCell singleton.
struct SyncCell<T>(RefCell<T>);
// SAFETY: Sync requires &T to be safely shareable across threads. wasm32 is
// single-threaded, so no &T ever crosses a thread boundary; the obligation
// is vacuous.
unsafe impl<T> Sync for SyncCell<T> {}

static STATE: SyncCell<State> = SyncCell(RefCell::new(State::new()));

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
    let mut s = STATE.0.borrow_mut();
    s.n = n;
    s.a = f64s[0..n * n].to_vec();
    s.b = f64s[n * n..2 * n * n].to_vec();
    s.c = vec![0.0; n * n];
}

// Transitional alias: see matmul/rust/raw for rationale. Removed in Task 14.
#[must_use]
#[wasm_bindgen]
pub fn matmul(iters: u32) -> f64 {
    run(iters)
}

#[must_use]
#[wasm_bindgen]
pub fn run(iters: u32) -> f64 {
    let mut s = STATE.0.borrow_mut();
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
}

#[wasm_bindgen]
pub fn reset() {
    STATE.0.borrow_mut().c.fill(0.0);
}

#[must_use]
#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}
