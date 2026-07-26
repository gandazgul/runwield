---
planId: "d98d1426-5ee8-4a0d-bd7d-acfff8044ee6"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Materialize canonical Plan files in execution worktrees and safely restore a missing Plan file so Workflow Validation can continue."
affectedPaths:
    - "src/shared/workflow/execution-plan-file.js"
    - "src/shared/workflow/execution-plan-file.test.js"
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/execution-context.js"
    - "src/shared/workflow/execution-context.test.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/validation.test.js"
    - "src/cmd/load-plan/index.js"
    - "src/cmd/load-plan/index.test.js"
    - "docs/plan-lifecycle.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-25T19:21:39-04:00"
updatedAt: "2026-07-25T23:26:15.554Z"
status: "draft"
origin: "internal"
---

# Rescue Missing Execution Worktree Plan Files

## Context

Workflow Validation currently requires the execution worktree to contain `plans/<plan-name>.md`, but execution worktrees
are created from a committed Git ref while the canonical Plan may exist only in the primary checkout's working tree.
Execution still proceeds because RunWield passes Plan content to the execution Agent Session. Validation later calls
`resolveValidationExecutionContext()`, fails to load the worktree copy, records `validation_failed`, and leaves the user
with the cryptic message `Execution worktree <id> does not contain Plan <name>.`

This has stranded at least `recover-interrupted-plan-review` in worktree `fc9b87ef` and `split-giant-test-modules` in
worktree `b85038d3`. In both cases, the canonical Plan file exists in the primary Project, the registered execution
worktree exists, and the worktree's creation commit did not contain that Plan path.

The primary checkout remains the canonical source of Plan Status and Front Matter. A missing execution copy is therefore
repairable after RunWield proves that the recorded registry entry, linked Git worktree, branch, baseline tree, and Plan
identity agree. An existing unreadable or identity-conflicting file is different evidence and must not be overwritten.

## Objective

Prevent new execution worktrees from omitting their canonical Plan file and make existing affected worktrees
self-recovering during Workflow Validation or Plan Recovery. When only `plans/<plan-name>.md` is absent, RunWield will
copy the full canonical Project Plan into the identity-verified execution worktree, report the restoration, and continue
the current workflow without requiring another user action. If restoration is unsafe or fails, RunWield will preserve
existing evidence and report the exact Plan file path plus a concrete reason.

## Approach

Add a small shared execution-Plan-file module that derives the canonical relative path, distinguishes a truly absent
file from an existing unreadable file, materializes canonical Markdown without overwriting an existing path, and checks
Plan identity after loading. The full canonical Markdown is the Front Matter repair policy: no field-by-field merge is
introduced. On successful Workflow Validation, the existing `validation_passed` Plan Event will replace the worktree
copy with current canonical `implemented` Front Matter, transition it to `verified`, clear stale failure state, and
merge that result back normally.

Use the helper at two seams:

1. `startActiveExecutionWorkflow()` ensures the Plan file is present before `captureWorktreeTree()`, for both newly
   created and safely reused execution worktrees. This makes the Plan part of the execution baseline and prevents the
   delayed validation failure.
2. `resolveValidationExecutionContext()` first proves registry/path/repository/branch/baseline identity, then restores a
   truly missing Plan file from the canonical Project Plan and continues resolution in the same call. Existing malformed
   files and Plan ID conflicts remain fail-closed.

Return structured restoration metadata from context resolution. Workflow Validation and `wld load-plan` recovery
surfaces will use it to show a single informational message naming `plans/<plan-name>.md` before continuing. Record the
restoration in workflow metrics without treating it as a validation failure.

## Files to Modify

- `src/shared/workflow/execution-plan-file.js` — add the shared exact-path inspection, non-overwriting canonical copy,
  parse verification, and Plan identity checks used by execution preparation and validation rescue.
- `src/shared/workflow/execution-plan-file.test.js` — cover absent, nested Plan, valid existing, malformed existing,
  conflicting Plan ID, and copy-failure outcomes.
- `src/shared/workflow/workflow.js` — ensure the canonical Plan file exists in a new or reused execution worktree before
  capturing its baseline or recording `execution_started`.
- `src/shared/workflow/workflow.test.js` — verify Plan materialization ordering, baseline inclusion, reused-worktree
  handling, and fail-before-lifecycle behavior.
