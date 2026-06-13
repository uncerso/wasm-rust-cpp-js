#![allow(
    unsafe_code,
    reason = "raw WASM cdylib: ABI-level unsafe (no_mangle, raw ptrs, from_raw_parts) + SyncCell Sync impl are inherent to the FFI surface"
)]

use std::cell::{RefCell, UnsafeCell};
use std::collections::HashMap;
use std::sync::LazyLock;

struct SyncCell<T>(RefCell<T>);
// SAFETY: wasm32 single-threaded — &T never crosses a thread boundary; Sync obligation is vacuous.
unsafe impl<T> Sync for SyncCell<T> {}

struct State {
    pairs: Vec<(String, u64)>,
    map: HashMap<String, u64>,
}

static STATE: LazyLock<SyncCell<State>> =
    LazyLock::new(|| SyncCell(RefCell::new(State { pairs: Vec::new(), map: HashMap::new() })));

// Fixture staging buffer. The host's one-shot `alloc()` hands out an offset into
// THIS static buffer, never from the global allocator: Rust's wasm allocator
// (dlmalloc) always grows linear memory on allocation, which would detach the
// raw-wasm loader's cached `memory.buffer` before it writes the fixture
// ("Cannot perform Construct on a detached ArrayBuffer"). A static buffer lives
// in the initial memory image, so `alloc()` never triggers memory.grow. The
// HashMap/Vec still use the global allocator — their later growth (load_input
// prefill / run) is harmless: the loader never re-reads the buffer after the
// initial write. Sized ≥ the largest fixture (hashmap_string L = 2.4 MB).
const STAGING_SIZE: usize = 4 * 1024 * 1024;

struct Staging(UnsafeCell<[u8; STAGING_SIZE]>);
// SAFETY: wasm32 single-threaded — &T never crosses a thread boundary; Sync obligation is vacuous.
unsafe impl Sync for Staging {}
static STAGING: Staging = Staging(UnsafeCell::new([0u8; STAGING_SIZE]));

const PAIR_BYTES: usize = 24;

// Private helper: keeps the panic out of the public FFI surface so
// clippy::missing_panics_doc does not fire (mirrors rust/bindgen structure).
fn parse_pairs(buf: &[u8]) -> Vec<(String, u64)> {
    let n = buf.len() / PAIR_BYTES;
    let mut pairs = Vec::with_capacity(n);
    for i in 0..n {
        let base = i * PAIR_BYTES;
        let key = std::str::from_utf8(&buf[base..base + 16])
            .expect("hashmap_string fixture must be ASCII")
            .to_string();
        let value = u64::from_le_bytes(buf[base + 16..base + 24].try_into().unwrap());
        pairs.push((key, value));
    }
    pairs
}

#[unsafe(no_mangle)]
#[allow(clippy::cast_possible_truncation, reason = "wasm32 address space is always 32-bit")]
pub extern "C" fn alloc(sz: u32) -> u32 {
    debug_assert!(sz as usize <= STAGING_SIZE, "fixture exceeds staging buffer");
    // addr_of! derives the address without creating a reference or dereferencing.
    // UnsafeCell is repr(transparent), so this is the address of the inner array.
    core::ptr::addr_of!(STAGING.0) as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn load_input(ptr: u32, len: u32) {
    // SAFETY: host wrote `len` bytes starting at `ptr` (returned by a prior alloc) before this call.
    let buf = unsafe { core::slice::from_raw_parts(ptr as *const u8, len as usize) };
    let pairs = parse_pairs(buf);
    let mut map = HashMap::with_capacity(pairs.len());
    for (k, v) in &pairs {
        map.insert(k.clone(), *v);
    }
    STATE.0.replace(State { pairs, map });
}

#[unsafe(no_mangle)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "map len bounded by fixture size; < 2^53")]
pub extern "C" fn hashmap_string_insert(iters: u32) -> f64 {
    let mut st = STATE.0.borrow_mut();
    let n = iters as usize;
    let pairs_snapshot: Vec<(String, u64)> = st.pairs[..n].to_vec();
    for (k, v) in pairs_snapshot {
        st.map.insert(k, v);
    }
    st.map.len() as f64
}

#[unsafe(no_mangle)]
pub extern "C" fn hashmap_string_insert_reset() {
    STATE.0.borrow_mut().map.clear();
}

#[unsafe(no_mangle)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "values in [0, 2^32) per spec ioContract; < 2^53 mantissa")]
pub extern "C" fn hashmap_string_lookup(iters: u32) -> f64 {
    let st = STATE.0.borrow();
    let mut acc: f64 = 0.0;
    for i in 0..iters as usize {
        if let Some(v) = st.map.get(&st.pairs[i].0) {
            acc += *v as f64;
        }
    }
    acc
}

#[unsafe(no_mangle)]
pub const extern "C" fn hashmap_string_lookup_reset() {
    // No-op — lookup is read-only.
}

#[unsafe(no_mangle)]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "values in [0, 2^32) per spec ioContract; < 2^53 mantissa")]
pub extern "C" fn hashmap_string_delete(iters: u32) -> f64 {
    let mut st = STATE.0.borrow_mut();
    let keys_snapshot: Vec<String> =
        st.pairs[..iters as usize].iter().map(|(k, _)| k.clone()).collect();
    let mut acc: f64 = 0.0;
    for k in keys_snapshot {
        if let Some(v) = st.map.remove(&k) {
            acc += v as f64;
        }
    }
    acc
}

#[unsafe(no_mangle)]
pub extern "C" fn hashmap_string_delete_reset() {
    let mut st = STATE.0.borrow_mut();
    st.map.clear();
    let pairs_snapshot: Vec<(String, u64)> = st.pairs.clone();
    for (k, v) in pairs_snapshot {
        st.map.insert(k, v);
    }
}
