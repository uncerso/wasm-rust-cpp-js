# Capture Protocol

How knowledge captured mid-session reaches its durable home without breaking flow. One mechanism (in-session markers), one collection point (`/finish-session`), five destinations.

## In-session marker (PB6)

When you notice something worth keeping, emit one line inline and keep working:

```
› capture: <type> — <slug>: <one-line note>
```

`<type>` ∈ `{tech-debt, roadmap, guideline-candidate, agent-lesson, pitfall}`. `<slug>` is a kebab-case handle; the note is one line.

Emitting a marker is NOT a round-trip — it costs nothing, persists in the transcript, and never blocks the current task. NEVER stop to write the destination file mid-task. `scripts/scan-markers.mjs` collects every marker at `/finish-session`: one triage pass → batch write by type. This replaces ad-hoc "should I capture this now?" interruptions.

## Marker types

| Type | When | Destination |
|---|---|---|
| `tech-debt` | small fix < 1 day, single file/function | `docs/tech_debt/<slug>.md` (format: `docs/tech_debt/README.md`) |
| `roadmap` | feature / runtime-axis / infra epic needing a spec | one line in a `docs/roadmap.md` bucket (format: `docs/roadmap.md` Conventions) |
| `guideline-candidate` | confirmed, reproducible, product-relevant finding | `docs/guidelines.md` |
| `agent-lesson` | how-to-work-with-the-agent lesson | `docs/pitfalls/` + actionable bits in `docs/workflow.md`; graduates to `docs/agent-guidelines.md` at an evidence threshold |
| `pitfall` | execution lesson | routed by the 5-branch taxonomy at `/finish-session` (see the `finish-session` skill) |

`guideline-candidate` test (PG2): does it change a product engineer's decision — language, toolchain, flag, or pattern — and is it reproducible? If no → it belongs in literature, not `docs/guidelines.md`.

## Tech-debt vs roadmap

- **Tech-debt** — small, fixable in < 1 day, single file/function impact → `docs/tech_debt/`.
- **Roadmap** — new feature / runtime axis / infra epic, needs brainstorm + spec → one line in `docs/roadmap.md`.

## What NOT to capture

Tech-debt — do NOT raise:
- Items already in `docs/tech_debt/`, `docs/roadmap.md`, or `docs/superpowers/specs/` / `plans/`.
- Accepted trade-offs in README "Известные ограничения".
- Style nitpicks without impact.
- Feature-level items (new workloads, runtime axes, infra epics) — those are roadmap.

Roadmap — do NOT raise:
- Items already in `docs/roadmap.md`, `docs/superpowers/specs/`, or `plans/`.
- Tech-debt-scale items — use the tech-debt marker.
- Accepted trade-offs in README "Известные ограничения".

## Trigger phrases

If these surface in your own reasoning, stop once and emit a marker:

- **Tech-debt:** process gap, latent bug, should fix later, open review ticket, investigation needed, не блокирующее, TODO, follow-up, skipped for now, нужно разобраться позже.
- **Roadmap:** new workload, new axis, browser support, runtime profile, future phase, big feature, requires spec, after Phase X.Y, separate effort needed, отдельная фаза, требует дизайна.

## Periodic triage

`/backlog-review` triages BOTH `docs/roadmap.md` and `docs/tech_debt/`. The two storages stay separate; the skill runs one pass over each and never edits without explicit confirmation.
