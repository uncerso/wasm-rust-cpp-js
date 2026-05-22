#![no_std]
#![allow(
    unsafe_code,
    reason = "raw WASM cdylib: ABI-level unsafe (#[unsafe(no_mangle)]) is inherent to the FFI surface"
)]

use core::cell::UnsafeCell;
use core::panic::PanicInfo;

#[panic_handler]
#[allow(clippy::missing_const_for_fn, reason = "panic_handler cannot be const")]
fn on_panic(_: &PanicInfo) -> ! {
    loop {}
}

// Wasm32 single-threaded — UnsafeCell wrapped with vacuous Sync impl is the
// minimal global-mutable pattern. Same recipe as matmul/rust/raw (HEAP, STATE).
struct GlobalCounter(UnsafeCell<u32>);
// SAFETY: Sync requires `&T` to be safely shareable across threads. wasm32 is
// single-threaded, so no `&T` ever crosses a thread boundary; the obligation
// is vacuous.
unsafe impl Sync for GlobalCounter {}
static NOOP_COUNTER: GlobalCounter = GlobalCounter(UnsafeCell::new(0));

#[unsafe(no_mangle)]
pub extern "C" fn interop_calls_noop() {
    // SAFETY: wasm32 single-threaded — NOOP_COUNTER has one writer (this fn)
    // and one reader (interop_calls_noop_counter); they cannot race.
    unsafe {
        let p = NOOP_COUNTER.0.get();
        *p = (*p).wrapping_add(1);
    }
}

#[must_use]
#[unsafe(no_mangle)]
pub extern "C" fn interop_calls_noop_counter() -> u32 {
    // SAFETY: read-only access; wasm32 single-threaded so cannot race the
    // writer.
    unsafe { *NOOP_COUNTER.0.get() }
}

#[must_use]
#[unsafe(no_mangle)]
pub const extern "C" fn interop_calls_add_i32(a: i32, b: i32) -> i32 {
    a.wrapping_add(b)
}

#[must_use]
#[unsafe(no_mangle)]
pub const extern "C" fn interop_calls_add_f64(a: f64, b: f64) -> f64 {
    a + b
}

// Loader contract: raw-wasm loader always calls alloc(len) + load_input(ptr, len)
// before run(). interop_calls is fixture-less (len=0), so these are trivial.
// load_input doubles as a reset hook so each measurement sample starts from
// counter=0.
#[must_use]
#[unsafe(no_mangle)]
pub const extern "C" fn alloc(_sz: u32) -> u32 {
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn load_input(_ptr: u32, _len: u32) {
    // SAFETY: wasm32 single-threaded; sole writer alongside interop_calls_noop.
    unsafe {
        *NOOP_COUNTER.0.get() = 0;
    }
}
