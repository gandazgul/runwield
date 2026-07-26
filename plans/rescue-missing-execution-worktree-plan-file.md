---
planId: "d98d1426-5ee8-4a0d-bd7d-acfff8044ee6"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Materialize canonical Plan files in execution worktrees and safely restore a missing Plan file so Workflow Validation can continue."
affectedPaths:
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/shared/workflow/execution-plan-file.js"
    - "src/shared/workflow/execution-plan-file.test.js"
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/execution-context.js"
    - "src/shared/workflow/execution-context.test.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/validation-loop-recovery.test.js"
    - "src/cmd/load-plan/index.js"
    - "src/cmd/load-plan/load-plan-recovery.test.js"
    - "docs/plan-lifecycle.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-25T19:21:39-04:00"
updatedAt: "2026-07-26T15:52:19.145Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-26T15:35:24.845Z"
verifiedAt: "2026-07-26T15:52:19.145Z"
executionReport: "- Implemented canonical Plan path resolver, execution Plan file materialization/rescue helper, workflow start preparation, validation-context restoration, validation/load-plan notices, metrics plumbing, tests, and lifecycle docs.\n- Verified formatting: `deno fmt --check ...` passed for all plan-listed files.\n- Verified targeted tests: `deno test -A src/plan-store.test.js src/shared/workflow/execution-plan-file.test.js src/shared/workflow/workflow.test.js src/shared/workflow/execution-context.test.js src/shared/workflow/validation-loop-recovery.test.js src/cmd/load-plan/load-plan-recovery.test.js` passed.\n- Verified full CI: `deno task ci` passed."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "796580ee0771637687459b44887bab824f51dca4"
    targetBranch: "main"
    targetHeadBeforeMerge: "35febc1bbd1d362445795ec4c799ede5b4fe6885"
---

# Rescue Missing Execution Worktree Plan Files

## Context

Workflow Validation requires the execution worktree to contain `plans/<plan-name>.md`, but execution worktrees are
created from a committed Git ref while the canonical Plan may exist only in the primary checkout's working tree.
Execution can still proceed because RunWield passes Plan content to the execution Agent Session. Validation later calls
`resolveValidationExecutionContext()`, fails to load the worktree copy, records `validation_failed`, and leaves the user
with the cryptic message `Execution worktree <id> does not contain Plan <name>.`

This has stranded at least `recover-interrupted-plan-review` in worktree `fc9b87ef` and `split-giant-test-modules` in
worktree `b85038d3`. In both cases, the canonical Plan file exists in the primary Project, the registered execution
worktree exists, and the worktree's creation commit did not contain that Plan path.

The primary checkout remains the canonical source of Plan Status and Front Matter. A missing execution copy is therefore
repairable after RunWield proves that the recorded registry entry, linked Git worktree, branch, target branch, baseline
tree, and Plan identity agree. An existing malformed, unreadable, symlinked, or identity-conflicting path is different
evidence and must not be overwritten.

## Objective

Prevent new execution worktrees from omitting their canonical Plan file and make existing affected worktrees
self-recovering during Workflow Validation or Plan Recovery. When only `plans/<plan-name>.md` is absent, RunWield will
copy the full canonical Project Plan into the identity-verified execution worktree, report the restoration, and continue
the current workflow without another user action. If restoration is unsafe or fails, RunWield will preserve existing
evidence and report the exact Plan file path plus a concrete reason.

## Approach

Expose the Plan store's canonical stored-Plan path resolver, then add a focused execution-Plan-file module that inspects
the canonical source, target, and each nested parent without following symlinks. It will distinguish absent, unreadable,
malformed, symlinked, or non-regular canonical sources before any worktree mutation. For an absent execution target, it
will write and parse a uniquely named temporary file in the verified target parent, then publish it atomically without
replacement by linking it to the final path. This prevents a failed write from stranding a partial final file and
preserves a concurrently created target. It will never perform a field-level Front Matter merge or replace an existing
path.

Use the helper at two seams:

1. `startActiveExecutionWorkflow()` loads the canonical Project Plan and ensures its execution copy before
   `captureWorktreeTree()`, for both newly created and safely reused execution worktrees. The Plan is therefore included
   in a fresh execution baseline. If preparation of a newly created worktree fails, remove the Git worktree first and
   remove its registry entry only after removal succeeds or the path is proven absent; preserve reused worktrees
   unchanged.
