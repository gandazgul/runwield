---
planId: "c3de7406-8856-4908-b131-4e387be39aac"
classification: "PROJECT"
complexity: "HIGH"
summary: "Rebuild RunWield planning and delivery around versioned Plan Package folders, UI/UX planning with reviewed prototypes, a first-class independent Validator, separate semantic review, bounded repair roles, journey acceptance, and a durable defective-Plan return path."
affectedPaths:
    - "docs/plans/"
    - "src/plan-store.js"
    - "src/plan-front-matter.js"
    - "src/shared/workflow/"
    - "src/shared/session/"
    - "src/agent-definitions/"
    - "src/skills/"
    - "src/tools/"
    - "src/cmd/load-plan/"
    - "src/cmd/plans/"
    - "src/ui/tui/"
    - "src/ui/workspace/"
    - "docs/plan-lifecycle.md"
    - "docs/domain-language.md"
    - "docs/prd/runwield-core-prd.md"
    - "docs/design-system.md"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-14T00:11:43-04:00"
status: "draft"
---

# Plan Packages and Independent Validation

## Context

RunWield currently stores each executable Plan as one Markdown file. Planner combines product context, architecture,
implementation steps, verification procedures, browser checks, and manual QA expectations in that file. Engineer or
Frontend Engineer then implements the Plan and is instructed to run its full Verification Plan before the same workflow
moves through Mechanical Validation and semantic review.

This shape has produced strong technical machinery but weak separation of responsibility. The Plan can omit a basic user
journey while still satisfying all written checks. Frontend Engineer can inspect an empty browser state, report browser
verification complete, and deliver a populated experience that users cannot understand. Semantic Reviewer is correctly
limited to the approved Plan and therefore cannot repair missing product intent. Manual QA is generated late and does
not act as an independent product-acceptance gate.

The Personal Remote Workspace Session list exposed the failure plainly: canonical TUI Session names and timestamps
existed, but Workspace projected untitled UUID cards with internal preparation language and no useful recency. Plan 15's
candidate added creation, continuation, and takeover machinery while retaining the unusable information hierarchy. Its
tests and browser evidence proved mechanisms, not the owner's task of finding the correct Session.

RunWield needs a larger planning and delivery model in which product experience, implementation, validation, semantic
review, and owner judgment have explicit artifacts and owners. Three prerequisite Plans must land first:

1. `repair-validation-authority-and-recovery`;
2. `simplify-validation-and-lifecycle-messages`; and
3. `generalize-pair-execution-to-engineer`.

## Objective

Replace single-file executable Plans with atomic, revisioned **Plan Packages** and separate implementation from proof:

- a Plan Package directory contains canonical `plan.md`, required `validation.md`, optional UX-specific
  `user-journeys.md`, and generated `manual-qa.md`;
- PROJECT Epics become package folders containing child Plan Package folders;
- Slicer materializes lightweight draft child `plan.md` files, while Planner makes a selected child execution-ready;
- Planner loads a UI/UX planning skill for material browser experiences, inspects the current product, defines journeys
  and representative states, favors a throwaway prototype when it reduces uncertainty, reviews the prototype in a
  browser, waits for owner feedback, and records the accepted direction;
- Engineer implements the approved package, adds required tests and fixtures, uses targeted checks while developing, and
  never claims independent validation;
- a first-class read-only Validator executes `validation.md`, loads a user-journey skill only for UX packages, and sends
  implementation findings to a bounded Validation Repair Engineer;
- a separate read-only Semantic Reviewer runs only after Validator passes and sends findings to a bounded Review Repair
  Engineer;
- every code repair returns through complete validation before semantic re-review;
- Plan omissions return to Planner under a durable `defective` state with structured evidence and preserved work; and
- `validating`, `reviewing`, `validated`, and `defective` become clear lifecycle milestones, with detailed validation
  stages recorded separately from board status.

The option set aside is adding more instructions to the existing single Plan and Frontend Engineer prompt. That would
leave the same agent responsible for implementation and proof, keep product intent mixed into technical prose, and give
missing journeys no independent artifact or lifecycle gate.

## Vertical Slice Findings

The current storage and workflow path is file-shaped from end to end:

```text
docs/plans/<name>.md
  -> plan-store filename identity + single body hash
  -> Planner projection
  -> Engineer executes body + Verification Plan
  -> Mechanical Validation
  -> Semantic Reviewer
  -> publication of one Plan file
```

