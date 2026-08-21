---
planId: "7dda74a4-02f8-4c21-8292-e17c3dfab037"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Let users enter a durable Guided Repair conversation with a Plan's execution Agent in its existing worktree from Workflow Validation or load-plan, then resume validation without creating a second worktree or conflating the flow with Pair Execution."
affectedPaths:
    - "src/cmd/load-plan/plan-recovery-flow.ts"
    - "src/cmd/load-plan/plan-recovery-actions.ts"
    - "src/cmd/load-plan/plan-session-types.ts"
    - "src/cmd/load-plan/plan-session-surface.ts"
    - "src/cmd/load-plan/plan-recovery-flow.test.ts"
    - "src/cmd/load-plan/index.integration.test.ts"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/agent-handler.ts"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/guided-repair-session.ts"
    - "src/shared/session/guided-repair-session.test.ts"
    - "src/shared/workflow/validation-ports.ts"
    - "src/shared/workflow/validation-types.ts"
    - "src/shared/workflow/validation-session-adapter.ts"
    - "src/shared/workflow/validation-interactions.ts"
    - "src/shared/workflow/validation-mechanical.ts"
    - "src/shared/workflow/validation-semantic.ts"
    - "src/shared/workflow/validation-merge-repair.ts"
    - "src/shared/workflow/validation-guided-repair.test.ts"
    - "docs/domain-language.md"
    - "docs/prd/runwield-core-prd.md"
objectiveChecks:
    - id: "OC1"
      command: "grep -q 'load-plan offers Guided Repair for a Plan in validation without resetting implementation' src/cmd/load-plan/plan-recovery-flow.test.ts && deno run -A scripts/run-tests.js src/cmd/load-plan/plan-recovery-flow.test.ts --filter 'load-plan offers Guided Repair for a Plan in validation without resetting implementation'"
      rationale: "The current validation recovery menu omits execution continuation. This proves that a user can deliberately enter Guided Repair from load-plan while the Plan remains implemented and bound to its recorded worktree."
    - id: "OC2"
      command: "grep -q 'Guided Repair routes user prompts to the execution Agent in the recorded repair checkout' src/shared/session/guided-repair-session.test.ts && deno run -A scripts/run-tests.js src/shared/session/guided-repair-session.test.ts --filter 'Guided Repair routes user prompts to the execution Agent in the recorded repair checkout'"
      rationale: "This proves the core interaction: subsequent user prompts reach the Plan's Engineer or Frontend Engineer with the existing RunWield worktree as cwd, without an EnterWorktree call or a second worktree lifecycle."
    - id: "OC3"
      command: "grep -q 'Guided Repair task completion resumes validation and another failure returns to the same conversation' src/shared/workflow/validation-guided-repair.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-guided-repair.test.ts --filter 'Guided Repair task completion resumes validation and another failure returns to the same conversation'"
      rationale: "This proves the desired multi-round loop. One task_completed resumes the correct validation path, and a later failure stays guided instead of dispatching an unrelated automatic repair session."
    - id: "OC4"
      command: "grep -q 'Guided Repair does not enable Pair Execution checkpoints or change collaboration style' src/shared/workflow/validation-guided-repair.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-guided-repair.test.ts --filter 'Guided Repair does not enable Pair Execution checkpoints or change collaboration style'"
      rationale: "Guided Repair and Pair Execution are separate product concepts. This prevents the new repair mode from enabling pair_checkpoint or changing collaborationStyle."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-08T00:37:47-04:00"
updatedAt: "2026-08-08T00:37:47-04:00"
status: "draft"
origin: "internal"
userVerifiedAt: null
routingIntent: "PLANNED_CHANGE"
sessionName: "guided validation repair"
---

# Guided Validation Repair

## Context

RunWield normally owns the complete execution and validation loop. A planned implementation runs in a RunWield-owned
worktree, Workflow Validation runs CI and review, and validation failures dispatch bounded independent repair turns.
This is effective when a failure has a direct mechanical fix.

