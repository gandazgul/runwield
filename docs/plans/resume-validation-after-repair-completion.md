---
planId: "49e20ce4-692f-42fb-b5a9-ecb3766640cc"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
summary: "Prove that independent validation repairs resume through the durable validation checkpoint without competing for root Task Completion events."
affectedPaths:
    - "src/shared/workflow/validation-supervisor.ts"
    - "src/shared/workflow/validation-checkpoint.ts"
    - "src/shared/workflow/validation-mechanical.ts"
    - "src/shared/workflow/validation-session-adapter.ts"
    - "src/shared/workflow/validation-position.ts"
    - "src/shared/workflow/validation-repair-resume.integration.test.ts"
    - "src/shared/session/task-completion-session.test.ts"
    - "docs/validation-authority.md"
    - "docs/workflows.md"
objectiveChecks:
    - id: "OC1"
      command: "deno run -A scripts/run-tests.js src/shared/workflow/validation-repair-resume.integration.test.ts --filter 'human-review CI repair completion resumes through isolated result'"
      rationale: "The reported sequence must complete after one isolated repair Task Completion without a stale lifecycle write, a root-journal claim, or a second user prompt."
    - id: "OC2"
      command: "deno run -A scripts/run-tests.js src/shared/workflow/validation-repair-resume.integration.test.ts --filter 'root handler cannot consume an isolated validation repair completion'"
      rationale: "Independent repair completion belongs to the repair turn result. The root Agent Handler must never observe or acknowledge it."
    - id: "OC3"
      command: "deno run -A scripts/run-tests.js src/shared/workflow/validation-repair-resume.integration.test.ts --filter 'interrupted mechanical repair resumes from checkpoint and reruns checks'"
      rationale: "After process loss there is no live repair result to consume. Recovery must use the durable checkpoint and current worktree, rerun Mechanical Validation, and continue without replaying the old Agent turn."
objectiveCheckWaivers:
    []
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-03T17:01:39-04:00"
updatedAt: "2026-08-18T00:32:49.746Z"
status: "verified"
origin: "internal"
implementedAt: "2026-08-17T21:24:22.196Z"
verifiedAt: "2026-08-18T00:32:49.746Z"
userVerifiedAt: null
executionReport: "- Implemented durable Mechanical Validation repair recovery: failure events now preserve the validation checkpoint before CI/Object repair dispatch, and live repair completion loops into fresh checks without root Task Completion journal ownership.\n- Removed recovery authority from in-memory validation position: `validation.ts` no longer reads it, and `validation-position.ts`/ports now mark it as presentation-only.\n- Added `validation-repair-resume.integration.test.ts` with 6 new regression tests for the human-review/CI repair sequence, root-journal isolation, process-loss before/during/after repair, and no-`task_completed` retry behavior.\n- Updated existing coverage: replaced the old in-memory position rerun test with a durable-checkpoint rerun test, strengthened isolated task completion journal assertions, and made the dirty-stop-resume golden scenario deterministic. No tests were removed.\n- Updated `docs/validation-authority.md` and `docs/workflows.md` to distinguish live isolated repair results from restart recovery.\n- Verification passed: `deno run -A scripts/run-tests.js src/shared/workflow/validation-repair-resume.integration.test.ts`; validation completion/human-review/repair test group; task-completion/agent-handler test group; `deno task seams:check`; `deno task check`; focused golden reruns for `dirty-stop-resume` and `broken-objective-stop`.\n- Verification did not fully pass: `deno task ci` failed after 330 files passed with two golden scenario failures (`validation-workflow-broken-objective.test.ts`, `validation-workflow-publication.test.ts`), but both failed scenarios passed when rerun individually. Mutation checks were not performed as manual source mutations."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
validationCheckpoint: null
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "9a3c97219dd92e61698eb4bf2703dddbba950987"
    targetBranch: "main"
    targetHeadBeforeMerge: "601ccba85aceb31ba4332a7655a0f3c4776d5c3f"
routingIntent: "PLANNED_CHANGE"
sessionName: "validation repair resume"
validationCiAttempts: 0
validationObjectiveCheckAttempts: 0
validationSemanticRounds: 1
---

# Resume Validation After Repair Completion

## Context

