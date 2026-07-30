---
planId: "ad9fd475-5559-4538-b43b-e16048a1eca0"
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "HIGH"
summary: "Split src/shared/workflow/validation.js into top-level TypeScript Workflow Validation modules while preserving behavior and deferring __deps cleanup."
affectedPaths:
    - "src/shared/workflow/validation.js"
    - "src/workflow-validation/"
    - "src/shared/workflow/orchestrator.js"
    - "src/shared/session/agent-handler.js"
    - "src/shared/workflow/epic-continuation.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/workflow/architecture-boundary.test.js"
    - "scripts/check-injection-seams.js"
    - "scripts/injection-seam-baseline.json"
    - "scripts/language-policy-baseline.json"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-30T12:24:36-04:00"
updatedAt: "2026-07-30T16:44:52.030Z"
status: "implemented"
origin: "internal"
implementedAt: "2026-07-30T16:44:52.030Z"
userVerifiedAt: null
executionReport: "- Implemented Workflow Validation move to `src/workflow-validation/` with TypeScript facade/types, seamed `entrypoints.ts`, responsibility module placeholders, updated production importers, updated architecture boundary coverage, and deleted `src/shared/workflow/validation.js`.\n- Moved validation tests/helpers to `src/workflow-validation/*.ts` and updated their imports/fixture paths.\n- Added explicit `--move oldPath=newPath` support to `scripts/check-injection-seams.js`; updated seam and language-policy baselines so the old validation path is gone and `src/workflow-validation/entrypoints.ts` carries the moved seam set.\n- Verification passed: `deno task check`, `deno task language-policy:check`, `deno task seams:check`, `deno run -A scripts/run-tests.js src/workflow-validation src/shared/workflow/architecture-boundary.test.js`, and `deno task ci`.\n- Manual checks passed: no stale `src/shared/workflow/validation.js` references in `src`/`scripts`; old monolith deleted; language-policy baseline no longer includes the old JS file."
humanReviewMode: null
humanReviewDecision: null
executionMode: "worktree"
executionBaselineTree: "9c0286827b353f86d2e49212694adba5f36618ba"
worktreeId: "d1f764dd"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-split-workflow-validation-into-typescript-module-d1f764dd"
worktreeBranch: "runwield/worktree/split-workflow-validation-into-typescript-module-d1f764dd"
worktreeBaseBranch: "main"
worktreeStatus: "completed"
---

# Split Workflow Validation into TypeScript Modules

## Context

`src/shared/workflow/validation.js` is a 3,945-line JavaScript module that owns most of RunWield's post-execution
validation behavior. It currently combines Workflow Validation, Mechanical Validation, prompt loading, local validation
command execution, Semantic Code Review support, merge publication verification, progress reporting, Manual QA handoffs,
and several small diff/classification helpers.

The requested outcome is to make this code easier to navigate and safer to change by moving it out of `src/shared/` into
a top-level `src/workflow-validation/` area, splitting independent concerns into TypeScript modules, and deleting the
old JavaScript monolith.

User decisions captured during planning:

- Use kebab-case: `src/workflow-validation/`.
- Break up the file now and defer the real `__deps`/capability-port cleanup to a follow-up, because the immediate pain
  is file size and navigability.
- Keep `runValidationLoop` largely intact in this change; extract independent helpers, but do not deeply split review
  rounds, repairs, or delivery phases yet.
- Move and convert the validation test files to TypeScript.

Important repository constraints:

- New production source must be TypeScript and use Deno-native real-extension imports.
- Do not introduce new `__deps` seams. The existing injection-seam ratchet is path-keyed, so moving a seamed module
  requires explicit tooling support; simply moving `__deps` reads into new paths currently fails
  `deno task seams:check`.
- Do not broaden this refactor into the full capability-port migration from
  `plans/replace-deps-bag-with-capability-ports.md`.
- Use current canonical language from `CONTEXT.md`: Workflow Validation, Mechanical Validation, Semantic Code Review,
  Review Issue Ledger, Review Issue, Review Advisory, Local Human Code Review, Guided Review, Manual QA.

## Objective

Create a top-level `src/workflow-validation/` module group that replaces `src/shared/workflow/validation.js` with
TypeScript files organized by responsibility, while preserving current behavior and public runtime entry points.