The flow becomes weak after several CI or review repair rounds, or when the failure needs user knowledge and judgment.
The user can ask RunWield to help with the failing Plan, but the request can be treated as a new conversation instead of
a continuation of that Plan's Engineer and worktree. The user cannot reliably hold a conversation with the execution
Agent, provide several prompts, rerun selected commands, and then return to validation.

There is a partial behavior today. Mechanical Validation offers `Engineer follow-up` after selected stops or after the
automatic repair limit. It keeps the active execution Agent and marks the workflow as a validation continuation. This
behavior is not a complete product mode:

- the label does not explain that the existing worktree and validation failure will stay active;
- `/load-plan` removes execution continuation while a Plan is in validation and offers only validation retry;
- the repair context and user conversation do not have an explicit typed state or durable identity;
- another validation failure can return to independent automatic repair instead of the guided conversation;
- the behavior is easy to confuse with frontend Pair Execution even though the lifecycle meaning is different.

## Objective

Add **Guided Repair**, a user-selected validation repair mode. Guided Repair lets the user converse with the Plan's
existing execution Agent in the recorded execution or merge-repair checkout. The same Plan, execution attempt, worktree
identity, validation evidence, and active user-visible Session remain authoritative.

The user can enter Guided Repair in two places:

1. from `/load-plan` while a recoverable Plan is in Workflow Validation; and
2. from a Workflow Validation failure decision, especially after automatic repair rounds do not converge.

While Guided Repair is active, ordinary user prompts go directly to the Plan's Engineer or Frontend Engineer. The Agent
receives the current bounded failure packet and works in the existing repair checkout. When it calls `task_completed`,
RunWield resumes Workflow Validation. If validation fails again, RunWield updates the failure packet and returns control
to the same guided conversation instead of starting an independent automatic repair turn.

Guided Repair is not Pair Execution. It does not enable visual checkpoints, change `collaborationStyle`, require a
frontend Plan, or treat user feedback as verification.

## Product Behavior

### Enter from load-plan

For an `implemented`, `validated_ci`, or `validated_reviewer` Plan with a valid recoverable execution context,
`/load-plan` offers:

- **Work with Engineer in current worktree**; or
- **Work with Frontend Engineer in current worktree**, when that Agent owns the Plan.

The action appears alongside `Retry Workflow Validation`, not in place of it. It:

1. resolves and verifies the existing worktree or merge-repair checkout;
2. rehydrates the active workflow without changing the Plan status to `ready_for_work`;
3. records Guided Repair state for the same Plan and execution attempt;
4. switches the root Agent to the Plan's execution Agent with `allowReturnToRouter: false`;
5. supplies a bounded repair packet from canonical Plan and validation evidence; and
6. returns the input surface to the user for follow-up prompts.

If the worktree, baseline, Plan identity, or workflow ownership cannot be proved, the action is unavailable or blocks
with the existing recovery guidance. It never falls back to the primary checkout silently.

### Enter during validation

Replace the vague `Engineer follow-up` label with **Work with Engineer** or **Work with Frontend Engineer**. Keep
automatic repair as the normal first response to a direct failure. Offer Guided Repair when:

- a validation run is canceled;
- an automatic repair returns without Task Completion;
- a repeated failure reaches the existing automatic-round decision point;
- Semantic Code Review or merge repair reaches a user-action pause; or
- the client exposes a deliberate `Work with Engineer` action from the paused validation surface.

The user can choose Guided Repair before spending another automatic retry. Headless clients that cannot hold a guided
conversation stop safely and preserve recovery state.

### Converse and resume

Guided Repair has a typed runtime state separate from `collaborationStyle`. The state identifies:

- the Plan and execution attempt;
- the execution Agent;
- the RunWield-owned repair checkout and worktree identity;
- the validation phase and failure kind that requested repair;
- the latest bounded failure packet; and
- whether Guided Repair is active, awaiting user input, or awaiting Task Completion handling.

The current root Agent session is the guided conversation. User prompts are normal persisted user turns; they are not
embedded in Plan Front Matter or copied into validation evidence. The latest failure packet is delivered once when
Guided Repair starts and once after each new validation failure. Repeated user prompts do not duplicate the packet.

