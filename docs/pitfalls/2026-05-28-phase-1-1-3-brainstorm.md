# Phase 1.1.3 brainstorm + planning — pitfalls

Lessons из Phase 1.1.3 shape_dispatch brainstorm + spec writing + plan writing
session (2026-05-27/28). Workload спроектирован (2×2 factorial dispatch × layout,
4 binaries, quantized checksum, raw-heap discipline), spec committed как `aeee4fd`,
plan committed как `f9a381f` (37 tasks W0-W6), execution pending.

## Process

### Mitigation alternatives leaked into spec без mechanism-verification

**What happened.** В spec § Open risks R1 (devirtualization в binary 2 native)
listed three mitigation alternatives:
1. `core::hint::black_box` (Rust) / `asm volatile("" : : "g"(ptr) : "memory")` (C++).
2. Factory function в отдельном TU без LTO.
3. `std::atomic_signal_fence(std::memory_order_seq_cst)` as fallback.

User asked: «почему `atomic_signal_fence` не приоритетнее, чем `asm volatile`?»
Investigation showed signal_fence — memory-ordering barrier (запрещает reorder
memory ops через эту точку), не type-escape mechanism. Devirtualization — это
**type-analysis** optimization, не memory-ordering. signal_fence не препятствует
compiler'у tracking concrete type across the fence. Fundamentally inadequate для
named risk. Removed from R1 + R3 mitigation lists.

**Root cause.** При drafting 2-3 mitigation alternatives, defaulted к «какие
tools могут быть relevant?» (signal_fence — известный compile barrier, superficially
relevant к compile-time anti-optimization patterns), вместо «которые tools
адресуют ИМЕННО mechanism риска?». Mechanism риска R1 — type analysis, not memory
ordering. Без явного mechanism-articulation step, superficially-similar candidates
get listed.

**Prevention.** Inline-applied к `CLAUDE.md § Spec & plan conventions` (commit
following this pitfall): «Mitigation alternatives mechanism-check — для each
candidate в spec § Open risks explicitly articulate the mechanism by which it
addresses the named risk; если cannot articulate в одном sentence, candidate
suspect, verify or drop».

Related memory: `feedback_brainstorming_mechanism_check.md` — same spirit (force
concrete trace before `(Recommended)` label); pitfall extends to spec writing
specifically.

### Spec internal-consistency breach — invariant introduced, then contradicted two sections later

**What happened.** Phase 1.1.3 spec § Checksum introduced quantized checksum
invariant («integer sum (`BigInt`) is commutative + associative mod 2^64 → iteration
order has no effect on total»). Two sections later (§ Per-toolchain JS impl outline,
binary 2 `homo_dyn`) wrote: «iteration order должен match reference impl для
cross-binary checksum equality — here мы должны iterate fixture-index, dispatch to
correct typed array per index». Directly contradicts the invariant introduced earlier.

Self-caught при spec self-review step; fixed inline (replaced contradicting block
с explicit acknowledgment что quantization makes order-independence guaranteed,
3-per-type loops produce bit-identical checksum как mixed-order loop).

**Root cause.** When writing § Per-toolchain JS — focused на mechanics of
3-typed-arrays + 3-loops; default mental model «f64 sum is order-dependent»
re-asserted itself. Just-introduced invariant («integer sum order-independent»)
not actively cross-referenced при writing related paragraphs.

**Prevention.** Pattern observation only (bulk-deferred к
`docs/tech_debt/incorporate-pitfalls-2026-05-28.md` Item 1). Self-review pass DID
catch the contradiction — process worked as designed. Overlaps с existing memory
`feedback_grep_before_scope.md` (grep file для related terms before locking
docs-spec scope). Не triggers durable rule change без recurrence.

## Tooling

(none — session was pure design/planning, не touched tooling chain.)

## Planning

(none — plan structure matched precedent, hashmap plan format adapted cleanly.)
