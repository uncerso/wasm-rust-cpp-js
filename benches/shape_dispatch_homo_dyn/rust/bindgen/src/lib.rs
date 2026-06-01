// Bindgen crate: parallels rust/raw — three concrete shape types partitioned
// into 3 per-type `*const dyn Shape` fat-pointer arrays. Each dispatch loop is a
// monomorphic call site (BTB-predictable) but still a REAL call_indirect
// (virtual dispatch) — R1 ACTIVE. Anti-devirt friction via `black_box` at
// construction (matches cpp `g_anti_devirt_sink` volatile-write barrier and the
// rust/raw sibling's identical pattern). State held in a LazyLock<SyncCell<State>>
// singleton (peer mixed_dyn/rust/bindgen style).
//
// Raw heap arrays via std::alloc::alloc(Layout) are used in place of Vec to keep
// the container-axis discipline identical to the rust/raw + cpp siblings: each
// concrete type is placement-written into a worst-case-strided storage region,
// then a parallel per-type `*const dyn Shape` array carries the fat pointers
// that the hot loop dereferences.
#![allow(
    unsafe_code,
    reason = "raw heap alloc + fat dyn pointer storage is inherent to the workload's per-type polymorphic call sites under test"
)]

use core::cell::UnsafeCell;
use core::hint::black_box;
use std::alloc::{Layout, alloc};
use std::sync::LazyLock;

use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Polymorphic shape hierarchy. Math identical to cpp / rust-raw siblings so
// per-shape `score` values (and thus the cross-binary checksum) match byte-
// for-byte. f64::sqrt and f64::ln are in std (available here) — no extern.
// ---------------------------------------------------------------------------
trait Shape {
    fn score(&self) -> f64;
}

#[repr(C)]
struct Circle {
    r: f64,
}
#[repr(C)]
struct Square {
    s: f64,
}
#[repr(C)]
struct Triangle {
    b: f64,
    h: f64,
}

// Each `score` impl is BYTE-EQUIVALENT across cpp / rust-raw / rust-bindgen.
// Rewriting the float expressions (mul_add / ln_1p / hypot) would change FP
// rounding and break the cross-binary checksum invariant (spec.json
// expectedChecksums). The `suboptimal_flops` and `imprecise_flops` allows
// below are NOT performance regressions to clean up later — they preserve
// numerical equivalence with the sibling binaries.
#[allow(
    clippy::suboptimal_flops,
    clippy::imprecise_flops,
    reason = "expression form is part of the cross-binary checksum invariant; rewriting via mul_add / ln_1p / hypot changes FP rounding and breaks expectedChecksums in spec.json"
)]
impl Shape for Circle {
    fn score(&self) -> f64 {
        let a = std::f64::consts::PI * self.r * self.r;
        let p = 2.0 * std::f64::consts::PI * self.r;
        a * (p / (a + 1.0)).sqrt() + (a + p + 1.0).ln()
    }
}

#[allow(
    clippy::suboptimal_flops,
    clippy::imprecise_flops,
    reason = "expression form is part of the cross-binary checksum invariant; rewriting via mul_add / ln_1p / hypot changes FP rounding and breaks expectedChecksums in spec.json"
)]
impl Shape for Square {
    fn score(&self) -> f64 {
        let a = self.s * self.s;
        let p = 4.0 * self.s;
        a * (p / (a + 1.0)).sqrt() + (a + p + 1.0).ln()
    }
}

#[allow(
    clippy::suboptimal_flops,
    clippy::imprecise_flops,
    reason = "expression form is part of the cross-binary checksum invariant; rewriting via mul_add / ln_1p / hypot changes FP rounding and breaks expectedChecksums in spec.json"
)]
impl Shape for Triangle {
    fn score(&self) -> f64 {
        let a = 0.5 * self.b * self.h;
        let p = self.b + self.h + (self.b * self.b + self.h * self.h).sqrt();
        a * (p / (a + 1.0)).sqrt() + (a + p + 1.0).ln()
    }
}

