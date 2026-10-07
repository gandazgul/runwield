---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/attached/"
    - "src/cmd/attached/"
    - "src/attached/claude/"
    - "src/shared/workflow/execution-start.ts"
    - "src/shared/workflow/execution-context.ts"
    - "src/shared/workflow/implementation-checkpoint.ts"
    - "src/shared/worktree.js"
    - "src/shared/worktree-registry.js"
    - "src/tools/"
    - "docs/prd/runwield-connect-prd.md"
    - "docs/prd/runwield-core-prd.md"
executionAgent: "engineer"
createdAt: "2026-10-07T03:22:47.384Z"
status: "draft"
origin: "internal"
parentPlan: "attached-mode-claude-feature-preview"
order: 4
dependencies:
    - "03-review-and-approve-plans-through-durable-plannotator-decisions"
targetBranch: "epic/attached-mode-claude-feature-preview"
planId: "2248330d-ab2d-4c0f-9858-aa8884a4aff0"
---

# Implement approved Plans in RunWield worktrees

## Context

Child 3 establishes approved and ready FEATURE Plans. The next step must use Core isolation authorities without
borrowing a HostedSession or allowing Claude to create a competing worktree lifecycle.

The owning Connect requirements are
[isolated implementation](../../prd/runwield-connect-prd.md#isolated-implementation),
[host-owned reasoning](../../prd/runwield-connect-prd.md#host-owned-reasoning), and execution recovery under
[lazy setup and recovery](../../prd/runwield-connect-prd.md#lazy-project-setup-and-recovery). Core retains execution and
worktree safeguards. Validation and publication remain later children.

## Objective

An approved ready Plan can be handed to a fresh Claude implementation worker in a RunWield-owned worktree. Core accepts
completion only against the issued action and canonical execution evidence. The invoking checkout is preserved, and
interrupted execution remains recoverable.

## Approach

Share domain execution preparation and guarded implementation completion with Core carriers.
`startActiveExecutionWorkflow` includes HostedSession interactions; `finalizePlanImplementation` is a reuse area, not
proof that its whole module is Session-free.

```text
approved ready Plan → Core worktree and baseline → Claude worker handoff
structured completion → canonical Plan/worktree/diff guards → validation pending
```

Keep worker execution in Claude. Do not use its automatic independent worktree lifecycle or the Core Claude CLI
execution backend.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/workflow/execution-start.ts`, execution-context services, and `implementation-checkpoint.ts` — domain
  preparation/completion separated from Session presentation as needed.
- `src/shared/worktree.js` and `worktree-registry.js` — authoritative worktree identity, baseline, and recovery.
- `src/shared/attached/` and CLI/MCP operations — issued implementation actions and validated completion acceptance.
- `src/attached/claude/` — fresh worker dispatch in the handed-off path.
- `src/tools/` — shared completion outcome semantics where existing Session carriers require alignment.
- Connect/Core capability scenarios — actual isolation, completion, and interruption behavior.

## Reuse Opportunities

- Core worktree registry and Git helpers — physical evidence and safeguarded ownership.
- `finalizePlanImplementation` — guarded implementation checkpoint semantics.
- Child 1 durable actions and child 3 reviewed-revision readiness — safe execution eligibility.

## Implementation Steps

1. Execution preparation requires canonical approval/readiness and binds the reviewed Plan, worktree registry identity,
   canonical path, baseline, candidate evidence, role contract, and workflow revision to a durable implementation
   action.
2. A fresh Claude-hosted worker operates in that RunWield worktree. Core starts no Claude/Pi model process, and Claude
   does not create or manage a parallel worktree registry.
3. Shared completion guards validate the lifecycle position, Plan revision, expected worktree, baseline, diff, and
   completion contract before advancing implementation. Existing protected Session tools consume the same semantic
   outcome where needed.
4. Process loss during worktree preparation or worker execution reconciles real Git/registry evidence. Duplicate
   completion cannot advance twice; delayed results after changed work or superseded actions are rejected. Cancellation
   preserves pending work.
5. The invoking checkout is not silently edited, cleaned, stashed, reset, or relocated. Handoff failure exposes only an
   existing explicit consent fallback when tested Preview capabilities permit it; otherwise it preserves resumable work
   and reports the limitation.
6. Owning Connect/Core scenarios and references describe the delivered handoff and completion semantics, with
   validation/publication still target scope.

## Verification Plan

- Automated: run
  `deno run -A scripts/run-tests.js src/shared/attached/ src/attached/claude/ src/shared/workflow/implementation-checkpoint-completion.test.ts src/shared/workflow/authority-continuation.integration.test.ts src/shared/workflow/plan-location.integration.test.ts`.
- Black-box: on each claimed host version, dispatch a fresh worker into a real Core worktree, implement a small approved
  Plan, and submit completion. Compare invoking checkout baseline and user files before/after; inspect canonical
  registry and Git state.
- Automated: reject pre-approval execution, forged paths, missing baseline/diff evidence, stale Plan revisions,
  fabricated completion, duplicate outcomes, and competing host turns. Kill Core during preparation and stop the worker
  mid-edit; resume in a fresh process without discarding work.
- Expected: completion advances only through shared guards and does not claim validation or Verified. Existing Core
  Session execution, worktree consent, and completion gating remain protected.
- Use `defineGitFixture` and real validation project fixtures. No new injection seam for worktree, registry, lifecycle,
  or Plan writes. Confirm PRD scope is synchronized.

## Edge Cases & Considerations

- Target-branch movement and dirty invoking files must retain existing safety behavior.
- Worker exit, quota loss, or plain-text completion is not a validated completion contract.
- Handoff path/session evidence must be current, not inferred from host transcript text.
- This child leaves a valid implemented candidate awaiting shared validation. It must not simulate a passed validation
  or publication step.
