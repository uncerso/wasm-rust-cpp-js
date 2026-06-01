#![no_std]
// Raw WASM cdylib: ABI-level unsafe (#[unsafe(no_mangle)], raw ptr arithmetic,
// unaligned reads from fixture buffer) is inherent to the FFI surface.
// UnsafeCell replaces static mut so each unsafe block is narrow and locally
// documented with SAFETY.
#![allow(
    unsafe_code,
    reason = "raw WASM cdylib: ABI-level unsafe (no_mangle, raw ptrs, unaligned reads) is inherent and cannot be avoided"
)]

use core::cell::UnsafeCell;
use core::panic::PanicInfo;

#[panic_handler]
#[allow(clippy::missing_const_for_fn, reason = "panic_handler cannot be const")]
fn on_panic(_: &PanicInfo) -> ! {
    loop {}
}

// `sqrt` / `log` are NOT in `core`; in `no_std` we declare them as `extern "C"`
// and rustc's `compiler_builtins` provides the implementations for
// `wasm32-unknown-unknown`. Same expressions as the cpp/`__builtin_sqrt` and
// `__builtin_log` calls in `benches/shape_dispatch_homo_static/cpp/src/main.cpp`.
unsafe extern "C" {
    fn sqrt(x: f64) -> f64;
    fn log(x: f64) -> f64;
}

// ---------------------------------------------------------------------------
// POD shape structs. NO virtual / NO trait objects — dispatch is static,
// monomorphized 3× via the generic `process<S: Score>`. Each concrete type
// lives in its own typed array.
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

impl Score for Circle {
    fn score(&self) -> f64 {
        let a = core::f64::consts::PI * self.r * self.r;
        let p = 2.0 * core::f64::consts::PI * self.r;
        // SAFETY: sqrt / log are pure leaf functions on f64; no preconditions
        // for finite positive inputs (a, p > 0 since r > 0).
        unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
    }
}

impl Score for Square {
    fn score(&self) -> f64 {
        let a = self.s * self.s;
        let p = 4.0 * self.s;
        // SAFETY: see Circle::score.
        unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
    }
}

