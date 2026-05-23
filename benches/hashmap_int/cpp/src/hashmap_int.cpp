#include "hashmap_int.h"

#include <cstring>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

struct State {
    std::vector<std::pair<uint64_t, uint64_t>> pairs;
    std::unordered_map<uint64_t, uint64_t> map;
};

State g_state;

constexpr size_t PAIR_BYTES = 16;

void parse_pairs(const uint8_t* buf, size_t len) {
    const size_t n = len / PAIR_BYTES;
    g_state.pairs.clear();
    g_state.pairs.reserve(n);
    for (size_t i = 0; i < n; i++) {
        const size_t base = i * PAIR_BYTES;
        uint64_t key;
        uint64_t value;
        std::memcpy(&key, buf + base, sizeof(key));
        std::memcpy(&value, buf + base + 8, sizeof(value));
        g_state.pairs.emplace_back(key, value);
    }
    g_state.map.clear();
    g_state.map.reserve(n);
    for (const auto& [k, v] : g_state.pairs) {
        g_state.map.emplace(k, v);
    }
}

} // namespace

extern "C" uint32_t alloc(uint32_t sz) {
    return reinterpret_cast<uint32_t>(::operator new(sz));
}

extern "C" void load_input(uint32_t ptr, uint32_t len) {
    parse_pairs(reinterpret_cast<const uint8_t*>(ptr), len);
}

extern "C" double hashmap_int_insert(uint32_t iters) {
    for (uint32_t i = 0; i < iters; i++) {
        g_state.map[g_state.pairs[i].first] = g_state.pairs[i].second;
    }
    return static_cast<double>(g_state.map.size());
}

extern "C" void hashmap_int_insert_reset() {
    g_state.map.clear();
}

extern "C" double hashmap_int_lookup(uint32_t iters) {
    double acc = 0.0;
    for (uint32_t i = 0; i < iters; i++) {
        const auto it = g_state.map.find(g_state.pairs[i].first);
        if (it != g_state.map.end()) {
            acc += static_cast<double>(it->second);
        }
    }
    return acc;
}

extern "C" void hashmap_int_lookup_reset() {
    // No-op.
}

extern "C" double hashmap_int_delete(uint32_t iters) {
    double acc = 0.0;
    for (uint32_t i = 0; i < iters; i++) {
        const auto it = g_state.map.find(g_state.pairs[i].first);
        if (it != g_state.map.end()) {
            acc += static_cast<double>(it->second);
            g_state.map.erase(it);
        }
    }
    return acc;
}

extern "C" void hashmap_int_delete_reset() {
    g_state.map.clear();
    g_state.map.reserve(g_state.pairs.size());
    for (const auto& [k, v] : g_state.pairs) {
        g_state.map.emplace(k, v);
    }
}