// Monomorphic dispatch loop over a per-type fat-pointer array. The call site is
// a real call_indirect (the fat pointer's vtable slot is invoked) — the
// black_box at construction keeps the compiler from devirtualizing it.
#[allow(
    clippy::cast_precision_loss,
    reason = "checksum max value bounded ≤ 2^53 by inner_iterations × per-shape score; no precision loss within the supported range"
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
fn process(arr: *const *const dyn Shape, n: usize) -> u64 {
    let mut acc: u64 = 0;
    for i in 0..n {
        // SAFETY: caller guarantees `arr` points to a contiguous run of `n`
        // valid `*const dyn Shape` fat pointers, each to a live shape allocated
        // in load_input; storage remains live for the entire run (no free path).
        let shape_ptr = unsafe { *arr.add(i) };
        // SAFETY: see above.
        let score = unsafe { (*shape_ptr).score() };
        acc = acc.wrapping_add((score * 1e6 + 0.5) as u64);
    }
    acc
}

// ---------------------------------------------------------------------------
// Singleton state. Holds the three per-type fat-pointer array bases and counts.
// The concrete-type storage regions are retained only for documentation
// symmetry; deallocation is never performed (loader contract: module lives for
// the entire run).
// ---------------------------------------------------------------------------
struct State {
    circles_arr: *const *const dyn Shape,
    squares_arr: *const *const dyn Shape,
    triangles_arr: *const *const dyn Shape,
    n_circle: usize,
    n_square: usize,
    n_triangle: usize,
    #[allow(dead_code, reason = "retained for symmetry with rust/raw + cpp; no free path")]
    circle_store: *mut u8,
    #[allow(dead_code, reason = "retained for symmetry with rust/raw + cpp; no free path")]
    square_store: *mut u8,
    #[allow(dead_code, reason = "retained for symmetry with rust/raw + cpp; no free path")]
    triangle_store: *mut u8,
}

// SAFETY: wasm32 single-threaded; no real cross-thread sharing of the pointers.
unsafe impl Send for State {}
// SAFETY: see Send above.
unsafe impl Sync for State {}

#[repr(transparent)]
struct SyncCell<T>(UnsafeCell<T>);
// SAFETY: wasm32 single-threaded — &T never crosses a thread boundary.
unsafe impl<T> Sync for SyncCell<T> {}

static STATE: LazyLock<SyncCell<State>> = LazyLock::new(|| {
    SyncCell(UnsafeCell::new(State {
        circles_arr: core::ptr::null::<*const dyn Shape>(),
        squares_arr: core::ptr::null::<*const dyn Shape>(),
        triangles_arr: core::ptr::null::<*const dyn Shape>(),
        n_circle: 0,
        n_square: 0,
        n_triangle: 0,
        circle_store: core::ptr::null_mut(),
        square_store: core::ptr::null_mut(),
        triangle_store: core::ptr::null_mut(),
    }))
});

// Worst-case shape stride == sizeof(Triangle). Storing every concrete type in
// uniform 16-byte slots matches the cpp impl's `SHAPE_STRIDE = sizeof(Triangle)`
// and the rust/raw bump-allocator layout.
const SHAPE_STRIDE: usize = core::mem::size_of::<Triangle>();

