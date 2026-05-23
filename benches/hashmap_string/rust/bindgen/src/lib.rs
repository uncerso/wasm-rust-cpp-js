#![allow(
    unsafe_code,
    reason = "SyncCell wrapper requires unsafe impl Sync; vacuous on wasm32 single-threaded"
)]

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::LazyLock;

use wasm_bindgen::prelude::*;

struct SyncCell<T>(RefCell<T>);
// SAFETY: wasm32 single-threaded — &T never crosses thread boundary; Sync obligation is vacuous.
unsafe impl<T> Sync for SyncCell<T> {}

struct State {
    pairs: Vec<(String, u64)>,
    map: HashMap<String, u64>,
}

impl State {
    fn new() -> Self {
        Self { pairs: Vec::new(), map: HashMap::new() }
    }
}

// HashMap::new() is not const, so we use LazyLock for lazy static init.
static STATE: LazyLock<SyncCell<State>> =
    LazyLock::new(|| SyncCell(RefCell::new(State::new())));

const PAIR_BYTES: usize = 24;

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

#[wasm_bindgen]
pub fn load_input(buf: &[u8]) {
    let pairs = parse_pairs(buf);
    let mut map = HashMap::with_capacity(pairs.len());
    for (k, v) in &pairs {
        map.insert(k.clone(), *v);
    }
    STATE.0.replace(State { pairs, map });
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "map len bounded by fixture size; < 2^53")]
pub fn hashmap_string_insert(iters: u32) -> f64 {
    let mut st = STATE.0.borrow_mut();
    let n = iters as usize;
    let pairs_snapshot: Vec<(String, u64)> = st.pairs[..n].to_vec();
    for (k, v) in pairs_snapshot {
        st.map.insert(k, v);
    }
    st.map.len() as f64
}

#[wasm_bindgen]
pub fn hashmap_string_insert_reset() {
    STATE.0.borrow_mut().map.clear();
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "values in [0, 2^32) per spec ioContract; < 2^53 mantissa")]
pub fn hashmap_string_lookup(iters: u32) -> f64 {
    let st = STATE.0.borrow();
    let mut acc: f64 = 0.0;
    for i in 0..iters as usize {
        if let Some(v) = st.map.get(&st.pairs[i].0) {
            acc += *v as f64;
        }
    }
    acc
}

#[wasm_bindgen]
#[allow(clippy::missing_const_for_fn, reason = "wasm_bindgen requires non-const fns")]
pub fn hashmap_string_lookup_reset() {
    // No-op — lookup is read-only.
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::cast_precision_loss, reason = "values in [0, 2^32) per spec ioContract; < 2^53 mantissa")]
pub fn hashmap_string_delete(iters: u32) -> f64 {
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

#[wasm_bindgen]
pub fn hashmap_string_delete_reset() {
    let mut st = STATE.0.borrow_mut();
    st.map.clear();
    let pairs_snapshot: Vec<(String, u64)> = st.pairs.clone();
    for (k, v) in pairs_snapshot {
        st.map.insert(k, v);
    }
}

#[wasm_bindgen]
#[must_use]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}