- `src/shared/workflow/execution-context.js` — separate canonical and execution Plan loading, move mutating rescue after
  all durable Git/worktree identity proofs, return restoration metadata, and replace cryptic blocked messages with exact
  Plan file paths.
- `src/shared/workflow/execution-context.test.js` — add real temporary-repository regressions for safe restoration and
  fail-closed malformed/conflicting/identity-mismatch cases.
- `src/shared/workflow/validation.js` — surface a successful restoration notice and continue the existing validation
  cycle instead of recording `validation_failed` for the repaired condition.
- `src/shared/workflow/validation.test.js` — verify the notice, continued CI/review path, and absence of a spurious
  `validation_failed` Plan Event after restoration.
- `src/cmd/load-plan/index.js` — surface restoration metadata during retry-validation and recovery/manual-merge context
  resolution, while preserving the existing recovery menus for genuinely blocked cases.
- `src/cmd/load-plan/index.test.js` — cover retrying an Implemented Plan whose registered worktree lacks its Plan file
  and assert that restoration is reported before Workflow Validation continues.
- `docs/plan-lifecycle.md` — document that RunWield materializes the canonical Plan into an execution worktree, safely
  repairs an absent copy after identity proof, and never replaces existing conflicting evidence automatically.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — reuse `loadPlan()` and canonical Plan-name/path validation rather than adding a second Plan
  parser or Front Matter merger.
- `src/shared/workflow/execution-context.js` — retain its registry, real-path, Git common-directory, branch, baseline,
  and Plan ID proof chain; restoration is permitted only after those checks succeed.
- `src/shared/workflow/plan-lifecycle.js` — reuse `stageValidationPassedInExecutionWorktree()` and `recordPlanEvent()`
  to produce verified Front Matter and clear stale failure state after validation; do not add a rescue-specific
  lifecycle transition.
- `src/shared/workflow/git-snapshot.js` — keep `captureWorktreeTree()` as the baseline authority after Plan
  materialization.
- `src/shared/workflow/metrics.js` and the existing validation status emitter — reuse established metrics and RunWield
  system-status presentation for the visible restoration notice.

## Implementation Steps

- [ ] Self-bootstrap this FEATURE's execution worktree by copying the exact canonical
      `plans/rescue-missing-execution-worktree-plan-file.md` from the primary Project into the same relative path in the
      execution worktree before validation. The currently running pre-fix RunWield process cannot apply the new rescue
      to its own already-created worktree.
- [ ] Add a pure-JavaScript/JSDoc execution-Plan-file helper that returns the canonical relative path, uses an existence
      check that does not mistake a dangling link or malformed file for absence, creates parent directories for nested
      child Plans, and uses create-new/non-overwriting file creation to avoid a time-of-check/time-of-use overwrite.
- [ ] Have the helper copy the canonical Plan's complete Markdown when the target is absent, reload the result, and
      return structured outcomes for `present`, `restored`, `unreadable`, `identity_conflict`, and `restore_failed`.
      Preserve any existing unreadable or conflicting path byte-for-byte.
- [ ] Update `startActiveExecutionWorkflow()` to load the canonical Project Plan and ensure its execution copy before
      baseline capture for both fresh and reused worktrees. Abort before the baseline registry update,
      `execution_started`, or Agent dispatch if the canonical Plan is unavailable or the existing execution file is
      unreadable/conflicting; include the exact `plans/<plan-name>.md` path in the error.
- [ ] Split execution-context test dependencies so a stub used to load the canonical Plan cannot also masquerade as the
      execution-worktree Plan loader. Preserve current production and test callers while ensuring worktree presence is
      checked against the actual execution root.
- [ ] Reorder `resolveValidationExecutionContext()` so repository linkage, registered real path, checked-out branch,
      target branch, and baseline tree are all proven before any rescue write. Once proven, restore only an absent Plan
      file, validate the restored copy/Plan ID, record restoration metadata, and return `kind: "ok"` so the same
      validation call continues.
- [ ] Replace the missing/unreadable/conflicting messages in this path with messages that name `plans/<plan-name>.md`,
      distinguish absence from malformed Front Matter or Plan ID conflict, and state whether RunWield restored,
      preserved, or could not restore the file.
- [ ] Propagate a `restoredPlanFile` result through direct Workflow Validation and `wld load-plan` recovery callers.
      Emit one informational notice such as
      `Restored missing execution worktree plan file: plans/<plan-name>.md from the canonical Project Plan. Continuing Workflow Validation.`
      and do not emit a recovery confirmation because the user selected automatic restoration with notice.
