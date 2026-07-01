# Pitfalls — 2026-07-01 (CV-stabilization spec redesign)

## Planning

### Spec built on unmeasured empirical premises

**What happened.** The original CV-stabilization spec (`cd20f2a`) designed an entire
"adaptive time-based batching" mechanism around two stated premises: "Firefox quantizes
`performance.now()` to 1 ms" and "node timer resolution ~1 µs". Both were false when
measured on the target machine: Firefox is **20 µs** (COOP+COEP already active), node is
**~40 ns**, Chromium 5 µs. The figures came from general knowledge of the *default*
(pre-cross-origin-isolation) browser behavior, not from a measurement — and they
contradicted the project's own recorded numbers
(`docs/superpowers/notes/2026-05-05-perf-now-precision.md`, `docs/guidelines.md:188`,
`docs/superpowers/plans/2026-05-20-...preamble.md:78`). A ~3-minute diagnostic
(busy-loop resolution probe + `crossOriginIsolated`, run in node / chromium / firefox
via a minimal COOP+COEP server) overturned the headline and led to a completely
different, simpler design: an SEM-of-mean acceptance gate with no batching at all.
Offline re-analysis of the reference run then showed ~9/10 of "noisy" cells were a
metric artifact (CV-of-spread instead of SEM-of-mean), not bad data.

**Root cause.** An empirical quantity (timer resolution / quantization) was treated as a
known constant during design instead of being probed. "1 ms" is the *default* Firefox
clamp; under the harness's already-enabled cross-origin isolation the real floor is
20 µs — a 50× error that invalidated the sizing of the whole approach (browser
`targetSampleMs` was set 10× too large as a direct consequence).

**Prevention.** Before designing on any empirical premise (timer resolution,
quantization, throughput, perf numbers), **measure it on the target setup** — do not
take it from general knowledge, and cross-check the repo's own `docs/superpowers/notes/`
+ `docs/guidelines.md` (which already held the correct 20 µs). A cheap diagnostic that
can overturn a design premise is always worth running before writing the spec. Landed as
a checklist line in the `/iterate` skill Design phase (branch 4 of the pitfall taxonomy).
