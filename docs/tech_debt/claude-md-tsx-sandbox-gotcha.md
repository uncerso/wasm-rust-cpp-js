---
id: claude-md-tsx-sandbox-gotcha
title: tsx sandbox — no sandbox knob grants the socket bind (#41817); wontfix, bypass remains
created: 2026-06-11
source: e196a07 config(sandbox); root-caused 2026-06-12 (spec 2026-06-12-workflow-trigger-landing § H3); fresh-session verify 2026-06-13
category: known-limitation
status: wontfix
priority: low
---

## What

tsx's `createIpcServer` binds a Unix-domain socket at `/tmp/claude-<uid>/tsx-<uid>/<pid>.pipe`; the sandbox blocks the `listen`/bind with EPERM. Root-caused 2026-06-12:

- It is NOT a filesystem-write block — writing a regular file into that dir succeeds (`$TMPDIR` is write-allowed). It is specifically the unix-socket bind.
- `sandbox.allowUnixSockets` (the `e196a07` fix) is **connect-only and cannot grant bind/listen** — a known unimplemented Claude Code limitation ([#41817](https://github.com/anthropics/claude-code/issues/41817), closed "not planned"). No glob form could ever have worked; that entry was dead and is now removed.
- The only path-less escape is `allowAllUnixSockets: true` (disables the unix-socket restriction; fs-write + network restrictions stay). Set in gitignored `.claude/settings.local.json` (local-only, user choice 2026-06-12).

## Why it matters

tsx-spawning commands (`pnpm smoke` / `build:*` / `fixtures` / `tsx -e`) need `dangerouslyDisableSandbox: true` — each bypass is a permission prompt plus a loss of sandbox protection. Confirmed unavoidable (see § Decision). The CLAUDE.md gotcha states this true state.

## Decision

**wontfix (2026-06-13).** Fresh-session verify run with `allowAllUnixSockets: true` live in `.claude/settings.local.json` and NO bypass: `pnpm exec tsx -e "console.log('tsx-ok')"` still fails `listen EPERM ... /tmp/claude-501/tsx-501/<pid>.pipe`. Disambiguation in the same session: a regular-file write into that exact dir **succeeds**, so it is specifically the unix-socket bind that `allowAllUnixSockets: true` does not lift (whether the setting is silently ignored — [#16076](https://github.com/anthropics/claude-code/issues/16076) — or genuinely doesn't cover bind, the empirical outcome is identical). No sandbox knob makes tsx run in-sandbox; the `dangerouslyDisableSandbox: true` bypass remains the working path. The CLAUDE.md gotcha now states this confirmed reality. Item stays in backlog per the wontfix convention (not duplicated in roadmap.md); reopen if a future Claude Code release implements unix-socket bind allow.

## References

- Spec: `docs/superpowers/specs/2026-06-12-workflow-trigger-landing-design.md` § Hole-audit (H3, H7).
- Verify: fresh-session run 2026-06-13 (this open-loop, surfaced by `/iterate` Phase 0).
