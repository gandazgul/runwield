# Product Requirements Document: Plan Recovery / Convergence Assistant

Last updated: 2026-07-16 16:16 EDT

Working draft. This PRD describes a future RunWield recovery capability inspired by Spec Kit's converge workflow,
adapted for RunWield's Plan Lifecycle, execution worktrees, semantic review, validation, and future Work Records.

## Objective

Add a **Plan Recovery / Convergence Assistant** that helps users and RunWield decide what to do when planned work gets
stuck, stale, interrupted, partially implemented, repeatedly rejected, or structurally mismatched with the approved
Plan.

The assistant should not replace the existing Reviewer/Engineer repair loop. It should operate outside that loop when
ordinary repair is exhausted or the correct next move is no longer obvious.

## Problem Statement

RunWield already has a strong inner validation loop:

1. Engineer implements an approved Plan.
2. Workflow Validation runs local validation.
3. Semantic Reviewer compares the implementation diff against the approved Plan.
4. Feedback returns to Engineer for repair.
5. Validation reruns until the work passes or fails.

That loop works when the Plan is still correct and the remaining work is a bounded repair. It is less suited to cases
where the failure is strategic rather than local:

- repeated repair attempts fail for the same underlying reason
- implementation reveals that the Plan was underspecified or stale
- the worktree is interrupted and later resumed without clear state
- merge-back fails after validation passes
- a user manually changes code or Plan state outside the normal flow
- a Plan is old enough that current code, Work Records, or decisions may have invalidated it
- an Epic or child FEATURE boundary was wrong and remaining work should be split

In these situations, another Engineer repair attempt may waste time or make the state harder to reason about.

## Difference From Current Reviewer/Engineer Repair

The current Reviewer/Engineer repair loop is execution-time and local:

- starts after Engineer says implementation is done
- CI passes/fails
- Reviewer compares the **diff** against the approved Plan
- feedback goes back to Engineer
- Engineer patches the worktree
- validation reruns

Its question is:

> Does this implementation satisfy the approved Plan well enough to merge?

It assumes the Plan is still right and the work is repairable inside the current execution attempt.

A convergence assistant would be recovery-time and diagnostic:

- kicks in after repeated repair failure, validation failure, interrupted work, stale worktree, merge conflict, or
  resumed/old Plan
- compares **Plan intent + current worktree + failure history + possibly current codebase reality**
- identifies what is actually left, what is contradicted, and whether the Plan itself is stale
- recommends a recovery path

Its question is:

> Given where we are now, what is the safest next move?

That might be:

- continue current worktree
- rerun validation only
- ask Engineer for one bounded repair
- reopen Plan review because the Plan is wrong/stale
- split remaining work into a new child Plan
- close without verification
- abandon/recreate worktree
- generate a Work Record note about what was learned

The key difference: **Reviewer is a judge of the diff. Convergence Assistant is a triage doctor for stuck planned
work.**

Reviewer says:

> FR-003 is missing from `src/foo.js`; fix it.

Convergence says:

> Three repair attempts failed because FR-003 depends on an unstated auth model. This is no longer a simple
> implementation defect; reopen planning or split a prerequisite Plan.

If convergence only says "here are missing plan items; Engineer fix them," it duplicates Reviewer. It should therefore
activate only when normal repair is exhausted, ambiguous, interrupted, stale, or structurally mismatched. Reviewer and
Engineer remain the fast inner loop; Convergence becomes the outer recovery loop.

## Target Users

- **Human users** deciding how to recover a failed, stale, or interrupted Plan.
- **Engineer** when repair feedback is no longer enough to proceed safely.
- **Planner, Architect, and Slicer** when recovery indicates the Plan should be reopened or split.
- **Workspace users** inspecting failed or implemented-but-unverified Plans.

## Product Principles

- **Do not duplicate Reviewer.** Only activate for recovery situations where ordinary validation repair is insufficient.
- **Preserve Plan Lifecycle semantics.** `verified` still requires Workflow Validation and merge-back; `failed` remains
  a mechanical recovery state.
