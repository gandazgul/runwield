---
planId: "a559c1f7-6449-43b8-b048-e0be2db55d28"
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "HIGH"
summary: "Remove Objective-Failing Checks from RunWield and clean obsolete metadata from active Plans"
affectedPaths:
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/tools/plan-written.ts"
    - "src/shared/workflow/"
    - "src/shared/workflow/validation-mechanical.ts"
    - "src/shared/workflow/execution-start.ts"
    - "src/shared/session/session-runtime.js"
    - "src/shared/work-records/"
    - "src/agent-definitions/"
    - "src/extensions/"
    - "src/cmd/"
    - "src/ui/tui/"
    - "docs/domain-language.md"
    - "docs/validation-authority.md"
    - "docs/plan-lifecycle.md"
    - "docs/plans/"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-24T15:21:10-04:00"
status: "user_verified"
origin: "internal"
userVerifiedAt: "2026-08-24T23:49:42.715Z"
userVerificationNote: "Completed and verified with Codex; deno task ci passed with 356 test files and 0 failures."
workRecord:
    status: "generated"
    recordId: "d39608f5-d764-4178-8b0c-c0cbb465f422"
    path: "docs/work-records/2026-08-24-objective-failing-checks-removed.md"
    lastAttemptAt: "2026-08-24T23:49:42.780Z"
validationCheckpoint: null
updatedAt: "2026-08-25T14:11:26.649Z"
archivedAt: "2026-08-25T14:11:26.649Z"
archivedFromStatus: "user_verified"
archivedFromPath: "docs/plans/remove-objective-failing-checks.md"
---

# Remove Objective-Failing Checks

## Context

RunWield currently requires every non-Epic Planned Change to provide Objective-Failing Checks. RunWield records their
red baseline, runs them during Mechanical Validation, dispatches repair turns for unmet results, and stores broken-check
waivers and repair state in Plan Front Matter.

The product definition has changed. **RunWield Verified** means that repository validation passed, Semantic Review
approved the result, and delivery was proven. Objective-Failing Checks do not add a required product guarantee under
that model. They add Planner-authored shell commands, brittle baseline rules, repair loops, waiver decisions, recovery
state, and a large maintenance surface. Completed Plans and their Work Records are sealed and must not be rewritten.

Only active Plans are in migration scope. The Work Record generated for this removal must state clearly that
Objective-Failing Checks are gone.

## Objective

Remove Objective-Failing Checks as a Plan feature and validation phase. New Planned Changes must not require or persist
Objective-Failing Checks. Active Plans must be cleaned of `objectiveChecks`, `objectiveChecksBaseline`,
`objectiveCheckWaivers`, and `validationObjectiveCheckAttempts`. Archived Plans and completed Work Records remain
unchanged.

The existing verification contract remains intact:

```text
Plan execution -> repository validation -> Semantic Review -> delivery proof -> RunWield Verified
```

The Work Record for this Plan must explicitly say that Objective-Failing Checks were removed from RunWield and cleaned
from active Plans. That statement must remain visible in the sealed record after completion.

## Approach

Remove the feature from the authoritative Plan schema and workflow first, then update callers, prompts, tests, and docs.
Add one revision-checked active-Plan cleanup path that removes only the obsolete fields from non-sealed Plans. The
cleanup must preserve Plan body text, definition fields, lifecycle status, worktree metadata, validation checkpoints,
delivery evidence, and user collaboration state.

Active cleanup is limited to Plans outside `docs/plans/archived/` whose status is not terminal. For each matching Plan:

```text
load active Plan
  -> remove four obsolete fields with an expected-revision write
  -> preserve all other Front Matter and body content
  -> report changed / already-clean / skipped-terminal / failed
```

The cleanup must run before the obsolete fields are removed from the parser's accepted schema, or use a raw-front-matter
migration that can still see and remove the fields. It must be safe to rerun and must not touch archived files.

The Work Record generator will enforce the removal statement for this Plan rather than relying only on an Agent-written
summary. The narrower option of leaving a compatibility reader was rejected: it would preserve obsolete lifecycle and
validation behavior and allow new code to keep depending on the feature.

## Files to Modify

- `src/plan-front-matter.js` — remove Objective-Failing Check keys from the canonical key registry and key order.
- `src/plan-store.js` — remove Objective Check types, fields, normalization, serialization, and update-preservation
  logic; add the revision-checked active-Plan cleanup primitive and active/terminal filtering needed by the migration.
- `src/plan-store.test.js` — replace Objective Check round-trip expectations with assertions that the cleanup preserves
  unrelated metadata and removes only the four obsolete fields from active Plans; add archived and terminal protection.
- `src/tools/plan-written.ts` — stop requiring, validating, persisting, or returning Objective-Failing Checks for
  PLANNED_CHANGE Plans; remove obsolete parameter validation and format references.
