---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/workflow/validation-engine.ts"
    - "src/shared/workflow/validation-supervisor.ts"
    - "src/shared/workflow/implementation-checkpoint.ts"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/review-ledger.ts"
    - "src/shared/session/"
    - "src/agent-definitions/"
    - "src/tools/"
    - "src/shared/epic-artifacts.ts"
    - "docs/validation-authority.md"
    - "docs/plan-lifecycle.md"
    - "docs/domain-language.md"
    - "docs/prd/runwield-core-prd.md"
executionAgent: "engineer"
createdAt: "2026-09-21T17:13:59.003Z"
status: "draft"
origin: "internal"
parentPlan: "plan-packages-and-independent-validation"
order: 4
dependencies:
    - "02-author-and-approve-complete-plan-packages"
targetBranch: "epic/plan-packages-and-independent-validation"
planId: "1c4853d7-dcb0-4fee-9e3c-d77bc6a206bf"
---

# Run Independent Validation and Advisory Human QA

## Context

Plan Engineer and Frontend Engineer currently implement the change and are instructed to perform the Plan's complete
verification. Workflow Validation then runs Mechanical Validation and AI review. This duplicates work and lets the
implementation owner appear to own independent proof.

This child introduces Validator as the independent owner of the approved contract. It delivers straight-through success,
complete reporting, safe pause on findings or operational interruption, and direct user acceptance. Automatic repair and
the shared loop budget remain for the next child.

## Objective

End implementation at `implemented`, run every approved check through an independent Validator where feasible, generate
useful advisory `manual-qa.md` for remaining human work, run applicable AI review against the current candidate, and
distinguish independent `validated` evidence from `user_validated` acceptance and delivery.

## Approach

Reuse the session-independent validation controller, but replace Engineer-owned Mechanical Validation authority with a
Validator attempt bound to the approved package revision and exact candidate. Validator reports check dispositions and
findings; the controller decides lifecycle state. AI review follows Validator on the same current candidate where
semantic diff review applies.

```text
implementation completion
  -> implemented
  -> Validator report
  -> AI review when applicable
  -> candidate unchanged and no observed failures
  -> validated
```

Failed observed behavior pauses with an open finding. Inability to perform a check creates advisory human QA rather than
a pass or implementation defect. The option set aside is strengthening Engineer prompts; that does not create
independent proof ownership.

## Expected Change Surface

The boundaries below are guidance, not an allowlist: verify the real footprint during implementation and change whatever
the Implementation Steps need, including files not named here. Stop and report only when discovery changes approved
intent — the change reaches another subsystem, public behavior or architecture shifts, migration or compatibility risk
grows, or the Verification Plan no longer proves the objective.

- `src/shared/workflow/validation-engine.ts` and `validation-supervisor.ts` — Validator attempt ownership, candidate
  binding, phase progression, pause, and settlement.
- `src/shared/workflow/implementation-checkpoint.ts` — implementation completion stops at `implemented`.
- `src/shared/workflow/plan-lifecycle.js` — `implemented`, `validating`, `reviewing`, `awaiting_owner_review`,
  `validated`, and `user_validated` meaning.
- `src/shared/workflow/review-ledger.ts` — stage-qualified Validator findings using existing issue identity rules.
- `src/shared/session/` — one user-facing Session with isolated role histories and safe stale-event rejection.
- `src/agent-definitions/` and `src/tools/` — Validator responsibility, restricted tools, and typed report completion.
- `src/shared/epic-artifacts.ts` — contextual generated `manual-qa.md` and retained validation reports.
- `docs/validation-authority.md`, `docs/plan-lifecycle.md`, `docs/domain-language.md`, and
  `docs/prd/runwield-core-prd.md` — delivered ownership, lifecycle, recovery, semantic review, and acceptance contracts.

## Reuse Opportunities

- Existing validation controller, generations, checkpoints, consume-once Workflow Tool Events, and process-loss
  recovery.
