// Bindgen crate: parallels rust/raw — three concrete POD shape types, each in
// its own raw-heap-allocated typed array. Dispatch is STATIC: the generic
// `process<S: Score>` is monomorphized 3× (once per concrete type). NO trait
// objects, NO `dyn`, NO black_box — the `score()` call site is resolved at
// compile time (R1: no call_indirect from the dispatch itself). State held in a
// LazyLock<SyncCell<State>> singleton (peer mixed_dyn/rust/bindgen style).
//
// Raw heap arrays via std::alloc::alloc(Layout) are used in place of Vec to keep
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
// POD shape structs. NO virtual / NO trait objects — dispatch is static,
// monomorphized 3× via the generic `process<S: Score>`. Each concrete type
// lives in its own typed array. Math identical to cpp / rust-raw siblings so
// per-shape `score` values (and thus the cross-binary checksum) match byte-
// for-byte. f64::sqrt and f64::ln are in std (available here) — no extern.
// ---------------------------------------------------------------------------
#[repr(C)]
#[derive(Clone, Copy)]
struct Circle {
    r: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Square {
    s: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Triangle {
    b: f64,
    h: f64,
}

trait Score {
    fn score(&self) -> f64;
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
impl Score for Circle {
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
impl Score for Square {
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
impl Score for Triangle {
    fn score(&self) -> f64 {
        let a = 0.5 * self.b * self.h;
        let p = self.b + self.h + (self.b * self.b + self.h * self.h).sqrt();
        a * (p / (a + 1.0)).sqrt() + (a + p + 1.0).ln()
    }
}

// Static dispatch: `process` is monomorphized once per concrete S — no vtable,
// no call_indirect. The `score()` call is resolved at compile time.
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
fn process<S: Score>(arr: *const S, n: usize) -> u64 {
    let mut acc: u64 = 0;
    for i in 0..n {
        // SAFETY: load_input allocated a contiguous run of `n` valid S values
        // at `arr` and never frees them; i < n keeps every access in bounds.
        let s = unsafe { &*arr.add(i) };
        acc = acc.wrapping_add((s.score() * 1e6 + 0.5) as u64);
    }
    acc
}

// ---------------------------------------------------------------------------
// Singleton state. Holds the three per-type heap regions and their counts.
// Wasm32 single-threaded → vacuous Sync impl; mutation is confined to
// load_input (called once before run) and reads happen only inside
// shape_dispatch_homo_static, so a plain UnsafeCell suffices.
// ---------------------------------------------------------------------------
struct State {
    circles_ptr: *const Circle,
    squares_ptr: *const Square,
    triangles_ptr: *const Triangle,
    n_circle: usize,
    n_square: usize,
    n_triangle: usize,
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
        circles_ptr: core::ptr::null::<Circle>(),
        squares_ptr: core::ptr::null::<Square>(),
        triangles_ptr: core::ptr::null::<Triangle>(),
        n_circle: 0,
        n_square: 0,
        n_triangle: 0,
    }))
});

#[wasm_bindgen]
#[allow(
    clippy::missing_panics_doc,
    reason = "panics only on impossible Layout overflow for fixture-sized N (≤ 100k)"
)]
#[allow(
    clippy::cast_ptr_alignment,
    reason = "Layout::array aligns each region to its element's align (8); the *mut u8 → *mut <shape> casts via alloc are sound; clippy cannot see across the alloc API"
)]
pub fn load_input(buf: &[u8]) {
    let n = buf.len() / 24;

    // Pass 1: count per type.
    let mut cnt = [0usize; 3];
    for i in 0..n {
        let tag = buf[i * 24];
        cnt[if (tag as usize) < 3 { tag as usize } else { 2 }] += 1;
    }

    let circles_layout = Layout::array::<Circle>(cnt[0])
        .expect("circle array layout fits within isize::MAX for fixture-sized N");
    let squares_layout = Layout::array::<Square>(cnt[1])
        .expect("square array layout fits within isize::MAX for fixture-sized N");
    let triangles_layout = Layout::array::<Triangle>(cnt[2])
        .expect("triangle array layout fits within isize::MAX for fixture-sized N");

    // SAFETY: Layout::array for n > 0 is non-zero-sized; alloc returns null on
    // failure which is checked. For empty per-type counts (cnt[k] == 0) the
    // layout is zero-sized and alloc behaviour is asserted below.
    let circles_ptr = unsafe { alloc(circles_layout) }.cast::<Circle>();
    assert!(!circles_ptr.is_null() || cnt[0] == 0, "alloc failed for circles");
    // SAFETY: see circles_ptr above.
    let squares_ptr = unsafe { alloc(squares_layout) }.cast::<Square>();
    assert!(!squares_ptr.is_null() || cnt[1] == 0, "alloc failed for squares");
    // SAFETY: see circles_ptr above.
    let triangles_ptr = unsafe { alloc(triangles_layout) }.cast::<Triangle>();
    assert!(!triangles_ptr.is_null() || cnt[2] == 0, "alloc failed for triangles");

    // Pass 2: fill per-type arrays via placement write.
    let mut ci = 0usize;
    let mut si = 0usize;
    let mut ti = 0usize;
    for i in 0..n {
        let off = i * 24;
        let tag = buf[off];
        let p1 = f64::from_le_bytes(buf[off + 8..off + 16].try_into().unwrap());
        let p2 = f64::from_le_bytes(buf[off + 16..off + 24].try_into().unwrap());
        // SAFETY: each per-type array was allocated with its type's count; the
        // running index (ci/si/ti) stays < that count by the pass-1 tally.
        match tag {
            0 => {
                unsafe { circles_ptr.add(ci).write(Circle { r: p1 }) };
                ci += 1;
            }
            1 => {
                unsafe { squares_ptr.add(si).write(Square { s: p1 }) };
                si += 1;
            }
            _ => {
                unsafe { triangles_ptr.add(ti).write(Triangle { b: p1, h: p2 }) };
                ti += 1;
            }
        }
    }

    // SAFETY: wasm32 single-threaded; load_input is the only writer to STATE.
    let st = unsafe { &mut *STATE.0.get() };
    st.circles_ptr = circles_ptr;
    st.squares_ptr = squares_ptr;
    st.triangles_ptr = triangles_ptr;
    st.n_circle = cnt[0];
    st.n_square = cnt[1];
    st.n_triangle = cnt[2];
}

#[wasm_bindgen]
#[must_use]
#[allow(
    clippy::cast_precision_loss,
    reason = "checksum max bounded ≤ 2^53 by inner_iterations × per-shape score; no precision loss within supported range"
)]
pub fn shape_dispatch_homo_static(_iters: u32) -> f64 {
    // Per-type arrays already sized to N by load_input; iterate stored arrays.
    // `_iters` is ignored (array-driven), matching the cpp + rust/raw peers.
    // SAFETY: load_input was called by the host before any entry call (loader
    // contract). Each pointer/count pair describes a contiguous run of valid
    // shapes; storage remains live for the entire run (no free path).
    let st = unsafe { &*STATE.0.get() };
    let acc = process(st.circles_ptr, st.n_circle)
        .wrapping_add(process(st.squares_ptr, st.n_square))
        .wrapping_add(process(st.triangles_ptr, st.n_triangle));
    acc as f64
}

#[wasm_bindgen]
#[must_use]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}