- `src/tools/__tests__/plan-written.test.js` and `src/tools/plan-written.test.ts` — prove a Planned Change can be
  submitted without Objective-Failing Checks and no obsolete fields are written.
- `src/shared/workflow/objective-checks.ts` — delete the obsolete runner and baseline comparison module after all
  imports and tests move to ordinary repository validation.
- `src/shared/workflow/objective-checks-baseline.ts` — delete baseline capture and persistence behavior.
- `src/shared/workflow/objective-check-waivers.ts` — delete waiver storage and filtering behavior.
- `src/shared/workflow/validation-mechanical.ts` — remove Objective Check execution, result classification, cancellation
  handling, repair dispatch, broken-check reports, and waiver interactions; preserve local CI failure handling and the
  Semantic Review handoff.
- `src/shared/workflow/execution-start.ts` — remove pre-execution Objective Check baseline preparation and progress
  messages while preserving normal execution preparation and lifecycle checkpointing.
- `src/shared/workflow/validation-context.ts` and `src/shared/workflow/plan-lifecycle.js` — remove Objective Check
  attempt counters, failure kinds, reset rules, and baseline cleanup while preserving CI and Semantic Review counters.
- `src/shared/session/session-runtime.js` and related workflow/session types — remove Objective Check fields from
  runtime projections and continuation state.
- `src/shared/workflow/validation-plan-amendment.ts` and related amendment tests — remove Objective Check diff, waiver,
  baseline, and defective-check amendment paths while preserving other approved Plan Amendments.
- `src/tools/task-completed.ts` and related Agent/session tests — remove `brokenObjectiveChecks` from completion
  contracts; preserve normal structured completion and repair reporting.
- `src/shared/work-records/generation.js`, `src/shared/work-records/schema.js`, and related tests — stop generating
  Objective Check waiver evidence and add a deterministic statement to this Plan's Work Record that the feature was
  removed and active Plans were cleaned.
- `src/agent-definitions/planner.md`, `src/agent-definitions/shared-practice/plan-execution.md`, and relevant Agent
  definitions — remove instructions to author, baseline, repair, waive, or report Objective-Failing Checks.
- `src/extensions/re-anchor/` and workflow prompt projection tests — remove obsolete Front Matter handling and
  assertions; continue excluding protected lifecycle metadata from Agent prompts.
- `src/cmd/` Plan maintenance command files and tests — expose or invoke the idempotent active-Plan cleanup path through
  the repository's existing Plan maintenance surface, with a clear dry-run/report mode if that surface supports it.
- `src/ui/tui/` validation progress, message, Golden scenario, and branch-precision tests — remove Objective Check
  states and messages while preserving CI, Semantic Review, cancellation, recovery, and no-check validation behavior.
- `docs/domain-language.md` — remove the Objective-Failing Check and related obsolete terms; retain the canonical
  meanings of Mechanical Validation, Semantic Review, delivery evidence, and RunWield Verified.
- `docs/validation-authority.md`, `docs/plan-lifecycle.md`, `docs/workflows.md`, `docs/user-facing-features.md`, and
  related docs — remove Objective Check authority, waiver, baseline, and repair-loop descriptions and document the
  revised validation contract.
- `docs/plans/*.md` — clean obsolete Objective Check fields from active Plans only, including this Plan after execution;
  do not modify `docs/plans/archived/`.
- `docs/work-records/` — do not modify existing sealed Work Records; the generated Work Record for this Plan must
  contain the explicit removal statement.

## Reuse Opportunities

- `listPlans` in `src/plan-store.js` — enumerate Plans in canonical order and identify active candidates.
- Existing revision-checked `updatePlanFrontMatter` and Plan-lock boundaries — make cleanup safe against concurrent Plan
  edits and rerunnable after interruption.
- Existing local CI path in `runMechanicalValidationPhase` — keep repository validation as the Mechanical Validation
  owner.
- Existing Work Record source preparation and deterministic post-processing in `src/shared/work-records/generation.js` —
  add the removal statement without changing sealed historical records.
- Existing Plan maintenance command and reporting patterns under `src/cmd/plans/` — use the established user-facing path
  rather than introducing a second migration mechanism.

## Implementation Steps

- [ ] `plan_written` accepts a non-Epic Planned Change with no Objective-Failing Checks and does not add any Objective
      Check field to its Front Matter.
- [ ] Active Plan cleanup removes `objectiveChecks`, `objectiveChecksBaseline`, `objectiveCheckWaivers`, and
      `validationObjectiveCheckAttempts` from every active Plan, including this Plan, while preserving each Plan's body,
      status, definition fields, validation checkpoint, worktree metadata, delivery evidence, and collaboration
      metadata.
