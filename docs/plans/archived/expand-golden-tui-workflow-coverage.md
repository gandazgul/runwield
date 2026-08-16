---
planId: "45b61121-a250-4ff6-9fdd-38dd488630c4"
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "HIGH"
summary: "Expand Golden TUI workflow coverage around Plan lifecycle recovery, Epic completion, contention, delivery modes, and abandon-worktree feedback."
affectedPaths:
    - "src/ui/tui/testing/scenario-runner.js"
    - "src/ui/tui/testing/coverage-matrix.js"
    - "src/ui/tui/testing/scripted-review-surface.js"
    - "src/ui/tui/golden-scenarios/catalog.js"
    - "src/ui/tui/golden-scenarios/project-workflow.js"
    - "src/ui/tui/golden-scenarios/planned-change-workflow.js"
    - "src/ui/tui/golden-scenarios/role-journeys.js"
    - "src/ui/tui/golden-scenarios/load-plan-workflow.ts"
    - "src/ui/tui/golden-scenarios/load-plan-workflow.test.ts"
    - "src/ui/tui/golden-scenarios/concurrent-workflow.ts"
    - "src/ui/tui/golden-scenarios/concurrent-workflow.test.ts"
    - "src/cmd/load-plan/index.js"
    - "src/cmd/load-plan/load-plan-recovery.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-01T00:00:50-04:00"
updatedAt: "2026-08-02T04:16:00.481Z"
archivedAt: "2026-07-01"
status: "verified"
origin: "internal"
implementedAt: "2026-08-01T05:36:07.961Z"
verifiedAt: "2026-08-02T04:15:18.180Z"
userVerifiedAt: null
workRecord:
    status: "generated"
    recordId: "ea5577c7-d380-459c-987b-2a409ee9f509"
    path: "docs/work-records/2026-08-02-expanded-golden-tui-workflow-coverage.md"
    lastAttemptAt: "2026-08-02T04:15:54.670Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "5dfa9ad8dd98171307eb22c5c2494a2f0119a076"
    targetBranch: "main"
    targetHeadBeforeMerge: "ba88fbdfcd7613b7e30170db38a4148c3f6444bd"
routingIntent: "PLANNED_CHANGE"
sessionName: "golden tui coverage plan"
validationCiAttempts: 0
validationSemanticRounds: 2
---

# Expand Golden TUI Workflow Coverage

## Context

The Golden TUI portfolio already exercises the basic Router/role journeys, a PLANNED_CHANGE happy path with Reviewer
repair, and a two-child PROJECT continuation. The newly broken seams are deeper lifecycle paths: the last child of an
Epic advancing the parent and producing Work Records, recovery after process interruption, concurrent Plan execution in
one Project, `/load-plan` preconditions/actions, validation failure retries, Direct Delivery durability, non-Git
in-place execution, malformed Front Matter, and user feedback during slow worktree abandonment.

Repository evidence found during planning:

- `src/ui/tui/golden-scenarios/project-workflow.js` currently verifies two child Plans but does not assert the parent
  Epic's terminal `verified`/done-enough state, parent Work Record state, or full `.wld/worktrees.json` drain after the
  final child.
- `src/ui/tui/testing/scenario-runner.js` has useful observation actions (`assertWorkflowDurability`,
  `captureProjectDurability`, `generateWorkRecord`) but needs stronger actions for restarting the TUI, capturing real
  `/load-plan` prompts, non-Git fixture setup, concurrent sessions, Work Record observation, and project
  worktree-registry parsing.
- `src/cmd/load-plan/index.js` does the slow `removeWorktreeGitArtifacts`/branch deletion in the `abandon` recovery path
  before any progress message, so a user can stare at an apparently blank/busy TUI until the final success message
  appears.
- Existing unit tests under `src/cmd/load-plan/` and `src/shared/workflow/` cover many individual preconditions, but the
  user-visible `/load-plan` TUI path is not covered end-to-end.
- The working tree already contains uncommitted Golden TUI changes in `planned-change-workflow.js`,
  `planned-change-workflow.test.js`, `coverage-matrix.js`, and `scripted-review-surface.js`; implementation must
  preserve or consciously replace those changes instead of overwriting them blindly.

## Objective

Add Golden TUI end-to-end coverage that fails on the recent lifecycle/recovery regressions and improve `/load-plan`
abandon-worktree feedback so users see immediate progress during slow deletion.

The finished change must prove:

- final child verification advances the parent Epic, creates/records Work Record evidence, and leaves no worktree
  registry residue;
- reopening after an interrupted child execution shows actionable recovery choices from current state, not stale
  snapshots;