`task_completed` remains the only Agent signal that repair work is ready for validation. A completion from the wrong
Plan, worktree, Agent, or execution attempt is rejected by the existing workflow-attempt checks. A valid completion:

1. keeps the Plan at its current validation-safe lifecycle status until RunWield acts;
2. clears only the pending Guided Repair failure packet;
3. runs the validation phase required by canonical Plan status and recovery context;
4. preserves Guided Repair as the selected repair mode until verification, explicit exit, hold, reset, review reopen,
   abandonment, or a deliberate switch back to automatic repair; and
5. returns a later failure to the same guided conversation.

The user can leave Guided Repair without claiming validation success. `Retry Workflow Validation`, `Put on hold`, and
the existing recovery operations keep their current meanings.

## Architecture

### One worktree authority

RunWield continues to create, register, validate, merge, and remove worktrees. Guided Repair receives only the checkout
resolved from the Plan and worktree registry. It does not expose `EnterWorktree`, accept an Agent-selected path, or
create a host-owned worktree. For merge repair, it uses the already recorded merge-repair checkout when that is the
authoritative repair location.

### Typed guided state

Add a named `GuidedRepairState` type and carry it on the active execution workflow as a field separate from Pair
Execution fields. Do not use `collaborationStyle: "pair"`, `pairPauseReason`, or `pair_checkpoint` as storage or control
flow for Guided Repair.

The active runtime projection is not lifecycle authority. On entry and every resumed turn, reconstruct and verify it
against canonical Plan status, worktree registry identity, execution baseline, and the current workflow attempt. A stale
guided state must block or be replaced by explicit `/load-plan` recovery; it must not redirect a prompt into a different
Plan or checkout.

Persist the guided conversation in the current user-visible Session transcript. Record a small typed custom marker for
Guided Repair activation, updated failure delivery, completion, and exit so a reopened Session can recover routing
intent without importing an independent repair Agent's transcript. The marker contains identifiers and bounded state,
not source, CI output, user prompt text, or Plan Front Matter copies.

This Plan does not require Pair Execution changes or a new Plan lifecycle status. Plan status remains the durable
validation truth. Existing `failureReason`, validation attempt counters, worktree fields, and review state remain the
cold-start recovery evidence.

### Validation engine boundary

Extend the session-independent validation port with explicit guided-repair operations rather than importing Session or
Pi machinery into validation modules. The engine decides whether a failure should dispatch an automatic repair or pause
for Guided Repair. The Session adapter owns root-Agent switching, transcript markers, failure-packet delivery, and
prompt routing.

When Guided Repair is active, validation must not call `runIndependentRepairTurn` for that Plan. It records the failed
phase as it does today, updates the guided failure packet, preserves `validationContinuation`, and returns a paused
result. The root Agent Handler resumes validation after a valid Task Completion through the existing completion gate.

### Context boundary

Use `buildValidationRepairPrompt` as the source for the bounded repair packet. Add a guided variant or options that
remove the text claiming the repair is an independent session. Do not give the model raw Plan Front Matter. Keep the
approved Plan body, repair checkout, worktree identifiers, current failure, and completion instruction.

If the stable Session already supports successor transcript segments at implementation time, Guided Repair should use
the current execution or repair segment and must not create a new segment for every user prompt. If segment rollover is
not available, the current persisted root Agent transcript is acceptable for this slice; do not create an untracked
standalone JSONL or an in-memory conversation for user-guided work.

## Files to Modify

- `src/cmd/load-plan/plan-recovery-flow.ts` — add the validation-state Guided Repair option with Agent-specific product
  language and keep validation retry available.
- `src/cmd/load-plan/plan-recovery-actions.ts` — implement Guided Repair entry without the current `recovery_continue`
  transition or `ready_for_work` rewrite.
- `src/cmd/load-plan/plan-session-types.ts` and `plan-session-surface.ts` — expose one narrow runtime operation for
  activating Guided Repair; do not give load-plan direct access to Session managers.
- `src/shared/session/guided-repair-session.ts` — own typed marker parsing, validated activation/exit state, bounded
  packet delivery, and prompt-routing decisions.
