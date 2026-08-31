---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/workflow/"
    - "src/shared/worktree-registry.js"
    - "src/cmd/load-plan/"
    - "src/ui/tui/"
    - "src/testing/"
executionAgent: "engineer"
createdAt: "2026-08-31T02:51:47.969Z"
status: "draft"
origin: "internal"
parentPlan: "forge-change-request-delivery"
order: 6
dependencies:
    - "05-prove-github-merge-and-finalize-planned-delivery"
planId: "418fdbcc-215e-46cc-ae20-eb551db92143"
targetBranch: "project/forge-change-request-delivery"
---

# Open and refresh GitLab shared-repository MRs

## Context

GitHub shared-repository delivery now proves the reference path. GitLab support must enter through the same Forge
contract and not create a parallel lifecycle.

## Objective

Prepare a validated candidate for a shared GitLab source branch, create or find the matching merge request, and refresh
the In Review state using the same coordinator shapes as GitHub.

## Approach

Add the GitLab opening/refresh path as the provider-parity version of the GitHub In Review slice. Keep final merge proof
for the next child.

```text
Coordinator shared path
  -> ForgePort adapter = GitLab
  -> source ref equals sealed candidate
  -> create/find MR
  -> refresh normalized In Review facts
```

The option set aside is a GitLab-specific coordinator branch. That would move provider vocabulary into application
lifecycle and weaken parity tests.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- Forge coordinator and GitLab adapter modules under `src/shared/workflow/` — connect GitLab shared-repository MR
  opening and refresh.
- `src/shared/worktree-registry.js` — persist GitLab MR identity using provider-neutral attempt fields.
- `src/cmd/load-plan/` and `src/ui/tui/` — show provider-neutral In Review state without GitLab-specific lifecycle
  labels.
- `src/testing/` — add GitLab opening, refresh, retry, and Direct Delivery regression tests.

## Reuse Opportunities

- GitHub opening tests — reuse scenario shape and assertions for provider parity.
- Forge port contract tests — reuse normalized shapes and unsupported-capability reporting.
- Source-ref publication logic — reuse lease and idempotency behavior across providers.

## Implementation Steps

- [ ] Selecting Change Request Delivery for a supported GitLab shared repository seals the same candidate generation
      shape as GitHub.
- [ ] The GitLab source ref equals the sealed candidate generation and uses lease protection.
- [ ] Retrying after timeout finds the existing MR before creating another one.
- [ ] The live attempt records GitLab MR identity, URL, source/target refs, observed head, and In Review phase through
      provider-neutral fields.
- [ ] Refresh updates normalized review/check observations without changing Plan status, lifecycle, code, or Agent
      instructions.
- [ ] The coordinator contains no GitLab-specific lifecycle branch.

## Verification Plan

- Automated: run focused GitLab shared-repository opening and refresh tests with
  `deno run -A scripts/run-tests.js <test paths>`.
- Automated: run provider parity tests that compare GitHub PR and GitLab MR normalized In Review observations.
- Automated: prove no `validation_passed` event or Work Record is produced when the MR opens.
- Automated: prove Direct Delivery remains unaffected.
- Expected result: GitLab shared-repository MRs can enter and refresh In Review state through the same application
  contract.

## Edge Cases & Considerations

- GitLab command output and optional fields must remain adapter-owned.
- Authentication, permission, draft state, and unavailable data must preserve retryable attempt facts.
- Merge proof remains intentionally unavailable until the next child.
