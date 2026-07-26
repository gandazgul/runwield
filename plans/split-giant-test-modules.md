---
planId: "74e5e3f3-097a-4311-8e8a-5ab5deaf22f7"
classification: "FEATURE"
complexity: "HIGH"
summary: "Split five serial-heavy test modules along domain boundaries and teach the write-tests Skill to preserve focused, parallel-safe test modules."
affectedPaths:
    - "src/cmd/load-plan/index.test.js"
    - "src/cmd/load-plan/load-plan-test-helpers.js"
    - "src/cmd/load-plan/load-plan-*.test.js"
    - "src/ui/workspace/workspace.test.js"
    - "src/ui/workspace/workspace-test-helpers.js"
    - "src/ui/workspace/workspace-*.test.js"
    - "src/shared/workflow/validation.test.js"
    - "src/shared/workflow/validation-test-helpers.js"
    - "src/shared/workflow/*validation*.test.js"
    - "src/shared/workflow/review-diff-tool.test.js"
    - "src/shared/worktree.test.js"
    - "src/shared/worktree-test-helpers.js"
    - "src/shared/worktree-*.test.js"
    - "scripts/install.test.js"
    - "scripts/install-test-helpers.js"
    - "scripts/install-*.test.js"
    - "src/skills/write-tests/SKILL.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-24T18:21:58-04:00"
updatedAt: "2026-07-26T05:02:38.309Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-25T22:46:25.790Z"
verifiedAt: "2026-07-26T05:02:38.309Z"
executionReport: "- Split the five aggregate suites into focused destination modules with exact split-family inventory parity: load-plan 80, workspace 84, validation 73, worktree 44, install 8; removed the original aggregate test files.\n- Updated `src/skills/write-tests/SKILL.md` with language/framework-agnostic module-shaping guidance for behavioral boundaries, serial critical paths, and parallel-safe fixture extraction.\n- Resolved reviewer and merge-back issues without reintroducing production-only test hooks; bundled skill cache extraction now prunes stale cache entries while preserving current bundled skills for parallel readers.\n- Focused split-family suites passed for load-plan, workspace, validation/review-diff, worktree, install, and affected merge-repair tests.\n- Full-suite baseline warm runs before split were 28.29s, 24.39s, 36.61s (median 28.29s). After split they were 38.31s, 39.48s, 44.96s (median 39.48s), so the measured performance objective did not improve on this machine.\n- Shuffle stress was partially completed: seeds 101 and 202 passed; seed 303 exposed global-state ordering issues that were repaired during validation.\n- Final post-merge verification passed: `deno task ci` reported 1728 passed (9 steps) and 0 failed."
workRecord:
    status: "generated"
    recordId: "d00b50ee-721b-4e0f-a3d4-58ec2e4eb96d"
    path: "docs/work-records/2026-07-26-split-serial-heavy-test-suites.md"
    lastAttemptAt: "2026-07-26T04:57:29.112Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "52cda96cd02b1986d7126eaabc27e4368c4c134f"
    targetBranch: "main"
    targetHeadBeforeMerge: "621ab0279cd2f162333f059fbf82a16ef27ad322"
---

# Split Serial-Heavy Test Modules

## Context

RunWield's test tasks now use Deno's native module-level parallelism, but tests declared within one module remain
serial. Five modules currently concentrate 289 top-level tests and roughly 13,800 lines:

- `src/cmd/load-plan/index.test.js` — 80 tests;
- `src/ui/workspace/workspace.test.js` — 84 tests;
- `src/shared/workflow/validation.test.js` — 73 tests;
- `src/shared/worktree.test.js` — 44 tests;
- `scripts/install.test.js` — 8 expensive black-box tests.

These files can define the suite's critical path even when other modules have finished. A custom weighted scheduler and
historical timing store were considered, but the user explicitly chose the simpler structural solution: split all five
modules along existing behavioral/domain boundaries and update the bundled `write-tests` Skill so future test work does
not recreate mixed-responsibility serial bottlenecks.

## Objective

