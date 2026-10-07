---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/cmd/attached/"
    - "src/shared/attached/"
    - "src/attached/claude/"
    - "src/shared/workflow/controller-registry.ts"
    - "docs/domain-language.md"
    - "docs/prd/runwield-connect-prd.md"
    - "docs/adr/014-attached-workflow-coordination-boundary.md"
executionAgent: "engineer"
createdAt: "2026-10-07T03:22:45.484Z"
status: "draft"
origin: "internal"
parentPlan: "attached-mode-claude-feature-preview"
order: 1
dependencies:
    []
targetBranch: "epic/attached-mode-claude-feature-preview"
planId: "1da830b9-9256-4d4b-a6c2-0cfd0b88c1de"
---

# Activate and resume an Attached Workflow

## Context

This is the first child of
[RunWield Connect for Claude Code: FEATURE Preview](../attached-mode-claude-feature-preview.md). Claude owns
conversations and model turns. RunWield needs a durable coordinator that does not create a HostedSession or import a
host transcript.

The owning requirements are [explicit activation](../../prd/runwield-connect-prd.md#explicit-per-request-activation) and
[lazy setup and recovery](../../prd/runwield-connect-prd.md#lazy-project-setup-and-recovery).
[ADR-014](../../adr/014-attached-workflow-coordination-boundary.md) defines the sibling-runtime direction. Plugin
planning, review, execution, validation, and publication are later children.

## Objective

An explicit request can establish a durable Attached Workflow, issue a real Triage action, and accept its typed outcome
from a fresh Core process. Status and recovery expose the current canonical references and next action without
duplicating Plan or worktree truth.

## Approach

Use a small host-neutral operation surface. Both short-lived `wld attached` commands and the host-owned MCP server call
it. Only implemented operations need transport parity in this child; later children extend the same surface.

```text
activate request → save workflow and issued Triage action → Core exits
fresh process → validate action, revision, and owner → accept outcome once
retry → return accepted result without repeating effects
```

The record owns request binding, capability/version evidence, operation identities, and pending-action checkpoints.
Existing domain authorities own Plan and execution facts. A fake SessionRuntime adapter would reverse this direction and
is excluded.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/attached/` — coordinator, durable record, typed envelopes, accepted outcomes, concurrency, and recovery.
- `src/cmd/attached/` and CLI registration — bounded JSON operations and diagnostics.
- `src/attached/claude/` — thin MCP framing for the implemented operations, not plugin workflow policy.
- `src/shared/workflow/controller-registry.ts` and lifecycle authorities — canonical consequential ownership where a
  request binds a Plan.
- `docs/domain-language.md`, Connect PRD, and ADR-014 — implemented coordinator/record relationships and
  process-lifetime clarification.

## Reuse Opportunities

- `writeControllerState` — revision checks and canonical ownership protections.
- Plan Store and Plan Lifecycle — authoritative Plan references and transitions.
- Existing runtime preflight and structured CLI conventions — local diagnostics.

## Implementation Steps

1. A typed operation envelope binds canonical Project evidence, workflow identity, host/adapter/Core evidence, operation
   ID, expected revision, and bounded payload to one explicit request. Persistent state excludes transcripts and copied
   Plan/worktree status.
2. Activation issues a durable Triage action with a contract reference. Its structured outcome can be accepted once in a
   fresh process, with accepted-result retries and rejection of superseded actions, malformed payloads, and conflicting
   owners. FEATURE routing semantics remain shared; later Plan submission is not fabricated.
3. Canonical CLI operations and thin MCP tools return equivalent committed revisions, next actions, waiting reasons, and
   recovery information for this slice. Neither carrier makes domain decisions.
4. Process loss and host cancellation preserve pending work. Recovery reconciles internal writes and ownership without
   treating shutdown as approval, completion, or abandonment.
5. Architecture checks enforce no Attached dependency on SessionRuntime, ACP, TUI, Claude execution backends, or Pi
   AgentSession, and no adapter import of domain authorities outside the operation surface.
6. `docs/domain-language.md` defines Attached Workflow Coordinator and Attached Workflow Record, their avoided aliases,
   and their stable relationships. Connect capability scenarios describe only the delivered operation subset; other
   Preview outcomes stay target scope.

## Verification Plan

- Automated: run `deno run -A scripts/run-tests.js src/shared/attached/ src/cmd/attached/ src/attached/claude/` for the
  new slice tests. Planner selects the concrete test files once the footprint is known.
- Automated: issue activation/action in process A, accept in B, and retry in C using real project storage. Compare
  CLI/MCP results. Race two owners and expected revisions; submit duplicate, delayed, oversized, transcript-shaped, and
  path-escape payloads.
- Automated: preserve controller behavior with
  `deno run -A scripts/run-tests.js src/shared/workflow/controller-registry.integration.test.ts src/shared/workflow/plan-lifecycle.test.js src/shared/workflow/state-transition.test.js`.
- Expected: only the matching issued action advances, accepted effects are not repeated, and restart needs no
  process-local handles. Architecture tests inspect transitive execution paths as well as imports; Core starts no model
  process or provider call.
- Confirm behavior and glossary land together. Verify PRD statements remain limited to activation/continuation, not
  complete plugin readiness. Use sandboxed HOME and real Git/Plan fixtures, with no new seams for owned machinery.

## Edge Cases & Considerations

- Host session identity is binding evidence, not lifecycle authority; explicit recovery rebinding must not use
  transcript matching.
- Dirty/nonstandard repositories retain existing consent and Git safeguards; activation never cleans or stashes user
  work.
- Unknown side effects are reconciled from evidence, not blindly replayed. Users resolve only genuine external
  uncertainty or consequential choices.
- Capability evidence fields are established here; the tested Claude Compatibility Matrix belongs to child 2.