#[wasm_bindgen]
#[allow(
    clippy::missing_panics_doc,
    reason = "panics only on impossible Layout overflow for fixture-sized N (≤ 100k)"
)]
#[allow(
    clippy::cast_ptr_alignment,
    reason = "storage layouts align to 8 (= alignof Triangle, covers Circle/Square); the *const dyn Shape arrays use Layout::array which aligns correctly; clippy cannot see across the alloc API"
)]
pub fn load_input(buf: &[u8]) {
    let n = buf.len() / 24;

    // Pass 1: count per type.
    let mut cnt = [0usize; 3];
    for i in 0..n {
        let tag = buf[i * 24];
        cnt[if (tag as usize) < 3 { tag as usize } else { 2 }] += 1;
    }

    let store_layout = |k: usize| {
        Layout::from_size_align(k * SHAPE_STRIDE, core::mem::align_of::<Triangle>())
            .expect("storage layout fits within isize::MAX for fixture-sized N")
    };
    let ptr_layout = |k: usize| {
        Layout::array::<*const dyn Shape>(k)
            .expect("ptr-array layout fits within isize::MAX for fixture-sized N")
    };

    // SAFETY: layouts are non-zero-sized for k > 0; alloc returns null on
    // failure which is checked (or vacuously satisfied for k == 0).
    let circle_store = unsafe { alloc(store_layout(cnt[0])) };
    let square_store = unsafe { alloc(store_layout(cnt[1])) };
    let triangle_store = unsafe { alloc(store_layout(cnt[2])) };
    assert!(!circle_store.is_null() || cnt[0] == 0, "alloc failed for circle store");
    assert!(!square_store.is_null() || cnt[1] == 0, "alloc failed for square store");
    assert!(!triangle_store.is_null() || cnt[2] == 0, "alloc failed for triangle store");

    // SAFETY: see stores above.
    let circles_arr = unsafe { alloc(ptr_layout(cnt[0])) }.cast::<*const dyn Shape>();
    let squares_arr = unsafe { alloc(ptr_layout(cnt[1])) }.cast::<*const dyn Shape>();
    let triangles_arr = unsafe { alloc(ptr_layout(cnt[2])) }.cast::<*const dyn Shape>();
    assert!(!circles_arr.is_null() || cnt[0] == 0, "alloc failed for circle ptr array");
    assert!(!squares_arr.is_null() || cnt[1] == 0, "alloc failed for square ptr array");
    assert!(!triangles_arr.is_null() || cnt[2] == 0, "alloc failed for triangle ptr array");

    // Pass 2: placement-write each into its type's storage, escape the fat
    // pointer through black_box (anti-devirt), store ptr in its per-type array.
    let mut ci = 0usize;
    let mut si = 0usize;
    let mut ti = 0usize;
    for i in 0..n {
        let off = i * 24;
        let tag = buf[off];
        let p1 = f64::from_le_bytes(buf[off + 8..off + 16].try_into().unwrap());
        let p2 = f64::from_le_bytes(buf[off + 16..off + 24].try_into().unwrap());

        // SAFETY: each store region is `cnt[k] * SHAPE_STRIDE` bytes, 8-byte
        // aligned; the running index stays < cnt[k]. Each per-type ptr array is
        // sized to cnt[k] slots. Placement write initialises the slot, then
        // `&*p` (inside `process`) turns it into a live reference.
        unsafe {
            match tag {
                0 => {
                    let slot = circle_store.add(ci * SHAPE_STRIDE).cast::<Circle>();
                    slot.write(Circle { r: p1 });
                    let escaped = black_box(slot as *const dyn Shape);
                    circles_arr.add(ci).write(escaped);
                    ci += 1;
                }
                1 => {
                    let slot = square_store.add(si * SHAPE_STRIDE).cast::<Square>();
                    slot.write(Square { s: p1 });
                    let escaped = black_box(slot as *const dyn Shape);
                    squares_arr.add(si).write(escaped);
                    si += 1;
                }
                _ => {
                    let slot = triangle_store.add(ti * SHAPE_STRIDE).cast::<Triangle>();
                    slot.write(Triangle { b: p1, h: p2 });
                    let escaped = black_box(slot as *const dyn Shape);
                    triangles_arr.add(ti).write(escaped);
                    ti += 1;
                }
            }
        }
    }

    // SAFETY: wasm32 single-threaded; load_input is the only writer to STATE.
    let st = unsafe { &mut *STATE.0.get() };
    st.circles_arr = circles_arr;
    st.squares_arr = squares_arr;
    st.triangles_arr = triangles_arr;
    st.n_circle = cnt[0];
    st.n_square = cnt[1];
    st.n_triangle = cnt[2];
    st.circle_store = circle_store;
    st.square_store = square_store;
    st.triangle_store = triangle_store;
}

#[wasm_bindgen]
#[must_use]
#[allow(
    clippy::cast_precision_loss,
    reason = "checksum max bounded ≤ 2^53 by inner_iterations × per-shape score; no precision loss within supported range"
)]
pub fn shape_dispatch_homo_dyn(_iters: u32) -> f64 {
    // Per-type fat-pointer arrays already sized to N by load_input; iterate
    // stored arrays. `_iters` is ignored (array-driven), matching the cpp +
    // rust/raw peers. Three separate monomorphic loops.
    // SAFETY: load_input was called by the host before any entry call (loader
    // contract); each base/count pair describes a valid fat-pointer array.
    let st = unsafe { &*STATE.0.get() };
    let acc = process(st.circles_arr, st.n_circle)
        .wrapping_add(process(st.squares_arr, st.n_square))
        .wrapping_add(process(st.triangles_arr, st.n_triangle));
    acc as f64
}

#[wasm_bindgen]
#[must_use]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}
