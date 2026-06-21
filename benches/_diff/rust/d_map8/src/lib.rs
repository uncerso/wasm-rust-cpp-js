//! Differential: +`HashMap` at EIGHT use-sites. Each `site` is a distinct
//! instantiation point (`inline(never)`), but `HashMap<u32,u32>`'s monomorphised
//! code appears ONCE. Delta vs `d_map1` ≈ 0 demonstrates "paid once, not per use-site".
#![allow(unsafe_code, reason = "raw WASM cdylib: #[unsafe(no_mangle)] export is inherent to the FFI surface")]

use std::collections::HashMap;

#[inline(never)]
fn site(seed: u32, n: u32) -> u32 {
    let mut m: HashMap<u32, u32> = HashMap::new();
    for i in 0..n {
        m.insert(i ^ seed, i.wrapping_mul(2_654_435_761));
    }
    m.values().fold(0u32, |a, &b| a ^ b)
}

#[unsafe(no_mangle)]
pub extern "C" fn run(n: u32) -> u32 {
    let mut acc = 0u32;
    for seed in 0..8u32 {
        acc ^= site(seed, n);
    }
    acc
}
