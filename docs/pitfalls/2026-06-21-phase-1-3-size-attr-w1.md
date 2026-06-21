# Pitfalls — Phase 1.3 Plan 1/3 W1 (size-attribution engine)

Session 2026-06-21. Engine + rust attribution landed clean; cpp/wasi-sdk hit a
name-section heisenbug that ate most of the session's back half. Technical forensics:
[`bug-reports/2026-06-21-cpp-wasi-sdk-name-section-heisenbug.md`](../bug-reports/2026-06-21-cpp-wasi-sdk-name-section-heisenbug.md).

## Planning

### A spec/W0 probe validated the cpp mechanism in isolation; the production integration behaved differently

**What happened.** The Phase 1.3 W0 probe confirmed "twiggy reads + demangles cpp
names for wasi-sdk" — but it did so against a **standalone clang invocation**. The
actual integration runs that same clang **inside `build-wasi-sdk.sh`** (after the
production strip build, via execa). In that path the name section silently drops to
anonymous `code[N]` (~98% unattributed). The exact captured argv replayed standalone
gives full demangled names; through the script it doesn't. The plan's "add `-g`"
instruction was also wrong (DWARF *suppresses* the wasm name section).

**Root cause.** The probe approximated the mechanism instead of exercising its real
integration path. A standalone clang call is not the same execution context as the
build-script-driven call, and the divergence lived precisely in that gap. The plan
inherited the probe's blind spot and even codified a wrong flag (`-g`).

**Prevention.** A W0/probe must exercise the mechanism through the **real integration
path** it will ship in (the actual build script / orchestrator call), not a standalone
approximation — especially for build-tooling whose output depends on flags, ordering,
or process context. Codified in `docs/workflow.md` (W0 / mechanism-check).

## Process

### Overran the retry budget hunting a heisenbug instead of degrading + escalating early

**What happened.** Once cpp attribution came back ~98% unattributed, I spent ~15
tool-calls bisecting the mechanism (flags, exports, `-flto`, wasm-opt, TMPDIR,
function-vs-flat, file-vs-`bash -c`, argv capture). It never resolved. CLAUDE.md
§ Cost discipline caps this at "≤2 attempts at the same approach; then STOP and
rethink." I blew past it.

**Root cause.** Sunk-cost momentum: each test felt one step from the answer, and the
zsh-vs-bash tooling confound (macOS bash 3.2, no `mapfile`; zsh doesn't word-split
`$VAR`) produced misleading intermediate results that kept the hunt "almost there."

**Prevention.** The rule already exists (CLAUDE.md § Cost discipline) — this is a
discipline failure, not a missing rule. Concretely: when a contained, non-blocking
failure mode appears (here: one toolchain's attribution, with the other three working
and a clean graceful-degradation path available), cap mechanism investigation at the
retry budget, ship the degradation + bug-report, and escalate the decision. The
plan's own break-check said exactly this ("STOP, эскалировать"); I should have hit it
~10 tool-calls earlier.
