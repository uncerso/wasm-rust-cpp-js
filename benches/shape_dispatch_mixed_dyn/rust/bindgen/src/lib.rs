// Bindgen crate: parallels rust/raw — three concrete shape types, mixed-array
// dispatch via `*const dyn Shape` fat pointers, anti-devirt friction via
// `black_box` (matches cpp `g_anti_devirt_sink` volatile-write barrier and
// raw crate's identical pattern). State held in a LazyLock<SyncCell<State>>
// singleton (peer hashmap_int/rust/bindgen style).
//
// Raw heap arrays are used in place of Vec to avoid the std dispatch overhead
// inherent to Vec<Box<dyn Shape>>: each Triangle slot fits the worst-case
// concrete-type stride, then a parallel `*const dyn Shape` array carries the
// fat pointers that the hot loop dereferences.
#![allow(
    unsafe_code,
    reason = "raw heap alloc + fat dyn pointer storage is inherent to the workload's polymorphic-3 call site under test"
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

// ---------------------------------------------------------------------------
// Singleton state. Holds the two heap regions: shape storage (worst-case-
// strided) and the parallel fat-pointer array. Wasm32 single-threaded → vacuous
// Sync impl; peer hashmap_int/rust/bindgen uses RefCell but here mutation is
// confined to load_input (called once before run) and reads happen only inside
// shape_dispatch_mixed_dyn, so a plain UnsafeCell suffices and avoids the
// RefCell borrow tracking in the hot loop.
// ---------------------------------------------------------------------------
struct State {
    dyn_array_ptr: *const *const dyn Shape,
    // storage_ptr retained for documentation symmetry with the rust/raw + cpp
    // siblings (which expose a bump-allocator next-offset). Deallocation is
    // never performed — loader contract: module lives for the entire run.
    #[allow(dead_code, reason = "retained for symmetry with rust/raw + cpp; no free path")]
    storage_ptr: *mut u8,
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
        dyn_array_ptr: core::ptr::null::<*const dyn Shape>(),
        storage_ptr: core::ptr::null_mut(),
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
    reason = "alloc(Layout) returns pointers honoring the Layout's align; Triangle layout aligns to 8 which covers Circle/Square; *const dyn Shape array uses Layout::array which aligns correctly; clippy cannot see across the alloc API"
)]
pub fn load_input(buf: &[u8]) {
    let n = buf.len() / 24;

    // SAFETY: SHAPE_STRIDE is the worst-case sizeof(Triangle); align 8 covers
    // Circle/Square/Triangle. n * SHAPE_STRIDE ≤ 100k * 16 = 1.6 MB << isize::MAX
    // and ≤ 100k * 16 = 1.6 MB for storage. Layout::from_size_align cannot fail
    // here in practice but we propagate via unwrap for documentation.
    let storage_layout =
        Layout::from_size_align(n * SHAPE_STRIDE, core::mem::align_of::<Triangle>())
            .expect("storage layout fits within isize::MAX for fixture-sized N");
    let ptr_layout = Layout::array::<*const dyn Shape>(n)
        .expect("ptr-array layout fits within isize::MAX for fixture-sized N");

    // SAFETY: layouts above are non-zero-sized (n > 0 for any non-empty fixture);
    // alloc returns null on failure which is checked.
    let storage_ptr = unsafe { alloc(storage_layout) };
    assert!(!storage_ptr.is_null(), "alloc failed for shape storage");
    // SAFETY: see storage_ptr above.
    let dyn_array_ptr = unsafe { alloc(ptr_layout) }.cast::<*const dyn Shape>();
    assert!(!dyn_array_ptr.is_null(), "alloc failed for dyn-ptr array");

    for i in 0..n {
        let off = i * 24;
        let tag = buf[off];
        let p1 = f64::from_le_bytes(buf[off + 8..off + 16].try_into().unwrap());
        let p2 = f64::from_le_bytes(buf[off + 16..off + 24].try_into().unwrap());

        // SAFETY: storage_ptr was allocated with n * SHAPE_STRIDE bytes; i < n.
        let slot = unsafe { storage_ptr.add(i * SHAPE_STRIDE) };

        // SAFETY: slot is 8-byte aligned (Layout::align_of::<Triangle>() == 8 ≥
        // align_of<Circle> = align_of<Square> = 8) and points to SHAPE_STRIDE
        // == 16 bytes of writable storage. Writing the concrete struct into the
        // slot via `*mut T::write` initialises that storage; subsequent `&*p`
        // turns it into a live reference.
        let shape_ptr: *const dyn Shape = unsafe {
            match tag {
                0 => {
                    let p = slot.cast::<Circle>();
                    p.write(Circle { r: p1 });
                    p as *const dyn Shape
                }
                1 => {
                    let p = slot.cast::<Square>();
                    p.write(Square { s: p1 });
                    p as *const dyn Shape
                }
                _ => {
                    let p = slot.cast::<Triangle>();
                    p.write(Triangle { b: p1, h: p2 });
                    p as *const dyn Shape
                }
            }
        };

        // Anti-devirt friction: round the fat pointer through black_box so the
        // compiler cannot prove the concrete type at the dispatch site even
        // if load_input is inlined. Matches the cpp `g_anti_devirt_sink`
        // volatile-write pattern and rust/raw's identical black_box call.
        let escaped = black_box(shape_ptr);

        // SAFETY: dyn_array_ptr was allocated with n slots; i < n.
        unsafe { dyn_array_ptr.add(i).write(escaped) };
    }

    // SAFETY: wasm32 single-threaded; load_input is the only writer to STATE.
    let st = unsafe { &mut *STATE.0.get() };
    st.storage_ptr = storage_ptr;
    st.dyn_array_ptr = dyn_array_ptr;
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
    reason = "u64 → f64 conversion sized to fit; see cast_precision_loss above"
)]
#[allow(
    clippy::suboptimal_flops,
    reason = "expression form `score * 1e6 + 0.5` is part of the cross-binary checksum invariant; rewriting via mul_add changes FP rounding and breaks expectedChecksums in spec.json"
)]
pub fn shape_dispatch_mixed_dyn(iters: u32) -> f64 {
    // SAFETY: load_input was called by the host before any entry call (loader
    // contract). STATE.dyn_array_ptr points to a contiguous run of valid
    // `*const dyn Shape` fat pointers — each one to a live Circle/Square/
    // Triangle allocated above in the same load_input call. Storage remains
    // live for the entire module lifetime (no free path in this crate).
    let st = unsafe { &*STATE.0.get() };
    let base = st.dyn_array_ptr;
    let mut acc: u64 = 0;
    for i in 0..iters as usize {
        // SAFETY: see load_input contract above.
        let shape_ptr = unsafe { *base.add(i) };
        // SAFETY: see load_input contract above.
        let score = unsafe { (*shape_ptr).score() };
        acc = acc.wrapping_add((score * 1e6 + 0.5) as u64);
    }
    acc as f64
}

#[wasm_bindgen]
#[must_use]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}
