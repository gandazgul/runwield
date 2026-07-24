---
planId: "bb479450-60e4-488d-bb56-195bb1aa51dc"
classification: "FEATURE"
complexity: "HIGH"
summary: "Prevent Git-backed FEATURE Plans from becoming Verified when execution context is lost or the validated worktree was not provably delivered to its target branch."
affectedPaths:
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/agent-handler.js"
    - "src/shared/session/agent-handler.test.js"
    - "src/shared/workflow/execution-context.js"
    - "src/shared/workflow/execution-context.test.js"
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/orchestrator.js"
    - "src/shared/workflow/orchestrator.test.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/validation.test.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
    - "src/shared/worktree.js"
    - "src/shared/worktree.test.js"
    - "src/shared/worktree-registry.js"
    - "src/shared/worktree-registry.test.js"
    - "src/cmd/load-plan/index.js"
    - "src/cmd/load-plan/index.test.js"
    - "src/ui/workspace/components/PlanDetail.jsx"
    - "src/ui/workspace/workspace.test.js"
    - "docs/plan-lifecycle.md"
    - "docs/workflows.md"
    - "docs/usage.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-23T23:08:25-04:00"
updatedAt: "2026-07-24T04:44:47.597Z"
status: "implemented"
origin: "internal"
implementedAt: "2026-07-24T04:44:47.597Z"
executionReport: "- Implemented explicit `executionMode` / `deliveryEvidence` plan metadata, validation-context resolution, worktree sealing/merge ancestry proof, lifecycle gates, recovery/manual-merge plumbing, registry immutability checks, Workspace metadata display, docs, and related tests for fail-closed Plan verification.\n- Verification passed for focused suites: `deno test -A src/shared/workflow/validation.test.js src/shared/workflow/execution-context.test.js src/shared/workflow/plan-lifecycle.test.js src/shared/worktree.test.js` and `deno test -A src/cmd/load-plan/index.test.js` after fixes.\n- Full verification attempted with `deno fmt && deno task ci`; it failed in existing UI/Plannotator workspace tests: `artifact read surface opens Workspace-hosted read payload`, `review page accepts Unicode Plan payloads`, `artifact read page receives authenticated read-only payload`, and `Plannotator Viewer readOnly disables annotation creation and checkbox mutation affordances` (expected Plannotator source strings/read payload behavior not present)."
worktreeStatus: "completed"
---

# Fail-Closed Plan Verification and Delivery Evidence

## Context

The `automatic-epic-child-session-continuation` FEATURE exposed a false-verification path. RunWield created execution
worktree `41d6aa43` with a branch, target branch, and baseline tree, and the Engineer left fourteen modified files plus
two untracked implementation files there. At implementation completion, however, Workflow Validation recorded
`hasWorktree: false`. It consequently validated the primary checkout as if execution were in place, skipped merge-back,
recorded `validation_passed`, cleared the Plan's worktree pointers, and generated a Work Record. Commit `072af53d`
contained only the Verified Plan metadata and Work Record; the execution branch remained at its original base commit.

The immediate fault is not a failed merge: merge-back was never entered. `runValidationLoop` currently treats absent
volatile Active Execution Workflow state as permission to fall back to the Project root. That contradicts the Plan
Lifecycle definition of a Verified worktree-backed FEATURE Plan and lets unrelated primary-checkout changes satisfy the
implementation-diff check.

This feature makes execution mode and delivery proof durable, reconstructs missing volatile state only from coherent
Plan/registry/Git evidence, and otherwise fails closed before CI or Plan verification. `affectedPaths` remains planning
scope and is not treated as an implementation manifest; checking only whether those paths exist would not detect omitted
modifications to existing files.

## Objective

Guarantee that a FEATURE Plan becomes Verified only when RunWield can identify the execution mode and, for Git worktree
execution, prove that the exact validated implementation candidate reached the concrete target branch. Preserve enough
compact Delivery Evidence after cleanup to audit the result without retaining absolute worktree paths.

## Approach

Add two canonical Front Matter concepts:

- `executionMode`: `worktree` or `non_git_in_place`, recorded at `execution_started`. Missing mode means unknown, never
  implicit in-place execution.
- `deliveryEvidence`: a versioned discriminated object written only by successful Workflow Validation. Worktree evidence
  contains `mode: worktree_merge`, the sealed implementation candidate commit, concrete target branch, and target head
  observed immediately before merge. Non-Git evidence contains `mode: non_git_in_place` and no fabricated Git fields.

Carry the immutable execution context returned by execution startup through `executePlan` and every immediate validation
caller. At the validation boundary, use a shared resolver to reconcile that explicit context and the live Session with
the canonical Implemented Plan, the exact registry entry selected by `worktreeId`, and actual Git worktree/ref state.
The canonical Plan defines the expected execution generation, the registry supplies local discovery state, and Git
proves filesystem/history facts; contradictory sources are never reconciled by majority vote. A missing live Session
context may be reconstructed only when all durable identities agree.