- [ ] Active Plan cleanup is idempotent, revision-checked, safe to rerun after interruption, and never changes a
      terminal Plan or any file under `docs/plans/archived/`.
- [ ] The Plan parser, serializer, and Plan Front Matter types no longer define or emit Objective Check fields, while
      legacy active files are cleaned before the final schema removal and legacy archived files remain readable as
      sealed history.
- [ ] Workflow Validation runs repository Mechanical Validation and then Semantic Review without executing Objective
      Checks, creating Objective Check baselines, dispatching Objective Check repair turns, or accepting Objective Check
      waivers; CI failure, Semantic Review repair, cancellation, and recovery still work.
- [ ] Plan Amendments, task completion payloads, Agent projections, progress messages, TUI scenarios, and recovery state
      no longer contain Objective Check-specific branches, while unrelated Plan Amendments and validation state remain
      intact.
- [ ] New Work Records no longer include Objective Check waiver evidence, and this Plan's generated Work Record contains
      the exact user-visible statement:
      `Objective-Failing Checks were removed from RunWield, and obsolete Objective Check metadata was cleaned from active Plans; sealed completed Plans and Work Records were not changed.`
- [ ] `docs/domain-language.md` and validation documentation describe RunWield Verified as repository validation,
      Semantic Review approval, and proven delivery, with no remaining Objective-Failing Check definition or workflow
      requirement.
- [ ] Focused and full test suites pass, including tests that prove omission of Objective Checks no longer blocks Plan
      submission and tests that prove the active-only cleanup boundary.

## Approval Confirmation

No Work Records are proposed for supersession. Completed Work Records are sealed and remain historical evidence. This
Plan changes the current validation product and cleans only active Plan metadata.

## Work Record Requirements

Objective-Failing Checks were removed from RunWield, and obsolete Objective Check metadata was cleaned from active
Plans; sealed completed Plans and Work Records were not changed.

## Verification Plan

- Automated: run the focused Plan-store, Plan-written, execution-start, validation, lifecycle, Work Record, Agent
  contract, and TUI validation suites through `deno run -A scripts/run-tests.js`; run `deno task seams:check`; run
  `deno task ci`.
- Automated: enumerate root-level active Plans and assert none contains `objectiveChecks`, `objectiveChecksBaseline`,
  `objectiveCheckWaivers`, or `validationObjectiveCheckAttempts`; separately assert archived Plans were not modified.
- Automated: create a temporary active Plan containing all four obsolete fields, run the cleanup twice, and assert the
  first run removes only those fields, the second run is a no-op, and unrelated body and Front Matter remain
  byte-equivalent.
- Automated: submit a Planned Change without Objective-Failing Checks and assert review metadata is written without any
  obsolete field.
- Automated: run Work Record generation for this Plan and assert the generated record contains the exact removal
  statement; assert an existing sealed Work Record is byte-equivalent before and after the cleanup.
- Manual: inspect the generated Work Record after validation and confirm the removal statement is visible in the Summary
  or Future Planning Notes section.
- Expected result: a normal Planned Change follows repository validation -> Semantic Review -> delivery proof, with no
  Objective Check baseline, execution, repair, waiver, or recovery interaction.
- Existing behavior to preserve: repository Mechanical Validation, Semantic Review rounds and repair, Plan lifecycle
  ownership, worktree/delivery proof, cancellation, recovery, sealed historical records, and User Verified/manual
  closure.
- Behavior expected to stop: mandatory Objective Check authoring, Objective Check baseline validation, Objective Check
  execution, Objective Check-specific repair and waiver flows, Objective Check Front Matter, and Objective Check Work
  Record evidence.

## Edge Cases & Considerations

- **Active Plan changes during cleanup:** use expected-revision writes and retry/report conflicts; never overwrite a
  newer user or workflow revision.
- **Terminal active-path Plan:** treat terminal status as sealed even if the file is not yet under `archived/`; do not
  edit it.
- **Archived Plan:** do not rewrite or normalize it. Preserve its historical Objective Check metadata.
- **Interrupted migration:** rerunning cleanup must converge without duplicate events or loss of unrelated metadata.
- **Execution worktree copy:** clean the active execution Plan and primary active Plan according to the existing Plan
  owner and revision rules; do not let a stale execution copy restore removed fields.
- **Generated Work Record timing:** the explicit removal statement must be added by deterministic generation logic so it
  does not depend on the Recorder Agent remembering the request.
- **Dirty working tree:** existing unrelated user changes are outside this Plan; the implementation must not overwrite
  them.
- **Objective Check verification:** this Plan intentionally uses only a migration sentinel as the required
  Objective-Failing Check because the current Plan tool contract requires one. The user may waive it; it is not part of
  the desired product contract and must be removed from this Plan during active cleanup.
