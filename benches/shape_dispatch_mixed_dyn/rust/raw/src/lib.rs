#![no_std]
// Raw WASM cdylib: ABI-level unsafe (#[unsafe(no_mangle)], raw ptr arithmetic,
// fat-pointer reads, unaligned reads from fixture buffer) is inherent to the
// FFI surface. UnsafeCell replaces static mut so each unsafe block is narrow
// and locally documented with SAFETY.
#![allow(
    unsafe_code,
    reason = "raw WASM cdylib: ABI-level unsafe (no_mangle, raw ptrs, fat dyn pointers, unaligned reads) is inherent and cannot be avoided"
)]

use core::cell::UnsafeCell;
use core::hint::black_box;
use core::panic::PanicInfo;

#[panic_handler]
#[allow(clippy::missing_const_for_fn, reason = "panic_handler cannot be const")]
fn on_panic(_: &PanicInfo) -> ! {
    loop {}
}

// `sqrt` / `log` are NOT in `core`; in `no_std` we declare them as `extern "C"`
// and rustc's `compiler_builtins` provides the implementations for
// `wasm32-unknown-unknown`. Same expressions as the cpp/`__builtin_sqrt` and
// `__builtin_log` calls in `benches/shape_dispatch_mixed_dyn/cpp/src/main.cpp`.
unsafe extern "C" {
    fn sqrt(x: f64) -> f64;
    fn log(x: f64) -> f64;
}

// ---------------------------------------------------------------------------
// Polymorphic shape hierarchy. Three concrete types; mixed array dispatch via
// `*const dyn Shape` fat pointers is the polymorphic-3 call site under test.
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

impl Shape for Circle {
    fn score(&self) -> f64 {
        let a = core::f64::consts::PI * self.r * self.r;
        let p = 2.0 * core::f64::consts::PI * self.r;
        // SAFETY: sqrt / log are pure leaf functions on f64; no preconditions
        // for finite positive inputs (a, p > 0 since r > 0).
        unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
    }
}

impl Shape for Square {
    fn score(&self) -> f64 {
        let a = self.s * self.s;
        let p = 4.0 * self.s;
        // SAFETY: see Circle::score.
        unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
    }
}

impl Shape for Triangle {
    fn score(&self) -> f64 {
        let a = 0.5 * self.b * self.h;
        // SAFETY: see Circle::score.
        let hyp = unsafe { sqrt(self.b * self.b + self.h * self.h) };
        let p = self.b + self.h + hyp;
        // SAFETY: see Circle::score.
        unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
    }
}

// ---------------------------------------------------------------------------
// Bump allocator over a static heap (matmul-style). 32 MB is comfortable for
// L (100k shapes × max sizeof(Triangle) + 100k × sizeof(fat ptr) ≈ 2.4 MB).
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
    dyn_off: UnsafeCell<usize>,
}
// SAFETY: vacuous Sync — wasm32 single-threaded; same justification as
// GlobalHeap above.
unsafe impl Sync for GlobalState {}
static STATE: GlobalState = GlobalState {
    next: UnsafeCell::new(0),
    dyn_off: UnsafeCell::new(0),
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
        // Align to 8 — sufficient for f64 fields and `*const dyn` fat ptr.
        *next = (*next + sz as usize + 7) & !7;
        if *next > HEAP_SIZE {
            return u32::MAX;
        }
        (heap_base() + p) as u32
    }
}

// Worst-case shape stride == sizeof(Triangle) == 16. Storing every concrete
// type in 16-byte slots keeps the storage region's address arithmetic simple
// and matches the cpp impl's `SHAPE_STRIDE = sizeof(Triangle)` pattern.
const SHAPE_STRIDE: usize = core::mem::size_of::<Triangle>();
const DYN_PTR_SIZE: usize = core::mem::size_of::<*const dyn Shape>();

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
    reason = "alloc() aligns to 8 (= alignof Triangle / Circle / Square), so the *mut u8 → *mut Shape casts are sound; clippy can't see across the alloc API"
)]
pub unsafe extern "C" fn load_input(ptr: u32, len: u32) {
    let n = (len as usize) / 24;

    // Allocate storage for the concrete-type instances (SHAPE_STRIDE per slot)
    // and the parallel array of fat `*const dyn Shape` pointers.
    let storage_off = alloc((n * SHAPE_STRIDE) as u32) as usize;
    let dyn_off_u32 = alloc((n * DYN_PTR_SIZE) as u32) as usize;

    // SAFETY: wasm32 single-threaded; load_input is the sole writer of STATE
    // and the heap regions returned by alloc(). The fixture bytes at `ptr`
    // were written by the JS host via memory.buffer + `alloc(len)`. The
    // tag/p1/p2 layout (1 + 7 pad + 8 + 8 = 24 B) matches the spec ioContract.
    unsafe {
        let buf = ptr as *const u8;

        for i in 0..n {
            let off = i * 24;
            let tag = *buf.add(off);
            // p1/p2 at +8/+16: aligned to 8 by the fixture layout, but
            // read_unaligned is conservative and identical-cost on wasm.
            let p1 = core::ptr::read_unaligned(buf.add(off + 8).cast::<f64>());
            let p2 = core::ptr::read_unaligned(buf.add(off + 16).cast::<f64>());

            let slot = (storage_off + i * SHAPE_STRIDE) as *mut u8;
            let shape_ptr: *const dyn Shape = match tag {
                0 => {
                    let p = slot.cast::<Circle>();
                    *p = Circle { r: p1 };
                    p as *const dyn Shape
                }
                1 => {
                    let p = slot.cast::<Square>();
                    *p = Square { s: p1 };
                    p as *const dyn Shape
                }
                _ => {
                    let p = slot.cast::<Triangle>();
                    *p = Triangle { b: p1, h: p2 };
                    p as *const dyn Shape
                }
            };

            // Anti-devirt friction: round the fat pointer through black_box
            // so the compiler cannot prove the concrete type at the call site
            // even if load_input is inlined into shape_dispatch_mixed_dyn.
            // Matches `g_anti_devirt_sink` volatile-write barrier in cpp/.
            let escaped = black_box(shape_ptr);

            let dyn_slot = (dyn_off_u32 + i * DYN_PTR_SIZE) as *mut *const dyn Shape;
            *dyn_slot = escaped;
        }

        *STATE.dyn_off.get() = dyn_off_u32;
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
#[allow(
    clippy::cast_sign_loss,
    reason = "score values are non-negative for all shape inputs in the fixture range (r,s,b,h ∈ [0.5, 5.0))"
)]
#[allow(
    clippy::cast_possible_truncation,
    reason = "u64 → f64 conversion sized to fit; see cast_precision_loss above"
)]
pub unsafe extern "C" fn shape_dispatch_mixed_dyn(iters: u32) -> f64 {
    let mut acc: u64 = 0;
    // SAFETY: load_input was called by the host before any entry call (loader
    // contract). STATE.dyn_off points to a contiguous run of `iters` valid
    // `*const dyn Shape` fat pointers — each one to a live Circle/Square/
    // Triangle allocated above in the same load_input call. Concrete-type
    // storage remains live for the entire run (no free path in this crate).
    unsafe {
        let base = *STATE.dyn_off.get() as *const *const dyn Shape;
        for i in 0..iters as usize {
            let shape_ptr = *base.add(i);
            let score = (*shape_ptr).score();
            acc = acc.wrapping_add((score * 1e6 + 0.5) as u64);
        }
    }
    acc as f64
}

#[unsafe(no_mangle)]
pub const extern "C" fn reset() {
    // Read-only state after load_input — no-op. Provided for loader contract
    // symmetry with other workloads.
}