impl Score for Triangle {
    fn score(&self) -> f64 {
        let a = 0.5 * self.b * self.h;
        // SAFETY: see Circle::score.
        let hyp = unsafe { sqrt(self.b * self.b + self.h * self.h) };
        let p = self.b + self.h + hyp;
        // SAFETY: see Circle::score.
        unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
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
// Bump allocator over a static heap (matmul-style). 32 MB is comfortable for
// L (100k shapes × max sizeof(Triangle) ≈ 1.6 MB across the three arrays).
// ---------------------------------------------------------------------------
const HEAP_SIZE: usize = 32 * 1024 * 1024;

// Wasm32 single-threaded — UnsafeCell wrapper is sufficient for global mutable
// state. Each Sync impl below acknowledges that there are no real threads.
struct GlobalHeap(UnsafeCell<[u8; HEAP_SIZE]>);
// SAFETY: Sync requires `&T` to be safely shareable across threads. wasm32 is
// single-threaded, so no `&T` ever crosses a thread boundary; the obligation
// is vacuous.
unsafe impl Sync for GlobalHeap {}
static HEAP: GlobalHeap = GlobalHeap(UnsafeCell::new([0u8; HEAP_SIZE]));

struct GlobalState {
    next: UnsafeCell<usize>,
    circles_off: UnsafeCell<usize>,
    squares_off: UnsafeCell<usize>,
    triangles_off: UnsafeCell<usize>,
    n_circle: UnsafeCell<usize>,
    n_square: UnsafeCell<usize>,
    n_triangle: UnsafeCell<usize>,
}
// SAFETY: vacuous Sync — wasm32 single-threaded; same justification as
// GlobalHeap above.
unsafe impl Sync for GlobalState {}
static STATE: GlobalState = GlobalState {
    next: UnsafeCell::new(0),
    circles_off: UnsafeCell::new(0),
    squares_off: UnsafeCell::new(0),
    triangles_off: UnsafeCell::new(0),
    n_circle: UnsafeCell::new(0),
    n_square: UnsafeCell::new(0),
    n_triangle: UnsafeCell::new(0),
};

#[inline]
fn heap_base() -> usize {
    // addr_of!(HEAP.0) gives a stable address derivation without unsafe and
    // without dereferencing. UnsafeCell is repr(transparent) over its inner
    // value, so addr of HEAP.0 == addr of the inner [u8; HEAP_SIZE] storage.
    core::ptr::addr_of!(HEAP.0) as usize
}

#[unsafe(no_mangle)]
#[allow(clippy::cast_possible_truncation, reason = "wasm32 address space is always 32-bit")]
pub extern "C" fn alloc(sz: u32) -> u32 {
    // SAFETY: wasm32 single-threaded — STATE.next is the only mutable global
    // and alloc() is its only writer; concurrent calls are impossible.
    unsafe {
        let next = &mut *STATE.next.get();
        let p = *next;
        // Align to 8 — sufficient for f64 fields.
        *next = (*next + sz as usize + 7) & !7;
        if *next > HEAP_SIZE {
            return u32::MAX;
        }
        (heap_base() + p) as u32
    }
}

#[unsafe(no_mangle)]
#[allow(
    clippy::cast_possible_truncation,
    reason = "wasm32 address space is always 32-bit"
)]
#[allow(
    clippy::missing_safety_doc,
    reason = "FFI export; loader contract documented in raw-wasm.ts"
)]
#[allow(
    clippy::cast_ptr_alignment,
    reason = "alloc() aligns to 8 (= alignof Triangle / Circle / Square), so the *mut u8 → *mut <shape> casts are sound; clippy can't see across the alloc API"
)]
pub unsafe extern "C" fn load_input(ptr: u32, len: u32) {
    let n = (len as usize) / 24;

    // SAFETY: wasm32 single-threaded; load_input is the sole writer of STATE
    // and the heap regions returned by alloc(). The fixture bytes at `ptr`
    // were written by the JS host via memory.buffer + `alloc(len)`. The
    // tag/p1/p2 layout (1 + 7 pad + 8 + 8 = 24 B) matches the spec ioContract.
    unsafe {
        let buf = ptr as *const u8;

        // Pass 1: count per type.
        let mut cnt = [0usize; 3];
        for i in 0..n {
            let tag = *buf.add(i * 24);
            cnt[if (tag as usize) < 3 { tag as usize } else { 2 }] += 1;
        }

        let circles_off =
            alloc((cnt[0] * core::mem::size_of::<Circle>()) as u32) as usize;
        let squares_off =
            alloc((cnt[1] * core::mem::size_of::<Square>()) as u32) as usize;
        let triangles_off =
            alloc((cnt[2] * core::mem::size_of::<Triangle>()) as u32) as usize;

        let circles = circles_off as *mut Circle;
        let squares = squares_off as *mut Square;
        let triangles = triangles_off as *mut Triangle;

        // Pass 2: fill per-type arrays.
        let mut ci = 0usize;
        let mut si = 0usize;
        let mut ti = 0usize;
        for i in 0..n {
            let off = i * 24;
            let tag = *buf.add(off);
            // p1/p2 at +8/+16: aligned to 8 by the fixture layout, but
            // read_unaligned is conservative and identical-cost on wasm.
            let p1 = core::ptr::read_unaligned(buf.add(off + 8).cast::<f64>());
            let p2 = core::ptr::read_unaligned(buf.add(off + 16).cast::<f64>());
            match tag {
                0 => {
                    *circles.add(ci) = Circle { r: p1 };
                    ci += 1;
                }
                1 => {
                    *squares.add(si) = Square { s: p1 };
                    si += 1;
                }
                _ => {
                    *triangles.add(ti) = Triangle { b: p1, h: p2 };
                    ti += 1;
                }
            }
        }

        *STATE.circles_off.get() = circles_off;
        *STATE.squares_off.get() = squares_off;
        *STATE.triangles_off.get() = triangles_off;
        *STATE.n_circle.get() = cnt[0];
        *STATE.n_square.get() = cnt[1];
        *STATE.n_triangle.get() = cnt[2];
    }
}

#[unsafe(no_mangle)]
#[allow(
    clippy::missing_safety_doc,
    reason = "FFI export; loader contract documented in raw-wasm.ts"
)]
#[allow(
    clippy::cast_precision_loss,
    reason = "checksum max value bounded ≤ 2^53 by inner_iterations × per-shape score; no precision loss within the supported range"
)]
pub unsafe extern "C" fn shape_dispatch_homo_static(_iters: u32) -> f64 {
    // Per-type arrays already sized to N by load_input; iterate stored arrays.
    // `_iters` is ignored (array-driven), matching the cpp peer.
    // SAFETY: load_input was called by the host before any entry call (loader
    // contract). Each offset points to a contiguous run of its type's count of
    // valid values; storage remains live for the entire run (no free path).
    unsafe {
        let circles = *STATE.circles_off.get() as *const Circle;
        let squares = *STATE.squares_off.get() as *const Square;
        let triangles = *STATE.triangles_off.get() as *const Triangle;
        let acc = process(circles, *STATE.n_circle.get())
            .wrapping_add(process(squares, *STATE.n_square.get()))
            .wrapping_add(process(triangles, *STATE.n_triangle.get()));
        cast_acc(acc)
    }
}

#[allow(
    clippy::cast_precision_loss,
    reason = "checksum max value bounded ≤ 2^53; no precision loss within the supported range"
)]
const fn cast_acc(acc: u64) -> f64 {
    acc as f64
}

#[unsafe(no_mangle)]
pub const extern "C" fn reset() {
    // Read-only state after load_input — no-op. Provided for loader contract
    // symmetry with other workloads.
}
