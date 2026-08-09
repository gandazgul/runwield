---
planId: "40fbf2d7-4068-42c5-8841-61331361a950"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Show visible Plan execution preparation checkpoints and keep the TUI busy spinner active while deterministic setup runs"
affectedPaths:
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/execution-preparation-progress.ts"
    - "src/shared/workflow/execution-progress.test.ts"
    - "src/ui/tui/runtime-interaction-adapter.js"
    - "src/ui/tui/runtime-interaction-adapter.test.js"
    - "src/cmd/load-plan/load-plan-execution.test.js"
    - "src/shared/session/session-runtime.test.js"
objectiveChecks:
    - id: "OC1"
      command: "test -f src/shared/workflow/execution-preparation-progress.ts && test -f src/shared/workflow/execution-progress.test.ts && grep -q \"execution preparation progress\" src/shared/workflow/execution-progress.test.ts && grep -q \"running Plan Objective-Failing Check baseline\" src/shared/workflow/execution-preparation-progress.ts && deno run -A scripts/run-tests.js src/shared/workflow/execution-progress.test.ts"
      rationale: "The workflow progress helper and targeted tests do not exist today; this passes only when execution-preparation checkpoint output is implemented and covered."
    - id: "OC2"
      command: "grep -Fq \"uiAPI.setBusy?.(true)\" src/ui/tui/runtime-interaction-adapter.js && grep -q \"Plan Review restores busy before Approve & Run execution resumes\" src/ui/tui/runtime-interaction-adapter.test.js && deno run -A scripts/run-tests.js src/ui/tui/runtime-interaction-adapter.test.js"
      rationale: "Approve & Run currently leaves the TUI busy spinner paused after Plan Review; this passes only when the adapter restores busy and the regression test passes."
    - id: "OC3"
      command: "grep -q \"load-plan proceed surfaces execution preparation progress\" src/cmd/load-plan/load-plan-execution.test.js && deno run -A scripts/run-tests.js src/cmd/load-plan/load-plan-execution.test.js"
      rationale: "The load-plan Proceed with execution path lacks assertions for visible preparation messages today; this passes only when that user flow is covered and passing."
objectiveChecksBaseline:
    recordedAt: "2026-08-03T01:43:22.059Z"
    head: "fb8a7a193c08031135de9ed39fc629284106692f"
    results:
        - id: "OC1"
          command: "test -f src/shared/workflow/execution-preparation-progress.ts && test -f src/shared/workflow/execution-progress.test.ts && grep -q \"execution preparation progress\" src/shared/workflow/execution-progress.test.ts && grep -q \"running Plan Objective-Failing Check baseline\" src/shared/workflow/execution-preparation-progress.ts && deno run -A scripts/run-tests.js src/shared/workflow/execution-progress.test.ts"
          rationale: "The workflow progress helper and targeted tests do not exist today; this passes only when execution-preparation checkpoint output is implemented and covered."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 8
          output: "\n"
        - id: "OC2"
          command: "grep -Fq \"uiAPI.setBusy?.(true)\" src/ui/tui/runtime-interaction-adapter.js && grep -q \"Plan Review restores busy before Approve & Run execution resumes\" src/ui/tui/runtime-interaction-adapter.test.js && deno run -A scripts/run-tests.js src/ui/tui/runtime-interaction-adapter.test.js"
          rationale: "Approve & Run currently leaves the TUI busy spinner paused after Plan Review; this passes only when the adapter restores busy and the regression test passes."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 11
          output: "\n"
        - id: "OC3"
          command: "grep -q \"load-plan proceed surfaces execution preparation progress\" src/cmd/load-plan/load-plan-execution.test.js && deno run -A scripts/run-tests.js src/cmd/load-plan/load-plan-execution.test.js"
          rationale: "The load-plan Proceed with execution path lacks assertions for visible preparation messages today; this passes only when that user flow is covered and passing."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 13
          output: "\n"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-02T21:34:25-04:00"