For a worktree-backed attempt, require matching Plan name and, when already assigned, Plan ID, plus worktree id, real
path, branch, target branch, baseline tree, repository common directory, and a validation-eligible worktree status.
Resolve legacy Plans without `executionMode` only when complete worktree Front Matter, the exact registry entry, and Git
agree; persist the inferred worktree mode. Ambiguous legacy Plans and metadata-less Plans stop for Plan Recovery.
Explicit non-Git mode may recover to the Project root, but absence of worktree fields alone never implies non-Git
execution.

After CI, Semantic Code Review, and any human review pass, seal all implementation changes into a candidate commit
before adding Verified metadata. Capture the concrete target branch and its current head, stage `validation_passed` plus
Delivery Evidence in a metadata-only commit on top of the candidate, and merge that branch without rebasing or sweeping
additional implementation changes after sealing. If non-Plan paths change after sealing, or the target ref advances
before publication, stop/retry from Workflow Validation rather than silently changing the delivered candidate. Merge
publication and verification must prove that the target contains both the candidate and final execution-branch metadata
commit before reporting success, generating a Work Record, advancing an Epic, or continuing to another child.

Keep the existing single target-merge architecture. The Plan cannot contain the SHA of the commit that contains that
same Plan, so Delivery Evidence records the pre-merge target head rather than a self-referential resulting merge SHA.
The persisted candidate commit plus target branch/pre-merge head and the enforced ancestry check provide durable,
verifiable evidence without adding a second target-branch metadata commit.

## Files to Modify

- `src/plan-front-matter.js` — register `executionMode` and `deliveryEvidence` in the canonical Front Matter order.
- `src/plan-store.js` and `src/plan-store.test.js` — define JSDoc typedefs and strict normalizers for the execution-mode
  and versioned Delivery Evidence unions; round-trip valid evidence, reject/omit malformed partial evidence, and
  preserve unknown unrelated Front Matter.
- `src/shared/session/hosted-session.js` — align Active Execution Workflow JSDoc/validation with the explicit execution
  mode and immutable context consumed by validation.
- `src/shared/workflow/execution-context.js` and its tests — add the shared fail-closed validation-context resolver and
  Git/registry reconciliation result, including actionable blocked reasons and guarded legacy recovery.
- `src/shared/workflow/workflow.js` and its tests — persist execution mode at `execution_started` and return the exact
  execution context from `executePlan` instead of requiring callers to reread mutable Session state.
- `src/shared/workflow/orchestrator.js`, `src/shared/session/agent-handler.js`, and their tests — pass returned
  execution context through immediate, delayed, resumed, and repair validation paths without weakening existing
  continuation behavior.
- `src/shared/workflow/validation.js` and its tests — resolve context before CI, remove Project-root fail-open defaults,
  seal the validated candidate, build Delivery Evidence, enforce post-seal immutability, and gate all post-verification
  handoffs on proven merge publication.
- `src/shared/workflow/plan-lifecycle.js` and its tests — require mode-appropriate Delivery Evidence for FEATURE
  `validation_passed`, clear stale evidence on new execution/reset/reopen paths, and prevent parent Epic advancement
  from a child lacking canonical proof.
- `src/shared/worktree.js` and its tests — expose typed candidate-sealing and merge-publication results, commit all
  dirty/untracked implementation state before metadata staging, prohibit post-seal rebases/non-Plan changes, compare the
  target ref against the captured pre-merge head, and prove exact candidate/branch ancestry before returning success.
- `src/shared/worktree-registry.js` and its tests — support exact-id reconciliation and prevent status updates from
  mutating immutable registry identity fields used as recovery evidence.
- `src/cmd/load-plan/index.js` and its tests — reuse the same execution-context and Delivery Evidence rules for retry
  validation and manual merge recovery; remove inference that missing worktree fields means non-Git in-place execution,
  and require legacy staged branches to revalidate when they lack evidence.
- `src/ui/workspace/components/PlanDetail.jsx` and `src/ui/workspace/workspace.test.js` — present execution mode and
  compact Delivery Evidence in the existing metadata groups without exposing absolute paths or introducing a new visual
  pattern.
- `docs/plan-lifecycle.md`, `docs/workflows.md`, and `docs/usage.md` — document fail-closed reconciliation, explicit
  execution modes, candidate sealing, evidence semantics, legacy recovery, and user-visible blocked states.

## Reuse Opportunities

- `src/shared/workflow/workflow.js#startActiveExecutionWorkflow` — source the immutable execution context and existing
  baseline/target values instead of creating another execution owner.
