# Pitfalls — Phase 1.3 close-out (visual deliverable + silent spec-scope reduction)

## Process

### Phase declared "closed" with green gates but a broken primary (visual) deliverable

- **What happened.** Phase 1.3 (size-attribution + reporter Size/Perf tabs) was reported "closed, gates green" after `build:all` / `typecheck` / `lint:all` / `test` / `smoke` all passed. On visual review the user found: (1) Size bars scaled to a **global** max across all workloads → `interop_calls` (~300 B) rendered as a sliver next to `hashmap_string` (~19 KB); (2) a stale `composition unavailable (Plan 3)` note (Plan 3 was the session that was closing); (3) the degraded non-rust/raw bar mislabelled as green `observed` / facility `(unattributed total)`. None of these are catchable by typecheck/lint/test — they are render/UX regressions in HTML+client-JS.
- **Root cause.** Close-out verification leaned entirely on automated gates. Gates assert "code compiles, lints, units pass, checksums hold" — they say nothing about whether the rendered artifact *looks right* or *delivers its purpose*. The primary deliverable of this phase was a visual report; it was never opened and eyeballed before "closed". Bugs (1) and (3) shipped in Plan 2 and survived two close-outs (Plan 2 and Plan 3) because each close trusted gates.
- **Prevention.** For any UI / report / rendered deliverable, the Close phase must include a **real render check** (open the produced artifact, look at it) before declaring closed — gates do not catch render regressions. Landed in the `iterate` skill Phase 7 (Close) checklist.

### Spec § item silently scoped out by a plan ("relocate without redesign")

- **What happened.** Spec § Information Architecture listed Perf-tab filters (env / size S-M-L / profile) as part of the shell. Plan 2 relocated the perf table "без редизайна" and dropped the filters, without flagging the omission to the user. They surfaced only on the user's review at Phase close — i.e. the spec was quietly under-delivered. (Same shape for the per-facility bar colouring from the early design mockup, narrowed to band-level in the written spec.)
- **Root cause.** When a plan narrows a spec item for scope reasons ("out of redesign scope", "v1 only"), the narrowing is a decision the user should see. Here it lived only inside the plan's prose and was never raised as "we are NOT doing spec § X this phase — ok?". A reader of the close-out summary had no signal that a spec item was dropped.
- **Prevention.** Close phase must produce a **spec-coverage diff**: explicitly name spec § items NOT implemented this phase and surface them to the user, rather than letting "relocate without redesign" silently swallow them. Landed in the `iterate` skill Phase 7 (Close) checklist. Related memory: `feedback_surface_planned_risks` (surface planned risks → extend to surfacing scope reductions).

## Note

Both lessons partially overlap existing memory (`feedback_manual_browser_check` — verify in a real browser early; `feedback_surface_planned_risks` — escalate when a planned risk fires). They did **not** fire here because they were framed for *debugging* and *planned-risk* contexts, not *close-out*. The prevention lands the close-out-specific trigger in the `iterate` Close checklist so it fires at the right cadence.