- [ ] Extend workflow metrics to distinguish successful Plan-file restoration from blocked execution-context resolution
      without changing Plan Status solely for the rescue.
- [ ] Add focused unit/integration tests using temporary linked worktrees where the canonical Plan exists only in the
      primary working tree. Assert restoration content, nested path support, notice behavior, continued validation,
      normal lifecycle cleanup on success, and no mutation when any durable identity proof fails.
- [ ] Update `docs/plan-lifecycle.md` with the execution Plan materialization/rescue invariant and the
      preserve-on-conflict policy.

## Verification Plan

- Automated:
  - `deno fmt --check src/shared/workflow/execution-plan-file.js src/shared/workflow/execution-plan-file.test.js src/shared/workflow/workflow.js src/shared/workflow/workflow.test.js src/shared/workflow/execution-context.js src/shared/workflow/execution-context.test.js src/shared/workflow/validation.js src/shared/workflow/validation.test.js src/cmd/load-plan/index.js src/cmd/load-plan/index.test.js docs/plan-lifecycle.md`
  - `deno test -A src/shared/workflow/execution-plan-file.test.js src/shared/workflow/workflow.test.js src/shared/workflow/execution-context.test.js src/shared/workflow/validation.test.js src/cmd/load-plan/index.test.js`
  - `deno task ci`
- Manual:
  - In a temporary Git Project, create and approve a FEATURE Plan without committing its Plan file, begin execution, and
    verify the execution worktree contains the exact canonical `plans/<plan-name>.md` before implementation starts.
  - Reproduce the legacy state by deleting only that file from an otherwise valid registered execution worktree, retry
    Workflow Validation through `wld load-plan`, and verify RunWield reports the exact restored path once and proceeds
    to CI/review rather than recording the old missing-Plan failure.
  - Place malformed content at the same path and retry; verify RunWield preserves the file, blocks before CI, and names
    the exact path and Front Matter problem.
  - Place a valid Plan with a conflicting `planId` at the path and retry; verify RunWield preserves it and blocks with
    an identity-conflict message.
  - Alter the registered path, branch, Git common directory, or baseline proof while leaving the file absent; verify no
    Plan file is written and the existing fail-closed identity message is retained.
- Expected results for key scenarios:
  - The states represented by worktrees `fc9b87ef` and `b85038d3` become retryable: an absent worktree Plan file is
    reconstructed from the canonical Project Plan, stale failure Front Matter is superseded by normal validation
    lifecycle updates, and the workflow continues.
  - New execution worktrees do not reach Agent execution or validation without a readable, identity-compatible Plan file
    at the canonical relative path.
  - Rescue never overwrites an existing malformed, symlinked, or Plan-ID-conflicting path.
  - Failed rescue messages say `plan file: plans/<plan-name>.md` (or equivalently name that exact path) rather than
    `Plan <plan-name>`.
- Execution policy matrix:
  - This is non-visual workflow/backend work and executes with `executionAgent: "engineer"` and
    `collaborationRecommendation: "autonomous"`.
  - No dev server or browser verification is required.

## Edge Cases & Considerations

- The primary checkout is canonical for Plan Status and Front Matter; rescue copies its full Markdown and does not merge
  fields from an absent or unreadable execution copy.
- A file that exists but cannot be parsed is not equivalent to a missing file. Preserve it to avoid destroying execution
  evidence, even when replacing it might appear to repair validation.
- Child FEATURE Plans use nested names such as `plans/<epic>/<child>.md`; path derivation and parent-directory creation
  must support them without allowing traversal outside `plans/`.
- Restoration must occur only after registry and Git identity proofs. The rescue must not turn an unrelated directory or
  stale registry path into a trusted execution worktree by writing a canonical Plan into it.
- If the canonical Plan disappears or becomes unreadable, block with its exact primary Plan path; there is no safe
  source for automatic restoration.
- A restored Plan may make the execution worktree dirty relative to its historical baseline. This is intentional: the
  Plan file must travel with the validated candidate, and existing validation staging/merge-back code owns the final
  verified Front Matter.
- Do not modify the Plan Lifecycle state machine or add a user confirmation. The agreed behavior is deterministic
  restoration with a visible notice, followed by the normal Workflow Validation outcome.