Expose the five concentrated suites to native Deno module parallelism without changing production behavior, test
coverage, assertions, or test names. Replace each aggregate test file with focused domain test modules and stateless
shared fixture helpers, remove hidden cross-test/module state that would make the split unsafe, and add
language/framework-agnostic test-module boundary guidance to the `write-tests` Skill.

## Approach

Treat this as a behavior-preserving test refactor. Capture the execution-time test-name inventory and a warm parallel
runtime baseline before moving code. Extract only fixture construction and test utilities that are genuinely shared by
multiple destination modules; keep domain-specific constants, typedefs, imports, and setup local. Shared helpers must
not own mutable singleton state.

Split each aggregate file as follows:

| Existing module                          | Focused destination modules                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cmd/load-plan/index.test.js`        | `load-plan-discovery.test.js`, `load-plan-epic.test.js`, `load-plan-execution.test.js`, `load-plan-review.test.js`, `load-plan-recovery.test.js`, `load-plan-session-lifecycle.test.js`, and `load-plan-hold.test.js`                                                                                             |
| `src/ui/workspace/workspace.test.js`     | `workspace-review.test.js`, `workspace-board.test.js`, `workspace-local-server.test.js`, `workspace-lifecycle.test.js`, `workspace-remote-storage.test.js`, `workspace-remote-server.test.js`, and `workspace-remote-review.test.js`                                                                              |
| `src/shared/workflow/validation.test.js` | `validation-prompts.test.js`, `mechanical-validation.test.js`, `validation-loop-core.test.js`, `validation-loop-repair.test.js`, `validation-loop-review.test.js`, `validation-loop-delivery.test.js`, `validation-loop-human-review.test.js`, `validation-loop-recovery.test.js`, and `review-diff-tool.test.js` |
| `src/shared/worktree.test.js`            | `worktree-creation.test.js`, `worktree-merge.test.js`, `worktree-merge-risk.test.js`, `worktree-plan-handoff.test.js`, and `worktree-guards.test.js`                                                                                                                                                              |
| `scripts/install.test.js`                | `install-platforms.test.js`, `install-integrity.test.js`, and `install-interaction.test.js`                                                                                                                                                                                                                       |

Use the existing behavior groupings:

- Load Plan discovery owns help, no-argument selection, ordering, empty/child-only lists, and sibling dependency
  resolution. Epic owns Epic details, done-enough behavior, child navigation, and next-child selection. Execution owns
  affected-path checks, dependency warnings, Ready For Work execution, and post-execution validation. Review owns
  planning/reapproval, execution-policy refresh, PROJECT rejection/decomposition, and denial. Recovery owns non-Git,
  failed/In-Progress/Implemented, worktree reset/inspection, and manual-merge behavior. Session lifecycle owns verified
  Plan actions and Agent Session restoration. Hold owns On-Hold Plan, Resume Check, parent/child warning, reset, and
  worktree deletion behavior.
- Workspace review owns token/review server, artifact read, Guided Review API, approval/feedback, images, and review
  expiry behavior. Board owns Plan serialization/grouping/search/detail metadata and pure rendering helpers. Local
  server owns local wrapper/API/SSR/body persistence. Lifecycle owns lifecycle intents, persisted actions, close, Resume
  Check, and Plan Workflow Lease responses. Remote storage owns capabilities, ciphertext persistence, retention, limits,
  and schema migration. Remote server owns mode/development gates, health/readiness/configuration, adapter lifetime, and
  SSR smoke behavior. Remote review owns encrypted comment projection, read-only rendering, annotations, and
  built-client assets.
- Validation prompts owns Manual QA and Reviewer prompt loading/contracts. Mechanical Validation owns local CI and
  Engineer repair attempts. Core Validation Loop owns non-Git execution, concurrent post-validation work, Agent
  restoration, progress, cancellation, and empty/Plan-only diff rejection. Repair owns paused/interrupted CI or Semantic
  Code Review repair and retry limits. Review owns workflow-baseline/cwd scoping, large-diff review, Reviewer errors,
  blank output, and retry. Delivery owns staging verified metadata, merge-back, rollback, and post-merge verification.
  Human review owns `always`/`ask`, feedback, exit, and merge ordering. Recovery owns cleanup policy, merge failure
  metadata, missing-target recovery, fail-closed publication, merge repair/retry, validation failure, and target
  advancement. Diff tooling owns parsing, listing, truncation, prompt packet, and `review_diff` tool behavior.
- Worktree creation owns path/branch resolution, creation/reuse, submodules, and target branch preparation. Merge owns
  publication, repaired merge worktrees, target advancement, dirty checkout handling, checkpoint/removal, and continuing
  resolved merges. Merge risk owns all non-mutating risk inspection. Plan handoff owns primary Plan path preservation
  and verified Plan/Epic metadata conflict behavior. Guards owns non-Git requirements and post-seal edit rejection.
- Installer platforms owns OS/architecture asset mapping plus PATH/idempotent installation. Integrity owns GitHub asset
  digest fallback, missing/corrupt checksums, missing executables, and required-versus-optional download failures.
  Interaction owns non-interactive PATH guidance and newly installed Snip filter setup.

After every test is moved, delete the five aggregate modules so Deno does not discover duplicate tests. Keep normal
`deno task test` and `workspace:test` task interfaces unchanged; this FEATURE relies on their existing `--parallel` and
`DENO_JOBS` behavior and adds no scheduler, timing history, or test-runner abstraction.

Update the `write-tests` Skill in its existing ordered workflow. Add one checkable module-shaping step under “Before You
Write”: group tests by behavioral/domain contract, inspect an existing module's responsibilities and runtime
concentration before appending, split mixed or serial-critical modules first, and extract parallel-safe shared fixtures.
The step is complete when every changed test has one clear domain home and unrelated behavior is not colocated merely to
reuse setup. Keep the guidance language/framework-agnostic and avoid a hard line-count threshold.

## Files to Modify

- `src/cmd/load-plan/index.test.js` — remove after all 80 current tests are assigned to focused modules.
- `src/cmd/load-plan/load-plan-test-helpers.js` — share `makeUi`, `makeRuntimeFixture`, `makeRuntimeContext`,
  `noOpRecordPlanEvent`, and Git fixture behavior without mutable module state.
- `src/cmd/load-plan/load-plan-{discovery,epic,execution,review,recovery,session-lifecycle,hold}.test.js` — own the Load
  Plan domains described above with minimal direct imports.
- `src/ui/workspace/workspace.test.js` — remove after all 84 current tests are assigned to focused modules.
- `src/ui/workspace/workspace-test-helpers.js` — share test environment/API context, Git, and JSON request/response
  helpers; do not centralize review registry state or static-asset mutation.
- `src/ui/workspace/workspace-{review,board,local-server,lifecycle,remote-storage,remote-server,remote-review}.test.js`
  — own the Workspace domains described above.
- `src/shared/workflow/validation.test.js` — remove after all 73 current tests are assigned to focused modules.
- `src/shared/workflow/validation-test-helpers.js` — share recorder/session construction, Git, no-op Plan Event/worktree
  handoff dependencies, and sample diff data. Replace the aggregate file's module-global `HostedSession` with a factory
  or destination-local Session so parallel modules cannot replace one another's event sink.
- `src/shared/workflow/validation-prompts.test.js`, `mechanical-validation.test.js`,
  `validation-loop-{core,repair,review,delivery,human-review,recovery}.test.js`, and `review-diff-tool.test.js` — own
  the Validation domains described above.
- `src/shared/worktree.test.js` — remove after all 44 current tests are assigned to focused modules.
- `src/shared/worktree-test-helpers.js` — share isolated Git repository setup, Git command execution, and immutable
  delivery evidence.
- `src/shared/worktree-{creation,merge,merge-risk,plan-handoff,guards}.test.js` — own the Worktree domains described
  above.
- `scripts/install.test.js` — remove after all eight current black-box tests are assigned to focused modules.
- `scripts/install-test-helpers.js` — share archive/checksum/fake-binary fixture construction and installer runners;
  every call must retain a unique temporary HOME, fixture tree, install directory, and cleanup responsibility.
- `scripts/install-{platforms,integrity,interaction}.test.js` — own the installer domains described above.
- `src/skills/write-tests/SKILL.md` — add the focused, parallel-safe test-module shaping step without RunWield-specific
  filenames or numeric size policy.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- The five aggregate test modules — preserve their test bodies, names, setup/cleanup, and assertions; this is a move and
  fixture-isolation refactor, not a rewrite of expected behavior.
- `Deno.makeTempDir`, `try/finally` cleanup, injected dependencies, and local fake collaborators already used by these
  suites — retain these isolation patterns in every destination module.
- `HostedSession` plus `createSessionRuntimeEvent` in the Validation tests — create isolated Sessions through a helper
  factory instead of sharing the current module-global Session.
- Existing `createTestEnv`, `createTestApiContext`, Git, and JSON helpers in the Workspace suite — extract only these
  stateless utilities and leave domain-specific imports with their tests.
- Existing installer fixture builders — extract them once so expensive scenarios can occupy separate Deno modules
  without duplicating shell fixture implementation.
- Deno native module parallelism and `DENO_JOBS` — use the existing test tasks rather than adding a custom scheduler.
- The current “Before You Write” sequence in `src/skills/write-tests/SKILL.md` — add one step with an explicit
  completion criterion, following the Skill's existing information hierarchy rather than duplicating guidance elsewhere.

## Implementation Steps

- [ ] Step 1: Before moving code, record the execution-time top-level test names/counts for each aggregate module and
      capture at least three warm `DENO_JOBS=4 deno task test` wall-clock runs. The current planning snapshot is
      80/84/73/44/8 tests (289 total); if concurrent work has changed it, use and report the newer inventory.
- [ ] Step 2: Extract `scripts/install-test-helpers.js`, create the three installer domain modules, run them together
      under `--parallel`, and remove `scripts/install.test.js` only after all baseline test names are present exactly
      once. Keep every shell fixture rooted in a unique temporary directory.
- [ ] Step 3: Extract `src/shared/worktree-test-helpers.js`, create the five Worktree domain modules, and remove
      `src/shared/worktree.test.js` after inventory parity. Preserve all execution-time changes already present in the
      source test, including submodule, merge publication, and post-seal coverage.
- [ ] Step 4: Extract `src/cmd/load-plan/load-plan-test-helpers.js`, create the seven Load Plan domain modules, and
      remove `index.test.js` after inventory parity. Keep recovery-only real Git/Plan Lifecycle imports out of
      lightweight menu and review modules.
- [ ] Step 5: Extract `src/shared/workflow/validation-test-helpers.js` with stateless recorder/session factories, then
      create the nine Validation domain modules and remove `validation.test.js` after inventory parity. Reset Settings
      in the modules that mutate them and ensure no `HostedSession`, event sink, deferred promise, or recorder is shared
      across destination modules.
- [ ] Step 6: Extract `src/ui/workspace/workspace-test-helpers.js`, create the seven Workspace domain modules, and
      remove `workspace.test.js` after inventory parity. Keep review decision registration paired with unregister
      cleanup, preserve isolated database/temp Project roots, and prevent multiple modules from writing a shared
      generated asset path.
- [ ] Step 7: Prune every destination module's imports, typedefs, constants, and fixtures to its domain. Use direct
      imports from shared test helpers, keep executable files as pure JavaScript/JSDoc, and verify helper filenames do
      not match Deno's test discovery suffixes.
- [ ] Step 8: Update `src/skills/write-tests/SKILL.md` with the agreed module-shaping step and completion criterion.
      Keep the Skill language/framework-agnostic, name behavioral/domain boundaries and serial critical paths, require
      parallel-safe fixture extraction, and avoid duplicating its existing determinism guidance or adding a numeric line
      cap.
- [ ] Step 9: Run each split family in a parallel invocation, then run repeated shuffled full-suite checks. Repair only
      fixture/isolation defects exposed by the split; do not change production semantics to accommodate moved tests.
- [ ] Step 10: Repeat at least three warm `DENO_JOBS=4 deno task test` measurements, compare the median with Step 1, and
      report per-family distribution and full-suite wall-clock results. If the median does not improve, inspect the new
      longest module and hidden serialization before claiming the performance objective is met.
- [ ] Step 11: Run the complete repository quality gate, inspect the final diff for accidental test deletion/duplication
      or unrelated production changes, and preserve unrelated working-tree edits.

## Verification Plan

- Automated inventory before and after: collect `Deno.test` names from each original module before deletion, collect
  them from its destination modules afterward, and compare sorted lists. Expected: exact one-to-one parity with the
  execution-time baseline (currently 289 top-level tests total), with no duplicate discovery.
- Automated focused suites:
  - `DENO_JOBS=4 deno task test src/cmd/load-plan`
  - `DENO_JOBS=4 deno task workspace:test`
  - `DENO_JOBS=4 deno task test src/shared/workflow/*validation*.test.js src/shared/workflow/review-diff-tool.test.js`
  - `DENO_JOBS=4 deno task test src/shared/worktree-*.test.js`
  - `DENO_JOBS=4 deno task test scripts/install-*.test.js`
  - Expected: every split family passes in parallel without shared HOME, cwd, Session, registry, database, generated
    asset, or temporary-directory interference.
- Automated ordering/race stress:
  `for seed in 101 202 303 404 505; do DENO_JOBS=4 deno task test --shuffle=$seed || exit 1; done`. Expected: all seeds
  pass with the same discovered test count.
- Automated performance: run at least three warm `DENO_JOBS=4 deno task test` measurements before and after the split
  and compare medians on the same machine with the same dependency cache. Expected: the after median is lower and no
  single destination recreates one of the former aggregate critical paths. Report measurements rather than adding a
  machine-specific percentage gate.
- Automated complete gate: `deno task ci`. Expected: formatting, checks, Workspace checks, lint, all tests, and release
  checks pass; fix all issues introduced by the refactor.
- Manual: no browser or user workflow verification is required because production behavior and UI are unchanged. Review
  the final test inventory/diff and benchmark report to confirm the change consists of test moves, isolated fixture
  helpers, and the `write-tests` Skill guidance.
- Execution policy matrix:
  - This FEATURE is Engineer-owned with autonomous collaboration because it is a non-visual test-architecture and Skill
    refactor; no dev server or headed-browser verification is needed.

## Edge Cases & Considerations

- Splitting modules changes isolation boundaries and can reveal state that was accidentally shared in serial order.
  Replace such coupling with explicit per-test/per-module fixture state; never preserve it through a mutable shared
  helper singleton.
- Validation's current module-global `HostedSession` has its event sink replaced by `makeUi`. It must not survive in a
  shared helper. Each destination module or test context needs an independently constructed Session and recorder.
- Workspace review registration, environment fakes, SQLite databases, Deno servers, and the remote-review generated
  asset path require paired cleanup. Keep colliding operations in one module or give them unique temporary paths.
- Worktree tests invoke real Git and can be resource-intensive in parallel. Preserve unique repositories and use
  `DENO_JOBS` for constrained machines; do not reintroduce serial aggregation solely to reduce peak load.
- Installer tests depend on shell tools and intentionally perform expensive archive/process work. Shared helper code is
  appropriate, but all writable paths and logs must remain fixture-local so the three modules can overlap safely.
- Test file moves can leave stale imports or accidentally make a helper discoverable as a test. Helper filenames must
  end in `-test-helpers.js`, not `.test.js` or `_test.js`.
- Preserve test names and observable assertions unless an isolation defect makes the old test invalid. Any semantic
  expectation change is outside this refactor and must be reported rather than folded into the move.
- The Skill remains language/framework-agnostic. “Large” is determined by mixed behavioral ownership or serial runtime
  concentration, not a universal line count.
- No custom worker scheduler, historical timing file, CI sharding, or production-code refactor is in scope.
