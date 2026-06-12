---
id: claude-md-tsx-sandbox-gotcha
title: tsx sandbox — allowUnixSockets can't grant socket bind (#41817); allowAllUnixSockets pending fresh-session verify
created: 2026-06-11
source: e196a07 config(sandbox); root-caused 2026-06-12 (spec 2026-06-12-workflow-trigger-landing § H3)
category: known-limitation
status: open
priority: low
---

## What

tsx's `createIpcServer` binds a Unix-domain socket at `/tmp/claude-<uid>/tsx-<uid>/<pid>.pipe`; the sandbox blocks the `listen`/bind with EPERM. Root-caused 2026-06-12:

- It is NOT a filesystem-write block — writing a regular file into that dir succeeds (`$TMPDIR` is write-allowed). It is specifically the unix-socket bind.
- `sandbox.allowUnixSockets` (the `e196a07` fix) is **connect-only and cannot grant bind/listen** — a known unimplemented Claude Code limitation ([#41817](https://github.com/anthropics/claude-code/issues/41817), closed "not planned"). No glob form could ever have worked; that entry was dead and is now removed.
- The only path-less escape is `allowAllUnixSockets: true` (disables the unix-socket restriction; fs-write + network restrictions stay). Set in gitignored `.claude/settings.local.json` (local-only, user choice 2026-06-12).

## Why it matters

While unverified, tsx-spawning commands (`pnpm smoke` / `build:*` / `fixtures` / `tsx -e`) still need `dangerouslyDisableSandbox: true` — each bypass is a permission prompt plus a loss of sandbox protection. The CLAUDE.md gotcha now states this true state.

## Possible fix

**Blocked on fresh-session verification** (the sandbox profile loads at session start, so a mid-session settings edit doesn't apply). In a new session run `pnpm exec tsx -e "console.log(1)"` with NO bypass:

1. **PASS** → `allowAllUnixSockets` works; rewrite the CLAUDE.md "tsx + sandbox" line to drop the bypass advice, then **resolve** this item (delete the file).
2. **FAIL** → it's the [#16076](https://github.com/anthropics/claude-code/issues/16076) "settings ignored" behaviour; keep the bypass and switch this item to `wontfix` with that rationale.

## References

- Spec: `docs/superpowers/specs/2026-06-12-workflow-trigger-landing-design.md` § Hole-audit (H3, H7).
- Deferred verify: next-session open-loop (run `/iterate` → Phase 0 surfaces it).
