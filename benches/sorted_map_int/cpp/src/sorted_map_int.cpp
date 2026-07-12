#include "sorted_map_int.h"

#include <algorithm>
#include <cstring>
#include <map>
#include <new>
#include <utility>
#include <vector>

namespace {

struct State {
    std::vector<std::pair<uint64_t, uint64_t>> pairs;
    std::map<uint64_t, uint64_t> map;
};

// Construct-on-first-use (mirrors the rust/raw + rust/bindgen LazyLock model).
// The wasi-sdk no-glue build is instantiated by the raw-wasm loader without a
// runtime that runs __wasm_call_ctors, so a plain `static State g_state;` would
// be left unconstructed and trap/corrupt on use. Placement-new into static
// storage on first access, guarded by a plain BSS bool — the same pattern the
// shape_dispatch wasi-sdk workloads use. Avoids both global ctors and
// __cxa_guard. emscripten behaves identically (lazy vs eager; same checksums).
alignas(State) unsigned char g_storage[sizeof(State)];
bool g_inited = false;

State& state() {
    if (!g_inited) {
        new (g_storage) State();
        g_inited = true;
    }
    return *reinterpret_cast<State*>(g_storage);
}

constexpr size_t PAIR_BYTES = 16;

void parse_pairs(const uint8_t* buf, size_t len) {
    const size_t n = len / PAIR_BYTES;
    state().pairs.clear();
    state().pairs.reserve(n);
    for (size_t i = 0; i < n; i++) {
        const size_t base = i * PAIR_BYTES;
        uint64_t key;
        uint64_t value;
        std::memcpy(&key, buf + base, sizeof(key));
        std::memcpy(&value, buf + base + 8, sizeof(value));
        state().pairs.emplace_back(key, value);
    }
    state().map.clear();
    // operator[]=, not emplace: on duplicate keys the LAST value must win, to match
    // the reference (JS Map.set / Rust HashMap::insert). emplace keeps the first value.
    for (const auto& [k, v] : state().pairs) {
        state().map[k] = v;
    }
}

} // namespace

extern "C" uint32_t alloc(uint32_t sz) {
    return reinterpret_cast<uint32_t>(::operator new(sz));
}

extern "C" void load_input(uint32_t ptr, uint32_t len) {
    parse_pairs(reinterpret_cast<const uint8_t*>(ptr), len);
}

extern "C" double sorted_map_int_build(uint32_t iters) {
    for (uint32_t i = 0; i < iters; i++) {
        state().map[state().pairs[i].first] = state().pairs[i].second;
    }
    return static_cast<double>(state().map.size());
}

extern "C" void sorted_map_int_build_reset() {
    state().map.clear();
}

extern "C" double sorted_map_int_lookup(uint32_t iters) {
    double acc = 0.0;
    for (uint32_t i = 0; i < iters; i++) {
        const auto it = state().map.find(state().pairs[i].first);
        if (it != state().map.end()) {
            acc += static_cast<double>(it->second);
        }
    }
    return acc;
}

extern "C" void sorted_map_int_lookup_reset() {
    // No-op.
}

static constexpr uint64_t WINDOW_KEYS = 16;
static constexpr uint64_t MAX_KEY = (static_cast<uint64_t>(1) << 53) - 1;

extern "C" double sorted_map_int_range(uint32_t iters) {
    const uint64_t n = state().pairs.size();
    const uint64_t span = ((static_cast<uint64_t>(1) << 53) / n) * WINDOW_KEYS;
    double acc = 0.0;
    for (uint32_t i = 0; i < iters; i++) {
        const uint64_t lo = state().pairs[i].first;
        const uint64_t hi = std::min(lo + span, MAX_KEY);
        for (auto it = state().map.lower_bound(lo); it != state().map.end() && it->first <= hi; ++it) {
            acc += static_cast<double>(it->second);
        }
    }
    return acc;
}

extern "C" void sorted_map_int_range_reset() {
    // No-op — range is read-only.
}
