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
// `__builtin_log` calls in `benches/shape_dispatch_mixed_static/cpp/src/main.cpp`.
unsafe extern "C" {
    fn sqrt(x: f64) -> f64;
    fn log(x: f64) -> f64;
}

// ---------------------------------------------------------------------------
// Single inline-tagged enum. Dispatch via `match` inside an inlinable
// area_complex. NO vtable, no call_indirect — branches resolved on the tag.
// ---------------------------------------------------------------------------
#[repr(C)]
#[derive(Clone, Copy)]
enum Shape {
    Circle { r: f64 },
    Square { s: f64 },
    Triangle { b: f64, h: f64 },
}

fn area_complex(shape: &Shape) -> f64 {
    let (a, p) = match *shape {
        Shape::Circle { r } => (
            core::f64::consts::PI * r * r,
            2.0 * core::f64::consts::PI * r,
        ),
        Shape::Square { s } => (s * s, 4.0 * s),
        // SAFETY: sqrt is a pure leaf function on f64; no preconditions.
        Shape::Triangle { b, h } => {
            (0.5 * b * h, b + h + unsafe { sqrt(b * b + h * h) })
        }
    };
    // SAFETY: sqrt / log are pure leaf functions on f64; finite positive inputs.
    unsafe { a * sqrt(p / (a + 1.0)) + log(a + p + 1.0) }
}

// ---------------------------------------------------------------------------
// Bump allocator over a static heap (matmul-style). 32 MB is comfortable for
// L (100k shapes × sizeof(Shape) ≈ 2.4 MB).
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
    shapes_off: UnsafeCell<usize>,
    count: UnsafeCell<usize>,
}
// SAFETY: vacuous Sync — wasm32 single-threaded; same justification as
// GlobalHeap above.
unsafe impl Sync for GlobalState {}
static STATE: GlobalState = GlobalState {
    next: UnsafeCell::new(0),
    shapes_off: UnsafeCell::new(0),
    count: UnsafeCell::new(0),
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
        // Align to 8 — sufficient for the enum's f64 payload fields.
        *next = (*next + sz as usize + 7) & !7;
        if *next > HEAP_SIZE {
            return u32::MAX;
        }
        (heap_base() + p) as u32
    }
}

const SHAPE_SIZE: usize = core::mem::size_of::<Shape>();

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
    reason = "alloc() aligns to 8 (= alignof Shape), so the *mut u8 → *mut Shape cast is sound; clippy can't see across the alloc API"
)]
pub unsafe extern "C" fn load_input(ptr: u32, len: u32) {
    let n = (len as usize) / 24;

    let shapes_off = alloc((n * SHAPE_SIZE) as u32) as usize;

    // SAFETY: wasm32 single-threaded; load_input is the sole writer of STATE
    // and the heap region returned by alloc(). The fixture bytes at `ptr` were
    // written by the JS host via memory.buffer + `alloc(len)`. The tag/p1/p2
    // layout (1 + 7 pad + 8 + 8 = 24 B) matches the spec ioContract.
    unsafe {
        let buf = ptr as *const u8;
        let shapes = shapes_off as *mut Shape;

        for i in 0..n {
            let off = i * 24;
            let tag = *buf.add(off);
            // p1/p2 at +8/+16: aligned to 8 by the fixture layout, but
            // read_unaligned is conservative and identical-cost on wasm.
            let p1 = core::ptr::read_unaligned(buf.add(off + 8).cast::<f64>());
            let p2 = core::ptr::read_unaligned(buf.add(off + 16).cast::<f64>());
            let shape = match tag {
                0 => Shape::Circle { r: p1 },
                1 => Shape::Square { s: p1 },
                _ => Shape::Triangle { b: p1, h: p2 },
            };
            *shapes.add(i) = shape;
        }

        *STATE.shapes_off.get() = shapes_off;
        *STATE.count.get() = n;
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
    reason = "f64 → u64 conversion sized to fit; see cast_precision_loss above"
)]
pub unsafe extern "C" fn shape_dispatch_mixed_static(_iters: u32) -> f64 {
    // Array already sized to N by load_input; iterate the single stored array.
    // `_iters` is ignored (array-driven), matching the cpp peer.
    let mut acc: u64 = 0;
    // SAFETY: load_input was called before any entry call (loader contract);
    // shapes_off points to a contiguous run of `count` valid Shape values that
    // remain live for the entire run (no free path).
    unsafe {
        let arr = *STATE.shapes_off.get() as *const Shape;
        let count = *STATE.count.get();
        for i in 0..count {
            let score = area_complex(&*arr.add(i));
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
