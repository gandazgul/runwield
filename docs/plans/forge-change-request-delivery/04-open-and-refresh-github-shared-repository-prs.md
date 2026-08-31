---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/workflow/validation-publication.ts"
    - "src/shared/workflow/"
    - "src/shared/worktree-registry.js"
    - "src/cmd/load-plan/"
    - "src/ui/tui/"
    - "src/testing/"
executionAgent: "engineer"
createdAt: "2026-08-31T02:51:47.950Z"
status: "draft"
origin: "internal"
parentPlan: "forge-change-request-delivery"
order: 4
dependencies:
    - "03-add-provider-neutral-forge-port-and-cli-contract-harness"
planId: "64af71ee-eaa7-4b53-93fd-46ad6e290171"
targetBranch: "project/forge-change-request-delivery"
---

# Open and refresh GitHub shared-repository PRs

## Context

After the provider-neutral port exists, the first user-path slice should open a GitHub pull request for a shared
repository. This is intentionally a half stage: it reaches In Review and can refresh state, but it does not yet claim
completion after merge.

## Objective

Prepare one locally validated Publication Candidate for a shared GitHub topic branch, create or find the matching pull
request with an idempotency marker, and store/refresh the In Review attempt state.

## Approach

Wire only the GitHub shared-repository path through the coordinator. Keep the capability hidden or marked incomplete for
finalization until merge proof exists in the next child.

```text
validated candidate
  -> seal generation
  -> source ref equals sealed candidate
  -> gh create-or-find PR
  -> record PR URL and head
  -> show In Review / refreshable state
```

The option set aside is to open both GitHub and GitLab before finalization. That would prove less end-to-end behavior
and make provider parity harder to judge.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/workflow/validation-publication.ts` — connect selected Change Request Delivery to the GitHub
  shared-repository coordinator path.
- Forge coordinator modules under `src/shared/workflow/` — seal, create/find, refresh, and persist GitHub PR facts.
- `src/shared/worktree-registry.js` — retain source branch, PR identity, current candidate generation, and observations.
- `src/cmd/load-plan/` and `src/ui/tui/` — expose a minimal refresh/resume view for the In Review state if needed.
- `src/testing/` — add GitHub shared-repository process-loss and duplicate-request tests.

## Reuse Opportunities

- `src/shared/isolated-publication.ts` — reuse safe Git source-ref behavior and lease patterns where applicable, without
  assuming target ref publication.
- `publication-machine` tests — reuse side-effect failure-matrix style for source publication and PR creation.
- Existing validation phases — reuse local readiness and review receipts; do not rerun completed phases inside PR
  opening.

## Implementation Steps

- [ ] Selecting Change Request Delivery for a supported GitHub shared repository seals a candidate generation after
      local readiness and before terminal Plan staging.
- [ ] The GitHub source ref equals the sealed candidate generation and uses lease protection.
- [ ] Retrying after a timeout finds the existing PR by stable repository identity, source/target refs, and idempotency
      marker before creating another one.
- [ ] The live attempt records the GitHub PR stable ID, URL, source/target refs, observed head, and In Review phase.
- [ ] Refresh updates observations and review/check summary without changing code, Plan status, lifecycle, or Agent
      instructions.
- [ ] Direct Delivery remains unaffected and uses no GitHub preflight when Change Request Delivery is not selected.

## Verification Plan

- Automated: run focused GitHub shared-repository delivery tests with `deno run -A scripts/run-tests.js <test paths>`.
- Automated: stop after candidate seal, source-ref update, and PR creation, then prove idempotent resume with no
  duplicate PRs or candidate rewrites.
- Automated: prove an outside source-head change is observed but not adopted in this child.
- Automated: prove no `validation_passed` event or Work Record is produced when the PR opens.
- Expected result: a GitHub PR can be opened and refreshed, and the Plan remains nonterminal while In Review.

## Edge Cases & Considerations

- Authentication failure, missing permission, network loss, and unavailable GitHub data must preserve recovery evidence.
- Branch names and provider text are untrusted and must be escaped or validated before use.
- Merge and finalization must remain unavailable until the next child implements proof.
