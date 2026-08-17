---
planId: "64f1828d-46e3-4efd-89dc-1066bdc45c00"
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "HIGH"
summary: "Finish the current Workflow Validation authority repair so Plan, attempt, worktree, review-ledger, and continuation state each have one canonical owner and resume mechanically after interruption."
affectedPaths:
    - "src/shared/workflow/"
    - "src/shared/session/"
    - "src/plan-store.js"
    - "src/shared/worktree-registry.js"
    - "src/shared/worktree.js"
    - "src/tools/"
    - "src/cmd/load-plan/"
    - "docs/plan-lifecycle.md"
    - "docs/domain-language.md"
    - "docs/workflows.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-14T00:11:43-04:00"
status: "user_verified"
origin: "internal"
userVerifiedAt: "2026-08-14T04:35:21.836Z"
userVerificationNote: "Completed with Codex in an isolated worktree and marked user verified at the explicit request of the repository owner after focused validation and full CI passed."
workRecord:
    status: "generated"
    recordId: "799c65d5-043c-4c73-9e25-80e1effd8c1f"
    path: "docs/work-records/2026-08-16-validation-authority-and-recovery-model-consolidated.md"
    lastAttemptAt: "2026-08-16T03:51:15.220Z"
validationCheckpoint: null
updatedAt: "2026-08-16T18:01:32.486Z"
archivedAt: "2026-08-16T18:01:32.486Z"
archivedFromStatus: "user_verified"
archivedFromPath: "docs/plans/repair-validation-authority-and-recovery.md"
---

# Repair Validation Authority and Recovery

## Context

RunWield's current Workflow Validation cycle has accumulated several partially overlapping representations of truth:
Plan Front Matter, execution-worktree Plan copies, active workflow memory, validation continuation state, operation
receipts, Review Issue ledgers, worktree registry entries, and Session transcript markers. Recent Plans are repairing
specific failures in that system, including defective Objective-Failing Check handling, operational-error
classification, validation repair guidance, repair completion resume, and Golden TUI coverage.

Those fixes must not leave behind a collection of locally correct mechanisms whose ownership still conflicts. Before
RunWield replaces the current validation loop with a first-class Validator, the existing loop needs one explicit, tested
authority model. A process restart at any implementation, validation, repair, review, or publication boundary must lead
to one mechanically determined next action. An LLM must never reconcile protected Plan, attempt, worktree, ledger, or
publication state.

This Plan begins with a fresh audit of the active validation-related Plans and current source after they land. It
consolidates remaining ownership defects rather than duplicating or superseding unfinished work.

## Objective

Make the current Workflow Validation cycle a trustworthy foundation for later redesign:

- each durable validation fact has one canonical owner and every other representation is a projection;
- Plan Lifecycle, attempt, worktree, Review Issue, and publication state change only through typed mechanical
  transitions;
- active runtime state never overrides newer committed truth after interruption;
- validation and repair continuation derives one next owner and phase from canonical evidence;
- agent completions and repair claims are inputs to mechanical transitions, not permission to edit protected state;
- accepted Plan-definition amendments remain revisioned, user-governed, and publication-safe; and
- recovery preserves uncertain work and offers concrete actions without guessing what completed.

The option set aside is postponing these repairs until the new Validator architecture. That would migrate ambiguous
authority into a larger system and make failures harder to distinguish from redesign regressions.

## Approach

Start with an authority inventory, not another repair branch. For every validation datum, record its canonical store,
legal writers, projections, commit boundary, interruption behavior, and cleanup rule. Turn that inventory into typed
transition invariants and tests before removing duplicate decision paths.

```text
Agent outcome / command result
  -> typed workflow result
  -> lifecycle transition under Plan + attempt locks
  -> canonical Plan / registry / ledger commit
  -> Session and UI projections refresh
```

Resume follows the reverse direction only as a read:

```text
Plan + attempt + worktree + ledger + transition journal
  -> derive one durable phase and owner
  -> reconstruct bounded continuation context
  -> continue without agent-authored bookkeeping
```

Treat the primary Plan package definition, execution candidate, worktree registry, Review Issue ledger, and transition
journal as separate resources with explicit ownership. Remove any conditional path that chooses truth from whichever
copy is easiest to reach. Keep read/display caches disposable and rebuildable.

## Files to Modify

- `src/shared/workflow/` — consolidate validation phase derivation, typed results, transitions, repair ledgers,
  continuation, publication, and recovery around explicit authorities.
- `src/shared/session/` — keep transcript markers and active workflow context as committed continuation evidence without
  letting Session projections decide lifecycle truth.
- `src/plan-store.js` — preserve exact Plan definition and Front Matter revision ownership across primary and execution
  worktrees.
- `src/shared/worktree-registry.js` and `src/shared/worktree.js` — keep candidate, repair, merge, and cleanup evidence
  authoritative and recoverable.
- `src/tools/` — make agent completion and review tools emit bounded typed claims only.
- `src/cmd/load-plan/` — derive recovery choices from canonical evidence and never dispatch an agent for deterministic
  bookkeeping.
- `docs/plan-lifecycle.md`, `docs/domain-language.md`, and `docs/workflows.md` — document the resulting authorities,
  transitions, failure classes, and recovery behavior.

## Reuse Opportunities

