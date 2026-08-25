---
planId: "217f472c-66b1-4725-e95ffeba5878"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Route owner and remote Plan actions through Session Activation with action-time canonical Plan revision, lifecycle status, and worktree validation."
affectedPaths:
    - "src/shared/workflow/"
    - "src/shared/session/session-runtime.js"
    - "src/shared/worktree-registry.js"
    - "src/shared/owner-coordination/"
    - "src/plan-store.js"
    - "src/cmd/load-plan/"
    - "src/ui/workspace/routes/"
    - "src/ui/workspace/server/"
objectiveChecks:
    - id: "OC1"
      command: "grep -q 'rejects stale Plan revision before lifecycle mutation' src/shared/workflow/plan-action-evidence.test.ts && grep -q 'rejects replaced worktree evidence before lifecycle mutation' src/shared/workflow/plan-action-evidence.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/plan-action-evidence.test.ts"
      rationale: "The shared evidence module and its named behavioral tests do not exist today. Both stale Plan bytes and replaced worktree identity must block the lifecycle mutation."
    - id: "OC2"
      command: "grep -q 'returns the stored result for an exact duplicate request' src/ui/workspace/owner-plan-actions.test.ts && grep -q 'revalidates canonical evidence for a new request id' src/ui/workspace/owner-plan-actions.test.ts && deno run -A scripts/run-tests.js src/ui/workspace/owner-plan-actions.test.ts"
      rationale: "The activated owner Plan-action service does not exist today. Its integration tests must distinguish exact HTTP deduplication from a new action-time evidence check."
    - id: "OC3"
      command: "grep -q \"'plan_action'\" src/shared/owner-coordination/schema.js && grep -q 'result_json' src/shared/owner-coordination/schema.js && grep -q 'result_http_status' src/shared/owner-coordination/schema.js && deno run -A scripts/run-tests.js src/shared/owner-coordination/database.test.js src/shared/owner-coordination/session-activations.test.js"
      rationale: "Schema 7 cannot store a Plan-action result or classify the receipt today. Migration and receipt tests must add bounded result persistence without breaking existing receipts."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-26T20:48:25.345Z"
status: "verified"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 12
dependencies:
    - "11-simplify-session-continuity"
implementedAt: "2026-08-12T17:40:11.648Z"
verifiedAt: "2026-08-12T19:05:57.160Z"
userVerifiedAt: null
executionReport: "- Implemented shared Plan Action Evidence Check and executor in `src/shared/workflow/plan-actions.ts` with canonical Plan revision/status/worktree validation and typed refresh/recovery/invalid/activation results.\n- Added read-only Plan/worktree evidence helpers, owner coordination migration 8, bounded `plan_action` receipt result storage/replay, and receipt tests.\n- Wired `SessionRuntime.runPlanAction`, load-plan session surface/types, owner Workspace API route/service, and local Workspace lifecycle adapter through the shared executor while preserving local shared-Plan lock behavior.\n- Added focused behavioral tests: stale revision, replaced worktree, valid lifecycle action, exact duplicate replay, new request revalidation, request-ID hash conflict, and bounded receipt persistence.\n- Updated existing session architecture/policy tests for the new explicit fenced Runtime Plan-action method and approved owner Plan-action service.\n- Verification passed: objective grep/test checks OC1/OC2/OC3; focused suite `deno run -A scripts/run-tests.js src/shared/workflow/plan-action-evidence.test.ts src/shared/owner-coordination/session-activations.test.js src/shared/owner-coordination/database.test.js src/ui/workspace/owner-plan-actions.test.ts src/cmd/load-plan/index.integration.test.ts`; `deno task seams:check`; full `deno task ci`.\n- Test coverage added only; no tests were removed or replaced. New generated `src/shared/version.js` was created by `deno task ci`/`scripts/write-version.js` as required for verification."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "5ec09c6e3c7db3228455146d51b38fdf1df5f766"
    targetBranch: "main"
    targetHeadBeforeMerge: "9171b151ec15991f2e3f8d4d3b8adf39878e2936"
validationCiAttempts: 0
validationSemanticRounds: 2
updatedAt: "2026-08-24T21:23:47.295Z"
archivedAt: "2026-08-24T21:23:47.295Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/personal-remote-workspace-v1/12-session-activated-plan-actions.md"
---

