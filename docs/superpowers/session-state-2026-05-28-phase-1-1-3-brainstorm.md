# Session state — 2026-05-28 Phase 1.1.3 brainstorm + planning

Phase 1.1.3 shape_dispatch design **finalized**: spec + plan committed на master,
execution не начато. Next session: choose execution mode (subagent-driven vs
inline) и приступить к W0 pre-flight.

## TL;DR

- Master HEAD: `f9a381f` (plan commit).
- Phase 1.1.3 spec `aeee4fd` (834 lines):
  `docs/superpowers/specs/2026-05-27-phase-1-1-3-shape-dispatch-design.md`.
- Phase 1.1.3 plan `f9a381f` (2478 lines, 37 tasks across W0-W6):
  `docs/superpowers/plans/2026-05-28-phase-1-1-3-shape-dispatch.md`.
- Workload design: **2×2 factorial** (dispatch × data layout) — 4 binaries:
  `shape_dispatch_{homo,mixed}_{static,dyn}`. Quantized checksum
  (`floor(score · 1e6 + 0.5) mod 2^64`) — integer sum order-independent →
  cross-binary equality invariant.
- Raw heap arrays в всех 5 toolchains (no Vec/std::vector — container axis
  deliberately excluded; covered by Phase 1.2 `hashmap-stdlib-no-glue`).
- JS skips binary 1 (collapses к binary 2 via monomorphic IC).
- Anti-devirt friction для `*_dyn` binaries: `core::hint::black_box` (Rust) +
  `asm volatile("" : : "g"(ptr) : "memory")` (C++). signal_fence rejected as
  mitigation — memory ordering ≠ type analysis.
- 6 open risks (R1 devirt, R2 body floor, R3 wasi-sdk placement new, R4
  rust/raw fat pointers, R5 cross-binary checksum equality, R6 reporter v2
  rewrite) каждый с verification command + 2-3 mitigation alternatives.
- Protocol: если risk fires → STOP, surface to user, не auto-apply mitigation.
- Phase 1.1.2.1 baseline (HEAD pre-session = `04f7202`) — gates green; не
  touched этой session'ой.

## What the next session needs

- **Execution mode decision:** subagent-driven (recommended — main context
  stays clean, per-task spec re-read happens automatically, risk-fired
  surfacing идёт через main agent review checkpoint) vs inline (watch each
  task closely, но context window наберёт массу к W2 close).
- **Pre-flight gate (Task 0):** verify master gates green перед W1 start —
  `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke`.
- **W1 (Tasks 1-8):** infra + spec — `genShapes` extension + `shape-reference.ts`
  + 4 binary skeletons + cross-binary `fixtureSha256` + `expectedChecksums` equality
  verification.
- **W2 risk-first ordering:** Tasks 9, 10 (cpp/wasi-sdk + rust/raw binary 4
  `mixed_dyn`) run **first** для R3, R4 fail-fast — surface к user если
  feasibility breaks.
- **R1 devirt verification:** post-W2 close — `wasm-objdump -d ... | grep -c
  call_indirect` per `*_dyn` artifact must be > 0.

## Done in this session

### Brainstorm dialogue (multi-turn refinement)

1. **Initial scope decision** — 2×2 factorial chosen over original
   asymmetric design (homogeneous-static vs mixed-dynamic) и over 3-way
   variant. Rationale: factorial isolates dispatch + data-layout effects
   atomically.

2. **JS asymmetry handling** — user recognized binary 1 ≡ binary 2 в JS
   (types erase, monomorphic IC identical). Skip binary 1 for JS path
   (3 binaries instead of 4).

3. **Storage discipline** — user proposed raw heap arrays (no Vec/std::vector)
   во всех toolchains. Eliminates container overhead axis (separate workload
   under Phase 1.2). Unblocks rust/raw (no alloc crate) + cpp/wasi-sdk
   (no libc++). Apples-to-apples cross-toolchain.

4. **Inlining risk decomposition** — 3 risks isolated: (A) full inlining of
   process — expected, не suppress; (B) devirtualization in binary 2 —
   prevented via construction-via-load_input pattern + black_box / asm volatile;
   (C) body-size floor — formula sized at 12 FP ops + sqrt + ln для ~20-30 ns
   per-shape cost.

5. **Quantized checksum invariant** — `floor(score · 1e6 + 0.5) mod 2^64`
   integer sum, order-independent by construction. Resolves cross-binary
   correctness verification (4 binaries, same shape data → identical
   checksum).