status: "verified"
origin: "internal"
implementedAt: "2026-08-03T02:14:12.634Z"
verifiedAt: "2026-08-03T13:49:36.891Z"
userVerifiedAt: null
executionReport: "- Implemented execution-preparation progress: added typed `execution-preparation-progress.ts` helpers and wired `workflow.js` to emit truthful RunWield system statuses for fresh worktree creation, reused worktrees, non-Git in-place execution, Objective-Failing Check baseline runs, Plan materialization/restoration/reconciliation, Plan status update, and Engineer/Frontend Engineer launch.\n- Fixed Approve & Run busy feedback: `runtime-interaction-adapter.js` now restores the TUI busy spinner only after approved `run` Plan Reviews, avoiding stuck-busy behavior for approve-for-later flows.\n- Added/updated tests with test-count delta +5: new `execution-progress.test.ts` has 4 new behavior tests; `session-runtime.test.js` adds 1 busy workflow-operation test; existing `runtime-interaction-adapter.test.js` and `load-plan-execution.test.js` were rewritten/strengthened for the new behavior, with no tests removed.\n- Verification passed: `deno run -A scripts/run-tests.js src/shared/workflow/execution-progress.test.ts`; targeted suite for runtime interaction/session/load-plan; all three Objective-Failing Checks; `deno task test` passed on retry after an initial transient npm node_modules lock-message failure in `src/cmd/help/index.test.ts` was rerun cleanly; `deno task seams:check` passed.\n- Manual TUI checks from the Verification Plan were not performed because this API session is non-interactive/no live TUI; automated coverage exercises the corresponding status and busy-state flows."
workRecord:
    status: "generated"
    recordId: "5bef62b8-2631-4361-b6d5-d7eae25af0be"
    path: "docs/work-records/2026-08-03-execution-preparation-progress-and-approve-run-busy-spinner-fix.md"
    lastAttemptAt: "2026-08-03T13:49:43.833Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "3b2c7cc810e091ac85a522072613a54b92ab95fa"
    targetBranch: "main"
    targetHeadBeforeMerge: "c519861de4e38eed08562d0ea85f6d9a2dddf1cb"
routingIntent: "PLANNED_CHANGE"
sessionName: "plan execution progress"
validationCiAttempts: 0
validationSemanticRounds: 1
updatedAt: "2026-08-09T04:59:56.783Z"
archivedAt: "2026-08-09T04:59:56.783Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/show-execution-preparation-progress.md"
---

# Show Execution Preparation Progress

## Context

Plan execution currently emits the high-level `RunWield === Executing Plan: <plan-name> ===` status before deterministic
setup, but the user does not see clear progress while RunWield checks the Objective-Failing Check baseline, prepares the
execution worktree, records Plan Lifecycle state, and launches the execution Agent. In the TUI, Approve & Run can also
leave the visible busy spinner stopped because the browser Plan Review interaction deliberately calls
`uiAPI.setBusy(false)` while the user reviews the Plan, then returns into the same runtime turn without a new
`BUSY_CHANGED: true` event.

The intended outcome is that both execution entry points are visibly alive:

- **Approve & Run** from the Review Loop resumes the `Thinking...` spinner once the browser review returns to RunWield
  workflow work, then shows deterministic preparation checkpoints before the Engineer turn.
- **`load-plan` → Proceed with execution** uses the existing `SessionRuntime.executePlan` busy operation and shows the
  same preparation checkpoints before the Engineer turn.

One requested ordering needs a small correction: for a fresh Git worktree, RunWield must create the execution worktree
before running Objective-Failing Check baseline commands, because the baseline must run in the unmodified execution tree
at the selected base commit. The status text should therefore say that RunWield is preparing/creating the worktree
before it says the baseline commands are running. For a reusable worktree or non-Git in-place execution, the messages
should describe the actual path rather than claiming a new worktree was created.