Plan storage resolves every canonical name directly to `<name>.md`; locks, archive/restore, collaboration hashes,
Plannotator editing, Plan Board resources, execution-worktree copies, lifecycle metadata, and publication all assume one
file. Epic children are files one directory below the Epic name. The migration is therefore a storage, revision,
collaboration, lifecycle, prompt, and UI project rather than a documentation reorganization.

The target boundary is package-shaped:

```text
docs/plans/<name>/
  plan.md             canonical identity, lifecycle, context, implementation specification
  validation.md       approved independent validation contract
  user-journeys.md    optional UX experience contract and prototype reference
  manual-qa.md        generated human-only delivery checklist

approved package revision
  -> Engineer implementation
  -> Validator + optional journey validation
  -> Semantic Reviewer
  -> owner gate when required
  -> publication
```

For Epics:

```text
docs/plans/<epic>/plan.md
docs/plans/<epic>/<child>/plan.md
docs/plans/<epic>/<child>/validation.md
docs/plans/<epic>/<ux-child>/user-journeys.md
```

Only directories containing `plan.md` are Plans. Companion Markdown and generated artifacts never appear as independent
Plans.

## Files to Modify

- `src/plan-store.js` and `src/plan-front-matter.js` — introduce package discovery, canonical identity, aggregate
  revision/hash, locks, archive/restore, migration, child hierarchy, and generated-artifact boundaries.
- `src/shared/workflow/` — split implementation, validation, review, repair, defective-Plan return, owner acceptance,
  and publication into explicit owners and transitions.
- `src/shared/session/` — preserve stable Session and segmented continuation across implementation, validation, repair,
  review, planning return, and revised-package execution.
- `src/agent-definitions/` — revise Planner, Architect, Slicer, Engineer, Frontend Engineer, Validator, Reviewer, and
  bounded repair contracts.
- `src/skills/` — add UI/UX planning and Validator user-journey validation skills; reuse the prototype workflow.
- `src/tools/` — add typed implementation completion, validation result, Plan defect, prototype review, and package
  finalization boundaries.
- `src/cmd/load-plan/` and `src/cmd/plans/` — load, review, share, archive, recover, and migrate packages atomically.
- `src/ui/tui/` and `src/ui/workspace/` — review package artifacts, preview prototypes/candidates, show new lifecycle
  milestones, and collect required owner decisions.
- `docs/plan-lifecycle.md`, `docs/domain-language.md`, `docs/prd/runwield-core-prd.md`, and `docs/design-system.md` —
  define the Plan Package, roles, statuses, experience artifacts, and owner-facing behavior.

## Reuse Opportunities

- Existing Plan frontmatter revision checks, Plan locks, catalog lock, transition journal, archive/restore, and
  collaboration body hashing as inputs to package-level equivalents.
- Existing Planner, Architect, and Slicer workflow, including draft child materialization and ordinary Planner pickup.
- Existing prototype skill and `prototypes/` isolation rules for throwaway design exploration.
- Existing Pair Execution interaction broker for prototype feedback and implementation checkpoints.
- Existing session-independent validation engine, Mechanical Validation commands, Semantic Reviewer, Review Issue
  ledger, and bounded semantic repair segments.
- Existing Manual QA subagent and Epic Manual QA artifact as migration inputs for package-local generated checklists.
- Existing Workspace Plan review, Plannotator, and browser design-system primitives.

## Verification Plan

- Each child Planned Change must provide Objective-Failing Checks in its own package; the Epic itself is not executed.
- Package storage children must prove legacy single-file and Epic layouts migrate without identity loss, duplicate
  Plans, collaboration corruption, archive ambiguity, or unsafe worktree publication.
- Workflow children must prove Engineer cannot mark validation complete, Validator and Reviewer remain read-only, repair
  agents receive bounded context, and every repair re-enters full validation before review.
- UX children must prove Planner cannot make a material UI Plan ready for work without required journeys/prototype
  decision and that Validator cannot approve it without representative journey evidence.
- Lifecycle children must prove a structured Plan defect returns to Planner without being misclassified as an
  implementation failure and preserves the candidate/worktree for an approved revision repair.
- Integration children must exercise the complete flow from Router through Planner, optional prototype review, package
  approval, Pair or autonomous implementation, validation, semantic review, repair, owner QA, and publication.
