---
planId: "ff6209a8-f8f4-4c61-aedb-6697328e2504"
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
summary: "Align current architecture and product documents with Session Activation, ordered Pi transcript segments, process-local pending interactions, and canonical Plan evidence."
affectedPaths:
    - "docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md"
    - "docs/prd/runwield-workspace-prd.md"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/runwield-acp-protocol-prd.md"
    - "docs/prd/runwield-connect-prd.md"
    - "docs/domain-language.md"
    - "src/shared/owner-coordination/index.js"
    - "src/ui/workspace/server.js"
objectiveChecks:
    - id: "OC1"
      command: "! grep -Eiq 'durable (workflow )?checkpoints?|Plan Workflow Lease' docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md docs/prd/runwield-{workspace,core,acp-protocol,connect}-prd.md"
      rationale: "Current architecture and product requirements must stop requiring either rejected state machine. These requirements exist today."
    - id: "OC2"
      command: "! grep -q 'Plan Workflow Lease' docs/domain-language.md && grep -qi 'pending interactions are process-local' docs/domain-language.md && grep -Eqi 'Pi.*completed (tool calls|interactions)|completed (tool calls|interactions).*Pi' docs/domain-language.md"
      rationale: "The canonical glossary must retire the unimplemented Plan ownership term and positively define Pi-native completed history versus process-local waits. It does not today."
    - id: "OC3"
      command: "! grep -Eiq 'checkpoint.*Plan Workflow Lease|future checkpoint|Plan Workflow Lease enforcement' src/shared/owner-coordination/index.js src/ui/workspace/server.js"
      rationale: "Production comments and owner-facing Workspace text currently promise the removed future machinery."
    - id: "OC4"
      command: "grep -qi 'pending interactions are process-local' docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md && grep -Eqi 'Pi.*completed tool calls|completed tool calls.*Pi' docs/prd/runwield-workspace-prd.md"
      rationale: "Removal alone is insufficient. ADR-011 and the Workspace PRD must state the accepted persistence and retry model. These statements are absent today."
    - id: "OC5"
      command: "! grep -Eiq 'Persistent Workflow Gate|Plan Action Claim|pending[[:space:]]*->[[:space:]]*resolved|resolved[[:space:]]*->[[:space:]]*resuming|typed continuation polic|compare-and-set (outcome|transition|progression|consumption)|checkpoint (table|record|state|resolution|consumption)' docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md docs/prd/runwield-{workspace,core,acp-protocol,connect}-prd.md docs/domain-language.md src/shared/owner-coordination/index.js src/ui/workspace/server.js"
      rationale: "The rejected designs must be removed semantically rather than retained under aliases. The current ADR and PRDs contain these state-machine phrases."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-26T20:48:25.345Z"
status: "verified"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 11
dependencies:
    - "10-transactional-segment-rollover-primitives"
implementedAt: "2026-08-12T16:16:20.310Z"
verifiedAt: "2026-08-12T16:28:59.722Z"
userVerifiedAt: null
executionReport: "- Implemented slice 11: ADR-011 now defines Session Activation + ordered Pi transcript segments, process-local pending interactions, canonical Plan/worktree action checks, and bounded endpoint receipts.\n- Aligned Workspace/Core/ACP/Connect PRDs and domain language to Pi-persisted completed results, retry-after-owner-loss pending waits, and action-time canonical Plan evidence validation.\n- Removed stale source comments/Owner Workspace copy promising checkpoint or Plan-lease machinery; added no owner-database workflow state, interaction persistence branch, or extra continuation store.\n- Verification passed: objective grep checks, `git diff --check`, and `deno task ci` all clean.\n- Manual verification covered with temp Pi JSONL/projection scripts: completed `user_interview` call/result projected as `tool_start` + `tool_end`; pending-only call projected without a result, then retried call/result projected normally."
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-08-12T16:28:58.437Z"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "121c79d60237da416475ba5d47d0c6be430ae1a0"
    targetBranch: "main"
    targetHeadBeforeMerge: "72377a641a9aad82375dfaeea80a4fc2e9b3d9ae"
validationCiAttempts: 0
validationSemanticRounds: 0
updatedAt: "2026-08-24T21:23:47.295Z"
archivedAt: "2026-08-24T21:23:47.295Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/personal-remote-workspace-v1/11-simplify-session-continuity.md"
---

# Simplify Session Continuity

## Context