- `src/shared/session/hosted-session.js` — carry the typed active projection while keeping Pair Execution fields
  independent.
- `src/shared/session/agent-handler.ts` — route guided prompts to the execution Agent and resume validation from
  accepted Task Completion without finalizing implementation again.
- `src/shared/session/session-runtime.js` — expose the public runtime activation operation used by load-plan and ensure
  Agent switching uses the resolved repair cwd and active workflow.
- `src/shared/workflow/validation-ports.ts`, `validation-types.ts`, and `validation-session-adapter.ts` — add the
  host-neutral Guided Repair contract and implement it at the Session boundary.
- `src/shared/workflow/validation-interactions.ts`, `validation-mechanical.ts`, `validation-semantic.ts`, and
  `validation-merge-repair.ts` — offer Guided Repair at supported pauses and keep later failures in guided mode.
- Focused tests — prove load-plan recovery, prompt routing, Task Completion continuation, repeated failures, process
  reopen behavior, wrong-workflow rejection, and separation from Pair Execution.
- `docs/domain-language.md` and `docs/prd/runwield-core-prd.md` — define Guided Repair and document it as an optional
  user-controlled validation repair mode.

## Reuse Opportunities

- `rehydrateActiveRecoveryWorkflow` and `resolveValidationExecutionContext` — recover and verify the Plan's existing
  execution context instead of inventing a second recovery path.
- `buildValidationRepairPrompt` and `projectEngineerPlanBody` — build the bounded guided packet without exposing Plan
  Front Matter.
- `validationContinuation`, Task Completion workflow-attempt matching, and the Agent Handler validation path — resume
  validation without treating repair completion as initial implementation completion.
- `failureReason`, `validationCiAttempts`, `validationSemanticRounds`, and existing review metadata — reconstruct cold
  recovery context without a new Plan status.
- `requestHostedSessionInteraction` and standard validation user-action pauses — present Guided Repair choices through
  the current interaction boundary.
- existing Plan/worktree recovery guards and Plan Workflow Lease checks — block stale or cross-Session adoption before
  any Agent prompt can mutate the checkout.

## Implementation Steps

- [ ] Add failing tests for Guided Repair entry from `/load-plan`, including `implemented`, `validated_ci`, and
      `validated_reviewer` Plans, worktree identity mismatch, non-Git in-place execution, and merge-repair checkout
      selection.
- [ ] Define `GuidedRepairState` and typed activation/exit markers. Validate Plan identity, execution attempt, Agent,
      checkout, and worktree registry state before making the projection active.
- [ ] Add a narrow `activateGuidedRepair` runtime operation to the load-plan Session surface. Rehydrate the workflow,
      preserve the current Plan status and validation metadata, switch to the execution Agent, and return control to the
      user's input surface.
- [ ] Add **Work with Engineer in current worktree** to validation-state Plan Recovery. Do not route it through
      `continueRecoveryPlan`, record `recovery_continue`, or set `ready_for_work`.
- [ ] Replace existing `Engineer follow-up` choices with Guided Repair product language and activation. Offer it for
      canceled validation, incomplete automatic repair, exhausted automatic rounds, supported semantic-review stops, and
      recoverable merge repair.
- [ ] Deliver a bounded guided repair packet on the first guided turn and after each new validation failure. Ensure
      ordinary follow-up prompts do not duplicate the Plan body or failure output.
- [ ] While Guided Repair is active, prevent validation from dispatching independent automatic repair sessions for that
      Plan. Update the guided failure packet and pause for user input instead.
- [ ] On a matching `task_completed`, resume validation exactly once. If checks fail again, retain Guided Repair and
      route the new failure to the same root conversation. If validation succeeds, clear Guided Repair through the same
      terminal workflow cleanup that clears active execution state.
- [ ] Add explicit exits for switching back to automatic repair, putting the Plan on hold, reopening review, resetting,
      abandoning, and terminal verification. Each exit clears routing state without deleting the worktree except where
      the selected recovery action already does so.
