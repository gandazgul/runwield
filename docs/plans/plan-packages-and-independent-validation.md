---
planId: "c3de7406-8856-4908-b131-4e387be39aac"
classification: "PROJECT"
complexity: "HIGH"
summary: "Rebuild RunWield planning and delivery around versioned Plan Package folders, a first-class independent Validator that also validates Epics, default Epic branches with integrated validation before an Epic is verified, separate semantic review, bounded repair roles, and a durable user-approved defective-Plan return path."
affectedPaths:
    - "docs/plans/"
    - "src/plan-store.js"
    - "src/plan-front-matter.js"
    - "src/shared/workflow/"
    - "src/shared/epic-artifacts.ts"
    - "src/shared/session/"
    - "src/agent-definitions/"
    - "src/tools/"
    - "src/cmd/load-plan/"
    - "src/cmd/plans/"
    - "src/ui/tui/"
    - "src/ui/workspace/"
    - "docs/plan-lifecycle.md"
    - "docs/domain-language.md"
    - "docs/prd/runwield-core-prd.md"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-14T00:11:43-04:00"
status: "draft"
---

# Plan Packages and Independent Validation

## Context

RunWield currently stores each executable Plan as one Markdown file. Planner combines product context, architecture,
implementation steps, validation procedures, and manual QA expectations in that file. Engineer then implements the Plan
and is instructed to run its full Verification Plan before the same workflow moves through Mechanical Validation and
semantic review.

This shape has produced strong technical machinery but weak separation of responsibility. The Plan can omit a basic user
outcome while still satisfying all written checks, and the implementation Agent can mistake partial evidence for proof
that the whole Plan is complete. Semantic Reviewer is correctly limited to the approved Plan and therefore cannot repair
missing intent. Manual QA is generated late and does not act as an independent acceptance gate.

A second gap sits one level up. Today each child FEATURE publishes into the primary checkout as it finishes, so every
slice is treated as a release. That is often wrong. An Epic frequently builds one capability that has no user until
every child lands. The per-child release model has three costs: partial work reaches the main branch; the implementation
Agent narrates the gap inside the product itself, with controls labeled as unavailable until a later slice; and nothing
ever proves the assembled Epic works. Validation is per-child, so integration defects between children are exactly what
it cannot see. The Epic aggregate that exists today, `docs/plans/<epic>/manual-qa.md`, states in its own header that it
is advisory and does not change verification status, and both routes to a verified Epic (`epic_done_enough` and user
attestation) are declarations rather than proof.

RunWield needs a planning and delivery model in which implementation, validation, semantic review, and owner judgment
have explicit artifacts and owners. Stronger frontend experience planning is a separate dependent PROJECT,
`plan-package-frontend-experience-planning`; it should build on this foundation rather than expand its storage and
lifecycle migration. Three prerequisite Plans must land first:

1. `repair-validation-authority-and-recovery`;
2. `simplify-validation-and-lifecycle-messages`; and
3. `generalize-pair-execution-to-engineer`.

## Objective

Replace single-file executable Plans with atomic, revisioned **Plan Packages** and separate implementation from proof:

- a Plan Package directory contains canonical `plan.md`, required `validation.md`, and generated `manual-qa.md` when
  genuinely human-only checks remain;
- PROJECT Epics become package folders containing child Plan Package folders;
- Slicer materializes lightweight draft child `plan.md` files, while Planner authors `validation.md` and makes a
  selected child execution-ready;
- the existing Verification Adversary challenges whether the proposed validation contract can distinguish a real
  implementation from a counterfeit one before package approval;
- Engineer implements the approved package, adds required tests and fixtures, uses targeted checks while developing, and
  never claims independent validation;
- a first-class Validator executes every machine-executable and agent-executable step in `validation.md` for FEATURE
  Plans, Epic children, and Epics themselves, remains read-only with respect to the candidate and approved package, and
  submits implementation findings to orchestration;
- orchestration sends Validator findings to a bounded Validation Repair Engineer;
- a separate read-only Semantic Reviewer runs only after Validator passes and submits findings that orchestration sends
  to a bounded Review Repair Engineer;
- every code repair returns through complete validation before semantic re-review;
- an Engineer, Validator, or Reviewer may propose a Plan defect, but only the user can approve the rare transition that
  returns the package to Planner under a durable `defective` state with structured evidence and preserved work;
- implementation, validation, review, and repair use role-specific completion boundaries instead of overloading
  `task_completed`;
- `implemented`, `validating`, `reviewing`, optional `awaiting_owner_review`, `verified`, and `defective` become clear
  lifecycle milestones, with detailed validation stages recorded separately from board status;