## Objective

Add user-visible RunWield system-status checkpoints for deterministic Plan execution preparation and ensure the TUI busy
spinner is active while those checkpoints are emitted. The messages must be accurate for fresh worktree, reused
worktree, and non-Git in-place execution paths, and the same behavior must be covered for Approve & Run and `load-plan`
Proceed with execution.

## Approach

Introduce a small workflow-owned progress helper that emits RunWield `SYSTEM_STATUS` events for execution preparation
milestones, then call it from `startActiveExecutionWorkflow` and immediately before `runEngineerWithPlan`. Keep truth
ownership unchanged: Plan Lifecycle writes still go through `recordPlanEvent`, worktree registry writes still go through
existing worktree/registry functions, and status messages remain projections only.

Use these checkpoint messages, with exact names adjusted only for grammar and available evidence:

1. `=== Executing Plan: <plan-name> ===` — keep the existing header in `executePlan`.
2. `preparing execution target...` — after execution policy/status has been accepted and before Git/non-Git preparation
   starts.
3. Fresh Git worktree: `creating execution worktree from base branch <branch-or-ref>...` before
   `createWorktreeGitArtifacts`, then `created worktree <worktree-branch> from base branch <base-branch-or-ref>.` after
   creation.
4. Reused Git worktree: `reusing worktree <worktree-branch> from base branch <base-branch-or-ref>.`
5. Non-Git path: `preparing in-place execution because Git is unavailable...` after the user has approved non-Git
   execution.
6. `running Plan Objective-Failing Check baseline...` immediately before `ensureObjectiveChecksBaseline` runs.
7. `materializing Plan in execution worktree...` before `ensureExecutionPlanFile`; if the file is restored or
   reconciled, follow with the existing plain-English restoration/reconciliation meaning in the message.
8. `updating Plan status to in_progress...` immediately before recording the `execution_started` Plan Event.
9. `launching <Engineer|Frontend Engineer> to execute...` after active workflow context is committed and immediately
   before the execution Agent turn starts.

The busy-spinner fix should be narrow:

- Do not make `workflow.js` mutate TUI state directly.
- Keep `SessionRuntime` as the owner of busy state for `load-plan` and other public workflow operations.
- In `runtime-interaction-adapter.js`, after a Plan Review interaction returns, restore `uiAPI.setBusy(true)` before
  returning control to the active runtime turn. This reverses the adapter's own temporary `setBusy(false)` pause; the
  runtime will still emit the final idle transition when the turn or workflow operation actually settles.

## Files to Modify

- `src/shared/workflow/execution-preparation-progress.ts` — new TypeScript helper that centralizes execution-preparation
  checkpoint message construction and emits RunWield `SYSTEM_STATUS` events without owning lifecycle state.
- `src/shared/workflow/workflow.js` — call the progress helper from `executePlan`, `startActiveExecutionWorkflow`,
  fresh/reused/non-Git preparation branches, baseline checks, Plan file materialization, Plan Lifecycle event recording,
  and the handoff into `runEngineerWithPlan`.
- `src/shared/workflow/execution-progress.test.ts` — new focused tests for checkpoint message order and message accuracy
  across fresh worktree, reusable worktree, Objective-Failing Check baseline rejection, and non-Git in-place preparation
  where feasible with existing fixtures.
- `src/ui/tui/runtime-interaction-adapter.js` — restore the visible busy spinner after Plan Review returns so Approve &
  Run shows deterministic execution-preparation activity.
- `src/ui/tui/runtime-interaction-adapter.test.js` — cover the Plan Review busy pause/resume behavior, including
  approval that returns to workflow execution.
- `src/cmd/load-plan/load-plan-execution.test.js` — assert that `load-plan` Proceed with execution surfaces the same
  RunWield preparation checkpoint messages while using the real `SessionRuntime.executePlan` path.
