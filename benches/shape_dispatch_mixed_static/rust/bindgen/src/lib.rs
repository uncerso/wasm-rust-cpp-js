// Bindgen crate: parallels rust/raw — a single raw-heap array of an inline-tagged
// `enum Shape`. Dispatch via `match` inside an inlinable `area_complex`. NO
// vtable, no trait objects — branches resolved on the enum discriminant (R1: no
// call_indirect from the dispatch itself). State held in a
// LazyLock<SyncCell<State>> singleton (peer mixed_dyn/rust/bindgen style).
//
// Raw heap array via std::alloc::alloc(Layout) is used in place of Vec to keep
// the container-axis discipline identical to the rust/raw + cpp siblings.
#![allow(
    unsafe_code,
    reason = "raw heap alloc + placement writes are inherent to the workload's container-axis discipline (no Vec)"
)]

use core::cell::UnsafeCell;
use std::alloc::{Layout, alloc};
use std::sync::LazyLock;

use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Single inline-tagged enum. Dispatch via `match` inside an inlinable
// area_complex. NO vtable, no call_indirect — branches resolved on the tag.
// Math identical to cpp / rust-raw siblings so per-shape `score` values (and
// thus the cross-binary checksum) match byte-for-byte. f64::sqrt and f64::ln
// are in std (available here) — no extern.
// ---------------------------------------------------------------------------
#[repr(C)]
#[derive(Clone, Copy)]
enum Shape {
    Circle { r: f64 },
    Square { s: f64 },
    Triangle { b: f64, h: f64 },
}

// The float expressions below are BYTE-EQUIVALENT across cpp / rust-raw /
// rust-bindgen. Rewriting them (mul_add / ln_1p / hypot) would change FP
// rounding and break the cross-binary checksum invariant (spec.json
// expectedChecksums). The `suboptimal_flops` / `imprecise_flops` allows are NOT
// performance regressions to clean up later — they preserve numerical
// equivalence with the sibling binaries.
#[allow(
    clippy::suboptimal_flops,
    clippy::imprecise_flops,
    reason = "expression form is part of the cross-binary checksum invariant; rewriting via mul_add / ln_1p / hypot changes FP rounding and breaks expectedChecksums in spec.json"
)]
fn area_complex(shape: &Shape) -> f64 {
    let (a, p) = match *shape {
        Shape::Circle { r } => (
            std::f64::consts::PI * r * r,
            2.0 * std::f64::consts::PI * r,
        ),
        Shape::Square { s } => (s * s, 4.0 * s),
        Shape::Triangle { b, h } => (0.5 * b * h, b + h + (b * b + h * h).sqrt()),
    };
    a * (p / (a + 1.0)).sqrt() + (a + p + 1.0).ln()
}

// ---------------------------------------------------------------------------
// Singleton state. Holds the single heap array base and its element count.
// Wasm32 single-threaded → vacuous Sync impl; mutation is confined to
// load_input (called once before run) and reads happen only inside
// shape_dispatch_mixed_static, so a plain UnsafeCell suffices.
// ---------------------------------------------------------------------------
struct State {
    shapes_ptr: *const Shape,
    count: usize,
}

// SAFETY: wasm32 single-threaded; no real cross-thread sharing of the pointer.
unsafe impl Send for State {}
// SAFETY: see Send above.
unsafe impl Sync for State {}

#[repr(transparent)]
struct SyncCell<T>(UnsafeCell<T>);
// SAFETY: wasm32 single-threaded — &T never crosses a thread boundary.
unsafe impl<T> Sync for SyncCell<T> {}

static STATE: LazyLock<SyncCell<State>> = LazyLock::new(|| {
    SyncCell(UnsafeCell::new(State {
        shapes_ptr: core::ptr::null::<Shape>(),
        count: 0,
    }))
});

#[wasm_bindgen]
#[allow(
    clippy::missing_panics_doc,
    reason = "panics only on impossible Layout overflow for fixture-sized N (≤ 100k)"
)]
#[allow(
    clippy::cast_ptr_alignment,
    reason = "Layout::array aligns the region to Shape's align (8); the *mut u8 → *mut Shape cast via alloc is sound; clippy cannot see across the alloc API"
)]
pub fn load_input(buf: &[u8]) {
    let n = buf.len() / 24;

    let shapes_layout = Layout::array::<Shape>(n)
        .expect("shape array layout fits within isize::MAX for fixture-sized N");

    // SAFETY: Layout::array for n > 0 is non-zero-sized; alloc returns null on
    // failure which is checked (or vacuously satisfied for n == 0).
    let shapes_ptr = unsafe { alloc(shapes_layout) }.cast::<Shape>();
    assert!(!shapes_ptr.is_null() || n == 0, "alloc failed for shape array");

    for i in 0..n {
        let off = i * 24;
        let tag = buf[off];
        let p1 = f64::from_le_bytes(buf[off + 8..off + 16].try_into().unwrap());
        let p2 = f64::from_le_bytes(buf[off + 16..off + 24].try_into().unwrap());
        let shape = match tag {
            0 => Shape::Circle { r: p1 },
            1 => Shape::Square { s: p1 },
            _ => Shape::Triangle { b: p1, h: p2 },
        };
        // SAFETY: shapes_ptr was allocated with n slots; i < n.
        unsafe { shapes_ptr.add(i).write(shape) };
    }

    // SAFETY: wasm32 single-threaded; load_input is the only writer to STATE.
    let st = unsafe { &mut *STATE.0.get() };
    st.shapes_ptr = shapes_ptr;
    st.count = n;
}

#[wasm_bindgen]
#[must_use]
#[allow(
    clippy::cast_precision_loss,
    reason = "checksum max bounded ≤ 2^53 by inner_iterations × per-shape score; no precision loss within supported range"
)]
#[allow(
    clippy::cast_sign_loss,
    reason = "score values are non-negative for all shape inputs in the fixture range (r,s,b,h ∈ [0.5, 5.0))"
)]
#[allow(
    clippy::cast_possible_truncation,
    reason = "f64 → u64 conversion sized to fit; see cast_precision_loss above"
)]
#[allow(
    clippy::suboptimal_flops,
    reason = "expression form `score * 1e6 + 0.5` is part of the cross-binary checksum invariant; rewriting via mul_add changes FP rounding and breaks expectedChecksums in spec.json"
)]
pub fn shape_dispatch_mixed_static(_iters: u32) -> f64 {
    // Array already sized to N by load_input; iterate the single stored array.
    // `_iters` is ignored (array-driven), matching the cpp + rust/raw peers.
    let mut acc: u64 = 0;
    // SAFETY: load_input was called before any entry call (loader contract);
    // shapes_ptr points to a contiguous run of `count` valid Shape values that
    // remain live for the entire run (no free path).
    let st = unsafe { &*STATE.0.get() };
    for i in 0..st.count {
        let score = area_complex(unsafe { &*st.shapes_ptr.add(i) });
        acc = acc.wrapping_add((score * 1e6 + 0.5) as u64);
    }
    acc as f64
}

#[wasm_bindgen]
#[must_use]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}