- a PROJECT Epic gets its own target branch by default, named by Architect; children take execution worktrees from that
  branch and publish into it, and the user can override this to per-child publication into the primary checkout;
- an Epic reaches `implemented` when every child is settled or the user marks it done enough, and Validator then runs
  the Epic's own `validation.md` against the assembled Epic branch before the Epic can reach `verified`;
- integrated validation separates "built and broken" from "never built", so a done-enough Epic records accepted gaps and
  still fails on a settled child whose claimed outcome does not work;
- an integrated-validation failure returns to Planner with the complete report and becomes a child Plan focused on those
  failures, carrying the failed outcome identifiers in its own validation contract; and
- `verified` on an Epic means the Epic branch is proven and ready to merge. RunWield does not merge it. Merging the Epic
  branch into the primary branch is a separate dependent PROJECT, `epic-branch-publication-workflow`.

No-plan QUICK_FIX workflow behavior is unchanged in this PROJECT. QUICK_FIX continues through its existing Engineer and
Mechanical Validation path.

The option set aside is adding more instructions to the existing single Plan and Engineer prompt. That would leave the
same agent responsible for implementation and proof, keep the validation contract mixed into implementation prose, and
provide no independent authority for deciding whether the approved proof actually passed.

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
  manual-qa.md        generated human-only delivery checklist

approved package revision
  -> Engineer implementation
  -> Validator
  -> Semantic Reviewer
  -> owner gate when required
  -> publication
```

For Epics:

```text
docs/plans/<epic>/plan.md           Epic identity, lifecycle, architecture
docs/plans/<epic>/validation.md     integrated validation contract
docs/plans/<epic>/manual-qa.md      advisory aggregate, generated as today
docs/plans/<epic>/<child>/plan.md
docs/plans/<epic>/<child>/validation.md
```

Only directories containing `plan.md` are Plans. Companion Markdown and generated artifacts never appear as independent
Plans.

The Epic release path changes shape too. Children stop publishing into the primary checkout one at a time:

```text
child 3 ──┐
child 4 ──┼──▶ Epic branch ──▶ Epic implemented ──▶ integrated validation ──▶ verified
child 5 ──┘    no Epic worktree                     Validator, read-only      branch is proven
                                                                              and ready to merge
