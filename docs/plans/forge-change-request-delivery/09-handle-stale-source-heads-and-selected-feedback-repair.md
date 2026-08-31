---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/workflow/validation-repair-prompt.ts"
    - "src/shared/workflow/validation-merge-repair.ts"
    - "src/shared/workflow/validation-semantic.ts"
    - "src/shared/workflow/"
    - "src/shared/worktree-registry.js"
    - "src/cmd/load-plan/"
    - "src/ui/tui/"
    - "src/testing/"
executionAgent: "engineer"
createdAt: "2026-08-31T02:51:47.998Z"
status: "draft"
origin: "internal"
parentPlan: "forge-change-request-delivery"
order: 9
dependencies:
    - "08-add-fork-delivery-and-upstream-participation-consent"
planId: "a1f16e7c-57d6-4aa6-8a21-2b186d8bef95"
targetBranch: "project/forge-change-request-delivery"
---

# Handle stale source heads and selected feedback repair

## Context

A Forge Change Request can change while RunWield is offline or while reviewers act in the Forge. If the published source
head no longer equals the sealed candidate, local readiness is stale. Review feedback is also untrusted text and must
reach repair only by explicit user selection.

## Objective

Detect changed source heads, block stale delivery proof, and support user-selected Forge feedback as input to existing
repair and revalidation. Repair creates a new immutable candidate generation and updates the same PR or MR.

## Approach

Make refresh observation-only unless the user chooses a repair action. Bind the selected feedback to provider feedback
ID, observed edit revision or timestamp, and exact selected text bytes or digest-backed snapshot.

```text
refresh Forge state
  source head != candidate head -> stale
  selected feedback + same text version
      -> repair
      -> local validation and review
      -> new candidate generation
      -> update same PR/MR
```

The option set aside is to send all PR comments to the repair Agent automatically. That is faster, but it turns
untrusted external text into instructions.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- Forge coordinator modules under `src/shared/workflow/` — detect stale source heads, persist selected feedback
  receipts, and route repair.
- `src/shared/workflow/validation-repair-prompt.ts`, `validation-merge-repair.ts`, and `validation-semantic.ts` — reuse
  existing repair and revalidation flow.
- `src/shared/worktree-registry.js` — mark superseded, stale, and replacement candidate generations.
- `src/cmd/load-plan/` and `src/ui/tui/` — offer inspect, restore, repair, or stop choices for stale and feedback
  states.
- `src/testing/` — add edited comment, stale head, repair, and revalidation tests.

## Reuse Opportunities

- Existing Semantic and Local Human Code Review repair handoffs — reuse bounded repair instead of adding a
  Forge-controlled repair Agent.
- Candidate generation state from earlier children — reuse immutable generation and supersession markers.
- Validation restart tests — reuse process-loss patterns around repair and revalidation.

## Implementation Steps

- [ ] Refresh marks the current candidate stale when the provider source head differs from the sealed candidate head.
- [ ] Stale source heads block merge proof and finalization until the user explicitly restores, inspects, or resumes
      repair and revalidation.
- [ ] A selected feedback receipt binds provider feedback ID, observed edit revision or timestamp, and exact selected
      text bytes or digest-backed immutable snapshot.
- [ ] If provider text changes after selection, repair stops and requires a new user selection.
- [ ] Repair receives only the selected feedback version, then runs applicable validation and review before creating a
      new candidate generation.
- [ ] The old candidate generation is marked superseded; its proof is not rewritten.
- [ ] GitHub and GitLab behavior use the same coordinator path.

## Verification Plan

- Automated: run focused stale-head, feedback selection, repair, revalidation, and provider parity tests with
  `deno run -A scripts/run-tests.js <test paths>`.
- Automated: prove edited feedback requires reselection.
- Automated: prove automatic refresh cannot change code, Plan definition, lifecycle state, or Agent instructions.
- Automated: prove repair creates a new candidate generation and does not rewrite prior proof.
- Expected result: stale external changes cannot inherit old validation, and selected feedback can drive a safe repair
  loop.

## Edge Cases & Considerations

- Unexpected force-pushes and collaborator commits must preserve the local candidate.
- Closed-unmerged requests should keep recovery evidence and offer clear next choices.
- User selection UI may be minimal here; full UI polish is a later child.
