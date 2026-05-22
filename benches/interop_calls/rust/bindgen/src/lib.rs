// SyncCell pattern requires `unsafe impl Sync` (vacuous on wasm32 single-threaded).
// Same allow as matmul/rust/bindgen.
#![allow(
    unsafe_code,
    reason = "SyncCell wrapper requires unsafe impl Sync; vacuous on wasm32 single-threaded"
)]

use std::cell::Cell;

use wasm_bindgen::prelude::*;

// Wasm32 single-threaded — Cell<u32> wrapped in SyncCell with vacuous Sync
// impl. Same pattern as matmul/rust/bindgen (SyncCell<RefCell<State>>).
struct SyncCell<T>(Cell<T>);
// SAFETY: Sync requires `&T` to be safely shareable across threads. wasm32 is
// single-threaded, so no `&T` ever crosses a thread boundary; the obligation
// is vacuous.
unsafe impl<T> Sync for SyncCell<T> {}

static NOOP_COUNTER: SyncCell<u32> = SyncCell(Cell::new(0));

#[wasm_bindgen]
pub fn interop_calls_noop() {
    NOOP_COUNTER.0.set(NOOP_COUNTER.0.get().wrapping_add(1));
}

#[must_use]
#[wasm_bindgen]
pub fn interop_calls_noop_counter() -> u32 {
    NOOP_COUNTER.0.get()
}

// wasm_bindgen macro emits non-const FFI wrappers; pure-fn `const` is rejected
// at the macro level, so suppress the lint instead of dropping wasm_bindgen.
#[must_use]
#[wasm_bindgen]
#[allow(clippy::missing_const_for_fn, reason = "wasm_bindgen requires non-const fns")]
pub fn interop_calls_add_i32(a: i32, b: i32) -> i32 {
    a.wrapping_add(b)
}

#[must_use]
#[wasm_bindgen]
#[allow(clippy::missing_const_for_fn, reason = "wasm_bindgen requires non-const fns")]
pub fn interop_calls_add_f64(a: f64, b: f64) -> f64 {
    a + b
}

// Loader contract: bindgen loader calls glue.load_input(buf) before run().
// interop_calls is fixture-less (buf.len() == 0), so reset counter and return.
#[wasm_bindgen]
pub fn load_input(_buf: &[u8]) {
    NOOP_COUNTER.0.set(0);
}

#[wasm_bindgen]
pub fn reset() {
    NOOP_COUNTER.0.set(0);
}

#[must_use]
#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}
