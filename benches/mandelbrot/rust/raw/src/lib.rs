#![no_std]
// Raw WASM cdylib: ABI-level unsafe (#[unsafe(no_mangle)], reading the host-copied
// fixture through a raw pointer) is inherent to the FFI surface. no_std + no heap
// growth: the only state is a fixed 64-byte scratch for the fixture plus scalar
// params — this is the pure-compute size floor.
#![allow(
    unsafe_code,
    reason = "raw WASM cdylib: ABI-level unsafe (no_mangle, raw-ptr fixture read) is inherent and cannot be avoided"
)]

use core::cell::UnsafeCell;
use core::panic::PanicInfo;

#[panic_handler]
#[allow(clippy::missing_const_for_fn, reason = "panic_handler cannot be const")]
fn on_panic(_: &PanicInfo) -> ! {
    loop {}
}

const HEAP_SIZE: usize = 64; // fixture = 7 * f64 = 56 bytes

#[derive(Clone, Copy)]
struct Params {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    dims_x: u32,
    dims_y: u32,
    max_iter: u32,
}

// Wasm32 single-threaded — UnsafeCell wrapped with a vacuous Sync impl is the
// minimal global-mutable pattern (same recipe as matmul/rust/raw).
struct GlobalHeap(UnsafeCell<[u8; HEAP_SIZE]>);
// SAFETY: Sync requires `&T` to be shareable across threads. wasm32 is
// single-threaded, so no `&T` ever crosses a thread boundary; the obligation is vacuous.
unsafe impl Sync for GlobalHeap {}
static HEAP: GlobalHeap = GlobalHeap(UnsafeCell::new([0u8; HEAP_SIZE]));

struct GlobalState {
    next: UnsafeCell<usize>,
    params: UnsafeCell<Params>,
}
// SAFETY: same vacuous Sync obligation as GlobalHeap — wasm32 is single-threaded.
unsafe impl Sync for GlobalState {}
static STATE: GlobalState = GlobalState {
    next: UnsafeCell::new(0),
    params: UnsafeCell::new(Params {
        min_x: 0.0,
        max_x: 0.0,
        min_y: 0.0,
        max_y: 0.0,
        dims_x: 0,
        dims_y: 0,
        max_iter: 0,
    }),
};

#[inline]
fn heap_base() -> usize {
    core::ptr::addr_of!(HEAP.0) as usize
}

#[unsafe(no_mangle)]
#[allow(clippy::cast_possible_truncation, reason = "wasm32 address space is always 32-bit")]
pub extern "C" fn alloc(sz: u32) -> u32 {
    // SAFETY: wasm32 single-threaded — STATE.next is the only mutable global here
    // and alloc() is its only writer; concurrent calls are impossible.
    unsafe {
        let next = &mut *STATE.next.get();
        let p = *next;
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
    clippy::cast_sign_loss,
    reason = "dims_x/dims_y/max_iter are small non-negative integers stored as f64 in the fixture"
)]
pub extern "C" fn load_input(ptr: u32, _len: u32) {
    // SAFETY: the host copied 7 little-endian f64 to `ptr` (via alloc). alloc()
    // returns 8-aligned addresses; read_unaligned is used defensively regardless.
    unsafe {
        let d = ptr as *const f64;
        *STATE.params.get() = Params {
            min_x: d.read_unaligned(),
            max_x: d.add(1).read_unaligned(),
            min_y: d.add(2).read_unaligned(),
            max_y: d.add(3).read_unaligned(),
            dims_x: d.add(4).read_unaligned() as u32,
            dims_y: d.add(5).read_unaligned() as u32,
            max_iter: d.add(6).read_unaligned() as u32,
        };
    }
}

// Canonical escape-time count (order fixed by validate/reference.ts; verbatim).
#[allow(clippy::missing_const_for_fn, reason = "runtime hot loop; const-ness is incidental and unused")]
fn escape(cx: f64, cy: f64, max_iter: u32) -> u32 {
    let mut zx = 0.0_f64;
    let mut zy = 0.0_f64;
    let mut iter = 0_u32;
    while iter < max_iter {
        let zx2 = zx * zx;
        let zy2 = zy * zy;
        if zx2 + zy2 > 4.0 {
            break;
        }
        zy = 2.0 * zx * zy + cy;
        zx = zx2 - zy2 + cx;
        iter += 1;
    }
    iter
}

#[unsafe(no_mangle)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "acc = sum of iteration counts, bounded by dims_x*dims_y*max_iter < 2^53")]
pub extern "C" fn mandelbrot(iters: u32) -> f64 {
    // SAFETY: load_input set STATE.params before the host calls mandelbrot; the
    // Copy read takes a snapshot with no aliasing.
    let p = unsafe { *STATE.params.get() };
    let step_x = (p.max_x - p.min_x) / f64::from(p.dims_x);
    let step_y = (p.max_y - p.min_y) / f64::from(p.dims_y);
    let mut last = 0.0_f64;
    for _ in 0..iters {
        let mut acc: u64 = 0;
        for py in 0..p.dims_y {
            let cy = p.min_y + f64::from(py) * step_y;
            for px in 0..p.dims_x {
                let cx = p.min_x + f64::from(px) * step_x;
                acc += u64::from(escape(cx, cy, p.max_iter));
            }
        }
        last = acc as f64;
    }
    last
}

#[unsafe(no_mangle)]
pub const extern "C" fn reset() {}
