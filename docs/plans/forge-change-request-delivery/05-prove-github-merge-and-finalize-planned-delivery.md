---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "docs/plan-lifecycle.md"
    - "src/shared/workflow/"
    - "src/shared/work-records/"
    - "src/shared/worktree-registry.js"
    - "src/shared/isolated-publication.ts"
    - "src/cmd/load-plan/"
    - "src/testing/"
executionAgent: "engineer"
createdAt: "2026-08-31T02:51:47.960Z"
status: "draft"
origin: "internal"
parentPlan: "forge-change-request-delivery"
order: 5
dependencies:
    - "04-open-and-refresh-github-shared-repository-prs"
planId: "ebe8d74e-5ea3-4545-8080-5d7053a9d60e"
targetBranch: "project/forge-change-request-delivery"
---

# Prove GitHub merge and finalize planned delivery

## Context

The GitHub PR opening path reaches In Review but cannot claim completion. This child adds proof and finalization for the
same shared-repository GitHub path.

## Objective

After GitHub reports the bound PR merged, prove that the delivered result is covered by RunWield validation, write a
durable delivery receipt, publish terminal Plan metadata and Work Record artifacts, and clean up only after proof.

## Approach

Treat merge proof and finalization as a second transaction. Code merge proof is durable even if metadata publication or
Work Record generation fails later.

```text
GitHub PR merged
  -> prove request, source revision, target, delivered content
  -> write Delivery Receipt
  -> build terminal Plan + Work Record artifacts
  -> metadata finalization or finalization_pending
  -> cleanup after proof
```

The option set aside is to mark the Plan complete as soon as GitHub says merged. That would let stale or rewritten
revisions inherit validation they did not receive.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `docs/plan-lifecycle.md` — define GitHub Change Request Finalization, delivery receipt, and pending finalization
  behavior.
- Forge coordinator modules under `src/shared/workflow/` — prove merged result and drive finalization.
- `src/shared/work-records/` — delay Work Record generation until merge proof and include Forge delivery provenance.
- `src/shared/worktree-registry.js` and controller state modules — retain attempt state until final proof and store
  durable receipt after cleanup.
- `src/shared/isolated-publication.ts` — reuse safe metadata publication where possible.
- `src/cmd/load-plan/` — resume finalization when metadata publication or Work Record generation failed.
- `src/testing/` — add merge proof, finalization, and recovery tests.

## Reuse Opportunities

- Direct Delivery publication recovery — reuse monotonic effect reconciliation and cleanup discipline.
- Work Record auto-generation and reconciliation modules — reuse idempotent Plan identity and supersession handling.
- Git fixtures — model merge commit, squash, rebase, target movement, and ambiguous overlap cases.

## Implementation Steps

- [ ] GitHub merge proof requires the bound PR, intended repository and target, sealed candidate generation, provider
      merge facts, and Git/content proof.
- [ ] Merge commits use Git ancestry proof when available.
- [ ] Squash, rebase, or queue-like rewrites require content proof against provider-proven bases or validation of the
      actual delivered result when equivalence is ambiguous.
- [ ] A durable controller-owned Delivery Receipt records provider identity, PR URL/stable ID, validated candidate,
      target, delivered result, proof method, and timestamps.
- [ ] Terminal Plan metadata and the Work Record are generated only after code merge proof.
- [ ] Finalization can resume after process loss or metadata publication failure without duplicating the Work Record.
- [ ] Cleanup removes live attempt state only after final proof and retained delivery evidence exist.

## Verification Plan

- Automated: run focused GitHub merge proof, Work Record, finalization, publication, and recovery tests with
  `deno run -A scripts/run-tests.js <test paths>`.
- Automated: cover merge commit, squash, rebase, target movement, ambiguous overlap, metadata failure, and restart after
  each receipt write.
- Automated: prove patch ID, commit message, changed-path equality, and provider merged status alone cannot finalize.
- Automated: prove Work Record generation is idempotent by Plan identity.
- Expected result: GitHub shared-repository delivery can complete truthfully; opened-but-unmerged PRs remain
  nonterminal.

## Edge Cases & Considerations

- A code merge cannot be undone by Recorder, indexing, or metadata-publication failure.
- Protected metadata finalization may need later hardening; this child should leave visible pending state if direct
  metadata publication cannot complete.
- Any ambiguous proof must fail closed.
