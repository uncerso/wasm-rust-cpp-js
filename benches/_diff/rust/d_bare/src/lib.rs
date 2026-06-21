//! Differential baseline: std linked, zero heap allocation. On `-Oz` the
//! allocator is dead-code-eliminated, so this is the structural+observed floor.
#![allow(unsafe_code, reason = "raw WASM cdylib: #[unsafe(no_mangle)] export is inherent to the FFI surface")]

#[unsafe(no_mangle)]
#[allow(clippy::missing_const_for_fn, reason = "exported differential root: kept a real (non-const) fn so the export is preserved as the floor reference")]
pub extern "C" fn run(x: u32) -> u32 {
    x.wrapping_mul(2_654_435_761).rotate_left(15)
}