- `runLocalCI` and exact execution-worktree command resolution.
- `review-ledger.ts` issue identities and claim/confirm/reject model.
- Guide's `write_docs` and `edit_docs` tools for generated Markdown.
- Existing AI review not-applicable behavior for non-Git work.
- Current manual QA artifact access and Work Record handoff.

## Implementation Steps

- Plan Engineer and Frontend Engineer completion records implementation evidence and advances only to `implemented`; it
  cannot create a validation report or independent success.
- Validator receives the approved package reference, exact candidate identity, check contract, read and inspection
  tools, shell access for approved checks, and Markdown-only report tools without general source-edit tools.
- Validator reports package revision, candidate revision, attempt, generation, and one disposition for every required
  check: passed, failed, blocked, unrun, or human-only, with evidence or an explicit evidence limit.
- Concrete observed defects create open validation findings; missing access, unavailable services, and genuinely human
  judgments become unperformed advisory work and never become passing evidence.
- Generated `manual-qa.md` identifies each remaining approved check, purpose, known versus unverified setup, actions,
  expected result, prior evidence, inability reason, candidate, completed validation summary, and cleanup.
- AI review runs after Validator where applicable and examines the current candidate against the approved package;
  non-Git not-applicable behavior remains explicit.
- Only matching controller-owned reports and consume-once events advance phases; Agent prose and generic
  `task_completed` cannot manufacture validation or repair completion.
- `validated` requires no unresolved observed failure in performed validation and applicable AI review for the final
  unchanged candidate; advisory human QA can remain and is not a user gate.
- A Plan or Epic can become `user_validated` through code review or direct action after failed, interrupted, or unrun
  checks; the route and available evidence are recorded without rewriting reports or creating delivery evidence.
- Late Agent events cannot overwrite user acceptance, restart work, or claim proof for changed code or requirements.
- Core execution, lifecycle, and semantic review requirements and scenarios match delivered independent proof, advisory
  QA, direct acceptance, and role ownership.
- The glossary defines Validator, Validation Contract, advisory human QA, `validated`, and `user_validated`, including
  avoided legacy aliases and their separation from delivery.

## Verification Plan

- Automated: run focused validation tests through
  `deno run -A scripts/run-tests.js src/shared/workflow/validation-completion-gating.test.ts src/shared/workflow/validation-manual-qa.test.ts src/shared/workflow/validation-owner.test.ts src/shared/workflow/validation-operational-recovery.test.ts src/shared/workflow/validation-loop-review.test.js`.
- Automated: prove implementation completion cannot produce independent success and only a matching Validator report
  advances the Validator phase.
- Automated: prove every contract check remains accounted for after early command failure and that blocked, unrun,
  human-only, and failed remain distinct.
- Automated: prove an infeasible check creates contextual advisory QA and permits `validated` when performed checks and
  AI review pass; prove a real defect remains an open finding instead.
- Automated: prove changed code, changed package content, stale generation, and duplicate completion events cannot reuse
  old proof.
- Automated: prove direct `user_validated` works after failed, unrun, and interrupted attempts and does not create
  publication evidence.
- Automated: verify the effective Validator tool set exposes documentation writes but not general write, edit, or
  multi-file edit tools; do not claim shell is sandboxed.
- Automated: run `deno task seams:check` and `deno task ci`.
- Manual: exercise one Planned Change from implementation through Validator, advisory QA, AI review, and `validated`;
  then accept a separate failing result directly and inspect retained findings.
- Documentation: confirm behavior, glossary, lifecycle, validation authority, and Core PRD changes land together.

## Edge Cases

- A Validator turn that crashes or never reports cannot manufacture a completed attempt or QA guide.
- Test commands may create normal outputs and side effects; tool policy is an Agent responsibility boundary, not an OS
  sandbox.
- Git evidence includes commit and required working or untracked inputs; non-Git evidence records consent-based source
  scope without inventing commits.
- Code Review remains optional, and advisory QA does not create `awaiting_owner_review` by itself.
- Legacy `verified` and `user_verified` evidence retains historical meaning until migration handles storage; it is not
  relabeled as a new Validator pass.
