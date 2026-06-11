---
id: claude-md-tsx-sandbox-gotcha
title: CLAUDE.md "tsx + sandbox" gotcha goes stale once allowUnixSockets is verified
created: 2026-06-11
source: e196a07 config(sandbox)— allow tsx IPC unix-socket listen via allowUnixSockets
category: docs
status: open
priority: low
---

## What

CLAUDE.md § "Tooling gotchas" → "tsx + sandbox" tells the agent to run
tsx-spawning commands (`pnpm smoke` / `build:*` / `fixtures` / `tsx -e`) with
`dangerouslyDisableSandbox: true`. As of `e196a07` the real fix is in place:
`.claude/settings.json` `sandbox.allowUnixSockets: ["/tmp/claude-*/tsx-*/*.pipe"]`.
The block is a unix-domain-socket `listen EPERM` (tsx `createIpcServer`), NOT a
file-write block — `$TMPDIR` was already write-allowed yet `listen` still failed,
so `filesystem.allowWrite` never addressed it.

## Why it matters

Once the `allowUnixSockets` fix is confirmed live, the gotcha's advice is wrong:
tsx commands should run *inside* the sandbox (no bypass), and
`autoAllowBashIfSandboxed` auto-allows them. Stale advice causes needless
`dangerouslyDisableSandbox` use — each bypass is a permission prompt plus a loss
of sandbox protection.

## Possible fix

**Blocked on verification.** The sandbox profile loads at session start, so the
new setting only takes effect in a fresh session. Once a new session confirms
`pnpm exec tsx -e "console.log(1)"` runs in-sandbox without `listen EPERM`:

1. Rewrite the CLAUDE.md "tsx + sandbox" line — the block is fixed via
   `sandbox.allowUnixSockets`; tsx runs in-sandbox; the bypass is no longer needed.
2. Update any `docs/workflow.md` / pitfall references that assume the bypass.

If verification FAILS (e.g. the directory-glob form is unsupported), switch to the
literal `/tmp/claude-<uid>/tsx-<uid>/*.pipe` or move the setting into global
`~/.claude/settings.json`, then re-verify.
