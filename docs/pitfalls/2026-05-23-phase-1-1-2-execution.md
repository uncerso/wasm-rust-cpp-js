# Pitfalls — Phase 1.1.2 execution (2026-05-23)

Lessons from executing Phase 1.1.2 (hashmap workload) via subagent-driven-development.
Phase merged to master at `6b8073d` with tag `phase-1-1-2`. 32 task commits + 1 bug-branch
commit on `feature/phase-1.1.2-bug`.

## Planning

### Plan template used invalid `const fn` для `HashMap::new()`

**What happened.** Plan Task 17 (hashmap_string/rust/bindgen) prescribed:
```rust
impl State {
    const fn new() -> Self {
        Self { pairs: Vec::new(), map: HashMap::new() }
    }
}
static STATE: SyncCell<State> = SyncCell(RefCell::new(State::new()));
```
This does not compile. `std::collections::HashMap::new()` is **not const** because the default
`RandomState` hasher seeds from the OS at runtime. Implementer correctly switched к
`LazyLock<SyncCell<State>>` and surfaced the deviation. Same fix applied в Task 18
(hashmap_int/rust/bindgen) without re-discussion.

**Root cause.** Plan author assumed `HashMap::new()` is const by analogy с `Vec::new()`. No
compile check during plan writing — code blocks были untested. Earlier phase's Rust crate
(matmul) wrapped `Vec<f64>` only, никогда HashMap, so the const-init pattern wasn't tested
end-to-end before being copied.

**Prevention.** Spec/plan author should compile spec'd code at least once (even a one-file
sketch) before locking commit blocks. Specifically для Rust workloads: verify any
`const fn`/`static` initialization against the actual types being used, not by analogy.
Add к `superpowers:writing-plans` skill (или to spec template): «If plan ships Rust
`const fn`/`static`, compile-check the block before commit. `HashMap::new()` is **not**
const на stable.» See guidelines section for the documented Rust pattern (`LazyLock` + `SyncCell`).

### Plan invariant «lookup == delete per size» неверен при collisions

**What happened.** Plan Task 9 sanity check:
> `expectedChecksums.hashmap_string_lookup.S` MUST equal `expectedChecksums.hashmap_string_delete.S`. Same for M and L.

Это держится для hashmap_string (uniform 64-bit hex keys, collision prob ~10⁻¹⁰), но НЕ
для hashmap_int L (uniform u64 keys в [0, 2^53), birthday paradox ~0.6% collision rate
at N=100000). Implementer correctly surfaced: `insert.L=99996` (not 100000), и
`lookup.L ≠ delete.L` by 5,724,698,288.

Numbers сами по себе correct (lookup counts colliding pairs twice; delete only finds key
first time). Plan's «MUST equal» — too-strong assumption.

**Root cause.** Plan author не оценил collision probability при writing invariants. 53-bit
key space + 100000 inserts → ~0.6% expected collisions = invariant failure заранее
known если посчитать. Plan template-копировал invariant из hashmap_string (where collision
prob is negligible) без re-deriving for hashmap_int's key range.

**Prevention.** Когда invariant зависит от key distribution, считать collision probability
заранее (birthday paradox: P(collision) ≈ N²/(2·M) where M = key space size). Documented
caveat в hashmap_int spec.json's `ioContract.iterSemantics`. Future workload plans с
random-key fixtures: include explicit collision-rate calculation in the spec § iter
semantics.

### Smoke at S only — eval-mode bugs survive Wave 2 close

**What happened.** Plan Task 21 (Wave 2 close) ran smoke at size S quick mode — all green.
Bench:all (Task 22) eval mode на тех же combos detected V8 JIT deopt bug при size S +
lookup entries. Smoke did NOT catch it because quick mode (warmup=3, maxSamples=10)
doesn't trigger turbofan tier-up; eval mode (warmup=10, maxSamples=100) does.

So «smoke OK at Wave 2 close» was a misleading signal — real validation deferred к bench:all.

**Root cause.** Smoke designed для speed (<30s), not for correctness coverage of all JIT
behaviors. Quick mode's sample count is too low to hit V8 tier-up boundaries.

**Prevention.** Wave 2 close protocol should additionally run a quick eval-mode validation
(e.g., one combo × one entry × one size в eval mode) before declaring Wave 2 closed.
Tech-debt candidate: add `pnpm smoke:eval` или similar that exercises eval mode на 1-2
representative cases per workload. Cost: ~30s extra; benefit: catches JIT-tier-dependent
bugs earlier.