The original failure happened when a CI repair ran in the root Engineer session. Both the in-flight validation loop and
the root Agent Handler could read the same accepted `task_completed` event. One consumer acknowledged it while the other
advanced the Plan, and the validation loop later attempted `mechanical_validation_failed` using its stale pre-repair
status. Validation then stopped until the user asked for a second Task Completion.

RunWield no longer uses that architecture. CI and Objective-Failing Check repairs now run in independent
Reviewer-Feedback Engineer sessions. Their `task_completed` result is read directly from the isolated turn's returned
messages. It is intentionally excluded from the root Session Task Completion journal. Mechanical Validation also records
the failed check and adopts the resulting Plan revision before it starts the repair turn.

Workflow Validation now has a durable attempt-scoped `validationCheckpoint` and one supervisor. The checkpoint, Plan,
worktree, and current Git facts—not an in-memory phase marker or an Agent completion claim—must determine recovery. The
remaining work is to prove the reported sequence against this architecture, remove any residual reliance on the old
root-completion race workaround, and make interruption behavior explicit.

## Objective

One `task_completed` call from an independent CI or Objective-Failing Check repair returns directly to the owning
validation invocation and causes fresh Mechanical Validation. The root Agent Handler cannot claim or acknowledge that
completion.

If the process stops before, during, or immediately after the repair result returns, a later validation invocation
claims the durable checkpoint and reruns Mechanical Validation against the preserved worktree. It does not replay the
old Agent turn, infer success from transcript text, or require a second Task Completion. Passing checks advance the
workflow; failing checks create a new bounded independent repair turn.

Local Human Code Review ownership remains intact. A repair requested after human feedback returns to the mechanically
required phase and then back to Local Human Code Review without a broad Semantic Code Review replacing the user's
decision.

## Approach

Treat completion and recovery as two different paths:

```text
Live repair
  independent repair session returns typed task_completed result
  -> current validation owner reruns Mechanical Validation
  -> checkpoint settles the resulting phase

Interrupted repair
  no repair result is assumed
  -> supervisor reclaims the durable validation checkpoint
  -> Mechanical Validation reruns against the current worktree
  -> checks, not Agent claims, decide what happens next
```

Keep the root Task Completion journal for root implementation/execution handoffs. Do not add an in-process reservation,
lease, or `claimed` journal event for independent validation repairs. The isolated session boundary already gives the
live result one consumer, while process-loss recovery is safer when it reruns deterministic checks instead of trying to
recover an ephemeral Agent return value.

Make the durable checkpoint the only continuation authority. `validation-position.ts` may remain as a disposable
same-process projection if the UI still needs it, but it must not select the recovery phase or override the checkpoint.
Remove it if no presentation consumer remains.

## Files to Modify

- `src/shared/workflow/validation-supervisor.ts` — prove that abandoned Mechanical Validation ownership is reclaimed
  from the checkpoint and resumes at the checkpoint's phase without requiring a Task Completion ID.
- `src/shared/workflow/validation-checkpoint.ts` — keep the attempt, generation, expected status, phase, and owner facts
  sufficient to rerun Mechanical Validation after an interrupted independent repair.
- `src/shared/workflow/validation-mechanical.ts` — retain failure recording before repair dispatch and ensure the live
  isolated completion immediately loops into fresh checks without a later stale lifecycle write.
- `src/shared/workflow/validation-session-adapter.ts` — keep independent repair completion scoped to the isolated turn
  result and outside the root Task Completion journal.
- `src/shared/workflow/validation-position.ts` — remove or demote the old in-memory `awaiting: "ci_repair"` state so it
  cannot compete with the durable checkpoint.
- `src/shared/workflow/validation-repair-resume.integration.test.ts` — cover the reported human-review/CI sequence,
  root-journal isolation, and process-loss recovery using real Plan lifecycle and checkpoint writes.
- `src/shared/session/task-completion-session.test.ts` — protect the root-only journal boundary without adding
  validation-specific reservation policy.
- `docs/validation-authority.md` and `docs/workflows.md` — document the live-result and interrupted-recovery paths.

## Reuse Opportunities

- `continueWorkflowValidation` and `claimValidation` in `validation-supervisor.ts` already provide single-owner,
  attempt-scoped checkpoint recovery.
- `runIndependentRepairTurn` in `validation-session-adapter.ts` already returns a typed completion report from the
  isolated Agent messages.
- `recordLifecycleEvent` plus `adoptRecordedPlanState` in `validation-mechanical.ts` already records CI and Objective
  Check failure before dispatch.
