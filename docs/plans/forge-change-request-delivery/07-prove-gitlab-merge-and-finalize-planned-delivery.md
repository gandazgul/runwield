---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "docs/plan-lifecycle.md"
    - "src/shared/workflow/"
    - "src/shared/work-records/"
    - "src/shared/worktree-registry.js"
    - "src/cmd/load-plan/"
    - "src/testing/"
executionAgent: "engineer"
createdAt: "2026-08-31T02:51:47.978Z"
status: "draft"
origin: "internal"
parentPlan: "forge-change-request-delivery"
order: 7
dependencies:
    - "06-open-and-refresh-gitlab-shared-repository-mrs"
planId: "82cdb500-75cd-4cc7-84ca-1f2204dcfe95"
targetBranch: "project/forge-change-request-delivery"
---

# Prove GitLab merge and finalize planned delivery

## Context

GitLab can now open and refresh shared-repository merge requests. This child adds the proof and finalization path and
checks that GitHub and GitLab still share one application contract.

## Objective

After GitLab reports the bound MR merged, prove the delivered result is covered by RunWield validation, write the same
durable delivery receipt shape, publish terminal Plan metadata and Work Record artifacts, and clean up only after proof.

## Approach

Route GitLab merge proof through the same coordinator stages used for GitHub. Provider-specific facts are normalized by
the adapter before the coordinator decides lifecycle effects.

```text
GitLab MR merged
  -> normalized merge proof facts
  -> coordinator proof hierarchy
  -> Delivery Receipt
  -> Plan + Work Record finalization
```

The option set aside is to accept GitLab merged status as enough because GitLab names the merge result. That is simpler,
but it does not prove RunWield validation covered the delivered content.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `docs/plan-lifecycle.md` — make GitHub/GitLab finalization provider-neutral.
- Forge coordinator and GitLab adapter modules under `src/shared/workflow/` — normalize and prove GitLab merge outcomes.
- `src/shared/work-records/` — include provider-neutral MR provenance in final records.
- `src/shared/worktree-registry.js` and controller state modules — retain and clean up attempts using the same receipt
  shape.
- `src/cmd/load-plan/` — resume GitLab finalization from saved state.
- `src/testing/` — add GitLab merge proof and parity tests.

## Reuse Opportunities

- GitHub merge proof tests — reuse scenario names and expected proof decisions.
- Work Record reconciliation — reuse idempotent generation after proof.
- Publication recovery patterns — reuse restart matrices and monotonic receipts.

## Implementation Steps

- [ ] GitLab merge proof requires the bound MR, intended repository and target, sealed candidate generation, provider
      merge facts, and Git/content proof.
- [ ] GitLab merge commit, squash, rebase, and target movement scenarios follow the same proof hierarchy as GitHub.
- [ ] A provider-neutral Delivery Receipt records GitLab stable identity and URL without changing receipt semantics.
- [ ] Terminal Plan metadata and Work Record generation happen only after proven code merge.
- [ ] Process-loss recovery can resume GitLab finalization without duplicate Work Records or cleanup before proof.
- [ ] Provider parity tests prove GitHub and GitLab do not create separate lifecycle systems.

## Verification Plan

- Automated: run focused GitLab merge proof, Work Record, finalization, and parity tests with
  `deno run -A scripts/run-tests.js <test paths>`.
- Automated: prove ambiguous GitLab rewrite evidence fails closed or triggers actual delivered-result validation.
- Automated: prove GitHub tests still pass after the shared proof code changes.
- Automated: run `deno task seams:check`.
- Expected result: GitLab shared-repository delivery can complete with the same truth model as GitHub.

## Edge Cases & Considerations

- GitLab Self-Managed variations are not certified by this child.
- If GitLab cannot expose enough evidence for a merge method, finalization must stop with a clear unsupported or
  ambiguous proof result.
- The receipt must survive cleanup and not require the live worktree entry afterward.