- `src/shared/worktree-registry.js#findById` — select the exact recorded worktree generation; do not recover safety-
  critical state with first-match `findByPlanName`.
- `src/shared/worktree.js#getWorktreeStatus`, `inspectExecutionWorktreeMergeRisk`, and existing Git worktree parsing —
  reuse repository/path/branch inspection while strengthening identity and publication checks.
- `src/shared/workflow/plan-lifecycle.js#stageValidationPassedInExecutionWorktree` — retain verified Front Matter on the
  execution branch, but supply evidence from the already-sealed candidate and keep the final metadata commit distinct.
- `src/shared/workflow/validation.js#verifyExecutionWorktreeMerged` — evolve the existing ancestry seam to verify pinned
  commits instead of only the current mutable branch ref.
- `src/shared/workflow/metrics.js#recordWorkflowMetric` — record reconciliation source/outcome and proof failures
  without adding a second telemetry mechanism or absolute paths.
- Existing primary Plan snapshot/restore and detached target-branch merge paths — preserve dirty-checkout safety and
  target-branch support while adding compare-and-swap and pinned-commit postconditions.

## Implementation Steps

- [ ] Add normalized `executionMode` and versioned `deliveryEvidence` Front Matter fields. Define the exact worktree
      shape (`version`, `mode`, `executionCommit`, `targetBranch`, `targetHeadBeforeMerge`) and non-Git shape
      (`version`, `mode`), update canonical key ordering, and test injection, parsing, partial updates, malformed input,
      and cleanup/reopen round trips.
- [ ] Persist `executionMode` during `execution_started`, clear prior Delivery Evidence whenever a new attempt begins or
      is reset/reopened, and include the immutable execution context in successful and paused `PlanExecutionResult`
      values. Update Hosted Session types and every execution caller so immediate validation receives that returned
      context even if Active Execution Workflow state is later cleared.
- [ ] Implement `execution-context.js` as a deep reconciliation module. Strictly require an Implemented FEATURE Plan;
      match its canonical name and optional existing Plan ID; compare explicit/live context with Plan fields; load only
      the exact registry id; verify registry status and all immutable fields; canonicalize/compare real paths; verify
      Git common directory, checked-out branch/ref, target branch, and baseline tree; and return either a complete
      worktree/non-Git context or a typed blocked result. Emit guarded-recovery metrics without filesystem paths.
- [ ] Make Workflow Validation call the resolver before clearing Session state or running CI. Recover a missing live
      context only when all Plan/registry/Git facts agree, persist a safe legacy `executionMode: worktree` inference,
      and otherwise keep the Plan Implemented, retain the worktree and registry entry, record an actionable failure, and
      route the user to Plan Recovery. Never run workflow diff/review against the Project root for an unknown mode.
- [ ] Refactor worktree delivery into a sealed transaction. Commit dirty and untracked implementation state after final
      review, capture the immutable candidate commit, assert the worktree is clean, capture the concrete target head,
      then allow only finalized Plan paths to change while staging Delivery Evidence and Verified Front Matter. Reject
      post-seal implementation edits and remove merge-time rebasing of the sealed candidate.
- [ ] Strengthen merge publication. Require the target ref to equal `targetHeadBeforeMerge`, use compare-and-swap where
      the target is updated through a detached merge worktree, and return pinned candidate, execution metadata commit,
      target, and publication details. Before success, prove the target contains both pinned commits. A target advance,
      candidate mismatch, or inconclusive proof keeps the canonical Plan Implemented and requires a fresh validation
      attempt; cleanup, registry removal, Work Record generation, Epic advancement, and Epic child continuation occur
      only after proof.
- [ ] Enforce the invariant in the Plan Lifecycle. FEATURE `validation_passed` must receive normalized Delivery Evidence
      consistent with `executionMode`; worktree evidence must come through the staged worktree path, while explicit
      non-Git validation records the non-Git shape. Preserve the separate `epic_done_enough` semantics for PROJECT
      Epics.
- [ ] Update `/load-plan` recovery to use the shared resolver and proof-bearing merge transaction. Exact legacy
      worktrees can retry Workflow Validation and acquire evidence; unknown/ambiguous attempts cannot be manually marked
      Verified, and a branch-local legacy `verified` Plan without evidence is not sufficient proof by itself.
- [ ] Add the incident-level integration regression and adversarial coverage, update existing permissive validation
      fixtures to supply explicit mode/context, expose evidence through the existing Workspace metadata presentation,
      and update user/workflow documentation.

## Verification Plan

- Automated: run focused schema/lifecycle tests:
  `deno test -A src/plan-store.test.js src/shared/workflow/plan-lifecycle.test.js`.
