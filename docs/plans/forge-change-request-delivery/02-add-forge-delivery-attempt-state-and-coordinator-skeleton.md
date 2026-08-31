---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "docs/plan-lifecycle.md"
    - "src/shared/workflow/validation-engine.ts"
    - "src/shared/workflow/validation-publication.ts"
    - "src/shared/workflow/publication-attempt.ts"
    - "src/shared/workflow/publication-machine.ts"
    - "src/shared/workflow/controller-state.ts"
    - "src/shared/worktree-registry.js"
    - "src/testing/"
executionAgent: "engineer"
createdAt: "2026-08-31T02:51:47.929Z"
status: "draft"
origin: "internal"
parentPlan: "forge-change-request-delivery"
order: 2
dependencies:
    - "01-lock-the-epic-branch-and-delivery-policy-foundation"
planId: "d9a483fe-38ee-4e9f-8580-f7cf85ba9f0c"
targetBranch: "project/forge-change-request-delivery"
---

# Add Forge delivery attempt state and coordinator skeleton

## Context

Change Request Delivery needs long-lived state that can survive process loss. Direct Delivery already has
`PublicationAttempt` state in `.wld/worktrees.json`, but Change Request Delivery cannot reuse it unchanged because
opening a Forge Change Request is not completion.

## Objective

Create the durable `ForgeDeliveryAttempt` model and a coordinator skeleton that can own candidate generations, In Review
state, stale markers, finalization phase, and retryable failure facts. Keep the feature hidden until provider paths are
complete.

## Approach

Place the coordinator in application-owned workflow code. It can call Plan, controller, worktree, validation, Git, and
Work Record modules, but provider adapters must not own lifecycle state.

```text
validated_reviewer
  -> delivery policy check
  -> Direct Delivery: existing publication path
  -> Change Request Delivery: ForgeDeliveryAttempt coordinator
       -> seal candidate generation
       -> pause in nonterminal In Review state
```

The option set aside is to add provider state straight into Plan front matter. That is easier to display, but it makes
runtime progress look like Plan authority.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `docs/plan-lifecycle.md` — describe the new nonterminal delivery attempt state and unchanged Direct Delivery path.
- `src/shared/workflow/validation-engine.ts` and `validation-publication.ts` — branch at local readiness without
  recording terminal validation for Change Request Delivery.
- `src/shared/workflow/publication-attempt.ts` and `publication-machine.ts` — reuse monotonic phase and evidence ideas
  where they fit.
- New Forge delivery workflow modules under `src/shared/workflow/` — own attempt state, candidate generation, and
  coordinator skeleton.
- `src/shared/workflow/controller-state.ts` — expose controller-owned delivery receipt shape only if needed by this
  skeleton.
- `src/shared/worktree-registry.js` — retain the live Forge attempt beside the worktree identity.
- `src/testing/` — add focused attempt-state and restart tests.

## Reuse Opportunities

- `PublicationAttempt` and `publication-machine.ts` — reuse phase ordering, evidence assertions, compare-and-swap update
  style, and recovery discipline.
- `withWorktreeRegistryLock` and registry update patterns — reuse registry locking and monotonic write patterns for
  Forge attempt state.
- `validation-publication.ts` — reuse the local readiness point, but not the direct target-branch delivery transaction.
- Controller registry modules — reuse file-backed state ownership instead of extending Plan Markdown for attempt
  progress.

## Implementation Steps

- [ ] A versioned `ForgeDeliveryAttempt` state type can represent provider/repository identity placeholders, source and
      target refs, current candidate generation, observations, finalization phase, retryable failure, and
      compare-and-swap revision.
- [ ] A candidate generation is immutable once recorded and binds the validated execution commit, observed target base,
      intended source ref, published head placeholder, validation/review receipts, and delivery outcome markers.
- [ ] The validation delivery phase can choose the Forge coordinator path after local readiness without emitting
      `validation_passed` or generating a Work Record.
- [ ] Direct Delivery still uses the existing publication path and does not load Forge attempt state.
- [ ] Restart can reload an incomplete Forge delivery attempt and report the same nonterminal phase without duplicating
      a candidate generation.
- [ ] The feature remains unavailable for real provider use until a later child supplies provider operations.

## Verification Plan

- Automated: run focused workflow tests through `deno run -A scripts/run-tests.js <test paths>` for attempt creation,
  CAS update, immutable generations, restart reload, and Direct Delivery regression.
- Automated: prove Change Request Delivery stops before `validation_passed` and before Work Record generation.
- Automated: prove Direct Delivery still reaches the existing `PublicationAttempt` phases with no Forge state.
- Automated: run `deno task seams:check`.
- Expected result: RunWield can remember an In Review attempt, but it cannot yet open a real Forge Change Request.

## Edge Cases & Considerations

- Do not add dependency injection seams for Plan writes, lifecycle transitions, registry writes, or locks.
- The skeleton should fail closed when provider identity is missing.
- Keep attempt state small; it must not become a cache of all comments, checks, approvals, or provider policy.
- This is an internal half stage by design; beta users only receive the finished product.