- `src/shared/workflow/state-transition.ts` — transactional transition journal and ordered resource locking.
- `src/shared/workflow/plan-lifecycle.js` — central Plan Status and lifecycle-event authority.
- `src/shared/workflow/validation-context.ts` — durable validation-phase reconstruction.
- `src/shared/workflow/validation-delivery-hierarchy.ts` — delivery hierarchy and related Plan evidence.
- `src/shared/workflow/objective-check-waivers.ts` and the active Objective Check amendment work — user-governed Plan
  definition correction.
- `src/shared/workflow/review-ledger.ts` and semantic repair segments — durable review findings and bounded repair
  context.
- Existing real-Git fixtures, process-loss tests, and Golden TUI workflow scenarios.

## Implementation Steps

- [x] An authority matrix in the implementation documentation names the canonical store, legal writer, projection,
      commit boundary, cleanup rule, and resume rule for every Plan definition, lifecycle, attempt, worktree, Objective
      Check, Review Issue, validation phase, repair claim, and publication datum.
- [x] No validation or repair agent can directly edit protected Plan Front Matter, attempt state, worktree registry
      state, Review Issue state, phase counters, Delivery Evidence, or transition journals.
- [x] Every transition that spans Plan, worktree, attempt, ledger, or target-ref state either commits its complete
      postcondition or leaves a durable journal with exact recovery actions.
- [x] Validation phase and next owner are derived from canonical committed evidence after process loss; stale runtime,
      transcript projection, and UI snapshot fields cannot move the workflow backward or skip a phase.
- [x] Accepted execution-worktree Plan definition amendments are revisioned and synchronized through one user-governed
      boundary, and publication cannot overwrite them with an older primary copy.
- [x] Objective Check results, operational failures, semantic findings, repair completions, and merge outcomes each use
      a distinct typed result; string matching and generic failure fallbacks do not decide lifecycle transitions.
- [x] Repair completion consumes exactly the durable findings it resolved, preserves still-open findings, and resumes at
      the mechanically required validation phase.
- [x] Non-success outcomes retain the exact implementation candidate, worktree, attempt, ledger, and recovery evidence
      until a later transition proves cleanup is safe.
- [x] Focused process-loss tests cover every phase boundary from implementation completion through publication and prove
      one next owner/action without duplicate work or LLM bookkeeping.
- [x] Existing active validation repair Plans are reconciled against the final authority matrix; redundant mechanisms
      are removed only after their behavior is protected by the consolidated tests.
- [x] The domain language and lifecycle documentation describe canonical authorities and avoid presenting projections,
      agent claims, or execution reports as workflow truth.

## Approval Confirmation

No Work Record is proposed for supersession. Before approval, review the then-current active validation Plans and decide
whether any have become fully redundant; do not add `supersedes` metadata based only on overlapping affected paths.

## Verification Plan

- Automated: run focused lifecycle, validation continuation, Plan amendment, Objective Check, Review Issue, worktree,
  publication, transition-journal, and process-loss suites through `scripts/run-tests.js`.
- Automated: run `deno task seams:check` and `deno task ci`.
- Automated: mutation or boundary tests prove no agent-facing tool or display projection can advance protected state.
- Scenario: interrupt after every committed and pre-commit boundary, restart with no in-memory workflow state, and prove
  RunWield derives the same candidate, phase, owner, open findings, and safe next action.
- Scenario: inject stale primary Plan, execution Plan, Session projection, worktree registry, and transition-journal
  combinations and prove conflicts fail closed without overwriting the newest proven authority.
- Expected result: current Workflow Validation has one explainable authority path and can be safely replaced or reused
  by the later first-class Validator architecture.

## Edge Cases & Considerations

- Active validation Plans and dirty worktrees may change the audit baseline; refine this draft only after their current
  outcomes are known.
- Primary and execution Plan copies have different roles during worktree execution; consolidation must not collapse
  definition authority into lifecycle metadata or vice versa.
- A command can issue an external side effect before state commits. Recovery must preserve uncertainty rather than
  replaying or declaring success.
- User edits remain possible outside RunWield locks. Compare-and-set and recorded-write evidence must preserve them.
- The later Plan Package migration changes storage shape; this Plan should establish ownership contracts that survive
  that migration without implementing the package model early.

## Implementation Outcome

- Added `docs/validation-authority.md` with the canonical store, legal writer, commit boundary, projection, cleanup, and
  resume rule for every validation resource named by this Plan.
- Moved attempt-scoped Review Issue and semantic repair evidence into the durable validation checkpoint. Semantic
  feedback now commits the status rollback, open ledger, repair baseline, and repair generation together.
- Added a compare-and-set, consume-once semantic repair completion receipt. The Agent's report remains an untrusted
  claim; Mechanical Validation and Semantic Review still prove the repair.
- Made the supervisor reconstruct an interrupted semantic repair handoff from the checkpoint and project that state into
  the Session. Stale Session workflow state cannot replace the durable ledger.
- Reconciled the focused validation Plans in the authority documentation without declaring any of them superseded.

### Verification Evidence

- Focused lifecycle, checkpoint, semantic review, Plan Amendment, segment handoff, self-healing, and Session Runtime
  suites passed through `scripts/run-tests.js`.
- `deno task seams:check` passed with zero seams.
- `deno task ci` passed: type check, Workspace diagnostics, lint, language policy, seam policy, documentation links, and
  301 test files with zero failures.