- `src/shared/session/session-runtime.test.js` — add or strengthen coverage that runtime workflow operations keep the
  session snapshot/event stream busy while Plan execution preparation is in progress.

## Reuse Opportunities

- `src/shared/session/session-runtime-events.js` — reuse `emitSystemStatus`; do not introduce a second UI event path for
  progress messages.
- `src/shared/session/session-runtime.js` — reuse the existing reference-counted workflow busy operation for
  `runtime.executePlan` rather than adding TUI-specific calls inside workflow code.
- `src/ui/tui/api.js` and `src/ui/tui/blocks.js` — reuse existing `appendSystemMessage` coalescing and `SpinnerBlock`
  rendering; consecutive RunWield system statuses already appear in one system message block when style/error state
  matches.
- `src/shared/workflow/objective-checks.ts` — keep baseline execution and rejection behavior unchanged; only surround it
  with status projection messages.
- `src/shared/workflow/workflow.test.js` and `src/cmd/load-plan/load-plan-execution.test.js` fixtures — reuse real
  Git/worktree/Plan Lifecycle fixtures; do not add dependency-bag seams for RunWield-owned lifecycle or registry
  machinery.

## Implementation Steps

- [ ] `src/shared/workflow/execution-preparation-progress.ts` exports typed helpers for formatting and emitting
      execution preparation checkpoint messages; callers cannot pass arbitrary untyped milestone objects, and every
      emitted event uses `emitSystemStatus(..., { header: "RunWield" })`.
- [ ] `executePlan` still emits exactly one `=== Executing Plan: <plan-name> ===` header before execution preparation,
      and subsequent checkpoint statuses are emitted consecutively so the TUI coalesces them into the same RunWield
      system message block.
- [ ] Fresh Git worktree preparation emits a truthful worktree sequence: preparing target, creating execution worktree
      from the resolved base branch/ref, created/reused worktree with branch evidence, running the Objective-Failing
      Check baseline after worktree creation, materializing the Plan file, updating Plan status, and launching the
      resolved execution Agent.
- [ ] Reused worktree preparation emits `reusing worktree ...` and never claims a new worktree was created;
      Objective-Failing Check baseline still runs or is trusted according to the existing baseline matching logic.
- [ ] Non-Git in-place preparation emits in-place wording, runs the Objective-Failing Check baseline against the project
      checkout, updates Plan status, and launches the resolved execution Agent without mentioning worktree creation.
- [ ] Objective-Failing Check baseline rejection still reopens the Plan for Planner/Architect revision and preserves
      existing feedback, Plan status, and worktree cleanup behavior; the only user-visible addition before rejection is
      the baseline-running checkpoint and the existing failure message.
- [ ] `runEngineerWithPlan` emits `launching <Agent display name> to execute...` only after
      `hostedSession.setActiveExecutionWorkflow(activeWorkflow)` has committed, so the message cannot claim launch
      before execution context exists.
- [ ] `runtime-interaction-adapter.js` restores `uiAPI.setBusy(true)` after the Plan Review browser interaction
      resolves, reversing its temporary `setBusy(false)` pause; final idle remains owned by `SessionRuntime` busy depth
      and is not faked by the adapter.
- [ ] `load-plan` Proceed with execution continues to drive execution through `SessionRuntime.executePlan` in
      production, so the busy spinner starts when deterministic workflow preparation starts and stops only after
      execution/validation handoff decisions settle.
- [ ] Tests use real Git/worktree/Plan Lifecycle fixtures for preparation behavior and assert both user-visible messages
      and absence of false wording such as `creating worktree` on reused/non-Git paths.

## Verification Plan

- Automated: `deno run -A scripts/run-tests.js src/shared/workflow/execution-progress.test.ts`
- Automated:
  `deno run -A scripts/run-tests.js src/ui/tui/runtime-interaction-adapter.test.js src/shared/session/session-runtime.test.js src/cmd/load-plan/load-plan-execution.test.js`