The implemented foundation already has the authorities needed for Personal Remote Workspace continuity. A Session
Activation Lease fences mutation of one stable RunWield Session, while its segment manifest orders multiple Pi JSONL
files as one Session Transcript and identifies the current writable segment.

Pi records completed tool calls and results. A pending `user_interview`, Plan review question, or other structured
interaction remains an in-memory wait. If the owning process stops before the result is written, a later owner reloads
committed Session history and the user asks the Agent to retry. Canonical Plan Lifecycle, Plan revision, and worktree
records remain authoritative for consequential Plan actions.

## Objective

Align current architecture, product requirements, domain language, and production-facing descriptions with this model:

- Session Activation is the only cross-process mutation lease;
- one stable Session owns ordered Pi JSONL Session Transcript Segments;
- Pi persists completed tool calls and results, while pending structured interactions remain process-local;
- interrupted pending interactions are retried rather than reconstructed;
- Plan actions validate canonical status, revision, and worktree evidence when each action starts;
- endpoint operation receipts may deduplicate HTTP requests but do not represent workflow progress; and
- execution and semantic repair use slice 10's transactional rollover and opaque continuation marker without another
  continuation store.

## Approach

Amend ADR-011 and the current Workspace, Core, ACP protocol, and Connect PRDs to state the simplified authority model.
Update domain language and remove production comments or owner-facing copy that advertises withdrawn machinery. Do not
add a schema, persistence abstraction, interaction API, or replacement state model.

## Files to Modify

- `docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md` — retain the stable path while
  revising the decision around Session Activation and Pi-native segmented continuity.
- `docs/prd/runwield-workspace-prd.md` — specify completed interaction history, retry behavior, and canonical Plan
  checks.
- `docs/prd/runwield-core-prd.md` — align the Core roadmap and continuation guarantees.
- `docs/prd/runwield-acp-protocol-prd.md` — make recovery reload committed Pi history and retry interrupted waits.
- `docs/prd/runwield-connect-prd.md` — align Connect with the Core authority model.
- `docs/domain-language.md` — define completed versus pending interaction continuity consistently.
- `src/shared/owner-coordination/index.js` — remove comments promising withdrawn coordination APIs.
- `src/ui/workspace/server.js` — replace stale owner-facing scope text without enabling remote Plan mutation.

## Reuse Opportunities

- `src/shared/session/session-runtime-interactions.js` — preserve in-memory request/response behavior.
- Pi Session Manager JSONL persistence — retain completed tool-call history.
- `src/shared/session/session-transcript-manifest.ts` — retain ordered aggregate projection.
- `src/shared/owner-coordination/session-activations.js` — retain the fenced Session writer.
- `src/shared/session/segment-rollover.ts` and `workflow-context-session.js` — retain the narrow rollover marker.
- `src/shared/workflow/plan-lifecycle.js` and `src/shared/worktree-registry.js` — retain canonical Plan/worktree
  authority.
- `owner_session_operations` receipts — retain bounded endpoint request deduplication only.

## Implementation Steps

- [ ] Revise ADR-011 to make Session Activation the sole cross-process mutation lease and ordered Pi segments the
      Session continuity model.
- [ ] Align the four current PRDs with Pi-persisted completed interactions, process-local pending waits, explicit retry,
      and action-time canonical Plan/worktree validation.
- [ ] Update domain language to distinguish committed interaction history from a live process wait.
- [ ] Remove source comments and Workspace copy that promise additional workflow ownership or interaction persistence
      machinery.
- [ ] Confirm the change adds no owner-database workflow state, interaction persistence branch, or continuation store.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: search the modified documents and source for obsolete workflow-ownership and generic interaction-state
  requirements.
- Manual: inspect a completed interaction in Pi JSONL and confirm aggregate projection renders its call and result.
- Manual: interrupt a pending structured interaction, reopen the stable Session, ask the Agent to retry, and confirm the
  new completed call is persisted normally.

## Edge Cases & Considerations

- A displayed prompt is not committed history until Pi writes the completed tool result.
- Browser disconnect does not resolve or cancel a live wait; process loss requires retry.
- A retry may repeat a question. Consequential Plan actions still reject stale status, revision, or worktree evidence.
- Session Activation cannot fence unsupported direct Pi writers that ignore owner coordination.
- Endpoint receipts can reject a duplicate request but must not become workflow authority.
- The rollover marker starts known Agent context; it does not serialize arbitrary runtime stacks or side effects.