# Session-Activated Plan Actions

## Context

Personal Workspace must let an owner initiate Plan actions remotely without creating a second owner for Plan progress.
Session Activation already fences mutation by one stable Session. Canonical Plan Lifecycle, the whole-file Plan
revision, and worktree registry evidence already describe whether an action is valid.

The owner Workspace is read-only today. The local Workspace lifecycle adapter checks Plan revision and status, but it
does not require Session Activation. The `load-plan` command also performs hold, resume, reset-to-draft, and User
Verification mutations outside the Runtime's managed-operation boundary. These paths can use stale caller state or
mutate a managed Session's Plan without the acting Session holding activation.

Remote requests can be duplicated by reconnects or browser retries. Existing `owner_session_operations` receipts record
request identity and status, but they cannot return a prior response because they do not store a bounded result payload.
Receipts must remain endpoint request deduplication only. They do not authorize later work or record workflow progress.

## Objective

Implement a shared Plan Action Evidence Check and an activated owner-action service that:

- identifies the Project, stable Session, and Plan by durable IDs;
- requires the acting stable Session to acquire valid Session Activation before a managed or remote mutation;
- reloads and compares the canonical whole-file Plan revision, Plan Status, and exact relevant worktree evidence at
  action time;
- delegates accepted mutations to canonical Plan Lifecycle and recovery transition APIs;
- rejects stale, incompatible, missing, or ambiguous evidence with typed refresh or recovery guidance;
- returns one stored bounded result for duplicate delivery of the same device, Session, request ID, and request hash;
- revalidates all canonical evidence for every new request ID; and
- preserves existing unmanaged local CLI and local Plan Board behavior through the same evidence executor without
  claiming cross-process Session Activation.

This slice exposes only lifecycle actions: manual status move, put on hold, resume from hold, reset to draft after the
worktree attempt is settled, User Verification, and close without verification. Feedback, approval/readiness, Approve &
Run, execution startup, and destructive Plan Recovery remain deferred to child Plans 13 and 17.

No persistent Plan ownership state or general interaction/continuation state is introduced.

## Approach

Add `src/shared/workflow/plan-actions.ts` as the application-owned action contract. Its read path resolves a durable
Plan ID without writing or backfilling metadata, loads the canonical whole-file revision and Plan Status, and snapshots
the relevant registry entry. Its execute path compares that evidence again immediately before it calls `recordPlanEvent`
or a canonical recovery transition. The action result is typed as success, refresh required, recovery required, invalid
action, or activation unavailable. Error data must not expose local paths.

For a managed Runtime action, add a public `SessionRuntime` Plan-action method that uses the existing private managed
operation machinery. The Runtime acquires Session Activation in `preparing`, runs the shared executor without hydrating
Pi, and releases the unchanged activation after the repository action settles. The command does not receive an
activation proof or owner database handle.

For owner Workspace requests, add an authenticated route under the acting Project and stable Session. The service first
returns a completed receipt for an exact duplicate request. For a new request, it verifies Project/Session membership
and committed generation, creates the receipt, acquires Session Activation, runs the same executor, stores the bounded
HTTP result, and releases activation. A request ID reused with different input is a conflict. An accepted/running
receipt with no provable completed result after process loss returns recovery guidance; it does not replay the mutation
blindly.

Upgrade the owner coordination schema so `owner_session_operations` accepts `plan_action` and stores a size-limited JSON
result and HTTP status. The migration must preserve bootstrap and continuation receipts. Keep authorization, canonical
validity, and duplicate-request handling separate: activation authorizes this mutation attempt, canonical artifacts
determine validity, and the receipt only deduplicates one endpoint request.

## Files to Modify

- `src/shared/workflow/plan-actions.ts` and focused tests — own the typed action/evidence contract, stale-evidence
  classification, lifecycle dispatch, and safe result shape.
- `src/shared/session/session-runtime.js` and managed-operation tests — expose a product-owned Plan-action operation
  that runs through existing Session Activation without exposing an injection seam or activation proof.
- `src/plan-store.js` — resolve a durable Plan ID to strict canonical revision, status, identity, and Front Matter
  evidence without metadata backfill or another ownership record.
