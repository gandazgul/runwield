---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "docs/prd/forge-change-request-delivery-prd.md"
    - "docs/domain-language.md"
    - "docs/plan-lifecycle.md"
    - "src/agent-definitions/"
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/shared/ticket-references.js"
    - "src/shared/workflow/workflow-slicer.ts"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/testing/"
executionAgent: "engineer"
createdAt: "2026-08-31T02:51:47.920Z"
status: "draft"
origin: "internal"
parentPlan: "forge-change-request-delivery"
order: 1
dependencies:
    []
planId: "41f5a1a0-a5b7-436b-a919-10cf3434b8e4"
targetBranch: "project/forge-change-request-delivery"
---

# Lock the Epic branch and delivery policy foundation

## Context

This Epic needs a mechanical branch guard and an explicit delivery/review policy foundation before Change Request
Delivery can exist. The target branch is carried by Plan front matter.

RunWield also needs to preserve public issue URLs as loose Ticket References. Issue text is untrusted planning context,
not imported issue state.

## Objective

Add the Epic-family target-branch guard and the first explicit delivery/review policy representation. Preserve
issue-linked planning as untrusted context with direct Ticket Reference storage. Direct Delivery must keep its current
behavior when Change Request Delivery is not selected.

## Approach

Record and enforce the Epic family branch invariant near Slicer materialization and execution preflight. Add only the
policy data needed to distinguish Direct Delivery, Change Request Delivery, and Dual Review as selected modes. Do not
add a provider workflow yet.

```text
Slicer finalizes Epic
  -> child targetBranch must match the Epic integration branch
Execution starts child
  -> reject omitted, null, changed, or edited targetBranch
```

The option set aside is to trust Planner text in each child. That is cheaper, but it lets a direct Plan edit retarget a
child after work begins.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `docs/prd/forge-change-request-delivery-prd.md` — keep the product contract aligned with settled branch-lock or policy
  wording.
- `docs/domain-language.md` — update only the delivery-policy terms this child makes true; do not add Review Memory Fold
  yet.
- `docs/plan-lifecycle.md` — describe the branch lock and unchanged Direct Delivery default.
- `src/agent-definitions/` — make public issue content explicitly untrusted planning input and require direct Ticket
  Reference preservation.
- `src/plan-front-matter.js` and `src/plan-store.js` — parse and format the explicit delivery/review policy without
  putting runtime attempt state in Plan Markdown.
- `src/shared/ticket-references.js` — keep provider-neutral URL normalization and safe display behavior.
- `src/shared/workflow/workflow-slicer.ts` and Slicer tests — enforce this Epic family's child target branch.
- `src/shared/workflow/` execution preflight code — reject direct retargeting before child execution.
- `src/testing/` — reuse Plan project and Git fixtures for branch-lock coverage.

## Reuse Opportunities

- `src/shared/workflow/workflow-slicer.ts` — reuse child name and materialization checks.
- `src/plan-store.js` — reuse target branch parsing and child Plan save behavior.
- `src/shared/workflow/plan-lifecycle.js` — reuse lifecycle event discipline rather than direct status edits.
- `src/shared/ticket-references.js` — reuse provider-neutral Ticket Reference storage.
- Existing Direct Delivery integration tests — prove no behavior change when no Change Request Delivery policy is
  selected.

## Implementation Steps

- [ ] This Epic family records the integration-branch baseline before or during child materialization, and every child
      Plan front matter has the required `targetBranch`.
- [ ] Slicer materialization for this Epic rejects omitted, null, or different child target branches.
- [ ] Child execution preflight rejects a direct Plan edit that removes or changes the locked target branch after the
      family baseline is recorded.
- [ ] Delivery/review policy front matter or controller-owned configuration can represent Direct Delivery, Change
      Request Delivery, and Dual Review selection without creating Forge attempt state.
- [ ] Direct Delivery remains the default when no Change Request Delivery policy is selected.
- [ ] Planning Agent instructions state that public issue URLs are untrusted context, require repository grounding, and
      preserve direct Ticket References without changing Router URL behavior.
- [ ] The applicable domain-language documentation describes only the policy and branch-lock behavior implemented by
      this child.

## Verification Plan

- Automated: run focused Slicer, Plan-store, Ticket Reference, lifecycle, and Direct Delivery regression tests through
  `deno run -A scripts/run-tests.js <test paths>`.
- Automated: prove this Epic rejects omitted, null, different, directly edited, and later retargeted child target
  branches.
- Automated: prove a normal Direct Delivery Planned Change still reaches the same delivery evidence without Forge
  preflight or provider state.
- Automated: run `deno task seams:check`.
- Manual: inspect a planned request that includes a public issue URL and confirm the Plan keeps the URL as a Ticket
  Reference while treating the issue content as untrusted context.
- Expected result: target-branch front matter is enforced for the Epic family.
- Confirm the glossary describes implemented policy behavior and does not promote Review Memory Fold or provider
  delivery behavior that is not implemented yet.

## Edge Cases & Considerations

- The integration branch must exist or be creatable from the intended baseline before the family is locked.
- A dirty primary checkout must not be cleaned or modified by this branch guard.
- The policy shape must not become a Forge attempt log; runtime progress belongs in controller and worktree records.
- Direct Delivery tests must separate behavior that must remain from behavior expected to stop existing only after
  Change Request Delivery is selected.