6. **Process protocol** — user added requirement: when pre-identified risk
   fires during execution, surface to user with 2-3 mitigation alternatives,
   **не auto-apply mitigation**. Captured как memory
   `feedback-surface-planned-risks`. Embedded в spec § Open risks.

7. **C++ `core::hint::black_box` analog** — user asked: documented
   `asm volatile("" : : "g"(ptr) : "memory")` (Google Benchmark pattern,
   type-escape via input operand). User questioned signal_fence priority;
   investigation showed fence inadequate для devirt (memory ordering ≠ type
   analysis); removed signal_fence from R1 + R3 mitigation lists.

8. **No auto-invoke /finish-session at phase close** — user added requirement:
   при phase exit criteria met, send hand-off message + ask user, don't
   auto-invoke. Captured как memory `feedback-no-auto-finish-session`.
   Embedded в plan Task 36.

### Artifacts shipped

| commit | what |
|---|---|
| `aeee4fd` | spec — Phase 1.1.3 shape_dispatch execution design (834 lines) |
| `f9a381f` | plan — implementation plan (2478 lines, 37 tasks W0-W6) |

### Memory updates

- New: `feedback_surface_planned_risks.md` — surface pre-identified risks
  when they fire, don't auto-apply.
- New: `feedback_no_auto_finish_session.md` — phase exit ≠ session exit;
  ask user before /finish-session.
- Updated: `project_wasm_benchmarks.md` description + body — reflect
  brainstorm done, execution pending.
- Updated: `MEMORY.md` index — added 2 new lines + updated project entry.

### Drift fixes этой /finish-session

- `MEMORY.md` + `project_wasm_benchmarks.md` status line: brainstorm pending
  → spec + plan ready, execution pending.
- `CLAUDE.md` § Spec & plan conventions: added «Mitigation alternatives
  mechanism-check» bullet (per pitfall C1).

### Pitfalls captured

- `docs/pitfalls/2026-05-28-phase-1-1-3-brainstorm.md` — 2 items:
  - signal_fence mistake (mechanism-verify mitigation alternatives) →
    inline-applied к CLAUDE.md.
  - Spec invariant audit (quantization vs iteration-order paragraph
    contradiction, self-caught) → tech-debt low.
- `docs/tech_debt/incorporate-pitfalls-2026-05-28.md` — bulk-defer bucket
  для tech-debt-level pitfall items.

## Deferred items

- **Phase 1.1.3 execution:** 37 tasks; expected ~50-100 hours total
  (incl. ~60-90 мин bench:all + reporter v2 work). Subagent-driven
  recommended.
- **Push to origin:** master ahead by 2+ commits (spec + plan + any
  session-close commits). Не pushed (agentic commits stay local пока
  user reviews).
- **Untracked files:** `.claude/settings.local.json` (gitignored config) +
  `"Какие есть существующие бенчмарки wasm под браузер.md"` (random user
  file с прошлых session'ов) — не trogano.

## Workflow notes

- `--no-gpg-sign` на коммитах per repo директива.
- Sandbox: для tsx subprocess — `dangerouslyDisableSandbox: true`. Не
  triggered этой session'ой (pure design/planning, no tsx invocation).
- Plan tasks 13-23 имеют abbreviated specification для rust/bindgen + js
  variants (binaries 1-3); tasks 9-12 + 13-18 (cpp + rust/raw binaries 1-4)
  fully coded. Tasks 19-23 reference fully-coded counterparts + spec §
  Per-toolchain. Hybrid expansion choice — user-approved compromise (spec
  834 lines + plan 2478 lines = sufficient context для subagent-driven
  execution).

## Полезные команды

```bash
# Где мы
git rev-parse HEAD                           # f9a381f
git log --oneline -5                         # spec + plan + session-close commits
git diff --stat HEAD~2 HEAD                  # +3312 lines docs (spec + plan)

# Phase 1.1.3 artifacts
wc -l docs/superpowers/specs/2026-05-27-phase-1-1-3-shape-dispatch-design.md   # 834
wc -l docs/superpowers/plans/2026-05-28-phase-1-1-3-shape-dispatch.md          # 2478

# Pre-flight gate (master baseline check)
pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke

# Phase 1.1.3 execution start
# (Choose: subagent-driven via superpowers:subagent-driven-development
#  OR inline via superpowers:executing-plans)
```

## Stop point

- Phase 1.1.3 — **design finalized, execution pending**.
- Spec `aeee4fd` + plan `f9a381f` on master. 37 tasks W0-W6 awaiting
  execution mode decision.
- Pre-flight gate Task 0 — first concrete action in next session.