2. `resolveValidationExecutionContext()` first proves registry/path/repository/branch/target/baseline identity, then
   invokes the helper. A truly absent Plan file is restored from the canonical Project Plan and resolution continues in
   the same call. Existing malformed files, symlinked paths or ancestors, and Plan ID conflicts remain fail-closed.

Return structured restoration metadata from context resolution. Direct Workflow Validation and `wld load-plan` recovery
surfaces will emit one informational notice naming `plans/<plan-name>.md` before continuing. The first caller that
performs the restoration owns the notice, so a later validation-context resolution sees `present` and does not duplicate
it. Record boolean materialization/restoration details in existing workflow metrics without changing Plan Status solely
for the rescue.

## Files to Modify

- `src/plan-store.js` — export the existing canonical stored-Plan location logic as a narrow path resolver so callers
  can inspect a specific Plan source without duplicating traversal protections.
- `src/plan-store.test.js` — cover the exported resolver for top-level, nested, extension-normalized, and rejected
  escaping Plan names.
- `src/shared/workflow/execution-plan-file.js` — add canonical-source loading/classification, no-follow inspection of
  the target and nested parents, temporary-file validation, atomic no-replace publication, Plan identity checks, and
  structured outcomes.
- `src/shared/workflow/execution-plan-file.test.js` — cover canonical-source failures, absent and nested targets, valid
  existing files, malformed or non-regular paths, target/ancestor symlinks, conflicting Plan IDs, concurrent
  publication, temporary-file cleanup, and copy failures.
- `src/shared/workflow/workflow.js` — ensure the canonical Plan exists in new or reused execution worktrees before
  baseline capture; clean up a newly created worktree if preparation fails without deleting a reused worktree.
- `src/shared/workflow/workflow.test.js` — verify Plan preparation ordering, baseline inclusion, fresh/reused behavior,
  cleanup semantics, metrics, and fail-before-lifecycle behavior.
- `src/shared/workflow/execution-context.js` — separate canonical Plan loading from execution-file inspection, move the
  mutating rescue after every durable Git/worktree identity proof, return restoration metadata, and name exact Plan
  paths in blocked messages.
- `src/shared/workflow/execution-context.test.js` — add real temporary-repository regressions for safe restoration,
  fail-closed malformed/conflicting/symlinked/identity-mismatch cases, and injected restoration metrics.
- `src/shared/workflow/validation.js` — surface successful restoration metadata and continue the existing validation
  cycle without recording `validation_failed` for the repaired condition.
- `src/shared/workflow/validation-loop-recovery.test.js` — verify the restoration notice, continued CI/review path, and
  absence of a spurious `validation_failed` Plan Event.
- `src/cmd/load-plan/index.js` — surface restoration metadata during retry-validation and manual-merge recovery context
  resolution while preserving existing recovery menus for genuinely blocked cases.
- `src/cmd/load-plan/load-plan-recovery.test.js` — cover retrying an Implemented Plan whose registered worktree lacks
  its Plan file and reporting restoration before Workflow Validation continues; cover manual-merge recovery notice
  plumbing.
- `docs/plan-lifecycle.md` — document execution Plan materialization, identity-proven absent-file rescue, and the
  preserve-on-conflict policy.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — expose the existing `getStoredPlanLocation()` path canonicalization and reuse
  `parsePlanFrontMatter()` for explicit source/target validation rather than adding another parser or Front Matter
  merger.
- `src/shared/workflow/execution-context.js` — retain its registry, real-path, Git common-directory, branch, target
  branch, baseline, and Plan ID proof chain; restoration is permitted only after those checks succeed.
- `src/shared/workflow/plan-lifecycle.js` — reuse `stageValidationPassedInExecutionWorktree()` and `recordPlanEvent()`
  to produce verified Front Matter and clear stale failure state after validation; do not add a rescue-specific
  lifecycle transition.
- `src/shared/workflow/git-snapshot.js` — keep `captureWorktreeTree()` as the baseline authority after Plan
  materialization.
- `src/shared/worktree.js` and `src/shared/worktree-registry.js` — reuse normal worktree/registry removal for rollback
  of a fresh worktree whose Plan preparation fails.
- `src/shared/workflow/metrics.js` and the existing validation status emitter — reuse generic safe boolean metric
  details and RunWield system-status presentation; no metrics schema or new UI pattern is required.

## Implementation Steps