The change should:

- Delete `src/shared/workflow/validation.js` after all importers are updated.
- Expose the same public capabilities through a new TypeScript facade.
- Keep all existing `__deps` reads in one temporary entry-point module so the split does not multiply seam claims before
  the planned capability-port cleanup.
- Update ratchet/baseline files in a way that proves no new seam names were introduced by the move.
- Move and convert the validation test files to TypeScript.
- Preserve current Workflow Validation and Mechanical Validation behavior, including lifecycle transitions, active
  execution workflow handling, progress events, merge publication proof, Manual QA handoff, and Work Record generation.

## Approach

Create `src/workflow-validation/index.ts` as the new public facade. It should re-export the existing public API
currently exported by `validation.js` except for the unused `__dirname` compatibility export, after verifying no
repository importers depend on it.

Use this target layout:

- `src/workflow-validation/index.ts` — public value/type re-export facade for callers.
- `src/workflow-validation/types.ts` — exported interfaces and type aliases currently defined as JSDoc typedefs,
  including `WorkflowValidationResult`, `LocalCIResult`, `CapturedProcessStream`, `HumanReviewDecision`,
  `HumanReviewMetadata`, and `MergeVerificationResult`.
- `src/workflow-validation/prompts.ts` — bundled prompt front-matter loading plus `loadReviewerPrompt`,
  `loadReviewerFeedbackEngineerDef`, and `loadManualQaPrompt`.
- `src/workflow-validation/delivery-hierarchy.ts` — `hasDirectDeliveryEvidence`, `loadCurrentPlanRevision`, and
  `loadDirectDeliveryHierarchySnapshot`.
- `src/workflow-validation/local-ci.ts` — process-output capture helpers, validation-command lookup/prompting, and
  `runLocalCI`.
- `src/workflow-validation/manual-qa.ts` — `presentManualQaChecklist` and `runFeaturePostVerificationHandoffs`; keep
  `runManualQaChecklistPrompt` in the temporary entry-point module if moving it separately would duplicate existing
  `__deps` seam claims.
- `src/workflow-validation/progress.ts` — `emitRunWieldSystemStatus`, `createValidationProgress`,
  `updateValidationProgress`, `completeValidationProgress`, `formatCodeReviewAnnotations`, and the current
  validation-progress `WeakMap`.
- `src/workflow-validation/review-support.ts` — root-message comparison helpers, `runCompletionGatedRepair`,
  `usedReviewDiffTool`, `unaccountedOpenItems`, and diff-path/classification helper functions such as
  `extractDiffPaths`, `hasImplementationDiff`, `shouldRunWorkflowValidation`, and
  `shouldContinueParentEpicAfterValidation`.
- `src/workflow-validation/merge-verification.ts` — merge failure prompting/context helpers,
  `runGitForMergeVerification`, `verifyPostMergeCandidatePublished`, and `buildMergeRepairRequest`.
- `src/workflow-validation/entrypoints.ts` — temporary seamed entry points: `runManualQaChecklistPrompt`,
  `runMechanicalValidation`, and `runValidationLoop`.

`entrypoints.ts` intentionally keeps the existing `__deps` reads together for this change. Splitting
`runMechanicalValidation` and `runValidationLoop` into separate seamed modules would duplicate shared seam names such as
`runLocalCI`, `runActiveAgentTurn`, `runCompletionGatedRepair`, `readLatestTaskCompletedOutcome`, `switchActiveAgent`,
and `recordWorkflowMetric`. That would make the seam ratchet treat the refactor as additional seam surface. The
capability-port follow-up can split these entry points more deeply once the `__deps` bag is removed.

Add a small, conservative enhancement to `scripts/check-injection-seams.js` so implementation can declare a one-to-one
path move from `src/shared/workflow/validation.js` to `src/workflow-validation/entrypoints.ts` during baseline update.
The move mechanism must:

- Be explicit, for example `--move oldPath=newPath`.
- Apply only during `--update` or comparison setup, similar to the existing `--rename old=new` seam-name support.
- Treat the moved target path as inheriting only the old file's baseline seam names.
- Reject any seam name at the target that was not already present in `src/shared/workflow/validation.js`.
- Reject moves that would duplicate the same old seam name into multiple production modules.
- Still report removed seams as ratchet-tightening opportunities.
- Write the final baseline with the new real path so normal `deno task seams:check` passes without a move flag after the
  update.

