---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/agent-definitions/"
    - "src/tools/"
    - "src/ui/review/"
    - "src/shared/workflow/plan-review-actions.ts"
    - "src/shared/workflow/sequence-review.ts"
    - "src/shared/workflow/plan-location.ts"
    - "docs/domain-language.md"
    - "docs/prd/runwield-core-prd.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "pair"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173/dev"
devServerHmr: true
createdAt: "2026-09-21T17:13:56.057Z"
status: "draft"
origin: "internal"
parentPlan: "plan-packages-and-independent-validation"
order: 2
dependencies:
    - "01-establish-plan-package-storage"
targetBranch: "epic/plan-packages-and-independent-validation"
planId: "812d050a-1d42-484f-96f4-5d047dd14069"
---

# Author and Approve Complete Plan Packages

## Context

Package storage alone does not change what Planner writes or what the user approves. Today the review path opens one
Markdown snapshot, and parts of Workspace can reload current content while applying a decision that was made against an
earlier view. Sequence review preserves opening snapshots, but each member is still one document.

This child makes `validation.md` an authored contract and binds approval to the complete reviewed package. It owns the
shared Plan Review interaction needed to inspect both authored documents. Broader Plan Board, artifact, and lifecycle
presentation remains in the final surfaces child.

## Objective

Make planning roles create the correct package documents and ensure one review decision approves the exact authored
package snapshot the user saw. Changes to authored membership or content must withdraw old approval, while mutable
lifecycle fields, generated QA, reports, and child package content do not.

## Approach

Define a versioned ordered authored manifest and calculate the specification revision through the package store. Pass
the opening package snapshot, revision, identity, and workflow ownership through standalone and Workspace review
decisions. Apply edits and lifecycle transitions as one package transaction.

```text
open review
  -> freeze authored manifest and content
  -> show plan.md + validation.md
  -> receive edits and decision
  -> compare current package with opening snapshot
  -> commit edits and approval, or reject stale decision
```

Extend Sequence snapshots so approval validates each member package and group order. The option set aside is rebuilding
the review base from files loaded when the decision arrives; that can approve content the user never saw.

## Expected Change Surface

The boundaries below are guidance, not an allowlist: verify the real footprint during implementation and change whatever
the Implementation Steps need, including files not named here. Stop and report only when discovery changes approved
intent — the change reaches another subsystem, public behavior or architecture shifts, migration or compatibility risk
grows, or the Verification Plan no longer proves the objective.

- `src/agent-definitions/` and document formats — Planner, Architect, Slicer, and Verification Adversary package
  responsibilities and validation contract format.
- `src/tools/` — typed package-authoring and review completion inputs where current one-body tools are insufficient.
- `src/ui/review/` — one review experience for `plan.md`, `validation.md`, and declared authored companions.
- `src/shared/workflow/plan-review-actions.ts` — package snapshot validation and atomic review decisions.
- `src/shared/workflow/sequence-review.ts` — package snapshots for every grouped member without changing Sequence
  execution semantics.
- `src/shared/workflow/plan-location.ts` — authoritative execution or retained-worktree package lookup.
- `docs/domain-language.md` — define Validation Contract, specification revision, and reviewed snapshot relationships
  when delivered.
- `docs/prd/runwield-core-prd.md` — update Plan review and Plan authoring requirements and scenarios.

## Reuse Opportunities

- `src/shared/workflow/sequence-review.ts` — opening snapshot, membership, and order validation.
- `src/shared/workflow/plan-review-actions.ts` — shared TUI and Workspace review transition.
- `src/shared/workflow/plan-location.ts` — refusal to replace authoritative worktree documents with stale primary
  copies.
- Existing Plannotator review components and RunWield design-system primitives.
- Existing Verification Adversary role, which challenges the contract before approval.

## Implementation Steps

- Planner produces `plan.md` and an outcome-based `validation.md` for execution-ready Planned Changes; lightweight child
  drafts can remain without a contract until selected for planning.
- Architect produces the Epic integrated validation intent and contract, while Slicer child drafts state boundaries and
  evidence without claiming implementation or proof.
- Validation contracts carry stable outcome and check IDs, inputs, setup, cleanup, actions, observable success, and
  machine-, agent-, or human-only execution classification.
- The authored manifest covers `plan.md`, `validation.md`, target policy, and declared authored companions while
  excluding lifecycle fields, generated QA, reports, controller records, and child package content.
- Standalone and Workspace Plan Review retain the opening package snapshot and reject approval when current authored
  content or membership differs, including a validation-only edit.
- The shared review surface presents authored package documents clearly as one review and commits accepted edits and
  approval atomically.
- Sequence review snapshots and validates every member package plus membership and order; a changed child contract
  cannot be approved by an unchanged container decision.
- Approved package handoff resolves the authoritative primary, execution, or retained document location and never
  substitutes a stale primary package.
- Core authoring and review requirements and scenarios match delivered whole-package review, external adoption,
  approve-for-later, approve-and-run, concurrent edit, and Sequence behavior.
- The glossary defines the implemented contract and revision terms, their avoided aliases, and their stable
  relationships.

## Verification Plan

- Automated: run focused review tests through
  `deno run -A scripts/run-tests.js src/shared/workflow/plan-review-actions.test.ts src/shared/workflow/sequence-review.test.ts src/ui/review/plan-review.test.ts`
  after confirming the actual review test paths during planning.
- Automated: prove a validation-only edit, authored companion add/remove, target-policy change, or member-package change
  rejects an old approval; prove status and regenerated QA changes do not.
- Automated: prove an interrupted review save exposes one committed package and preserves the opening snapshot as
  evidence.
- Automated: preserve worktree document authority through existing Plan authority integration tests.
- Automated: run `deno task seams:check` and `deno task ci`.
- Headed browser: start `deno task workspace:dev`, open `http://127.0.0.1:5173/dev`, enter the Plan Review fixture or
  real review flow, inspect `plan.md` and `validation.md`, edit each, and verify the decision applies to the complete
  visible package.
- Headed browser: open the same review in two tabs, change only `validation.md` in one, and confirm the older tab
  receives a clear stale-review result without approving unseen content.
- Documentation: confirm the Core PRD and glossary land with behavior and leave Validator execution as target work.

## Edge Cases

- YAML formatting-only changes can canonicalize without withdrawing approval, but authored values cannot.
- Custom authored metadata must survive review even when RunWield does not recognize each key.
- Closing a review is not approval or acceptance.
- A historical package may lack `validation.md`; browsing remains valid, but new execution requires planning and
  approval.
- Non-Git and remote-canonical authority rules remain unchanged.
