---
id: hashmap-string-cpp-emplace-latent
title: hashmap_string cpp uses emplace (first-wins) where int uses operator[] (last-wins)
created: 2026-06-13
source: session 2026-06-13 phase-1-2-hashmap-no-glue W1; sibling fix 8cf09e3 (int)
category: latent-bug
status: open
priority: low
---

## What

`benches/hashmap_string/cpp/src/hashmap_string.cpp` resolves duplicate keys with
`std::unordered_map::emplace` (first-wins) in both `parse_pairs` and
`hashmap_string_delete_reset`:

```cpp
for (const auto& [k, v] : state().pairs) {
    state().map.emplace(k, v);   // first-wins
}
```

The `int` sibling was fixed to `operator[]=` (last-wins, matching JS `Map.set` /
Rust `HashMap::insert` / the reference) in `8cf09e3` after a real L-size checksum
divergence. The string variant still uses `emplace`.

## Why it matters

Currently harmless: `genAsciiHexKeys` draws each key from two independent
`mulberry32` outputs → a 2^64 keyspace, so at N=100k (L) the expected collision
count is ~2.7e-10 — effectively no duplicate keys, and `emplace` ≡ `operator[]`.
But it is (a) inconsistent with the int sibling, and (b) latent: if the fixture
seed, key length, or key generator ever changes to admit duplicates, the cpp
variants (emscripten + wasi-sdk, shared source) would silently diverge from the
pinned `expectedChecksums` on dup keys — exactly the int failure mode, surfacing
only at scale. Contrast int: `genIntPairs53` keys collapse to a ~2^32 effective
space (mulberry32 has 32-bit entropy), so int *did* hit ~4 dup keys at L.

## Possible fix

Replace both `state().map.emplace(k, v)` with `state().map[k] = v` in
`hashmap_string.cpp` (mirrors the int fix). No checksum change today (no dups);
re-run `pnpm bench:all` to confirm. See the confirmed guideline
"явно фиксируй duplicate-key policy — last-wins" in `docs/guidelines.md`.

## References
- `benches/hashmap_string/cpp/src/hashmap_string.cpp` (`parse_pairs`, `hashmap_string_delete_reset`)
- `8cf09e3` — int operator[] fix; `docs/superpowers/bug-reports/2026-06-13-hashmap-int-emplace-dupkey.md`
- `benches/common/fixtures.ts` — `genAsciiHexKeys` (2^64) vs `genIntPairs53` (~2^32 effective)
- `docs/guidelines.md` § Code patterns — duplicate-key policy claim