- [ ] Export a narrow `getStoredPlanPath(cwd, planName)`-style API from `src/plan-store.js` that delegates to the
      existing canonicalization logic. Add Plan-store tests proving top-level/nested resolution and rejection of
      absolute, empty-segment, dot-segment, and traversal names.
- [ ] Add a pure-JavaScript/JSDoc execution-Plan-file helper that uses the exported path resolver and `lstat`/direct
      read/parse operations to classify the canonical source as loaded, absent, unreadable, malformed, symlinked, or
      non-regular. Require a loaded regular canonical source before selecting or mutating an execution worktree.
- [ ] Inspect each execution-target parent plus the target with `lstat` so symlinked ancestors, dangling links,
      directories, and other non-regular evidence are never treated as absence. Return structured `present`, `restored`,
      `unreadable`, `identity_conflict`, and `restore_failed` outcomes with the exact relative path and reason.
- [ ] For a truly absent target, create missing real directories one segment at a time; create a unique hidden temporary
      file in the verified final parent; write, close, reload, parse, and identity-check the complete canonical
      Markdown; revalidate the parent chain; then publish with same-filesystem atomic no-replace semantics (for example,
      a hard link from the temporary file to the final path). Always clean up the temporary file, and preserve every
      pre-existing or concurrently created final target byte-for-byte.
- [ ] Add focused helper tests for canonical source classifications, top-level/nested targets, exact copied content,
      compatible legacy files without a Plan ID, malformed and non-regular paths, target/parent symlinks, concurrent
      publication, partial temporary writes, temporary cleanup, and read/write/parse failures.
- [ ] Update `startActiveExecutionWorkflow()` to load the canonical Project Plan and ensure the execution copy after
      worktree selection/creation but before baseline capture. Abort before baseline registry updates,
      `execution_started`, or Agent dispatch on any blocked outcome, naming the exact relative path.
- [ ] On fresh-worktree preparation failure, remove the Git worktree first; remove its registry entry only if worktree
      removal succeeds or its path is proven absent. If removal fails, retain the registry entry as durable recovery
      evidence and report both preparation and cleanup errors. On reused-worktree failure, preserve the worktree,
      registry state, and existing Plan path. Add tests for this ordering, materialized baseline input, rollback
      failure, reused preservation, and `worktree_prepared.details.planFileMaterialized`.
- [ ] Refactor `resolveValidationExecutionContext()` dependency seams so one loader cannot masquerade as both canonical
      source and execution-worktree evidence. Replace the overloaded test seam with separate injectable canonical-source
      loading and execution-file preparation helpers, then update affected tests/callers to exercise the correct root.
- [ ] Reorder execution-context resolution so registry identity, canonical worktree real path, Git common directory,
      checked-out branch, target branch, and baseline tree are all proven before any rescue write. Then inspect/restore
      the execution Plan, validate identity, and return `restoredPlanFile: { relativePath }` with `kind: "ok"` when
      repaired.
- [ ] Replace missing/unreadable/conflicting messages in this path with messages that name `plans/<plan-name>.md`,
      distinguish malformed Front Matter, symlink/non-regular evidence, Plan ID conflict, or failed restoration, and
      state that existing evidence was preserved. Assert that no execution path is mutated when any earlier identity
      proof fails.
- [ ] Route execution-context metrics through the resolver's injected `recordWorkflowMetric` dependency and include
      `planFileRestored: true` on successful restoring resolution. Assert this in `execution-context.test.js` rather
      than relying on a validation-loop resolver stub to exercise resolver metrics.
- [ ] Propagate restoration metadata through direct Workflow Validation. Emit one non-error system status such as
      `Restored missing execution worktree Plan file from the canonical Project Plan: plans/<plan-name>.md. Continuing Workflow Validation.`
      before CI, and do not record a `validation_failed` Plan Event for the repaired condition. Test notice/continued-CI
      behavior separately in `validation-loop-recovery.test.js`.
- [ ] Propagate the same metadata and notice through `wld load-plan` retry-validation preflight and manual-merge
      recovery. Ensure a preflight restoration is reported there exactly once and the subsequent validation call treats
      the file as present. Preserve current blocked recovery menus and manual-merge eligibility rules.
- [ ] Add temporary linked-worktree integration tests where the canonical Plan exists only in the primary working tree.
      Assert restoration content, notice behavior, continued validation, normal lifecycle cleanup on success, and no
      write for registry/path/repository/branch/target/baseline mismatches.
