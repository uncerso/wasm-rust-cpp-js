#include "hashmap_string.h"

#include <cstring>
#include <new>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

struct State {
    std::vector<std::pair<std::string, uint64_t>> pairs;
    std::unordered_map<std::string, uint64_t> map;
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

constexpr size_t PAIR_BYTES = 24;

void parse_pairs(const uint8_t* buf, size_t len) {
    const size_t n = len / PAIR_BYTES;
    state().pairs.clear();
    state().pairs.reserve(n);
    for (size_t i = 0; i < n; i++) {
        const size_t base = i * PAIR_BYTES;
        std::string key(reinterpret_cast<const char*>(buf + base), 16);
        uint64_t value;
        std::memcpy(&value, buf + base + 16, sizeof(value));
        state().pairs.emplace_back(std::move(key), value);
    }
    state().map.clear();
    state().map.reserve(n);
    for (const auto& [k, v] : state().pairs) {
        state().map.emplace(k, v);
    }
}

} // namespace

extern "C" uint32_t alloc(uint32_t sz) {
    return reinterpret_cast<uint32_t>(::operator new(sz));
}

extern "C" void load_input(uint32_t ptr, uint32_t len) {
    parse_pairs(reinterpret_cast<const uint8_t*>(ptr), len);
}

extern "C" double hashmap_string_insert(uint32_t iters) {
    for (uint32_t i = 0; i < iters; i++) {
        state().map[state().pairs[i].first] = state().pairs[i].second;
    }
    return static_cast<double>(state().map.size());
}

extern "C" void hashmap_string_insert_reset() {
    state().map.clear();
}

extern "C" double hashmap_string_lookup(uint32_t iters) {
    double acc = 0.0;
    for (uint32_t i = 0; i < iters; i++) {
        const auto it = state().map.find(state().pairs[i].first);
        if (it != state().map.end()) {
            acc += static_cast<double>(it->second);
        }
    }
    return acc;
}

extern "C" void hashmap_string_lookup_reset() {
    // No-op.
}

extern "C" double hashmap_string_delete(uint32_t iters) {
    double acc = 0.0;
    for (uint32_t i = 0; i < iters; i++) {
        const auto it = state().map.find(state().pairs[i].first);
        if (it != state().map.end()) {
            acc += static_cast<double>(it->second);
            state().map.erase(it);
        }
    }
    return acc;
}

extern "C" void hashmap_string_delete_reset() {
    state().map.clear();
    state().map.reserve(state().pairs.size());
    for (const auto& [k, v] : state().pairs) {
        state().map.emplace(k, v);
    }
}