- two Plans can execute concurrently in one Project without Plan identity/backfill or registry-lock ordering failures;
- core `/load-plan` actions work through the TUI, not only unit seams;
- validation failure, retry, and exhausted-round paths are visible and stateful;
- QUICK_FIX and non-Git in-place delivery modes leave the expected durable filesystem/state evidence;
- read-only/materialization mutation policies are asserted against the filesystem;
- malformed Plan Front Matter fails closed without lifecycle mutation; and
- choosing recovery `abandon` immediately tells the user what RunWield is doing before the slow worktree removal
  completes.

## Approach

Expand the Golden TUI portfolio in two layers:

1. Strengthen the Golden harness with observation/restart/concurrency actions that still use production RunWield paths.
   These should observe real state and drive real TUI commands; they must not fake Plan lifecycle writes, worktree
   registry settlement, Work Record generation, or `/load-plan` decisions.
2. Add targeted scenarios grouped by product journey. Prefer short seeded-state `/load-plan` scenarios for menu/action
   coverage and reserve full Plan Review → execution → validation journeys for the high-value lifecycle and delivery
   seams.

The abandon feedback fix is intentionally small: emit a visible progress message immediately after confirmation and
before `removeWorktreeGitArtifacts`, then keep the existing final success/fallback messages.

## Files to Modify

- `src/ui/tui/testing/scenario-runner.js` — add reusable Golden actions for restarting a TUI in the same isolated
  Project, launching/capturing a second concurrent TUI/session, selecting real `/load-plan` prompts, removing/omitting
  Git for non-Git fixtures, capturing `.wld/worktrees.json`, capturing Work Records without generating them, and
  asserting Plan/registry/Work Record state.
- `src/ui/tui/testing/scripted-review-surface.js` — keep/extend scripted interaction support so a scripted user can
  inspect prompt labels/options, make project edits before answering, and confirm destructive recovery actions.
- `src/ui/tui/testing/coverage-matrix.js` — add required Golden capabilities for Epic completion, `/load-plan` actions,
  interrupted recovery, concurrent Plan execution, validation failure/retry/exhaustion, QUICK_FIX delivery, non-Git
  in-place execution, malformed Plan Front Matter, and abandon progress feedback.
- `src/ui/tui/golden-scenarios/catalog.js` — register the new scenario modules in the portfolio and extensive suite.
- `src/ui/tui/golden-scenarios/project-workflow.js` — strengthen the existing two-child Epic scenario or add a sibling
  scenario that waits for parent advancement and asserts Work Record plus full registry drain after the final child.
- `src/ui/tui/golden-scenarios/planned-change-workflow.js` — add validation failure/retry/exhaustion scenarios and
  ensure PLANNED_CHANGE registry assertions inspect the project worktree registry, not only the home registry directory.
- `src/ui/tui/golden-scenarios/role-journeys.js` — extend QUICK_FIX coverage from Mechanical Validation text to durable
  file/Git/no-registry state after completion; keep filesystem mutation-policy assertions for Guide and Ideator.
- `src/ui/tui/golden-scenarios/load-plan-workflow.ts` and `src/ui/tui/golden-scenarios/load-plan-workflow.test.ts` — add
  end-to-end `/load-plan` scenarios for hold/resume, reset-to-draft, re-review, user-verify with Work Record, archive,
  recovery inspect/reset/abandon, abandon progress feedback, and malformed Front Matter.
- `src/ui/tui/golden-scenarios/concurrent-workflow.ts` and `src/ui/tui/golden-scenarios/concurrent-workflow.test.ts` —
  add a concurrent Project scenario with two executable Plans active in one Project and assertions for Plan IDs,
  registry lock ordering, delivery evidence, and registry drain.
- `src/cmd/load-plan/index.js` — add immediate progress feedback for recovery `abandon` before slow worktree and branch
  deletion begins.
- `src/cmd/load-plan/load-plan-recovery.test.js` — add a focused regression test for abandon progress message ordering
  in the load-plan recovery path.

## Reuse Opportunities

- `src/ui/tui/testing/scenario-runner.js` — reuse `createInteractiveTuiComposition`, `VirtualTerminal`,
  `waitForPlanStatus`, `assertWorkflowDurability`, `captureProjectDurability`, and child-process diagnostics patterns.
- `src/ui/tui/testing/isolated-environment.js` — reuse isolated `HOME`, `RUNWIELD_HOME`, faux model setup, and Git
  fixture setup; extend it rather than building a parallel Golden fixture.
- `src/ui/tui/testing/scripted-review-surface.js` — reuse `ScriptedInteractionSurface` prompt scripting for `/load-plan`
  select/text prompts.