Then run the move-aware baseline update once, and ensure the final `scripts/injection-seam-baseline.json` contains
`src/workflow-validation/entrypoints.ts` instead of `src/shared/workflow/validation.js`, with no increased seam set.
Also update `scripts/language-policy-baseline.json` to remove the stale JavaScript entry for
`src/shared/workflow/validation.js`.

## Files to Modify

- `src/shared/workflow/validation.js` — source monolith to delete after extracting behavior and updating importers.
- `src/workflow-validation/index.ts` — new public facade exporting validation values and types.
- `src/workflow-validation/types.ts` — TypeScript types replacing current JSDoc typedefs.
- `src/workflow-validation/prompts.ts` — prompt loading and agent-definition construction.
- `src/workflow-validation/delivery-hierarchy.ts` — direct-delivery hierarchy/evidence helpers.
- `src/workflow-validation/local-ci.ts` — local validation command execution and captured process output formatting.
- `src/workflow-validation/manual-qa.ts` — post-verification Manual QA and Work Record handoff helpers.
- `src/workflow-validation/progress.ts` — Workflow Validation progress/status helpers.
- `src/workflow-validation/review-support.ts` — Semantic Code Review support helpers and diff/classification predicates.
- `src/workflow-validation/merge-verification.ts` — merge verification and merge-repair request helpers.
- `src/workflow-validation/entrypoints.ts` — `runManualQaChecklistPrompt`, `runMechanicalValidation`, and
  `runValidationLoop` with existing `__deps` behavior preserved.
- `src/shared/workflow/orchestrator.js` — update imports/re-exports from `./validation.js` to the new
  `../../workflow-validation/index.ts` facade.
- `src/shared/session/agent-handler.js` — update imports to `../../workflow-validation/index.ts`.
- `src/shared/workflow/epic-continuation.js` — update `runValidationLoop` import and `WorkflowValidationResult` JSDoc
  type reference.
- `src/shared/session/session-runtime.js` — update dynamic import and `WorkflowValidationResult` JSDoc type references.
- `src/shared/workflow/architecture-boundary.test.js` — replace `src/shared/workflow/validation.js` in
  `HIGH_LEVEL_FILES` with the new module(s) that contain lifecycle/merge choreography, at minimum
  `src/workflow-validation/entrypoints.ts`.
- `src/shared/workflow/*validation*.test.js` and `src/shared/workflow/validation-test-helpers.js` — move to
  `src/workflow-validation/`, convert to `.ts`, update imports, and define proper test helper interfaces instead of
  `any` casts.
- `scripts/check-injection-seams.js` — add declared path-move support for moving a seamed module without loosening the
  ratchet.
- `scripts/injection-seam-baseline.json` — update after the declared move so the old validation path is gone and the new
  entry-point path carries only the existing seam names.
- `scripts/language-policy-baseline.json` — remove `src/shared/workflow/validation.js` as a stale production JavaScript
  baseline entry.

`CONTEXT.md` does not need modification because this refactor does not introduce, redefine, or retire domain language.

## Reuse Opportunities

Existing functions and patterns to preserve/reuse:

- `src/shared/workflow/state-transition.ts` — preserve existing typed transition calls and Deno-native TypeScript style.
- `src/shared/workflow/review-ledger.ts` — keep Review Issue Ledger imports and type usage unchanged.
- `src/shared/git-port.ts` — preserve the existing Git capability port argument on `runValidationLoop`; do not
  reintroduce separate git `__deps` seams.
- `src/shared/session/session-runtime-events.js` — continue using existing runtime validation-progress types and event
  emission shape.
- `src/shared/session/session-runtime-interactions.js` — continue using existing hosted-session interaction prompts.
- `src/shared/session/agent-assets.js` — continue using `ensureBundledAgentDefFile`; do not make prompt paths relative
  to the new module directory.
- `scripts/check-injection-seams.js` existing `--rename old=new` pattern — model the path-move flag after its
  explicit-declaration style.
- `scripts/check-language-policy.js` baseline update flow — use it to tighten the JavaScript baseline after deleting
  `validation.js`.