Update `superpowers/specs/<phase>-<workload>-design.md` template — explicit "Wave 2 close
also runs eval-mode validation" gate.

## Tooling

### Clangd diagnostics noise on new C++ files (no compile_commands.json / `.clangd`)

**What happened.** Tasks 19 (hashmap_string/cpp) и 20 (hashmap_int/cpp) triggered IDE
diagnostics с errors like «right angle brackets need space», «Unknown type name 'constexpr'»,
«Unknown size_t», «no member 'emplace' in unordered_map». Все — pre-C++11 mode noise
because clangd defaults to whatever the system default is without project config. Actual
emcc build с `-std=c++23 -Werror` passes clean.

Existing `interop_calls/cpp/src/interop_calls.cpp` was simpler (no nested templates, no
constexpr globals), so didn't trigger this noise at its scale.

**Root cause.** Project has no `compile_commands.json` (would be generated by CMake; this
project uses emcc shell scripts) and no `.clangd` config. Clangd falls back to whatever
default `clang -E` would use, which is pre-C++11 на macOS.

**Prevention.** Add a minimal `.clangd` config at repo root specifying `-std=c++23` plus
emcc/wasi-sdk include paths. Captured as tech-debt:
`docs/tech_debt/clangd-config-cpp23-diagnostics.md` (to be added by /tech-debt-review
or inline). Не блокирует execution — just IDE noise. Reviewers should learn to recognize
clangd diagnostics на new C++ files как false positives until config lands.

### `pnpm bench:all` browsers сегмент fragile to chromedriver session loss

**What happened.** First bench:all retry (after V8 deopt fix) succeeded на node cases но
failed mid-browser-segment with `SessionNotCreatedError: chrome not reachable`. 334
results captured before crash, but matmul wasn't reached. User chose `pnpm bench --envs=node`
fallback — 140 results, всё clean.

Chromedriver session may drop из-за memory pressure (long-running bench loops 100s of
WebDriver invocations) или из-за internal driver bug. Не workload-specific.

**Root cause.** Bench-runner does one WebDriver session per case (per combo × entry × size).
Cumulative sessions accumulate Chrome processes if cleanup is imperfect; eventually
chromedriver gives up creating new sessions. Already-captured results are not corrupted —
the failure isolates к the failing case.

**Prevention.** Bench-runner should retry-on-session-loss (e.g., 1 retry per case before
giving up). Bench-all script should support `--envs=node` shortcut for "skip browsers if
they're flaky." Captured как tech-debt candidate. Also: future Phase в which Safari /
WebDriver-BiDi adoption — document this pattern's persistence через runtime axes.

## Process

### Two-stage review can hallucinate violations not present в lint

**What happened.** Task 12 code-quality reviewer reported "**Important — ESLint Style
Violations (brace-style rule)**" as "blocking", recommending `pnpm lint:ts:fix` re-commit.
I verified independently — `pnpm lint:ts` returned 0 errors. Reviewer's claim was a
hallucination (likely pattern-matching на single-line braces без actually running lint).

Same code-style pattern WAS present в Task 9 reference.ts but lint:ts reported 0 errors
там же. Так что reviewer's claim was correct in general (brace-style rule exists) но
incorrect about applicability at that moment.

Later (Task 22a/22b) когда lint:ts reported 24 brace-style errors, the violations были
real. Investigated и confirmed they had been present since Task 9 commit but somehow
lint:all returned exit 0 in Wave 1 close (Task 13). Cause not root-caused — possibly
sandboxed pipe with `| tail` swallowed lint exit code, или I misread the output.

**Root cause.** (a) Reviewer's check был performative, not verified. (b) Earlier
verification ran lint:ts/lint:all and trusted its exit code, but with `2>&1 | tail` —
bash pipeline exit code is the rightmost command (tail succeeds even if lint fails).

**Prevention.**
1. Skill instruction: reviewer agents должны run actual lint when claiming lint violations.
   Captured как input для improving subagent reviewer prompts.
2. Tooling: avoid `| tail` для lint/test commands; capture exit code explicitly. Better
   pattern: `pnpm lint:all 2>&1 | tee /tmp/out; echo "EXIT: $PIPESTATUS"`. Or
   `set -o pipefail` (когда session policy allows).
