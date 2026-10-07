---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/workflow/validation-engine.ts"
    - "src/shared/workflow/validation-ports.ts"
    - "src/shared/workflow/validation-session-adapter.ts"
    - "src/shared/workflow/validation-semantic.ts"
    - "src/shared/workflow/validation-local-ci.ts"
    - "src/shared/workflow/review-ledger.ts"
    - "src/shared/workflow/review-diff-tool.js"
    - "src/shared/attached/"
    - "src/attached/claude/"
    - "src/tools/"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/runwield-connect-prd.md"
executionAgent: "engineer"
createdAt: "2026-10-07T03:22:47.915Z"
status: "draft"
origin: "internal"
parentPlan: "attached-mode-claude-feature-preview"
order: 5
dependencies:
    - "04-implement-approved-plans-in-runwield-worktrees"
targetBranch: "epic/attached-mode-claude-feature-preview"
planId: "31b97384-eb6c-4c98-8c54-578755ab80da"
---

# Validate with Claude-owned review and repair workers

## Context

Child 4 leaves an implemented candidate in a Core-owned worktree. Validation-engine extraction is already delivered.
Remaining work is durable host continuation: `ValidationSessionPort` still awaits Agent/user outcomes and passes opaque
tool/session-manager handles, while semantic reviewer rounds retain process-local turn state.

Core owns [execution, validation, and recovery](../../prd/runwield-core-prd.md#execution-validation-and-recovery) and
[semantic review and repair](../../prd/runwield-core-prd.md#semantic-review-and-repair). Connect owns
[host reasoning](../../prd/runwield-connect-prd.md#host-owned-reasoning) and supported
[verification continuation](../../prd/runwield-connect-prd.md#shared-plan-and-verification-outcomes). Optional code
review, recording, publication, and terminal closure belong to child 6.

## Objective

Attached candidates pass Mechanical Validation, configured local CI, independent Claude-owned AI review, bounded
repairs, and independent re-verification through the same engine used by Core Sessions. Every host wait is durable and
can resume in a fresh Core process up to the existing pre-publication checkpoint.

## Approach

Extend shared engine/port semantics for suspension and accepted external outcomes. The engine still selects phases and
owns convergence and gates. Attached coordination persists issued-action identity and evidence; Claude supplies role
turns.

```text
shared engine → durable pending action → Core exits
Claude-owned worker → typed outcome → fresh Core acceptance → shared engine
```

Opaque Pi tools and reviewer managers are not host contracts. Preserve shared inspection semantics while materializing
executable host tools at the adapter boundary. Do not implement a second validation loop or re-extract policy.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `validation-engine.ts`, `validation-ports.ts`, phase modules, and Session adapter — shared durable
  suspension/resumption while preserving Session behavior.
- `validation-semantic.ts`, `review-ledger.ts`, and review-diff modules — durable round/inspection evidence and shared
  review semantics.
- `src/shared/attached/` — current-evidence acceptance and continuation binding, not validation policy.
- `src/attached/claude/` and affected protected tools — independent reviewer/repair carriers and common typed outcomes.
- Core/Connect PRDs and validation authority documentation — delivered shared phase and host-continuation behavior.

## Reuse Opportunities

- `runValidationPhase` and canonical engine checkpoints — one policy and phase selection.
- Local CI, mechanical checks, review ledger, and existing repair contracts — authoritative evidence.
- Issued-action and expected-revision protocol — idempotent external outcome acceptance.

## Implementation Steps

1. Mechanical Validation and configured CI operate on the canonical implemented candidate using existing engine gates.
   Host-supplied pass claims cannot replace Core-observed check evidence.
2. Before every Claude review, repair, re-verification, or relevant user interaction wait, the pending identity and
   Plan/candidate/role/workflow evidence are durable. Fresh processes accept only the matching current action once and
   resume the shared phase.
3. Independent Claude workers provide AI review and repairs using canonical role policy and typed outcomes. Required
   diff-inspection evidence, findings, repair completion, and review ledger rules remain shared; no Pi executable tool
   or session-manager handle is serialized to the host.
4. The engine retains review-round bounds, repair limits, and continuation rules. Attached contains no copied gate or
   convergence loop. Retry exhaustion, host cancellation, quota loss, and process death remain recoverable conditions,
   not automatic abandonment.
5. Existing Core Session and ACP validation behavior remains intact through the Session adapter. The Attached path
   constructs no HostedSession and starts no model call, including transitive review-tool paths.
6. Success leaves a canonical candidate awaiting optional code review/publication. It does not fabricate Verified or
   skip the pending child-6 requirements. Owning PRD and authority references distinguish delivered local validation
   from remaining publication targets.

## Verification Plan

- Automated: run
  `deno run -A scripts/run-tests.js src/shared/attached/ src/attached/claude/ src/shared/workflow/validation-loop-core.test.js src/shared/workflow/validation-loop-review.test.js src/shared/workflow/validation-loop-repair.test.js src/shared/workflow/validation-ci-recovery.test.js src/shared/workflow/validation-repair-resume.integration.test.ts src/shared/workflow/review-contract.test.ts`.
- Automated: terminate Core after issuing review and repair actions, after accepting outcomes but before responding, and
  around CI side effects. Resume fresh; verify current evidence, no repeated accepted effects, rejection of delayed
  outcomes, and automatic internal reconciliation.
- Black-box: force a real blocking Review Issue, execute a fresh repair worker, and independently re-verify. Instrument
  role origin and process/network boundaries; fabricated CI/review/repair claims must not advance the canonical ledger
  or phase.
- Expected: one shared validation policy, independent role contexts, durable host waits, and no serialized Pi handles or
  Core-owned model turns. Existing review convergence and Session behavior remain protected.
- Planner must establish the exact red-to-green shared suspension test after choosing the engine interface; no existing
  synchronous engine test alone proves durable host continuation. Check PRD/authority synchronization and zero-seam
  compliance.

## Edge Cases & Considerations

- Candidate edits after review invalidate applicable evidence; delayed pass results cannot approve a changed candidate.
- Inspection and review semantics stay Core-owned even when host-specific tools implement the inspection carrier.
- Local validation success is not publication. Only child 6 may complete the delivery path.
- Recording and publication may themselves request host actions; this child's protocol must support those later uses
  without implementing them here.