- **Make the next move explicit.** The assistant should recommend a recovery path, not merely summarize failure.
- **Prefer evidence over speculation.** Use Plan events, worktree status, failure reasons, validation output, diffs,
  current code evidence, and relevant Work Records.
- **Keep user control over consequential recovery.** Abandoning work, reopening Plans, splitting work, or closing
  without verification should require user confirmation.

## Proposed Experience

The assistant appears when RunWield detects a recoverable but non-obvious state, or when the user requests recovery for
a Plan.

Possible entry points:

- `implemented` Plan with `worktreeStatus: validation_failed`
- `implemented` Plan with `worktreeStatus: merge_conflict`
- `failed` Plan with `worktreeStatus: execution_failed`
- repeated semantic review or validation repair failure
- `/load-plan` on stale or interrupted worktree-backed Plans
- Workspace recovery action from a failed or implemented Plan card

The assistant produces a recovery report:

- **Current state:** Plan Status, worktree status, branch/path, last Plan Event, failure reason.
- **Intent inventory:** Plan requirements, acceptance expectations, validation obligations.
- **Current evidence:** what appears implemented, missing, contradicted, or unrequested.
- **Staleness check:** whether current code or records make the Plan suspect.
- **Recommended recovery:** one primary next action and alternatives.
- **User decision:** continue, retry validation, repair, reopen Plan review, split, abandon, close without verification,
  or inspect manually.

## Functional Requirements

- RunWield should detect recovery situations where convergence analysis is useful and avoid running it for ordinary
  successful validation.
- The assistant should inspect Plan Lifecycle metadata and execution worktree metadata before recommending action.
- The assistant should distinguish missing implementation work from stale or invalid Plan intent.
- The assistant should classify findings as missing, partial, contradictory, unrequested, stale, or blocked.
- The assistant should recommend exactly one safest next action, with alternatives when appropriate.
- Consequential actions should require explicit user confirmation.
- The assistant should hand bounded repair work back to Engineer only when the remaining work is clearly repair-sized.
- If the Plan should change, the assistant should route back to the appropriate planning Agent instead of editing the
  approved Plan casually.

## Technical Approach

This capability should sit around existing recovery and validation primitives rather than replace them.

Likely components:

- a read-only recovery analysis Agent or workflow prompt
- a recovery context bundle built from Plan Front Matter, Plan Events, worktree registry state, validation output,
  semantic review feedback, merge-back failure detail, and selected code evidence
- a structured recovery report displayed in TUI and eventually Workspace
- orchestration hooks from failed validation, failed merge-back, interrupted execution resume, and `/load-plan`
- integration with existing recovery actions: continue execution, retry Workflow Validation, merge worktree changes,
  recreate worktree, abandon worktree, reopen review, or close without verification
- future Work Record integration so unresolved lessons and abandoned approaches can inform later planning

## Out of Scope

- Replacing semantic Reviewer for ordinary Plan adherence checks.
- Automatically abandoning worktrees or rewriting Plans without user approval.
- Creating a second task list artifact that competes with RunWield Plans.
- Treating convergence success as equivalent to Workflow Validation success.
- Applying convergence to every QUICK_FIX validation failure.

## Success Criteria

- Users can recover failed or stale Plans without manually reconstructing worktree state.
- Repeated Engineer repair loops decrease when the true issue is Plan staleness or underspecification.
- Fewer Plans are abandoned merely because recovery state is unclear.
- Recovery decisions preserve Plan Lifecycle invariants and merge-back safety.
- Future planning benefits from recovery findings captured in Work Records or planning context.

## Open Questions

- What exact threshold should trigger convergence automatically: repair count, repeated failure signature, elapsed time,
  worktree staleness, or user action only?
- Should recovery reports be persisted as Plan Events, separate artifacts, Work Record inputs, or transient session
  output?
- How should RunWield compare a stale Plan against newer Work Records without overloading the recovery prompt?
- Should Workspace expose a dedicated recovery panel for failed and implemented Plans?