- `validation-completion-gating.test.ts` already proves the basic live CI and Objective Check repair loops; reuse its
  fixtures while adding the missing human-review and interruption composition.
- `makeValidationProjectRoot` and the real Plan lifecycle fixtures provide the repository-owned machinery without a new
  injection seam.

## Implementation Steps

- [ ] Add the exact reported regression: Local Human Code Review requests changes, the Plan returns to Implemented, CI
      fails, one independent repair calls `task_completed`, CI reruns, and validation returns to Local Human Code Review
      without a stale lifecycle error or second completion.
- [ ] Prove that an independent repair completion is read only from the isolated turn result and does not create,
      expose, consume, or acknowledge a root `runwield.task_completion` event.
- [ ] Keep `mechanical_validation_failed`, its attempt counter, failure kind, and the updated Plan revision durable
      before either CI or Objective-Failing Check repair dispatch begins.
- [ ] Prove process loss before repair dispatch, during the repair, and after the repair modifies the worktree but
      before its return is handled all resume by reclaiming the checkpoint and rerunning Mechanical Validation.
- [ ] Ensure restart recovery never replays an independent Agent turn or treats an uncommitted `task_completed` report
      as authority; current worktree contents and fresh checks decide whether another repair is needed.
- [ ] Ensure a repair that returns normally without `task_completed` settles the checkpoint as paused. Retry starts
      Mechanical Validation from committed state and may dispatch a new bounded repair if checks still fail.
- [ ] Remove or demote the in-memory validation position so it cannot decide recovery, skip Mechanical Validation, or
      move the workflow backward relative to the durable checkpoint.
- [ ] Preserve duplicate filtering and consume-once behavior for genuine root implementation Task Completions, while
      keeping isolated Reviewer-Feedback Engineer completions outside that journal.
- [ ] Keep strict Plan revision and lifecycle preconditions unchanged. Do not catch stale writes, coerce status, or
      restore caller snapshots over canonical Plan state.
- [ ] Update validation authority and workflow documentation to distinguish live isolated completion from restart
      recovery.

## Verification Plan

- Automated:
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-repair-resume.integration.test.ts`
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-completion-gating.test.ts src/shared/workflow/validation-loop-human-review.test.js src/shared/workflow/validation-loop-repair.test.js`
  - `deno run -A scripts/run-tests.js src/shared/session/task-completion-session.test.ts src/shared/session/agent-handler.test.ts`
  - `deno task seams:check`
  - `deno task check`
  - `deno task ci`
- Mutation checks:
  - route an independent repair completion into the root Task Completion journal and prove the isolation regression
    fails;
  - move `mechanical_validation_failed` after the Agent turn and prove the interruption regression fails;
  - let the in-memory position override the checkpoint and prove the process-loss regression fails.
- Expected result:
  - live repair completion has one owner by construction;
  - interrupted repair has no completion consumer and safely reruns checks;
  - neither path requires a second user prompt or weakens Plan lifecycle compare-and-set rules.

### Objective-Failing Checks

- `OC1` proves the original user-visible sequence on the independent repair architecture.
- `OC2` proves that the obsolete competing-consumer condition cannot be recreated through the root journal.
- `OC3` proves restart recovery from canonical checkpoint and worktree evidence instead of an Agent completion claim.

## Edge Cases & Considerations

- A repair may change files and then stop before `task_completed`. Recovery must still rerun checks; absence of the
  Agent claim does not mean the worktree is unchanged.
- A repair may call `task_completed` just before process loss. The returned report may be lost, but rerunning checks is
  safe because lifecycle advancement has not been inferred from the report.
- CI can be nondeterministic. Existing retry and user-stop behavior remains responsible for repeated operational
  failures; this Plan does not declare a repair successful merely because an earlier run passed.
- Objective-Failing Check reports can include a judgement that a check is defective. Only a live returned structured
  report can open the user waiver path. After process loss, rerun the canonical check and ask again only if the defect
  remains observable.
- Semantic repair is different because its checkpoint owns a Review Issue ledger and consume-once repair generation.
  Keep its durable completion receipt; do not generalize the mechanical repair recovery rule over semantic evidence.
- The root Task Completion journal remains necessary for implementation/execution continuation across Session restart.
  Do not remove or weaken it while removing validation-specific assumptions.
