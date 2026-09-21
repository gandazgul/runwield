---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/workflow/workflow-slicer.ts"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/"
    - "src/shared/worktree.js"
    - "src/shared/worktree-registry.js"
    - "src/shared/isolated-publication.ts"
    - "src/shared/epic-artifacts.ts"
    - "src/agent-definitions/"
    - "src/tools/"
    - "docs/plan-lifecycle.md"
    - "docs/domain-language.md"
    - "docs/prd/runwield-core-prd.md"
executionAgent: "engineer"
createdAt: "2026-09-21T17:14:01.408Z"
status: "draft"
origin: "internal"
parentPlan: "plan-packages-and-independent-validation"
order: 6
dependencies:
    - "05-repair-findings-through-one-recoverable-loop"
targetBranch: "epic/plan-packages-and-independent-validation"
planId: "5a7fd331-f2b4-4b1b-9b79-324a3b55ecb1"
---

# Assemble and Validate Epics on Epic Branches

## Context

Current child completion can advance a parent Epic from child statuses, even when a child has not delivered its
candidate to a common assembly. Missing targets can also be created from implicit local `main`. This allows partial work
to reach the primary branch and lets status bookkeeping stand in for integrated proof.

This child makes future Epics the default release unit. It assembles children on an explicit Epic branch and validates
the exact assembled result. It does not publish that Epic branch to primary; the dependent Epic publication workflow
owns that later action.

## Objective

Give each new Epic a reviewed destination and intended creation base, inherit that destination into children by default,
require real delivery containment before automatic Epic implementation, and run the Epic validation contract against
pinned assembly inputs without creating an Epic execution role or durable worktree.

## Approach

Record the Epic branch and intended base as authored target policy. Reuse isolated Git and publication evidence to prove
each included child candidate is contained in the current assembly head. Let the controller create a temporary
validation checkout bound to the Epic package revision, child-set revision, receipts, accepted gaps, exact commit, and
generation.

```text
child delivery receipts
  -> containment in Epic branch
  -> settled outcomes and accepted gaps
  -> Epic implemented
  -> integrated Validator on pinned assembly
  -> Epic validated or report to Planner
```

The option set aside is parent success from terminal child statuses; status cannot prove delivery or the assembled
behavior.

## Expected Change Surface

The boundaries below are guidance, not an allowlist: verify the real footprint during implementation and change whatever
the Implementation Steps need, including files not named here. Stop and report only when discovery changes approved
intent — the change reaches another subsystem, public behavior or architecture shifts, migration or compatibility risk
grows, or the Verification Plan no longer proves the objective.

- `src/shared/workflow/workflow-slicer.ts` — inheritance of reviewed Epic destination and stable child outcome
  references.
- `src/shared/workflow/plan-lifecycle.js` and related workflow modules — settlement, accepted gaps, integrated attempt
  identity, staleness, and repair-child return.
- `src/shared/worktree.js`, `src/shared/worktree-registry.js`, and `src/shared/isolated-publication.ts` — intended
  branch base, containment, temporary assembly checkout, and real Git evidence.
- `src/shared/epic-artifacts.ts` — integrated reports and advisory Epic QA.
- `src/agent-definitions/` and `src/tools/` — Architect integrated contracts, Slicer outcome mapping, Validator input,
  and repair-child creation.
- `docs/plan-lifecycle.md`, `docs/domain-language.md`, and `docs/prd/runwield-core-prd.md` — Epic branch, assembly,
  done-enough, and integrated validation behavior.

## Reuse Opportunities

- Existing child target inheritance in `workflow-slicer.ts`.
- Worktree registry and isolated publication ancestry and compare-and-swap evidence.
- Existing validation controller without adding an Epic Engineer phase.
- Current Epic done-enough interaction and generated Epic artifacts.
- Real Git fixtures in `src/shared/git-test-fixture.ts`.

## Implementation Steps