- [ ] Add reopen tests that restore Guided Repair from a persisted Session marker plus canonical Plan/worktree evidence.
      Stale markers for a different attempt, missing worktree, moved Plan status, or lost workflow ownership must not
      route a user prompt.
- [ ] Confirm Engineer and Frontend Engineer both work, while `collaborationStyle`, Pair checkpoints, and browser
      collaboration behavior remain unchanged.
- [ ] Document the product term and run targeted tests, seams enforcement, type checks, and full CI.

## Verification Plan

- Automated:
  - `deno run -A scripts/run-tests.js src/cmd/load-plan/plan-recovery-flow.test.ts src/cmd/load-plan/index.integration.test.ts`
  - `deno run -A scripts/run-tests.js src/shared/session/guided-repair-session.test.ts src/shared/session/agent-handler.test.ts`
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-guided-repair.test.ts src/shared/workflow/validation-loop-repair.test.js src/shared/workflow/validation-completion-gating.test.ts`
  - `deno task seams:check`
  - `deno task check`
  - `deno task ci`
- Manual:
  - Run a Plan until CI fails repeatedly, choose **Work with Engineer**, send several repair prompts, and confirm all
    edits occur in the recorded worktree.
  - Call `task_completed`, let CI fail again, and confirm the same Engineer conversation receives the new failure and
    waits for another user prompt instead of spawning an automatic repair session.
  - Start a different RunWield Session, run `/load-plan <plan>`, choose Guided Repair, and confirm the loaded Plan's
    execution Agent and recorded worktree become active without changing the Plan to `ready_for_work`.
  - Resume the Session after process restart and confirm canonical Plan/worktree checks restore or reject Guided Repair
    before any model turn.
  - Repeat with a Frontend Engineer Plan and confirm no Pair checkpoint appears unless the Plan independently uses Pair
    Execution.

### Objective-Failing Checks

- `OC1` proves `/load-plan` exposes Guided Repair for validation-state Plans without restarting implementation.
- `OC2` proves prompts reach the correct execution Agent and RunWield-owned checkout.
- `OC3` proves Task Completion and repeated validation failures form one user-guided repair loop.
- `OC4` proves Guided Repair remains independent from Pair Execution.

## Edge Cases and Constraints

- A Plan can be loaded while the current Session owns another active workflow. Guided Repair must use existing Plan
  Workflow Lease and handoff rules. It must not silently replace or combine two active workflows.
- An `implemented` status does not by itself prove a safe checkout. Worktree ID, path, branch, baseline, Plan ID, and
  Git attachment must pass existing recovery validation before activation.
- `validated_reviewer` merge repair can use a detached publication repair checkout. Guided Repair must route to the
  recorded repair checkout and preserve delivery evidence rather than resetting to the original execution worktree.
- A user prompt is not Task Completion. Asking a question, suggesting a diagnosis, or stopping a turn must keep
  validation paused.
- Task Completion from an independent old repair session, a stale transcript, or another execution attempt must not
  resume the active Guided Repair workflow.
- Guided Repair selection is not evidence that CI, review, or merge passed. It must never advance Plan status by itself.
- Do not store CI output, source diffs, user prompt text, or Agent prose in Plan Front Matter. Store only existing
  lifecycle evidence there; keep conversation content in the Session transcript.
- Automatic repair remains available. Guided Repair is a user-controlled mode, not a global replacement for bounded
  autonomous repair.
- Do not add an injection seam for Plan writes, lifecycle transitions, registry writes, worktree resolution, or guided
  state persistence. Use real Plan/worktree fixtures and the existing external Agent/model boundary in tests.

## Out of Scope

- Agent-created or host-created worktrees, `EnterWorktree`, arbitrary checkout switching, or a second worktree registry.
- Changing frontend Pair Execution, its checkpoint protocol, or its collaboration recommendation.
- Treating user guidance as code review approval or validation evidence.
- A general multi-Agent terminal that can attach to any historical Agent session without a recoverable active Plan.
- Replacing automatic validation repairs or changing their round limits globally.
- Importing independent repair transcripts into the guided conversation.