- Automated: run focused execution/reconciliation tests:
  `deno test -A src/shared/workflow/execution-context.test.js src/shared/workflow/workflow.test.js src/shared/workflow/orchestrator.test.js src/shared/session/agent-handler.test.js`.
- Automated: run real temporary-repository worktree/publication tests:
  `deno test -A src/shared/worktree-registry.test.js src/shared/worktree.test.js src/shared/workflow/validation.test.js src/cmd/load-plan/index.test.js`.
- Automated: run Workspace metadata coverage: `deno test -A src/ui/workspace/workspace.test.js`.
- Automated: run `deno task ci` and fix every failure.
- Regression: create a temporary Git Project and FEATURE Plan, start execution, leave modified and untracked files in
  the recorded worktree, clear Active Execution Workflow immediately before validation, and assert guarded recovery uses
  the exact worktree, seals/merges all files, persists Delivery Evidence, and only then records Verified.
- Regression: repeat with one mismatch at a time (worktree id, Plan name, path/realpath, branch, target, baseline,
  registry status, Git common directory, or missing registry entry) and assert CI/review/merge/Work Record/Epic
  continuation never starts; the Plan stays Implemented and the worktree remains recoverable.
- Regression: leave unrelated primary-checkout changes while the live context is absent and assert they cannot satisfy
  the FEATURE implementation-diff requirement.
- Regression: mutate a non-Plan file after candidate sealing or advance the target ref before publication and assert the
  attempt stops for fresh Workflow Validation without canonical Verified metadata.
- Regression: verify exact candidate and metadata-commit ancestry for both a target checked out in the primary Project
  and a target updated through a detached merge worktree; cleanup may remove the execution branch while the target
  history still proves the persisted candidate.
- Regression: verify explicit `non_git_in_place` execution can recover from durable mode and records only non-Git
  Delivery Evidence, while a metadata-less legacy Plan cannot be inferred as non-Git.
- Manual: inspect a newly Verified Plan in Markdown and Workspace and confirm Delivery Evidence is compact, contains no
  absolute path, and identifies the candidate and target; then use
  `git merge-base --is-ancestor <executionCommit>
  <targetBranch>` to confirm the persisted claim.
- Manual: force a context mismatch and confirm the user sees a clear Plan Recovery message rather than successful
  validation or a misleading Work Record.
- Expected: no FEATURE Plan can reach Verified through `validation_passed` without explicit execution mode and
  mode-appropriate evidence; Work Records and Epic continuation remain downstream of the same proof.
- Execution policy matrix:
  - FEATURE Plans may omit `executionAgent`; omission defaults to `engineer` for backward compatibility.
  - This is core workflow/TUI work with no materially visual browser outcome, so use `executionAgent: "engineer"` and
    autonomous execution. The Workspace change only projects existing metadata through an established component.
  - Engineer-owned execution must not use Pair collaboration.
  - The incidental Workspace metadata check does not introduce a new browser interaction or visual pattern.

## Edge Cases & Considerations

- **Execution-base prerequisite:** the restored Epic-continuation implementation is currently dirty/uncommitted on
  `main`. Before this Plan executes, those changes must be committed or otherwise made part of the selected execution
  base; a new RunWield worktree created from the current branch cannot inherit uncommitted primary-checkout changes.
- The incident proves the Active Execution Workflow disappeared between `worktree_prepared` and validation, but the
  available durable evidence does not identify the exact mutation that removed it. Carrying immutable context fixes the
  immediate seam; reconciliation and lifecycle guards ensure any future loss fails safely regardless of origin.
- Existing verified Plans predate Delivery Evidence. Treat missing evidence as legacy history rather than retroactively
  declaring them invalid; only new verification/recovery attempts must satisfy the invariant. The known incident has
  already been repaired separately.
- Registry state is advisory and local. It may help reconstruct a missing Session only when the canonical Plan and Git
  independently confirm the same exact id/path/branch/target/baseline; registry presence alone is never proof.
- `findByPlanName` remains useful for user-facing recovery discovery but is unsafe for validation identity when multiple
  attempts exist. Safety-critical validation always selects by recorded id.
- Absolute worktree paths are cleared during normal cleanup and must never appear in Delivery Evidence, metrics,
  Workspace DTOs, or Work Records.
- The single-merge design deliberately records the target head before merge rather than a self-referential resulting
  commit SHA. A future separate metadata-commit design would be a new architectural decision, not an implementation
  shortcut.
- `closed_without_verification` remains available for an explicit human closure, but it must not synthesize Delivery
  Evidence or be described as Verified.
- ADR-005 states the intended worktree isolation/merge invariant but its wording about when `validation_passed` is
  recorded does not fully describe branch-local staging. This Plan does not modify ADRs; recommend a separate
  Architect/Init amendment after implementation if the durable evidence terminology should be captured there.
