# Writing Standard

Default standard for all prose humans read in this repo — docs, commit messages, specs, plans, skill text, error and UI strings. Apply it inline as you write. A heavy polish pass loads the full `writing-clearly-and-concisely` skill via a subagent; keep that load off the per-turn path (read + persistence is costly — spec GM2).

## Rules

1. **No preamble.** Start with the action or the claim. NEVER restate the question or open with "This document describes…".
2. **Hard modals.** Replace soft modals ("should", "try to", "consider") with `NEVER` / `MUST` scaled to severity. Reserve them for real constraints, not emphasis.
3. **Tables for ≥3 options.** Any comparison of 3+ proposals, tools, or approaches goes in a table, not prose.
4. **Rationalization table for discipline rules.** A rule the reader will be tempted to skip MUST carry a two-column "thought → reality" table that pre-empts the rationalization.
5. **Red-flags before decisions.** State the failure signals ("STOP if you catch yourself thinking X") before the decision point, not after it.
6. **One example, one language.** Show a single working example. NEVER ship the same example in multiple languages "for completeness".
7. **Density target for output-generating docs.** A doc that tells the agent to produce output (a skill, a template) MUST state a density or length target so the output stays lean.
8. **Validation checklist at the end.** End a procedure doc with a checklist the reader runs to confirm recency and completeness.

## Polish pass

The cheat-sheet above is the inline standard. For a heavy edit, dispatch a subagent that loads the full `writing-clearly-and-concisely` skill — keep that load off the main per-turn context. The fuller distillation lives in tech-debt `writing-clearly-distillation`.