- `src/shared/work-records/auto-generation.js` and `src/shared/work-records/store.js` — observe production Work Record
  outcomes; do not synthesize Golden-only record files.
- `src/shared/worktree-registry.js` — parse and assert the production worktree registry shape instead of grepping JSON
  text.
- `src/cmd/load-plan/load-plan-*.test.js` — mirror existing seeded Plan/recovery states when setting up Golden
  `/load-plan` journeys, but drive them through the TUI slash command.
- `src/shared/workflow/orchestrator.js` and `src/shared/workflow/workflow.js` — reuse production QUICK_FIX,
  PLANNED_CHANGE, and non-Git execution flows.

## Implementation Steps

- [ ] `src/ui/tui/testing/scenario-runner.js` can restart the composed TUI within the same isolated Project/HOME while
      preserving the faux provider script queue, Project files, session store, and diagnostics; the restart action
      records an event such as `tui:restarted` and the subsequent typed `/load-plan ...` command is processed by a fresh
      composition.
- [ ] `src/ui/tui/testing/scenario-runner.js` can run two Golden TUI sessions against the same Project concurrently,
      each with its own `VirtualTerminal`, while sharing the production SessionRuntime/storage/locks; assertions can
      read both terminals' scrollback and both sessions' final state.
- [ ] Golden observation actions parse `.wld/worktrees.json` and Work Record storage through production helpers and
      expose `registryEntries`, `nonTerminalRegistryEntries`, `workRecordNames`, and per-Plan `planId`/status snapshots
      in `result.state`.
- [ ] The Golden environment supports a non-Git Project mode for one scenario without deleting or corrupting Git in
      other scenarios; non-Git setup still uses the isolated `HOME`/`RUNWIELD_HOME` and faux model configuration.
- [ ] `src/ui/tui/testing/coverage-matrix.js` declares and the portfolio asserts new capabilities for
      `durable:epic-completion`, `workflow:load-plan`, `recovery:interrupted-execution`, `recovery:load-plan-worktree`,
      `workflow:concurrent-plans`, `recovery:validation-failure-retry`, `recovery:validation-exhausted`,
      `durable:quick-fix-delivery`, `durable:non-git-in-place`, `recovery:malformed-plan-front-matter`, and
      `block:abandon-progress`.
- [ ] The Epic Golden scenario proves this exact chain without harness lifecycle writes: second/last child reaches
      `verified` or `user_verified`; parent Epic reaches `verified` with `epicCompletionMode: done_enough`; Work Record
      storage contains a record for the completed Epic or its completed-source closure as produced by RunWield;
      `.wld/worktrees.json` has zero remaining entries; both child files are delivered and tracked on the primary
      branch.
- [ ] The interrupted recovery scenario starts a child Plan execution far enough to create durable active worktree
      metadata, stops/restarts the TUI before `task_completed`, runs `/load-plan epic`, selects the active
      child/recovery path, and asserts the recovery prompt includes current actionable options (`inspect`, `continue`,
      `reset`, `abandon`, `review`, `user_verify`, `hold`, `cancel` as applicable) without stale-snapshot or
      precondition error text.
- [ ] The concurrent Plans scenario starts two Plans under one Project before either finishes, lets both run through
      implementation and validation, and asserts both Plans have stable non-empty `planId` values, registry attempts
      record the correct Plan identity, no Plan Front Matter changed underneath a transaction, both delivery artifacts
      are tracked, and the registry is fully drained at the end.
- [ ] `/load-plan` Golden scenarios cover hold/resume, reset-to-draft, re-review, user-verify, archive, worktree
      recovery inspect/reset/abandon, and malformed Plan Front Matter via typed slash commands and scripted prompts;
      each scenario asserts both visible TUI feedback and durable filesystem/Front Matter outcomes.
- [ ] Validation Golden scenarios cover CI failure followed by Engineer repair and retry success, and a separate
      exhausted-round path that leaves the Plan in the documented failed/recoverable state with visible failure
      guidance; assertions count attempts and confirm the active workflow/Plan state does not silently reset.
- [ ] QUICK_FIX Golden coverage writes a real file in the Engineer turn and, after Mechanical Validation, asserts the
      file exists in the primary checkout, expected Git status/tracking behavior is recorded for the current product
      semantics, no Plan file is created, no worktree registry entry remains, and the TUI is usable again.
- [ ] Non-Git in-place PLANNED_CHANGE Golden coverage approves a Plan in a non-Git Project, confirms the non-Git prompt,
      runs implementation and validation in the project root, and asserts `executionMode: non_git_in_place`, non-Git
      Delivery Evidence, absence of worktree registry entries, delivered file contents, and final verified/user-visible
      state.