- `src/shared/worktree-registry.js` — return read-only worktree evidence by Plan/attempt ID and fail closed on registry
  read errors, duplicate live attempts, or identity conflicts.
- `src/shared/owner-coordination/schema.js`, `database.js`, `session-activations.js`, and tests — migrate operation
  receipts to support `plan_action`, bounded result JSON, and HTTP status while preserving existing rows and uniqueness.
- `src/shared/owner-coordination/index.js` — expose the extended receipt operations through the existing store facade.
- `src/cmd/load-plan/plan-session-surface.ts`, `plan-session-types.ts`, `plan-hold.ts`, and affected call sites/tests —
  route hold, resume, reset-to-draft, and User Verification through the Runtime Plan-action operation for managed
  Sessions and the same canonical executor for unmanaged Sessions.
- `src/ui/workspace/server/plan-adapter.js` — replace duplicated lifecycle dispatch with the shared executor while
  preserving the local Plan Board contract.
- `src/ui/workspace/server/owner-plan-actions.ts` and tests — coordinate activated owner requests and bounded receipts.
- `src/ui/workspace/routes/owner-api.js` and `src/ui/workspace/server.js` — register the paired-device owner endpoint;
  keep owner browser controls read-only until child Plan 17.

## Reuse Opportunities

- `src/shared/owner-coordination/session-activations.js` — use `acquireSessionActivation` and
  `releaseUnchangedActivation`; do not add another lease.
- `src/shared/session/session-runtime.js` — reuse `#runManagedOperation` and its heartbeat/fencing behavior.
- `src/shared/workflow/plan-lifecycle.js` — keep `recordPlanEvent` as the canonical Plan Lifecycle transition authority
  and preserve its locked status/revision checks.
- `src/shared/workflow/state-transition.ts` — preserve transactional recovery behavior for reset-to-draft where
  applicable.
- `src/plan-store.js` — reuse strict whole-file revision hashes and `StalePlanWriteError` semantics.
- `src/shared/worktree-registry.js` — remain the canonical worktree evidence source; compare immutable attempt identity
  and current registry status.
- `src/ui/workspace/server/plan-adapter.js` — reuse lifecycle action names, validation rules, resume warning contract,
  and safe Workspace serialization.
- `owner_session_operations` — deduplicate one endpoint request without interpreting a receipt as workflow state.

## Implementation Steps

- [ ] `src/shared/workflow/plan-actions.ts` defines closed action and result unions. Each request contains durable Plan
      ID, expected whole-file revision, expected Plan Status, and an explicit worktree expectation (`none` or exact
      attempt ID, Plan ID, status, branch, and target/base identity). No request can supply canonical Front Matter as
      authority.
- [ ] The Plan-store and registry evidence readers are read-only. They reject a missing/malformed Plan, duplicate Plan
      ID, unreadable registry, duplicate live attempt, Plan/registry identity mismatch, missing expected attempt, or an
      unexpected live attempt before mutation.
- [ ] The executor reloads evidence at action time and maps mismatched Plan bytes/status to `refresh_required`; missing,
      replaced, ambiguous, or conflicting worktree evidence maps to `recovery_required`. Accepted actions call existing
      Plan Lifecycle or recovery APIs and return the new canonical Plan revision, Plan Status, and worktree evidence.
- [ ] Lifecycle dispatch supports only manual status move, put on hold, resume from hold after accepted warnings,
      reset-to-draft after settled worktree evidence, User Verification with a required note, and close without
      verification with a required reason. It does not expose Feedback, approval, readiness, execution, worktree
      deletion, or arbitrary lifecycle events.
- [ ] `SessionRuntime` owns managed activation for Plan actions. It acquires the acting stable Session at the exact
      committed generation/current segment, heartbeats while active, does not hydrate Pi, and releases unchanged
      activation on success or handled rejection. Stale generation/segment and competing activation return typed
      refresh/in-progress results without Plan mutation.
- [ ] Managed `load-plan` hold, resume, reset-to-draft, and User Verification call the Runtime Plan-action method after
      collecting user input. Unmanaged local Sessions call the same executor directly. Existing prompts, Work Record
      generation, and recovery warnings remain protected, while direct lifecycle writes in these covered paths no longer
      bypass the executor.
