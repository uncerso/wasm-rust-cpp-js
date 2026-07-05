# Bug report — hashmap_int cpp: `unordered_map::emplace` keeps first value on duplicate keys; reference is last-wins

**Status:** root cause **confirmed** + fix **verified** 2026-06-13.
**Discovered:** logged 2026-06-02 (Phase 1.1.3 bench) as a correctness fail; root-caused + fixed in Phase 1.2.
**Affected source file (patched):** `benches/hashmap_int/cpp/src/hashmap_int.cpp`.
**NOT a toolchain bug** — the prior tech-debt (`hashmap-int-emscripten-L-correctness`) hypothesised an emscripten codegen / integer-width / memory-growth issue. All wrong. It is a plain C++ source-semantics bug; emscripten is simply the only cpp toolchain hashmap_int builds, so the source bug surfaced there.

---

## TL;DR

`parse_pairs` (used by `lookup`, whose `_reset` is a no-op) and `delete_reset` built the map with `g_state.map.emplace(k, v)`. `std::unordered_map::emplace` **does not overwrite** an existing key — for a duplicate key it keeps the **first** inserted value. The reference (JS `Map.set`, Rust `HashMap::insert`) keeps the **last** value. The two diverge only when a key repeats in the fixture.

The L fixture has 4 duplicate keys (insert L checksum = 99996 = unique keys < 100000 pairs); S and M have none (size == iters). So only L diverged, only for `lookup`/`delete` (insert uses `operator[]=` already = last-wins, and its checksum `map.size()` is insensitive to which value wins).

## The arithmetic fingerprint (what pinned it)

| entry (L) | got (emscripten) | expected (reference) | diff |
|---|---|---|---|
| lookup | 213953188581571 | 213944096178963 | **9 092 402 608** |
| delete | 213942901681979 | 213938355480675 | **4 546 201 304** |

`9 092 402 608 = 2 × 4 546 201 304` — exactly double. This falls straight out of the first-wins-vs-last-wins model: a duplicate key is **looked up twice** (both occurrences in `pairs`) but **deleted once** (after `erase`, the second occurrence misses). The exact 2:1 ratio is the signature of a duplicate-key value mismatch, not random codegen drift — it ruled out the toolchain hypotheses before any rebuild.

## Reproduction (deterministic, no toolchain needed)

Pure logic repro over the real `l.bin` fixture, in Node (the bug is source-logic, env-independent):

```js
// parse l.bin → pairs; build two maps:
const lastWins = new Map();  for (const {key,value} of pairs) lastWins.set(key, value);          // reference
const firstWins = new Map(); for (const {key,value} of pairs) if (!firstWins.has(key)) firstWins.set(key, value); // emplace
// lookupSum(firstWins) === 213953188581571 (== emscripten "got")
// lookupSum(lastWins)  === 213944096178963 (== spec.json expected)
```

Output: `dupKeys=4`, `Σ(vFirst−vLast)=4546201304`, first-wins reproduces the wrong checksums to the digit, last-wins reproduces the expected ones.

## Fix

`emplace(k, v)` → `g_state.map[k] = v;` in `parse_pairs` and `delete_reset` (matches the existing `hashmap_int_insert` `operator[]=` and the reference last-wins semantics). `operator[]=` overwrite is standard-mandated, immune to `-O3`/`-Oz`/closure/wasm-opt.

**Verified** on rebuilt emscripten artifacts at L, both profiles, in Node:

| entry | speed | size | expected |
|---|---|---|---|
| insert | 99996 ✓ | — | 99996 |
| lookup | 213944096178963 ✓ | 213944096178963 ✓ | 213944096178963 |
| delete | 213938355480675 ✓ | 213938355480675 ✓ | 213938355480675 |

All `validated: true, correctnessFailed: false`. Browser cases (chromium/firefox) run the identical wasm artifact and compute the checksum inside wasm → env-independent, covered by the same fix.

## Significance

- A shipped workload produced silently-wrong output for 2 of 3 entries at the largest size on one toolchain; any guideline drawing on hashmap_int cpp-emscripten L numbers was built on invalid data (now corrected).
- **Cross-toolchain porting lesson:** `unordered_map::emplace`/`insert` and Rust `HashMap::entry().or_insert()` are **first-wins**; `operator[]=`/`insert_or_assign`, JS `Map.set`, Rust `HashMap::insert` are **last-wins**. Porting a hashmap workload across languages must fix one duplicate-key policy explicitly, or large-N fixtures (birthday-paradox collisions) silently diverge.
- **Diagnostic lesson:** an exact small-integer ratio between two "wrong" sums (here 2:1) is a strong tell for a deterministic semantic mismatch on a few elements — investigate the source logic before assuming toolchain/UB.

## hashmap_string resolution (2026-07-05, Phase 1.2 pipeline-hygiene)

The parallel `hashmap_string` cpp had the same `map.emplace(k, v)` first-wins in `parse_pairs`
(line 51) and `hashmap_string_delete_reset` (line 107); `hashmap_string_insert` already used
`operator[]=`. Fixed identically → `state().map[k] = v;`.

**Why it stayed latent (unlike int):** hashmap_string keys are 16 ASCII-hex chars = **2⁶⁴**
key space (`genAsciiHexKeys`, two u32 rng → 8 hex each). At N≈10⁵ the birthday-collision
expectation is ~10⁻¹⁰ → **zero duplicate keys** in S/M/L fixtures. So first-wins ≡ last-wins on
the actual data; the checksum never diverged and the bug never surfaced. int diverged because its
key space is smaller (4 dup keys at L). Post-fix re-bench (node, both toolchains × both profiles ×
S/M/L): **all 12 `validated: true`** — checksums unchanged, as predicted.

**Unexpected size win (measured, not predicted):** replacing `emplace` with `operator[]` — which
was *already* instantiated (line 67 `hashmap_string_insert`) — removes the separate `emplace`
insert-path template instantiation. Rebuilt artifact sizes dropped **~4–6% across all four**:

| artifact | emplace (orig) | operator[] (fixed) | Δ |
|---|---|---|---|
| cpp-emscripten-speed | 15950 | 14982 | −968 B (−6.1%) |
| cpp-emscripten-size | 14786 | 14205 | −581 B (−3.9%) |
| cpp-wasi-sdk-speed | 18384 | 17237 | −1147 B (−6.2%) |
| cpp-wasi-sdk-size | 16154 | 15510 | −644 B (−4.0%) |

Perf-neutral by construction: the measured entry loops (`insert`/`lookup`/`delete`) are byte-identical;
only setup (`parse_pairs`/`delete_reset`) changed. **Guideline nugget:** prefer `operator[]=` over
`emplace` for last-wins map fills — besides matching cross-language semantics, if `operator[]` is
already used elsewhere in the TU, `emplace` adds a redundant template instantiation that inflates
the wasm (~5% here).

**Gate gap now closed:** the "still open" gate gap noted below (`bench-run-correctness-fail-not-surfaced`
→ roadmap `bench-correctness-fail-surfacing`) is resolved this same phase (Task C): runner-node exits
non-zero + run-matrix records correctness fails to `failures.txt` (node + browser).

## Related artifacts

- Prior (mis-diagnosed) tech-debt: `docs/tech_debt/hashmap-int-emscripten-L-correctness.md` (resolved → deleted with this fix; history via `git log`).
- Gate gap that let it ship undocumented: tech-debt `bench-run-correctness-fail-not-surfaced` (separate, still open).
- Reference semantics: `benches/hashmap_int/validate/reference.ts`, `benches/hashmap_int/rust/bindgen/src/lib.rs`.