- [ ] Guide and Ideator mutation-policy assertions are filesystem-based: Guide leaves the initial Project snapshot
      unchanged; Ideator changes only the PRD path and expected parent directories; scenario failure output lists
      unexpected added/modified/deleted paths.
- [ ] `src/cmd/load-plan/index.js` emits an immediate RunWield system message after `Delete/abandon` confirmation and
      before worktree removal begins, for example `Deleting recorded worktree for "<plan>"...`; the existing final
      messages still distinguish fully removed worktrees from metadata-only abandon when Git is unavailable.
- [ ] A targeted `src/cmd/load-plan/load-plan-recovery.test.js` regression test proves the abandon progress message is
      appended before the fake slow `removeWorktreeGitArtifacts` promise resolves and before the final
      `Worktree abandoned and removed.` message.
- [ ] No new Golden scenario is skipped/ignored; timeouts are set from measured worst-case runtime, and diagnostics
      preserve enough state to debug prompt options, registry entries, Work Records, and terminal text on failure.

## Verification Plan

- Automated: run the new focused Golden suites:
  - `deno run -A scripts/run-tests.js -A --no-check src/ui/tui/golden-scenarios/project-workflow.test.js src/ui/tui/golden-scenarios/planned-change-workflow.test.js src/ui/tui/golden-scenarios/load-plan-workflow.test.ts src/ui/tui/golden-scenarios/concurrent-workflow.test.ts src/ui/tui/golden-scenarios/role-journeys.test.js src/ui/tui/golden-scenarios/coverage.test.js`
  - `deno run -A scripts/run-tests.js -A --no-check src/cmd/load-plan/load-plan-recovery.test.js`
- Automated: run the whole Golden portfolio: `deno task test:golden-tui`.
- Automated: run the full project gate: `deno task ci`.
- Objective-failing checks:
  - `deno run -A scripts/run-tests.js -A --no-check src/ui/tui/golden-scenarios/load-plan-workflow.test.ts` must fail
    against today's code because the file/scenarios do not exist and must pass only when `/load-plan` TUI journeys are
    covered.
  - `grep -R "durable:epic-completion\|workflow:concurrent-plans\|durable:non-git-in-place\|block:abandon-progress" src/ui/tui/testing/coverage-matrix.js src/ui/tui/golden-scenarios`
    must find declared and asserted Golden capabilities.
  - The Epic Golden assertion must mechanically check `parent.status === "verified"`,
    `parent.epicCompletionMode === "done_enough"`, `registryEntries.length === 0`, and at least one Work Record under
    `docs/work-records/`; it must not accept only screen text or only terminal registry statuses.
  - The abandon progress test must assert message ordering: progress message index `<` final success message index, with
    `removeWorktreeGitArtifacts` unresolved when the progress message is observed.
- Manual: run the abandon recovery flow in a disposable Git project with a recoverable Plan worktree, choose
  `Delete/abandon worktree`, confirm, and verify the TUI immediately shows progress before deletion completes and then
  shows the terminal result.
- Expected results: Golden failures should print the prompt options, screen/scrollback, Plan statuses, Work Record list,
  `.wld/worktrees.json` entries, and relevant session diagnostics so a stale snapshot/precondition regression is
  debuggable from the artifact.
- Existing behavior to preserve: current Golden role journeys, Plan Review approval/feedback flow, Reviewer rejection
  repair flow, uncommitted-user-work pause/retry flow, Direct Delivery ancestry checks, and TUI slash-command busy guard
  must continue to pass. The busy guard should still reject a second slash command while abandon is running; the
  improvement is that the user sees what is running.
- Behavior expected to stop existing: the recovery abandon path must no longer be silent between destructive
  confirmation and final completion.

## Edge Cases & Considerations

- Concurrency scenarios can be flaky if they rely on exact scheduling. Gate them on deterministic barriers: both
  sessions must reach active worktree metadata before either is allowed to call `task_completed`, then both may proceed.
- Do not fake RunWield-owned machinery. Harness actions may seed input Plans and observe state, but Plan Lifecycle
  transitions, registry writes, Work Record generation, Direct Delivery, and `/load-plan` choices must run through
  production code.
- Avoid making the default Golden suite excessively slow. If a scenario becomes too long, shorten setup with seeded
  Plans at the correct lifecycle boundary rather than skipping the test or replacing product transitions with fakes.
- Malformed Front Matter must fail closed: no status updates, no registry deletion, no Work Record, and a user-readable
  repair message.
- Non-Git in-place coverage must not leak consent/settings into other scenarios because the isolated `HOME` is reused
  only within one scenario.
- The current dirty working tree includes partial Golden TUI changes; implementation should inspect and preserve them
  before editing overlapping files.
