//! Differential: +`HashMap` at ONE use-site. Pulls `HashMap` + `RandomState` + hash
//! + panic machinery on top of the allocator. Delta vs `d_alloc` ≈ hash-map cost.
#![allow(unsafe_code, reason = "raw WASM cdylib: #[unsafe(no_mangle)] export is inherent to the FFI surface")]

use std::collections::HashMap;

#[unsafe(no_mangle)]
pub extern "C" fn run(n: u32) -> u32 {
    let mut m: HashMap<u32, u32> = HashMap::new();
    for i in 0..n {
        m.insert(i, i.wrapping_mul(2_654_435_761));
    }
    m.values().fold(0u32, |a, &b| a ^ b)
}
