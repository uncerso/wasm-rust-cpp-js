# Pitfalls — 2026-06-12 workflow-trigger-landing execution

## Process

### Following generic plugin-skill scripts over repo conventions
- **What happened** — Twice this session I ran a plugin-cache skill's boilerplate verbatim instead of reconciling it against the repo's own convention: (1) at session start I jumped into `/brainstorming` and skipped `docs/workflow.md` Phase 0/1 (Orient/Select); (2) after `/writing-plans` I asked the generic "subagent-driven vs inline" handoff question even though the plan's Execution Protocol already routed every task `[I]`. The user caught both.
- **Root cause** — The generic superpowers skills (brainstorming, writing-plans) don't know this repo's pipeline; their scripted steps are written for plans without per-task routing. Running the script without checking the repo convention produces redundant or skipped steps.
- **Prevention** — Landed: the `/iterate` skill now drives phases 0–7 (Phase 0 Orient can't be skipped), and its Phase 6 says "route by the plan's `[I]`/`[S]` tags — do NOT re-ask the harness". Standing rule: when a plan already carries per-task routing, the harness choice is determined; the only open decision left is the session boundary.

## Tooling

### sandbox: allowUnixSockets cannot grant socket bind (#41817)
- **What happened** — `e196a07` "fixed" the tsx IPC-pipe `listen EPERM` with `sandbox.allowUnixSockets`, but it never worked and shipped unverified — the verify step crossed a session boundary as an untracked open-loop (H7). A systematic-debugging pass this session proved the mechanism is wrong, not the glob form.
- **Root cause** — `allowUnixSockets` is connect-only; path-scoped bind/listen is unimplemented upstream ([#41817](https://github.com/anthropics/claude-code/issues/41817), closed "not planned"). No glob form could ever work. The original fix assumed the knob covered bind without verifying — and the "tweak the glob to add `/private/tmp`" follow-up would have been a second broken fix.
- **Prevention** — Landed: finish-session now blocks silent "done" on deferred verifications (open-loops-before-close rule); `docs/workflow.md`'s "verify the config knob" discipline + the new landing-audit catch the broader class. Sandbox specifics: file-write into the pipe dir already works (`$TMPDIR`); only the socket bind is blocked → the only escapes are `allowAllUnixSockets: true` (set in gitignored `settings.local.json`, pending fresh-session verify) or `dangerouslyDisableSandbox: true`.

### `git grep` with exclusion-only pathspecs matches nothing (false-clean)
- **What happened** — A reference sweep `git grep PATTERN -- ':!a' ':!b'` returned "(none)", implying the pattern was gone — but a direct `git grep PATTERN` found live matches. This is also why the prior workflow-cost-redesign close shipped with `docs/pitfalls/README.md` still naming the retired `/tech-debt-review` (its verify steps used the same exclusion-only form).
- **Root cause** — git pathspecs with only negative (`:!`) entries and no positive entry select no paths → the grep scans nothing and exits non-zero, which a `|| echo "(none)"` reports as clean.
- **Prevention** — Always include a positive pathspec alongside exclusions: `git grep PATTERN -- . ':!a' ':!b'` (or `:/`). When a sweep claims clean, cross-check with an unscoped `git grep PATTERN` before trusting it.
