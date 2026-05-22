#![no_std]
// Raw WASM cdylib: ABI-level unsafe (#[unsafe(no_mangle)], raw ptr arithmetic,
// from_raw_parts) is inherent to the FFI surface. UnsafeCell replaces static
// mut so each unsafe block is now narrow and locally documented with SAFETY.
#![allow(
    unsafe_code,
    reason = "raw WASM cdylib: ABI-level unsafe (no_mangle, raw ptrs, slice::from_raw_parts) is inherent and cannot be avoided"
)]

use core::cell::UnsafeCell;
use core::panic::PanicInfo;
use matmul_shared::{abs_sum, matmul_naive};

#[panic_handler]
#[allow(clippy::missing_const_for_fn, reason = "panic_handler cannot be const")]
fn on_panic(_: &PanicInfo) -> ! {
    loop {}
}

const HEAP_SIZE: usize = 32 * 1024 * 1024;

// Wasm32 single-threaded — UnsafeCell wrapper is sufficient for global mutable
// state. Each Sync impl below acknowledges that there are no real threads.
struct GlobalHeap(UnsafeCell<[u8; HEAP_SIZE]>);
// SAFETY: Sync requires `&T` to be safely shareable across threads. wasm32 is
// single-threaded, so no `&T` ever crosses a thread boundary; the obligation is
// vacuous.
unsafe impl Sync for GlobalHeap {}
static HEAP: GlobalHeap = GlobalHeap(UnsafeCell::new([0u8; HEAP_SIZE]));

struct GlobalState {
    next: UnsafeCell<usize>,
    n: UnsafeCell<usize>,
    a_off: UnsafeCell<usize>,
    b_off: UnsafeCell<usize>,
    c_off: UnsafeCell<usize>,
}
// SAFETY: same vacuous Sync obligation as GlobalHeap — wasm32 is single-threaded.
unsafe impl Sync for GlobalState {}
static STATE: GlobalState = GlobalState {
    next: UnsafeCell::new(0),
    n: UnsafeCell::new(0),
    a_off: UnsafeCell::new(0),
    b_off: UnsafeCell::new(0),
    c_off: UnsafeCell::new(0),
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
        *next = (*next + sz as usize + 7) & !7;
        if *next > HEAP_SIZE {
            return u32::MAX;
        }
        (heap_base() + p) as u32
    }
}

#[unsafe(no_mangle)]
#[allow(clippy::cast_possible_truncation, reason = "wasm32 address space is always 32-bit")]
pub extern "C" fn load_input(ptr: u32, len: u32) {
    let total_f64 = (len as usize) / 8;
    let half = total_f64 / 2;
    let n = half.isqrt();
    debug_assert!(n * n == half);
    // SAFETY: wasm32 single-threaded; load_input/run/output_* never overlap.
    unsafe {
        *STATE.n.get() = n;
        *STATE.a_off.get() = ptr as usize;
        *STATE.b_off.get() = ptr as usize + n * n * 8;
        let c_sz: u32 = (n * n * 8) as u32;
        *STATE.c_off.get() = alloc(c_sz) as usize;
    }
}

// CPS-style API: lifetime of slices is closed inside the closure scope, so
// compiler enforces no escape across STATE reshapes (load_input/alloc).
// Equivalent to the previous get_slices() but type-safe at the borrow level.
//
// SAFETY: caller guarantees load_input was called and set STATE.{n, a_off,
// b_off, c_off} to non-overlapping regions of n*n*8 valid f64-aligned bytes
// inside HEAP. Wasm32 single-threaded → exclusive &mut [f64] is upheld by
// control flow (only run() calls this).
unsafe fn with_slices<R>(
    body: impl FnOnce(&[f64], &[f64], &mut [f64], usize) -> R,
) -> R {
    unsafe {
        let n = *STATE.n.get();
        let a_off = *STATE.a_off.get();
        let b_off = *STATE.b_off.get();
        let c_off = *STATE.c_off.get();
        let a = core::slice::from_raw_parts(a_off as *const f64, n * n);
        let b = core::slice::from_raw_parts(b_off as *const f64, n * n);
        let c = core::slice::from_raw_parts_mut(c_off as *mut f64, n * n);
        body(a, b, c, n)
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn run(iters: u32) -> f64 {
    // SAFETY: load_input was called by JS host before run; A/B/C are valid.
    unsafe {
        with_slices(|a, b, c, n| {
            let mut last = 0.0_f64;
            for _ in 0..iters {
                matmul_naive(a, b, c, n);
                last = abs_sum(c);
            }
            last
        })
    }
}

// Transitional alias: raw-wasm loader now binds the entry export by name
// (entry id == wasm export name). matmul's entry id is "matmul"; the legacy
// `run` export is removed in Task 14 once all loaders migrate.
#[unsafe(no_mangle)]
pub extern "C" fn matmul(iters: u32) -> f64 {
    run(iters)
}

#[unsafe(no_mangle)]
#[allow(clippy::cast_possible_truncation, reason = "wasm32 address space is always 32-bit")]
pub extern "C" fn output_ptr() -> u32 {
    // SAFETY: read-only access to STATE.c_off. wasm32 single-threaded.
    unsafe { *STATE.c_off.get() as u32 }
}

#[unsafe(no_mangle)]
#[allow(clippy::cast_possible_truncation, reason = "wasm32 address space is always 32-bit")]
pub extern "C" fn output_len() -> u32 {
    // SAFETY: read-only access to STATE.n. wasm32 single-threaded.
    unsafe { (*STATE.n.get() * *STATE.n.get() * 8) as u32 }
}

#[unsafe(no_mangle)]
pub const extern "C" fn reset() {}
