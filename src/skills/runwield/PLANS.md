# Plans and workflows

Use this file for Plan lifecycle questions. Link to these docs for depth:

- https://github.com/gandazgul/runwield/blob/main/docs/workflows.md
- https://github.com/gandazgul/runwield/blob/main/docs/plan-lifecycle.md
- https://github.com/gandazgul/runwield/blob/main/docs/collaboration.md

## Plan files

Plans are Markdown files with YAML Front Matter under `docs/plans/`. Child FEATURE Plans for a PROJECT Epic live under
`docs/plans/<epic-name>/` and point back with `parentPlan`. RunWield owns Front Matter lifecycle metadata; the user owns
the Plan body and review content.

## FEATURE review and execution

A normal FEATURE flow is:

1. Planner writes the Plan.
2. Plannotator opens in the browser for user review.
3. Feedback returns the Plan to Planner; Approve records execution metadata and marks it ready for work.
4. RunWield dispatches the recorded `executionAgent`.
5. Workflow Validation runs.
6. The Plan becomes RunWield Verified only after delivery evidence and, for worktree execution, proof of merge-back.

Plannotator is the browser review surface RunWield opens for Plan review. Outcomes are Approve, Approve for Later, and
Feedback. FEATURE Plan Review exposes `executionAgent` and `collaborationRecommendation` controls so the user can select
the execution owner and autonomous or Pair collaboration recommendation.

## Validation, review, and repair

Workflow Validation is local CI plus semantic review. Semantic review runs in narrowing rounds, carries findings in a
Review Issue Ledger, and repairs findings in independent Engineer sessions. `QUICK_FIX` runs Mechanical Validation only:
no Reviewer, no Plannotator code review, no Plan status changes, and no merge-back.

`codereview` controls the local human code-review gate after local validation and semantic review pass and before
merge-back: `none` skips the gate, `ask` prompts the user, and `always` requires it.

## Statuses users see

- `draft`: Plan exists but review is not complete.
- `feedback`: user feedback or interrupted feedback handling returned it to planning.
- `approved`: user approved it, but preparation is not complete.
- `ready_for_decomposition`: approved PROJECT Epic is ready for Slicer.
- `ready_for_work`: FEATURE can execute, or PROJECT Epic can offer child selection.
- `in_progress`: execution started.
- `failed`: implementation did not finish; recovery may continue or reset it.
- `implemented`: implementation finished and waits for validation or repair restart.
- `validated_ci`: local Mechanical Validation passed; semantic review is next.
- `validated_reviewer`: semantic review passed; human review and publication are next.
- `validation_passed`: validation success event that moves the Plan to `verified` after required proof.
- `verified`: RunWield Verified; Workflow Validation passed and worktree-backed work merged back.
- `user_verified`: User Verified; the user attested acceptance without RunWield Workflow Validation proof.
- `done_enough`: user-facing Epic outcome meaning remaining child work is intentionally deferred.
- `closed_without_verification`: terminal manual closure without validation success.
- `on_hold`: paused and resumable.

RunWield Verified means RunWield collected validation and delivery evidence. User Verified means the user recorded an
attestation note; it does not set `verifiedAt` or claim Workflow Validation passed.

## `wld load-plan`, Epics, and Slicer

`wld load-plan <name-or-path>` loads a saved Plan, resumes work, reopens review, or starts recovery based on status. It
is Epic-aware: loading an approved or decomposing PROJECT opens Slicer; loading a ready Epic offers child FEATURE
selection; loading a child follows the normal FEATURE path.

A PROJECT is an Epic container. Slicer is the interactive PM/lead-engineer pseudo-Agent that helps split it into child
FEATURE Plans under `docs/plans/<epic-name>/`. After a child FEATURE verifies, RunWield can continue the parent Epic in
strict child order. The chain stops at the first child that is on hold, needs recovery, has unmet dependencies, has an
unsupported status, or needs user planning/approval.

## Recovery

Use `wld plans doctor` to inspect Plan/worktree drift. Add `--repair` only for safe metadata repairs. Interrupted
lifecycle transactions can leave recovery records under `.wld/plan-transitions/`; later `wld load-plan`, validation
retry, or doctor runs use them to decide whether to complete, roll back, or ask the user.

## Work Records

Work Records are repo-local Markdown generated at supported Plan completion under `docs/work-records/`. Use `wld wr` to
list, search, read, backfill missing records, or rebuild the derived index. They summarize completed work for future
planning; failed generation does not undo a terminal Plan outcome.

## Shared Spaces

`wld plans share|pull|push|unshare` use remote-canonical encrypted Shared Spaces for collaborative planning. Sharing
takes a Shared Plan Lock that blocks normal local mutation. `share` prints reviewer and maintainer URLs once. `pull`
imports remote revisions or comments, `push` publishes the accepted local revision, and `unshare` destructively deletes
the remote Shared Space and clears local sharing metadata.