3. Add to `CLAUDE.md` под «Tooling environment»: «When piping pnpm commands through tail,
   capture `${PIPESTATUS[0]}` или use `set -o pipefail` to surface real exit codes.»

### Subagent task-completion verification used `| tail` and missed real failures

**What happened.** Wave 1 close (Task 13) ran `pnpm typecheck && pnpm lint:all && pnpm test 2>&1 | tail -3`.
Returned "test: Done" в output. Я reported all gates green. But — see previous pitfall —
brace-style violations were already in reference.ts at that point, and lint:all should
have failed. The `&&` short-circuit + `| tail` pipeline hid the failure.

Bug-deferred until Task 22a/22b when I ran the same command without tail and saw 24 errors.

**Root cause.** Sloppy gate-verification command construction для multi-step pipelines.
Same as pitfall above's prevention (b).

**Prevention.** Same as above. Specifically: codify "always check PIPESTATUS[0] (или use
pipefail) для `pnpm X && pnpm Y && pnpm Z | tail` patterns". Captured как automation
tech-debt — should be enforced via CLAUDE.md note или helper alias.

### V8 JIT deopt bug discovered late (Phase Wave 3, not Wave 2)

**What happened.** Plan Wave 2 close had smoke gate (quick mode, S only). Bug surfaced
only in Wave 3 Task 22 (bench:all eval mode). Forced unscheduled refactor + 2 extra
commits + 1 bug branch + 1 guideline entry. Schedule cost: ~30 min of investigation +
~10 min of refactor.

**Root cause.** Smoke coverage gap (see also "Smoke at S only" above). Compounded by
manual repro outside harness succeeding (which made debug harder).

**Prevention.** Per «Planning > Smoke at S only» recommendation: add eval-mode validation
to Wave 2 close protocol для JS-touch workloads. Specifically, future workloads that have
JS impls с per-entry dispatch should run at least one eval-mode case per workload before
Wave 2 close — even at a single size — to surface deopt patterns. This is broader than
«hashmap workload»: any future workload using `switch(entry)` or similar в hot loops
needs this.

Bug investigation deferred to next session — see `docs/superpowers/bug-reports/2026-05-23-v8-deopt-switch-over-closure-const.md`
+ branch `feature/phase-1.1.2-bug`. Workaround applied for current phase.

### `git stash` interactions с macOS sandbox restrictions silently fail

**What happened.** During lint investigation, I ran `git stash` to temporarily revert
working tree changes. The stash command had warnings about `.claude/settings.local.json`
being un-writable (sandbox), and the stash pop later failed silently. Working tree was left
в inconsistent state — refactored hashmap_int still modified, but hashmap_string reverted.
Had to re-write hashmap_string by hand using the same Write tool call.

Не блокировало progress but cost ~5 min of confusion.

**Root cause.** macOS sandbox prevents git from removing `.claude/settings.local.json` (which
is `denyWithinAllow`-listed). Stash creates a partial state that pop can't fully restore.

**Prevention.** Avoid `git stash` in sandboxed sessions. If a working-tree-modifying check
is needed, use `git diff <commit> -- <file>` or `git show <commit>:<file>` для inspection
without modifying working tree. Alternatively, copy files к `/tmp/` for inspection
(within sandbox-writable paths).

Captured к CLAUDE.md «Tooling environment»: «`git stash` interacts unpredictably с macOS
sandbox restrictions on `.claude/settings.local.json`. Prefer `git diff/show` для inspecting
historical states without modifying working tree.»

## Summary — где invest для future phases

1. **Plan author discipline:** compile-check Rust `const fn`/`static` blocks before
   committing plan. Document `LazyLock`/`SyncCell` patterns в plan template.
2. **Coverage discipline:** add eval-mode validation gate к Wave 2 close (catches JIT
   deopt patterns smoke misses).
3. **Pipeline discipline:** use `set -o pipefail` или explicit `PIPESTATUS` для gate
   commands. Avoid `| tail` masking real exit codes.
4. **Reviewer discipline:** subagent reviewers must run lint when claiming lint violations
   (not just pattern-match).
5. **IDE discipline (low priority):** add `.clangd` config для C++23 diagnostics.
6. **Process discipline:** avoid `git stash` in sandboxed Claude sessions.

Each recommendation has clear ownership: 1, 2 belong к spec/plan templates; 3, 4, 6 belong
к CLAUDE.md и/или subagent skill prompts; 5 is а small tech-debt item.
