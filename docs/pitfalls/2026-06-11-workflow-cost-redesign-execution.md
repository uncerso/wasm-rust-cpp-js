# Pitfalls — workflow-cost-redesign execution (Session D, 2026-06-11)

## Planning

### Verify the facts a plan asserts before acting on them

**What happened.** The plan asserted two things that were wrong at execution time:
(1) `finish-session` lived in the repo at `.claude/skills/finish-session/` — it was
actually a *global* skill at `~/.claude/skills/finish-session/`; (2) the recurring
tsx sandbox block was a filesystem write-allow issue — it is actually a
unix-domain-socket `listen EPERM` (`$TMPDIR` was already write-allowed, yet
`listen` still failed), fixed by `sandbox.allowUnixSockets`, not
`filesystem.allowWrite`.

**Root cause.** The plan inferred a file location and a failure mechanism without
checking them against the live system. Both inferences were plausible and both
were wrong; acting on them blindly would have produced a no-op fix (write-allow)
and a failed commit step (`git add` of a path outside the repo).

**Prevention.** Before a task acts on a plan's factual assertion — a file path, a
failure mechanism, a config knob — verify it cheaply first: `ls`/`find` the path;
reproduce the error and read the actual errno/syscall. A one-command check turns a
silent no-op into a correct fix. See `docs/workflow.md` § Spec & plan discipline.

## Process

### Push / PR to origin is a user action, not an agent action

**What happened.** `git push` failed with `Permission denied (publickey)` both in
and out of the sandbox. The ssh-agent held only Yubikey-backed corporate
(Skotty/Yandex) keys that require a physical touch; the github-authorized key was
not loaded. `gh` / `hub` were not installed. The agent could neither push nor open
the PR.

**Root cause.** Yubikey-backed SSH auth needs an interactive physical touch that a
non-interactive Bash tool cannot satisfy, and the GitHub CLI is absent — so neither
the SSH push nor an API-based PR creation was available to the agent.

**Prevention.** The agent prepares the branch (commits, gate, reference sweep) and
the PR body, then hands off: the user runs `! git push -u origin <branch>` in their
interactive context and opens the PR via the GitHub compare link. Do not burn turns
retrying the push. See CLAUDE.md § Commits.
