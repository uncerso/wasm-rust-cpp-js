#![no_std]
// Wave 3 will eliminate static mut entirely (UnsafeCell / thread_local!) —
// until then, suppress the reference-to-mutable-static lint here.
#![allow(
    static_mut_refs,
    reason = "static mut HEAP/NEXT/N/A_PTR/B_PTR/C_PTR removed in Wave 3 refactor"
)]
// This crate is a raw WASM cdylib: ABI-level unsafe (#[no_mangle], raw ptr
// arithmetic, from_raw_parts) is inherent and remains after Wave 3.  The
// static-mut shape and the bisection isqrt go away; the byte-level FFI does not.
#![allow(
    unsafe_code,
    reason = "raw WASM cdylib: static-mut shape removed in Wave 3; ABI-level unsafe (no_mangle, raw ptrs) inherent and remains"
)]

use core::panic::PanicInfo;
use core::ptr::addr_of;

#[panic_handler]
#[allow(clippy::missing_const_for_fn, reason = "panic_handler cannot be const")]
fn on_panic(_: &PanicInfo) -> ! { loop {} }

const HEAP_SIZE: usize = 32 * 1024 * 1024;
static mut HEAP: [u8; HEAP_SIZE] = [0; HEAP_SIZE];
static mut NEXT: usize = 0;

static mut N: usize = 0;
static mut A_PTR: usize = 0;
static mut B_PTR: usize = 0;
static mut C_PTR: usize = 0;

#[no_mangle]
pub extern "C" fn alloc(sz: u32) -> u32 {
    unsafe {
        let p = NEXT;
        NEXT = (NEXT + sz as usize + 7) & !7; // align 8
        if NEXT > HEAP_SIZE { return u32::MAX; }
        // wasm32 address space is 32-bit — truncation is intentional.
        #[allow(clippy::cast_possible_truncation, reason = "wasm32 address space is always 32-bit")]
        { (addr_of!(HEAP) as usize + p) as u32 }
    }
}

#[no_mangle]
pub extern "C" fn load_input(ptr: u32, len: u32) {
    unsafe {
        let total_f64 = (len as usize) / 8;
        let half = total_f64 / 2;
        let n = half.isqrt();
        debug_assert!(n * n == half);
        N = n;
        A_PTR = ptr as usize;
        B_PTR = ptr as usize + n * n * 8;
        // wasm32 address space is 32-bit — truncation is intentional.
        #[allow(clippy::cast_possible_truncation, reason = "wasm32 address space is always 32-bit")]
        let c_sz: u32 = (n * n * 8) as u32;
        C_PTR = alloc(c_sz) as usize;
    }
}

#[no_mangle]
// Matrix math idioms: single-char names (n, a, b, c, s, i, j, k) are
// standard and perfectly readable in this context.
#[allow(clippy::many_single_char_names, reason = "standard matrix algebra variable names")]
pub extern "C" fn run(iters: u32) -> f64 {
    unsafe {
        let n = N;
        let a = core::slice::from_raw_parts(A_PTR as *const f64, n * n);
        let b = core::slice::from_raw_parts(B_PTR as *const f64, n * n);
        let c = core::slice::from_raw_parts_mut(C_PTR as *mut f64, n * n);
        let mut last_sum = 0.0_f64;
        for _ in 0..iters {
            for x in c.iter_mut() { *x = 0.0; }
            for i in 0..n {
                for k in 0..n {
                    let aik = a[i * n + k];
                    for j in 0..n {
                        c[i * n + j] += aik * b[k * n + j];
                    }
                }
            }
            let mut s = 0.0_f64;
            for &x in c.iter() { s += x.abs(); }
            last_sum = s;
        }
        last_sum
    }
}

#[no_mangle]
// wasm32 address space is 32-bit — truncation is intentional.
#[allow(clippy::cast_possible_truncation, reason = "wasm32 address space is always 32-bit")]
pub extern "C" fn output_ptr() -> u32 { unsafe { C_PTR as u32 } }

#[no_mangle]
// wasm32 address space is 32-bit — truncation is intentional.
#[allow(clippy::cast_possible_truncation, reason = "wasm32 address space is always 32-bit")]
pub extern "C" fn output_len() -> u32 { unsafe { (N * N * 8) as u32 } }

#[no_mangle]
pub const extern "C" fn reset() {}