- [ ] Update `docs/plan-lifecycle.md` with the execution Plan materialization invariant, automatic absent-file rescue
      after durable identity proof, visible-notice behavior, and never-overwrite policy for conflicting evidence.

## Verification Plan

- Automated:
  - `deno fmt --check src/plan-store.js src/plan-store.test.js src/shared/workflow/execution-plan-file.js src/shared/workflow/execution-plan-file.test.js src/shared/workflow/workflow.js src/shared/workflow/workflow.test.js src/shared/workflow/execution-context.js src/shared/workflow/execution-context.test.js src/shared/workflow/validation.js src/shared/workflow/validation-loop-recovery.test.js src/cmd/load-plan/index.js src/cmd/load-plan/load-plan-recovery.test.js docs/plan-lifecycle.md`
  - `deno test -A src/plan-store.test.js src/shared/workflow/execution-plan-file.test.js src/shared/workflow/workflow.test.js src/shared/workflow/execution-context.test.js src/shared/workflow/validation-loop-recovery.test.js src/cmd/load-plan/load-plan-recovery.test.js`
  - `deno task ci`
- Manual:
  - In a temporary Git Project, create and approve a FEATURE Plan without committing its Plan file, begin execution, and
    verify the execution worktree contains the exact canonical `plans/<plan-name>.md` before implementation starts.
  - Reproduce the legacy state by deleting only that file from an otherwise valid registered execution worktree, retry
    Workflow Validation through `wld load-plan`, and verify RunWield reports the exact restored path once and proceeds
    to CI/review rather than recording the old missing-Plan failure.
  - Place malformed content, a symlink, and a valid Plan with a conflicting `planId` at the same path in separate
    retries; verify RunWield preserves each path, blocks before CI, and reports the exact reason.
  - Alter the registered path, branch, Git common directory, target branch, or baseline proof while leaving the file
    absent; verify no Plan file is written and the existing fail-closed identity message is retained.
- Expected results for key scenarios:
  - The states represented by worktrees `fc9b87ef` and `b85038d3` become retryable: an absent worktree Plan file is
    reconstructed from the canonical Project Plan, stale failure Front Matter is superseded by normal validation
    lifecycle updates, and the workflow continues.
  - New execution worktrees do not reach Agent execution or validation without a readable, identity-compatible Plan file
    at the canonical relative path, and that path is part of the execution baseline.
  - Rescue never overwrites an existing malformed, unreadable, symlinked, non-regular, concurrently created, or
    Plan-ID-conflicting path.
  - Failed rescue messages name `plans/<plan-name>.md` rather than only `Plan <plan-name>`.
- Execution policy matrix:
  - This is non-visual workflow/backend work and executes with `executionAgent: "engineer"` and
    `collaborationRecommendation: "autonomous"`.
  - No dev server or browser verification is required.

## Edge Cases & Considerations

- The primary checkout is canonical for Plan Status and Front Matter; rescue copies its full Markdown and does not merge
  fields from an absent or unreadable execution copy.
- A valid existing execution Plan without a Plan ID remains compatible for legacy behavior; only two present, unequal
  Plan IDs constitute an identity conflict. Successful validation later stages current canonical Front Matter normally.
- A file that exists but cannot be parsed is not equivalent to a missing file. Preserve it to avoid destroying execution
  evidence, even when replacing it might appear to repair validation.
- Child FEATURE Plans use nested names such as `plans/<epic>/<child>.md`. Parent creation must remain inside the
  execution worktree's real `plans/` tree and reject symlinked/non-directory ancestors rather than following them
  outside it.
- Restoration must occur only after registry and Git identity proofs. The rescue must not turn an unrelated directory or
  stale registry path into a trusted execution worktree by writing a canonical Plan into it.
- If the canonical Plan is absent, unreadable, malformed, symlinked, or non-regular, block before worktree mutation with
  its exact primary Plan path and classified reason; there is no safe source for automatic restoration.
- A restored legacy Plan makes the execution worktree dirty relative to its historical baseline. This is intentional:
  the Plan file must travel with the validated candidate, and existing validation staging/merge-back code owns the final
  verified Front Matter.
- Do not modify the Plan Lifecycle state machine or add user confirmation. The agreed behavior is deterministic
  restoration with a visible notice, followed by the normal Workflow Validation outcome.
- The working tree currently contains unrelated edits in `src/shared/workflow/validation.js` and
  `src/cmd/load-plan/index.js`; execution must preserve and integrate with those current changes rather than reverting
  them.
