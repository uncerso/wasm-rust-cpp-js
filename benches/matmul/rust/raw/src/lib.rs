#![no_std]

use core::panic::PanicInfo;
use core::ptr::addr_of;

#[panic_handler]
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
        (addr_of!(HEAP) as usize + p) as u32
    }
}

/// Integer square root via bisection — used because no_std f64 lacks .sqrt().
fn isqrt_usize(n: usize) -> usize {
    let mut lo = 0usize;
    let mut hi = n.saturating_add(1);
    while lo + 1 < hi {
        let mid = lo + (hi - lo) / 2;
        if mid.saturating_mul(mid) <= n { lo = mid; } else { hi = mid; }
    }
    lo
}

#[no_mangle]
pub extern "C" fn load_input(ptr: u32, len: u32) {
    unsafe {
        let total_f64 = (len as usize) / 8;
        let half = total_f64 / 2;
        let n = isqrt_usize(half);
        debug_assert!(n * n == half);
        N = n;
        A_PTR = ptr as usize;
        B_PTR = ptr as usize + n * n * 8;
        let c_sz = (n * n * 8) as u32;
        C_PTR = alloc(c_sz) as usize;
    }
}

#[no_mangle]
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
pub extern "C" fn output_ptr() -> u32 { unsafe { C_PTR as u32 } }

#[no_mangle]
pub extern "C" fn output_len() -> u32 { unsafe { (N * N * 8) as u32 } }

#[no_mangle]
pub extern "C" fn reset() {}
