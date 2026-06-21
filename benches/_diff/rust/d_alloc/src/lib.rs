//! Differential: +allocator. A heap `Vec` whose backing allocation must
//! materialise (leaked via `mem::forget`) forces the global allocator (`dlmalloc`)
//! to link. Delta vs `d_bare` ≈ the allocator floor on `-Oz`.
#![allow(unsafe_code, reason = "raw WASM cdylib: #[unsafe(no_mangle)] export is inherent to the FFI surface")]

#[unsafe(no_mangle)]
pub extern "C" fn run(n: u32) -> u32 {
    let mut v: Vec<u32> = Vec::with_capacity(n as usize);
    for i in 0..n {
        v.push(i.wrapping_mul(2_654_435_761));
    }
    let acc = v.iter().fold(0u32, |a, &b| a ^ b);
    core::mem::forget(v); // keep the allocation observable to the optimizer
    acc
}