## Implementation Steps

- [ ] Add `scripts/check-injection-seams.js` support for a declared path move, for example
      `--move src/shared/workflow/validation.js=src/workflow-validation/entrypoints.ts`, with tests or self-check
      coverage sufficient to prove moved seam names are allowed only when they existed on the source path and are not
      duplicated into extra modules.
- [ ] Create `src/workflow-validation/types.ts` and convert all validation-related JSDoc typedefs into exported
      TypeScript interfaces/type aliases. Avoid `any`, `unknown`, and bare `object`; define named object shapes for
      arguments/results.
- [ ] Create `src/workflow-validation/prompts.ts` and move the bundled prompt front-matter helpers plus
      `loadReviewerPrompt`, `loadReviewerFeedbackEngineerDef`, and `loadManualQaPrompt`. Preserve retry behavior,
      fallback `Deno.readTextFile(join(AGENT_DEFS_DIR, relativePath))`, and `ensureBundledAgentDefFile` usage.
- [ ] Create `src/workflow-validation/delivery-hierarchy.ts` and move direct-delivery evidence/hierarchy helpers.
      Preserve fail-closed behavior for verified Plans without direct Delivery Evidence.
- [ ] Create `src/workflow-validation/local-ci.ts` and move process stream tail capture plus `runLocalCI`. Preserve
      validation-command prompting, cancellation handling, runtime tool events, output truncation, and captured
      stderr/stdout formatting.
- [ ] Create `src/workflow-validation/progress.ts` and move validation progress helpers/status emission. Preserve the
      per-hosted-session progress `WeakMap` behavior and structured runtime event payloads.
- [ ] Create `src/workflow-validation/review-support.ts` and move message comparison, completion-gated repair,
      review-diff-tool usage detection, Review Issue Ledger open-item reconciliation, implementation-diff detection, and
      classification display helpers.
- [ ] Create `src/workflow-validation/merge-verification.ts` and move merge failure prompting/context helpers, git merge
      verification, post-merge publication proof, and merge-repair request formatting. Preserve typed merge failure
      classification and worktree-path resolution.
- [ ] Create `src/workflow-validation/manual-qa.ts` for seam-free Manual QA handoff helpers. Keep
      `runManualQaChecklistPrompt` in `entrypoints.ts` for this change unless it can be moved without adding or
      duplicating `__deps` seam claims.
- [ ] Create `src/workflow-validation/entrypoints.ts` and move `runManualQaChecklistPrompt`, `runMechanicalValidation`,
      and `runValidationLoop`. Keep `runValidationLoop`'s internal nested functions intact except for imports of helpers
      extracted above. Preserve all existing `__deps` names and fallback behavior exactly; do not add new names.
- [ ] Create `src/workflow-validation/index.ts` to re-export the public API currently imported from `validation.js`:
      `loadReviewerPrompt`, `loadReviewerFeedbackEngineerDef`, `loadManualQaPrompt`, `runManualQaChecklistPrompt`,
      `runLocalCI`, `usedReviewDiffTool`, `unaccountedOpenItems`, `shouldRunWorkflowValidation`,
      `shouldContinueParentEpicAfterValidation`, `runMechanicalValidation`, `runValidationLoop`, and exported types.
- [ ] Verify no repository code imports `__dirname` from `validation.js`; omit it from the new facade if unused.
- [ ] Update production importers to the new facade/type paths: `src/shared/workflow/orchestrator.js`,
      `src/shared/session/agent-handler.js`, `src/shared/workflow/epic-continuation.js`, and
      `src/shared/session/session-runtime.js`.
- [ ] Move validation test files from `src/shared/workflow/` to `src/workflow-validation/` and convert them to `.ts`,
      including `mechanical-validation.test.ts`, `validation-loop-core.test.ts`, `validation-loop-delivery.test.ts`,
      `validation-loop-human-review.test.ts`, `validation-loop-recovery.test.ts`, `validation-loop-repair.test.ts`,
      `validation-loop-review.test.ts`, `validation-prompts.test.ts`, and `validation-test-helpers.ts`.
- [ ] During test conversion, replace loose JSDoc/casts with named TypeScript helper interfaces for fake hosted
      sessions, fake user interfaces, workflow records, fake dependency functions, and message/result shapes.