```

`implemented` already means what this needs: implementation finished, Workflow Validation still to run. The Epic has no
way to reach it, because the only transition into `implemented` starts from `in_progress` and an Epic never enters
`in_progress`. So this is one new transition, not a new status. `epic_done_enough` changes target from `verified` to
`implemented` and records the accepted gaps, which also removes the current exception in `docs/plan-lifecycle.md` that
lets an Epic reach `verified` without Workflow Validation.

The Epic stays non-executable. No Engineer ever works at Epic level and the Epic never owns an execution worktree.
Validator is read-only by design, so it can run against the Epic branch without giving the Epic write authority. An
integrated failure becomes an ordinary child Plan through Planner, so every fix stays a planned, validated, reviewed
change.

## Files to Modify

- `src/plan-store.js` and `src/plan-front-matter.js` — introduce package discovery, canonical identity, aggregate
  revision/hash, locks, archive/restore, migration, child hierarchy, and generated-artifact boundaries.
- `src/shared/workflow/` — split implementation, validation, review, repair, defective-Plan return, owner acceptance,
  and publication into explicit owners and transitions.
- `src/shared/session/` — preserve stable Session and segmented continuation across implementation, validation, repair,
  review, planning return, and revised-package execution.
- `src/agent-definitions/` — revise Planner, Architect, Slicer, Engineer, Validator, Reviewer, and bounded repair
  contracts. Architect names a default Epic branch instead of setting `worktreeBaseBranch` only on request
  (`architect.md:209`); Slicer already passes the parent branch to children (`slicer-prompt.md:134`).
- `src/shared/epic-artifacts.ts` — keep the advisory aggregate checklist and add the Epic's executed validation contract
  beside it.
- `src/tools/` — add typed implementation completion, validation result, Plan defect, and package finalization
  boundaries; give repair roles their own completion signal rather than reusing implementation completion.
- `src/cmd/load-plan/` and `src/cmd/plans/` — load, review, share, archive, recover, and migrate packages atomically.
- `src/ui/tui/` and `src/ui/workspace/` — review package artifacts and candidates, show new lifecycle milestones, and
  collect required owner decisions.
- `docs/plan-lifecycle.md`, `docs/domain-language.md`, and `docs/prd/runwield-core-prd.md` — define the Plan Package,
  roles, statuses, validation contract, and owner-facing behavior.

## Reuse Opportunities

- Existing Plan frontmatter revision checks, Plan locks, catalog lock, transition journal, archive/restore, and
  collaboration body hashing as inputs to package-level equivalents.
- Existing Planner, Architect, and Slicer workflow, including draft child materialization and ordinary Planner pickup.
- Existing session-independent validation engine, Mechanical Validation commands, Semantic Reviewer, Review Issue
  ledger, and bounded semantic repair segments.
- Existing Manual QA subagent and Epic Manual QA artifact, which stay advisory and keep their current aggregation
  behavior, as migration inputs for package-local generated checklists.
- Existing `worktreeBaseBranch` front matter, Slicer branch inheritance, and per-child worktree creation, which already
  support children executing from and publishing into an Epic branch.
- Existing Workspace Plan review, Plannotator, and browser design-system primitives.

## Verification Plan

- Each child Planned Change must provide a `validation.md` whose steps are classified as machine-executable,
  agent-executable, or genuinely human-only. The Epic must provide its own `validation.md` for integrated validation.
  The Epic is still never executed — no Engineer works at Epic level and the Epic owns no execution worktree — but it is
  validated.
- Epic branch children must prove Architect names a default Epic branch, Slicer passes it to every child, children take
  worktrees from it and publish into it, and an explicit user override restores per-child publication into the primary
  checkout.
- Epic validation children must prove an Epic reaches `implemented` only when every child is settled or the user marked
  it done enough, that Validator executes the Epic `validation.md` read-only against the Epic branch, and that
  `verified` requires a passing integrated run rather than an attestation.
- Done-enough children must prove a done-enough Epic still runs integrated validation, records outcomes that were never
  built as accepted gaps, and still fails when a settled child's claimed outcome does not work.
- Integrated-failure children must prove a failing Epic validation produces a Planner-owned child Plan that carries the
  complete report and the failed outcome identifiers inside its own validation contract, and that the Epic cannot reach
  `verified` until that child lands and integrated validation runs again.
- Planner-authored Objective-Failing Checks must remain red-before/green-after and the Verification Adversary must
  challenge whether the package contract discriminates real completion from counterfeit evidence before approval.
- Package storage children must prove legacy single-file and Epic layouts migrate without identity loss, duplicate
  Plans, collaboration corruption, archive ambiguity, or unsafe worktree publication.
- Workflow children must prove Engineer cannot mark validation complete, Validator and Reviewer remain read-only, repair
  agents receive bounded context, and every repair re-enters full validation before review.
- Lifecycle children must prove a proposed Plan defect cannot change lifecycle state without user approval, and that an
  approved defect returns to Planner without being misclassified as an implementation failure while preserving the
  candidate/worktree for an approved revision repair.
- Integration children must exercise the complete flow from Router through Planner, package approval, autonomous
  implementation, validation, semantic review, repair, optional owner QA, and publication.
- Migration and integration must run through `scripts/run-tests.js`, `deno task seams:check`, and `deno task ci`;
  children that change browser surfaces must also run the project's approved browser acceptance framework.

### Outcome Evidence

- **Plan Packages replace executable single files** — every active executable Plan resolves through a directory
  containing `plan.md` and `validation.md`; companion files are not cataloged as Plans; legacy Plans preserve `planId`,
  canonical name, lifecycle history, collaboration relations, and archive state after migration.
- **Package approval is atomic** — changing `plan.md` or `validation.md` changes one package revision and invalidates
  prior approval; generated `manual-qa.md` never mutates that approved specification revision.
- **Slicer drafts stay lightweight** — materialized child drafts require only `plan.md`; Planner adds `validation.md`
  before `ready_for_work`.
- **Engineer no longer validates itself** — Engineer completion produces `implemented` plus bounded implementation
  evidence; only Validator can advance to semantic review.
- **Validator owns execution of the approved validation contract** — every `validation.md` step has a recorded result;
  Validator may create ephemeral probes and evidence outside the candidate but cannot modify production code or the
  approved package.
- **Semantic review remains independent** — Reviewer receives the approved package, validated implementation revision,
  diff, and Validator report, and cannot be bypassed by passing tests or owner checkpoints.
- **Repairs never skip proof** — a validation or review repair that changes code causes a new complete Validator pass,
  followed by a new Semantic Reviewer pass.
- **Plan defects require owner judgment** — Validator, Reviewer, or implementation discovery can propose structured
  `planDefect` evidence, but only user approval makes the status `defective`; Planner then revises the package under a
  new revision and preserves the candidate for a bounded Plan-revision repair when safe.
- **Lifecycle is understandable and resumable** — `implemented`, `validating`, `reviewing`, optional
  `awaiting_owner_review`, `verified`, and `defective` have one documented meaning; detailed validation/review stages
  and repair state resume after process loss without adding board-status noise.
- **Completion signals cannot cross authority boundaries** — implementation completion, validation completion, review
  completion, and repair completion are role-scoped; one role's completion cannot advance another role's state.
- **Manual QA contains only human work** — generated `manual-qa.md` excludes automated checks already performed and
  gives the owner concrete observable actions for remaining judgment. The Epic aggregate keeps its current advisory
  meaning and gains an executed sibling rather than being replaced.
- **The Epic is the default release unit** — a PROJECT Epic carries a named target branch, children execute from it and
  publish into it, no child reaches the primary branch on its own, and an explicit user override restores per-child
  publication.
- **The Epic is validated without becoming executable** — the Epic owns a `validation.md`, reaches `implemented` when
  its children are settled, and reaches `verified` only after Validator executes that contract read-only against the
  assembled branch. No Engineer runs at Epic level and the Epic never owns an execution worktree.
- **Done enough stays honest** — an Epic marked done enough still runs integrated validation. Outcomes no child claimed
  are recorded as accepted gaps; an outcome a settled child claimed and cannot demonstrate is a failure, not a gap.
- **Integrated failures reopen planning, not execution** — a failing Epic validation returns the full report to Planner
  and produces a focused child Plan whose validation contract names the failed outcomes.
- **A verified Epic branch is proven, not shipped** — `verified` means the branch is ready to merge and the merge stays
  the user's decision in this PROJECT.
- **QUICK_FIX remains stable** — no-plan QUICK_FIX behavior and its existing Mechanical Validation path do not change.
- **Existing behavior remains protected** — Plan sharing/collaboration, Plannotator review, Plan Board, Epic dependency
  selection, worktree execution, non-Git execution, Objective Checks, Pair Execution, semantic repair, recovery,
  archive/restore, and publication continue through package authorities.
- **Behavior expected to stop existing** — no executable Plan is identified solely by a `.md` filename; Engineer is not
  instructed to run or claim the full validation contract; Manual QA is not a substitute for independent validation;
  semantic review does not repair omitted Plan intent; `task_completed` is not reused as a universal repair or
  validation transition; Epic children do not publish into the primary branch by default; and an Epic does not reach
  `verified` on attestation alone.

## Edge Cases & Considerations

- Package migration must coexist with active worktrees and Plans mid-lifecycle; a big-bang rename without recovery proof
  could orphan executable work.
- Package hashes need explicit inclusion rules. Approved specification artifacts belong to the revision; generated QA,
  execution reports, and mutable owner checkboxes do not.
- Validator may execute tests, browser checks, and temporary probes but remains read-only with respect to production
  code and approved package artifacts. Ephemeral evidence must live outside the candidate and cannot affect its diff.
- Validation Repair Engineer, Review Repair Engineer, and Plan-Revision Repair Engineer share the candidate worktree but
  receive different bounded evidence and may not edit lifecycle metadata.
- A Plan defect is not an ordinary test failure. It means the approved specification can pass while the objective fails,
  is contradictory, lacks required authority/information, or cannot define success. Because this should be rare, an
  Agent only proposes the defect with evidence and the user decides whether planning reopens.
- `validating`, `reviewing`, and optional `awaiting_owner_review` should be durable milestone statuses; detailed stages
  belong in a separate resumable field so the board remains legible.
- Direct user edits remain supported. Package-level compare-and-set must preserve user-owned Markdown without allowing
  partial approval of mismatched artifact revisions.
- "Every child is settled" needs one definition. Verified, user-verified, closed without verification, and explicitly
  excluded children all settle; a child still in `failed`, `implemented`, or `in_progress` does not. An Epic must not
  reach `implemented` while a child is mid-flight.
- Moving `epic_done_enough` from `verified` to `implemented` changes a documented board rule. `docs/plan-lifecycle.md`
  currently names it as the one exception that reaches `verified` without Workflow Validation; that exception goes away
  and existing done-enough Epics need a defined read after migration.
- An Epic branch can live for weeks while the primary branch moves. This PROJECT proves the Epic branch in isolation and
  deliberately stops there. Proving the Epic against current primary-branch content belongs to
  `epic-branch-publication-workflow`, and the gap between the two is a known and accepted risk until that PROJECT lands.
- The Epic branch default must not break single-child Epics, non-Git projects, or Epics the user explicitly wants to
  publish per child. The override has to be reachable through ordinary Plan feedback, not only at Architect time.
- Integrated validation runs against work that is already merged into the Epic branch, so it has no candidate diff of
  its own. Semantic review at Epic level is out of scope: each child was already reviewed against its own approved
  package.
- The Epic should be decomposed only after all three prerequisite Plans land and the current validation authority model
  is re-audited.
