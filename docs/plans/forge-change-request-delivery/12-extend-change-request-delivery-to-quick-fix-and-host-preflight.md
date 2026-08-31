---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "docs/prd/forge-change-request-delivery-prd.md"
    - "docs/plan-lifecycle.md"
    - "src/shared/workflow/"
    - "src/shared/worktree-registry.js"
    - "src/cmd/load-plan/"
    - "src/ui/tui/"
    - "src/testing/"
executionAgent: "engineer"
createdAt: "2026-08-31T02:51:48.032Z"
status: "draft"
origin: "internal"
parentPlan: "forge-change-request-delivery"
order: 12
dependencies:
    - "11-harden-recovery-plans-doctor-and-protected-metadata-finalization"
planId: "df781800-d3d9-46b2-a623-331286f0406e"
targetBranch: "project/forge-change-request-delivery"
---

# Extend Change Request Delivery to QUICK_FIX and host preflight

## Context

QUICK_FIX can explicitly use Change Request Delivery, but it must not gain Planned Change semantics. No Plan, Semantic
Code Review, Work Record, or false Workflow Validation claim should appear merely because a Forge Change Request was
used.

## Objective

Support no-Plan QUICK_FIX delivery through GitHub and GitLab Change Requests while preserving QUICK_FIX meaning. Add
provider/host preflight for GitHub.com, GitLab.com, and best-effort enterprise/self-managed hosts.

## Approach

Let the worktree registry identify the owner as either a Plan ID or a no-Plan delivery ID. QUICK_FIX uses mechanical
validation and Forge delivery receipts only. Provider host preflight should name missing capabilities and stop safely.

```text
QUICK_FIX + Change Request Delivery
  -> no Plan owner
  -> mechanical validation
  -> Forge delivery attempt
  -> merge proof + cleanup
  -> no Work Record
```

The option set aside is to force QUICK_FIX into a temporary Plan for reuse. That would reduce code paths, but it would
create false lifecycle and memory claims.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `docs/prd/forge-change-request-delivery-prd.md` — keep QUICK_FIX and host-scope language aligned with implementation.
- `docs/plan-lifecycle.md` — clarify that no-Plan QUICK_FIX has no Plan Lifecycle or Work Record finalization.
- Forge coordinator modules under `src/shared/workflow/` — support Plan-owned and no-Plan delivery identities.
- `src/shared/worktree-registry.js` — allow durable QUICK_FIX delivery identity without Plan identity.
- `src/cmd/load-plan/` and `src/ui/tui/` — present QUICK_FIX delivery state without Plan claims where applicable.
- `src/testing/` — add QUICK_FIX, no-Plan, and host preflight tests.

## Reuse Opportunities

- Existing QUICK_FIX mechanical validation path — preserve current validation level.
- Forge delivery attempt state — reuse source-branch, request identity, merge proof, and cleanup receipts.
- Provider port preflight — reuse normalized unsupported/inaccessible/temporary-failure results.

## Implementation Steps

- [ ] QUICK_FIX can explicitly select Change Request Delivery for GitHub and GitLab shared or fork scenarios.
- [ ] The registry can represent a no-Plan delivery owner without requiring Plan ID, Plan status, or Plan file evidence.
- [ ] QUICK_FIX delivery runs mechanical validation and Forge proof but does not run Semantic Code Review, Plan Review,
      or Work Record generation.
- [ ] Successful QUICK_FIX delivery leaves commit and Forge history as the audit trail and creates no false RunWield
      Workflow Validation claim.
- [ ] Host preflight distinguishes supported GitHub.com/GitLab.com, best-effort enterprise/self-managed hosts,
      authentication failure, missing command, missing permission, and unsupported capability.
- [ ] Planned Change delivery still behaves as before after QUICK_FIX support is added.

## Verification Plan

- Automated: run focused QUICK_FIX delivery, no-Plan registry, host preflight, and regression tests with
  `deno run -A scripts/run-tests.js <test paths>`.
- Automated: prove QUICK_FIX creates no Plan, no Semantic Code Review, no Work Record, and no `validation_passed` event.
- Automated: prove host preflight errors name unsupported capability without weakening proof.
- Automated: prove Planned Change delivery and Direct Delivery still pass.
- Expected result: QUICK_FIX can use Forge review safely while keeping its smaller meaning.

## Edge Cases & Considerations

- There is no load-plan entry for a no-Plan QUICK_FIX; surface design must avoid implying one.
- Enterprise/self-managed compatibility is best effort and must not be over-certified.
- Missing CLIs or credentials should stop before source publication.