- Migration and integration must run through `scripts/run-tests.js`, `deno task seams:check`, and `deno task ci`;
  browser children must also run the project's approved browser acceptance framework and headed journeys.

### Outcome Evidence

- **Plan Packages replace executable single files** — every active executable Plan resolves through a directory
  containing `plan.md` and `validation.md`; companion files are not cataloged as Plans; legacy Plans preserve `planId`,
  canonical name, lifecycle history, collaboration relations, and archive state after migration.
- **Package approval is atomic** — changing `plan.md`, `validation.md`, or required `user-journeys.md` changes one
  package revision and invalidates prior approval; generated `manual-qa.md` never mutates that approved specification
  revision.
- **Slicer drafts stay lightweight** — materialized child drafts require only `plan.md`; Planner adds validation and
  optional experience artifacts before `ready_for_work`.
- **Material UI planning proves a user experience before implementation** — an approved UX package contains concrete
  actor/jobs, journey IDs, representative states, information requirements, a recorded prototype decision, and an
  owner-reviewed prototype reference when prototyping was chosen.
- **Engineer no longer validates itself** — Engineer completion produces `implemented` plus bounded implementation
  evidence; only Validator can advance to semantic review.
- **Validator owns the approved validation contract** — every `validation.md` step has a recorded result; UX packages
  map every journey ID to representative automated, browser, and human evidence.
- **Semantic review remains independent** — Reviewer receives the approved package, validated implementation revision,
  diff, and Validator report, and cannot be bypassed by passing tests or owner checkpoints.
- **Repairs never skip proof** — a validation or review repair that changes code causes a new complete Validator pass,
  followed by a new Semantic Reviewer pass.
- **Plan defects return to planning** — Validator, Reviewer, or implementation discovery can record structured
  `planDefect` evidence; status becomes `defective`; Planner revises the package under a new revision and preserves the
  candidate for a bounded Plan-revision repair when safe.
- **Lifecycle is understandable and resumable** — `implemented`, `validating`, `reviewing`, `validated`, `verified`, and
  `defective` have one documented meaning; detailed `validationStage` and repair state resume after process loss without
  adding board-status noise.
- **Manual QA contains only human work** — generated `manual-qa.md` excludes automated checks already performed and
  gives the owner concrete observable actions for remaining judgment.
- **Existing behavior remains protected** — Plan sharing/collaboration, Plannotator review, Plan Board, Epic dependency
  selection, worktree execution, non-Git execution, Objective Checks, Pair Execution, semantic repair, recovery,
  archive/restore, and publication continue through package authorities.
- **Behavior expected to stop existing** — no executable Plan is identified solely by a `.md` filename; Engineer is not
  instructed to run or claim the full validation contract; empty-state browser evidence cannot satisfy a populated UX
  journey; Manual QA is not a substitute for independent validation; semantic review does not repair omitted Plan
  intent.

## Edge Cases & Considerations

- Package migration must coexist with active worktrees and Plans mid-lifecycle; a big-bang rename without recovery proof
  could orphan executable work.
- Package hashes need explicit inclusion rules. Approved specification artifacts belong to the revision; generated QA,
  execution reports, and mutable owner checkboxes do not.
- The prototype is an approved behavioral/visual reference, not production code. Store a stable path plus revision or
  digest and require Frontend Engineer to inspect it without copying its implementation.
- Personas must describe real roles, contexts, knowledge, and constraints rather than fictional demographic prose.
- Validator may execute tests and browser journeys but remains read-only with respect to production code and approved
  package artifacts.
- Validation Repair Engineer, Review Repair Engineer, and Plan-Revision Repair Engineer share the candidate worktree but
  receive different bounded evidence and may not edit lifecycle metadata.
- A Plan defect is not an ordinary test failure. It means the approved specification can pass while the objective fails,
  is contradictory, lacks required authority/information, or cannot define success.
- `validating` and `reviewing` should be durable milestone statuses; detailed stages such as `ux_journeys` belong in a
  separate resumable field so the board remains legible.
- Direct user edits remain supported. Package-level compare-and-set must preserve user-owned Markdown without allowing
  partial approval of mismatched artifact revisions.
- The Epic should be decomposed only after all three prerequisite Plans land and the current validation authority model
  is re-audited.