- [ ] Owner coordination schema migration 8 preserves existing operation rows and uniqueness, expands receipt kind with
      `plan_action`, and adds bounded result JSON and HTTP status. Receipt APIs reject oversized/invalid results and
      expose parsed safe results without changing bootstrap or continuation behavior.
- [ ] The paired-device owner endpoint accepts Project ID, stable Session ID, Plan ID, request ID, expected committed
      generation, expected canonical evidence, and one supported action. Exact completed duplicates return the stored
      status/body. A changed request hash conflicts, and a new request always reacquires activation and revalidates.
- [ ] Owner Workspace Plan pages and read APIs remain read-only in this slice. Tests prove that the backend endpoint is
      authenticated and available for child Plan 17 without adding partial review or execution controls.
- [ ] Focused tests cover valid managed and owner actions; stale revision/status; body-only edits; no/unexpected,
      missing, replaced, and ambiguous worktrees; activation loss and generation mismatch; duplicate request replay;
      request-ID hash conflicts; interrupted receipts; migration preservation; path redaction; and unchanged unmanaged
      local behavior.

## Verification Plan

- Automated: run focused tests with
  `deno run -A scripts/run-tests.js src/shared/workflow/plan-action-evidence.test.ts
  src/shared/owner-coordination/session-activations.test.js src/shared/owner-coordination/database.test.js
  src/ui/workspace/owner-plan-actions.test.ts src/cmd/load-plan/index.integration.test.ts`.
- Automated: run `deno task seams:check` and prove the change adds no injection seam for Plan, lifecycle, registry,
  lock, or owner-database machinery.
- Automated: run `deno task ci`.
- Automated: prove every covered managed command and owner endpoint mutation fails before `recordPlanEvent` when Session
  Activation or canonical evidence is stale, missing, or ambiguous.
- Automated: prove an exact duplicate request returns byte-equivalent stored status/body without another lifecycle
  transition, while a new request ID observes and rejects changed Plan/worktree evidence.
- Automated: prove migration 8 retains existing bootstrap/continuation receipts and their request uniqueness.
- Automated: preserve existing lifecycle behavior for local Plan Board and unmanaged `load-plan`; no covered existing
  test is expected to stop protecting an action.
- Manual: load a Plan detail and evidence, edit the Plan markdown before submitting a lifecycle action, and confirm the
  endpoint returns refresh guidance without changing Plan Status.
- Manual: settle or replace the recorded worktree after loading evidence, submit the stale action, and confirm recovery
  guidance without lifecycle mutation.
- Manual: repeat one successful request ID and confirm the same result returns; send the same action with a new request
  ID and confirm current evidence is checked again.

## Edge Cases & Considerations

- Direct repository edits cannot be prevented. A body-only edit changes the whole-file revision and blocks the stale
  action even when Plan Status is unchanged.
- Plan lookup and evidence reads must not backfill a missing Plan ID. Remote action on an unonboarded Plan is blocked
  and directs the owner to adopt or repair it locally.
- SQLite and repository files do not commit atomically. After the canonical action commits, a receipt-write failure must
  not cause blind replay. A retry can finalize only a result that current canonical evidence proves; otherwise it
  returns recovery guidance.
- A terminal receipt may be returned after Session Activation moved or expired because it answers the same prior HTTP
  request. A new request must acquire current activation.
- Session Control may decide which client can submit an action, but Session Activation is mutation authority.
- Reset-to-draft in this slice never deletes a worktree. It is allowed only after canonical evidence says the attempt is
  settled. Destructive recovery remains deferred.
- User Verification and close-without-verification can produce a terminal Plan and Work Record side effects. Their
  required note/reason and canonical transition remain unchanged.
- Receipt payload size is bounded before SQLite write, parsed JSON is treated as untrusted data on read, and owner API
  responses redact local filesystem paths.
- A receipt does not reserve a Plan, authorize another action, imply execution remains in progress, or become an
  Attention Dashboard source of truth.
- The domain-language definition of Plan Action Evidence Check must remain consistent with the implemented status,
  revision, and worktree checks.