- Future Architect output records an Epic destination and intended creation base; ambiguous repository targets require
  owner review rather than implicit local `main`.
- New child drafts inherit the reviewed Epic target by default, while explicit child overrides stay explicit and
  approved or active work is not silently retargeted.
- Missing Epic branches are created from the recorded resolved base commit, and existing targets are inspected rather
  than reset.
- Automatic Epic `implemented` requires every included child to be settled and its delivered candidate to be contained
  in the exact assembly revision; validation status without delivery is insufficient.
- Closed, excluded, or omitted outcomes have explicit dispositions; done-enough records accepted gaps and can produce
  `implemented` without creating synthetic passing evidence.
- Integrated attempt identity binds Epic `planId`, approved package revision, repository and ref, exact commit,
  child-set revision, delivery receipts, outcome claims, accepted gaps, and generation.
- Integrated Validator runs in a controller-owned temporary checkout with no Epic Engineer, no Epic AI Reviewer, and no
  durable Epic execution worktree.
- Every integrated outcome and check is accounted for; human-only or unavailable procedures become advisory Epic
  `manual-qa.md`, while a claimed outcome that fails remains a validation failure.
- Branch movement, package edits, changed child set, changed receipts, or accepted-gap changes make prior integrated
  evidence stale without deleting its history.
- A failing integrated run returns the complete report and stable failed outcome IDs to Planner; the approved repair is
  a child Plan whose delivery triggers a full integrated rerun.
- Explicit per-child targets count only when their delivered commits are contained in the declared common assembly;
  validation never silently merges mixed targets.
- Non-Git Epics use a defined source snapshot and do not claim branch isolation or Git evidence.
- Core Epic decomposition and hold requirements and scenarios match delivered branch inheritance, containment, accepted
  gaps, integrated failure, and owner acceptance behavior.
- The glossary defines Epic branch, Epic assembly, integrated validation, and accepted gap with their stable
  relationship to child delivery and proof.

## Verification Plan

- Automated: run focused Epic, Slicer, worktree, publication, and lifecycle tests through
  `deno run -A scripts/run-tests.js src/shared/workflow/workflow-slicer.integration.test.ts src/shared/workflow/plan-lifecycle.test.js src/shared/worktree-creation.test.js src/shared/isolated-publication.test.ts src/shared/epic-artifacts.test.ts`,
  adjusting only to actual discovered test paths.
- Automated: prove new children inherit the reviewed Epic target and creation uses the recorded base rather than
  hard-coded `main`; prove explicit overrides remain intact.
- Automated: prove a `validated` or `user_validated` child with pending delivery cannot settle the Epic, and only
  current candidate containment counts.
- Automated: prove done-enough records omitted outcomes as gaps while an implemented-but-failing claimed outcome remains
  a failure.
- Automated: prove integrated validation uses pinned package, child set, receipts, and commit; change each input and
  confirm old evidence becomes stale.
- Automated: prove the temporary checkout is recovered or cleaned only when owned, and no durable Epic execution
  worktree or Epic Engineer phase is created.
- Automated: prove an integrated failure creates a reviewable repair-child request with failed outcome IDs and a
  delivered repair triggers a complete rerun.
- Automated: run `deno task seams:check` and `deno task ci`.
- Manual: exercise a multi-child Epic from branch creation through child delivery, pending-delivery containment,
  accepted gap, integrated failure, repair child, rerun, and `validated`.
- Documentation: confirm Core PRD, lifecycle, and glossary changes land with behavior and do not claim Epic-to-primary
  publication.

## Edge Cases

- Existing active attempts retain their recorded target unless the user chooses recovery.
- Scope changes and added children change assembly identity even if the branch head is unchanged.
- Status or report writes must not move the source commit being certified.
- Explicit child publication to primary is allowed only as reviewed policy; integrated validation still pins the
  declared common assembly.
- The later publication Epic must revalidate its merge candidate against then-current primary content.