- Automated: `deno task test`
- Automated: `deno task seams:check` to prove no new dependency-bag seams were added for RunWield-owned lifecycle or
  registry machinery.
- Manual TUI: approve a Plan with **Approve & Run** and confirm the `Thinking...` busy spinner resumes after the browser
  review closes; the RunWield system block shows preparation/check/baseline/status/launch messages before the Engineer
  output starts.
- Manual TUI: run `runwield load-plan <ready-plan>` and select **Proceed with execution**; confirm the same preparation
  messages appear and the spinner runs during deterministic setup.
- Manual TUI: rerun an In-Progress/ready Plan with a reusable worktree and confirm the message says `reusing worktree`,
  not `creating worktree`.
- Expected behavior protected afterwards: Objective-Failing Check baseline rejection, worktree cleanup/registry
  settlement, Plan Lifecycle `execution_started` transitions, execution Agent selection, and Workflow Validation handoff
  semantics must remain unchanged. No existing behavior is expected to stop existing; this Plan adds projection/status
  output and fixes a TUI busy-state resume gap.

### Objective-Failing Checks

- `OC1` —
  `test -f src/shared/workflow/execution-preparation-progress.ts && test -f src/shared/workflow/execution-progress.test.ts && grep -q "execution preparation progress" src/shared/workflow/execution-progress.test.ts && grep -q "running Plan Objective-Failing Check baseline" src/shared/workflow/execution-preparation-progress.ts && deno run -A scripts/run-tests.js src/shared/workflow/execution-progress.test.ts`
  — the workflow progress helper and tests must exist and pass; this is red today because the helper, test file, and
  checkpoint behavior do not exist.
- `OC2` —
  `grep -Fq "uiAPI.setBusy?.(true)" src/ui/tui/runtime-interaction-adapter.js && grep -q "Plan Review restores busy before Approve & Run execution resumes" src/ui/tui/runtime-interaction-adapter.test.js && deno run -A scripts/run-tests.js src/ui/tui/runtime-interaction-adapter.test.js`
  — the TUI Plan Review busy resume regression must be implemented, covered, and passing; this is red today because the
  adapter currently pauses busy for Plan Review without restoring it before workflow continuation.
- `OC3` —
  `grep -q "load-plan proceed surfaces execution preparation progress" src/cmd/load-plan/load-plan-execution.test.js && deno run -A scripts/run-tests.js src/cmd/load-plan/load-plan-execution.test.js`
  — the `load-plan` Proceed with execution path must assert the visible preparation messages; this is red today because
  that coverage is absent.

## Execution Policy

- `executionAgent: "engineer"` — this is TUI/workflow/runtime behavior, not browser-rendered frontend work.
- `collaborationRecommendation: "autonomous"` — the outcome is mechanically verifiable through event/message tests and
  TUI manual checks; live pairing is not needed.
- `devServerCommand`, `devServerUrl`, and `devServerHmr` remain `null` because no browser development server is
  required.

## Edge Cases & Considerations

- **Message truthfulness:** Do not emit `creating worktree` before RunWield knows it is creating a fresh worktree.
  Reused worktrees and non-Git execution need distinct wording.
- **Ordering:** Objective-Failing Check baseline runs after fresh worktree creation because the execution worktree is
  the baseline command working directory; the UI should reflect that rather than the initially requested
  baseline-before-worktree order.
- **Projection boundary:** Checkpoint messages and spinner state are user-visible projections only. They must never
  become authority for Plan Status, worktree registry state, execution context, or validation state.
- **Failure paths:** If preparation fails after a checkpoint, existing failure messages and preserved recovery evidence
  remain authoritative. Do not add optimistic success checkmarks for steps that have not committed.
- **Managed/Workspace sessions:** Runtime busy remains reference-counted and phase-aware. The Plan Review adapter only
  restores the visual busy indicator it paused; it does not publish managed lifecycle truth or release ownership.
