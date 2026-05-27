---
id: incorporate-pitfalls-2026-05-28
title: Bulk-defer pitfalls из /finish-session 2026-05-28 (Phase 1.1.3 brainstorm)
created: 2026-05-28
source: docs/pitfalls/2026-05-28-phase-1-1-3-brainstorm.md
category: process-gap
status: open
priority: low
---

## What

Bulk-defer бакет для pitfall items из /finish-session 2026-05-28 (Phase 1.1.3
brainstorm/planning session), которые не были задиспатчены inline. Каждый item —
отдельный suggestion для дальнейшего dispatch через `/tech-debt-review`.

### Item 1: After introducing invariant in spec, audit subsequent paragraphs for inadvertent contradictions

**Lesson:** Phase 1.1.3 spec § Checksum introduced quantization-makes-order-independent
invariant («integer sum order-independent because BigInt sum is commutative + associative
mod 2^64»). Затем § Per-toolchain JS implementation outline для binary 2 wrote
«iteration order должен match reference impl для cross-binary checksum equality —
reference processes mixed-fixture order; here мы должны iterate fixture-index, dispatch
to correct typed array per index» — directly contradicting the invariant introduced
two sections earlier. Self-caught в spec self-review pass; fixed inline with explicit
acknowledgment в comment block.

Root cause: When writing later sections that touch related concept, fell back на
default mental model («order matters в float sums») rather than honoring the
just-introduced invariant. Spec quality depends на consistency across paragraphs,
не per-paragraph correctness.

**Suggested dispatch options:**
1. Extend `feedback_grep_before_scope.md` memory: «после introducing invariant в
   spec, grep file для terms related к the invariant (e.g., "iteration order",
   "addition non-associative", "f64 sum") — verify all mentions honor it». Currently
   memory is about convention edits; spec invariants — generalization.
2. Add к `CLAUDE.md § Spec & plan conventions` separate bullet «Invariant-introduction
   audit» — после introducing invariant, grep + verify.
3. Skip — overlaps with existing `feedback_grep_before_scope` + spec self-review
   (which DID catch this case); not durable rule needed.

**Why low priority:** Single occurrence; self-caught during self-review (process
worked as designed); pattern overlap с existing memory. Worth noting не triggers
durable rule change. Pattern review at next spec writing — promote if recurs.

## Why it matters

См. pitfall `docs/pitfalls/2026-05-28-phase-1-1-3-brainstorm.md` для full context.
Без review во время следующего `/tech-debt-review` items тихо застревают в backlog'е.

## Suggested workflow для review

Run `/tech-debt-review`; для item:
- Если решено «extend memory» или «add CLAUDE.md bullet» — открыть target file
  и применить change inline, закрыть item.
- Если решено «skip» — пометить отдельным `status: wontfix` rationale (или закрыть
  весь bulk file если все items skipped).
- Если решено «hold» — оставить open до следующей phase, перепосмотреть если
  pattern повторится.