- [ ] Update `src/shared/workflow/architecture-boundary.test.js` so lifecycle and publication safeguards inspect the new
      Workflow Validation entry-point module path(s).
- [ ] Delete `src/shared/workflow/validation.js` once all imports resolve to `src/workflow-validation/index.ts` or more
      specific new modules.
- [ ] Run the move-aware seam baseline update, for example
      `deno run -A scripts/check-injection-seams.js --update --move src/shared/workflow/validation.js=src/workflow-validation/entrypoints.ts`,
      and inspect the resulting JSON to confirm no extra seam names were introduced.
- [ ] Run the language-policy baseline update to remove the stale JavaScript path, for example
      `deno run -A scripts/check-language-policy.js --update`, and inspect that only `src/shared/workflow/validation.js`
      was removed for this migration.
- [ ] Run formatting/lint/type/test verification and address only refactor fallout, not unrelated behavior changes.

## Verification Plan

- Automated:
  - `deno task check`
  - `deno task language-policy:check`
  - `deno task seams:check`
  - `deno run -A scripts/run-tests.js src/workflow-validation src/shared/workflow/architecture-boundary.test.js`
  - `deno task ci`
- Manual/code-review checks:
  - Confirm `grep -rn "validation.js" src --include='*.js' --include='*.ts'` has no stale imports of
    `src/shared/workflow/validation.js`.
  - Confirm `src/shared/workflow/validation.js` is deleted and no production JavaScript replacement is added under
    `src/workflow-validation/`.
  - Confirm `scripts/injection-seam-baseline.json` moved the validation seam entry rather than adding duplicated seam
    names across multiple new modules.
  - Confirm `scripts/language-policy-baseline.json` removed the stale validation JavaScript path.
  - Confirm `runValidationLoop` behavior remains semantically unchanged: active execution workflow restoration/clearing,
    Workflow Validation progress events, CI retry/repair, Semantic Code Review attempts, Review Issue Ledger handling,
    Local Human Code Review, merge publication transition, Manual QA handoff, and Work Record generation paths are
    preserved.
  - Confirm `runMechanicalValidation` still resumes active execution workflow on repair-without-`task_completed` and
    still emits Mechanical Validation progress.
  - Confirm prompt loading still resolves bundled Reviewer, Reviewer-Feedback Engineer, and Manual QA prompts from
    `src/agent-definitions/workflow-prompts/`.
- Expected results:
  - Type checking passes with real `.ts`/`.js` extensions in all imports.
  - The seam ratchet passes without increasing seam names or spreading existing `__deps` reads across additional
    production modules.
  - The language-policy ratchet passes with one fewer production JavaScript file in `src/`.
  - Existing validation-loop and mechanical-validation test behavior passes after moving/converting tests.

## Edge Cases & Considerations

- The `__deps` bag remains temporary technical debt. This plan must not add new seam names or duplicate existing seam
  names into multiple new modules; the capability-port cleanup remains a follow-up.
- Keeping `runValidationLoop` intact means `entrypoints.ts` will still be large. That is intentional for this change: it
  reduces the monolith substantially without risky closure extraction from the most stateful validation logic.
- Import paths change depth because the code moves from `src/shared/workflow/` to `src/workflow-validation/`. Carefully
  update paths to `../constants.js`, `../plan-store.js`, `../shared/...`, `../tools/...`, and sibling `./*.ts` modules
  with real extensions.
- Deno TypeScript can import types from existing JSDoc JavaScript modules; use `import type` where possible and avoid
  inline complex object types.
- Test conversion to TypeScript may expose weakly typed fake hosted sessions and dependency bags. Define narrow fake
  interfaces rather than using `any`, `unknown`, or bare `object`.
- `architecture-boundary.test.js` must continue to protect high-level lifecycle callers after the move; do not
  accidentally remove Workflow Validation from that safety net.
- Prompt loading must remain independent of the new module directory. Continue resolving bundled prompts through
  `ensureBundledAgentDefFile` and `AGENT_DEFS_DIR`, not relative `import.meta.url` paths.
- If implementation discovers that a helper extraction would require deep mutation of `runValidationLoop` state or a
  broad context object, leave that helper inside `entrypoints.ts` and document it as future work after capability-port
  cleanup.
