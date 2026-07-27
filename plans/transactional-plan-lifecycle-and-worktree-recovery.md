---
planId: "f9544cf4-7c0c-4564-8e1c-52ee10369263"
classification: "FEATURE"
complexity: "HIGH"
summary: "Refactor the Plan Lifecycle machine so every lifecycle/worktree transition is one transactional operation across Plan files, the worktree registry, Git, and durable recovery evidence."
affectedPaths:
    - "src/constants.js"
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/shared/workflow/state-transition.js"
    - "src/shared/workflow/state-transition.test.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
    - "src/shared/workflow/architecture-boundary.test.js"
    - "src/shared/workflow/execution-context.js"
    - "src/shared/workflow/execution-context.test.js"
    - "src/shared/workflow/execution-plan-file.js"
    - "src/shared/workflow/execution-plan-file.test.js"
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/workflow-slicer.js"
    - "src/shared/workflow/workflow-slicer.test.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/validation-loop-core.test.js"
    - "src/shared/workflow/validation-loop-delivery.test.js"
    - "src/shared/workflow/validation-loop-human-review.test.js"
    - "src/shared/workflow/validation-loop-recovery.test.js"
    - "src/shared/workflow/validation-loop-repair.test.js"
    - "src/shared/workflow/validation-loop-review.test.js"
    - "src/shared/worktree.js"
    - "src/shared/worktree-registry.js"
    - "src/shared/worktree-registry.test.js"
    - "src/shared/worktree-creation.test.js"
    - "src/shared/worktree-guards.test.js"
    - "src/shared/worktree-merge-risk.test.js"
    - "src/shared/worktree-merge.test.js"
    - "src/shared/worktree-plan-handoff.test.js"
    - "src/cmd/load-plan/index.js"
    - "src/cmd/load-plan/load-plan-execution.test.js"
    - "src/cmd/load-plan/load-plan-hold.test.js"
    - "src/cmd/load-plan/load-plan-recovery.test.js"
    - "src/cmd/load-plan/load-plan-session-lifecycle.test.js"
    - "src/cmd/plans/index.js"
    - "src/cmd/plans/doctor.js"
    - "src/cmd/plans/doctor.test.js"
    - "src/cmd/plans/archive.js"
    - "src/cmd/plans/archive.test.js"
    - "src/cmd/plans/index.test.js"
    - "src/cmd/registry.js"
    - "src/cmd/__tests__/registry.test.js"
    - "src/shared/session/session.js"
    - "src/shared/session/__tests__/session-tools-policy.test.js"
    - "src/tools/plan-safe-file-tools.js"
    - "src/tools/plan-safe-file-tools.test.js"
    - "src/tools/multi_file_edit.js"
    - "src/tools/__tests__/multi-file-edit.test.js"
    - "src/tools/plan-written.js"
    - "src/tools/__tests__/plan-written.test.js"
    - "src/ui/review/plan-review.js"
    - "src/ui/review/plan-review.test.js"
    - "src/ui/workspace/server/plan-adapter.js"
    - "src/ui/workspace/workspace-lifecycle.test.js"
    - "src/shared/work-records/generation.js"
    - "src/shared/work-records/work-records.test.js"
    - "docs/plan-lifecycle.md"
    - "docs/workflows.md"
    - "docs/usage.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-26T00:56:36-04:00"
updatedAt: "2026-07-27T03:57:09.315Z"
status: "implemented"
origin: "internal"
failureReason: "User canceled validation after Semantic Review failure."
userVerifiedAt: null
worktreeId: "a999678c"
worktreeStatus: "validation_failed"
---

# Transactional Plan Lifecycle and Worktree Recovery

## Context

The Plan Lifecycle is RunWield Core's delivery authority, but its durable effects are currently spread across callers.
For example, `startActiveExecutionWorkflow()` creates or reuses a Git worktree, mutates `.wld/worktrees.json`,
materializes the Plan in the execution worktree, captures a baseline, records `execution_started`, and updates in-memory
Session state through separate calls. Validation and Plan Recovery similarly compose Plan writes, registry writes, Git
operations, cleanup, and Work Record handoffs.

`recordPlanEvent()` centralizes Plan Event semantics, but it trusts caller-supplied status and performs an unguarded
Plan write. Other Plan writers—Plan review, Workspace body editing, archive/restore, collaboration metadata, identity
backfill, and Work Record backlinks—can race those writes. Atomic rename alone would prevent torn files but not lost
updates.

RunWield must make every Plan Lifecycle/worktree transition one Core operation. The operation either proves all intended
postconditions, restores the prior safe state, or leaves durable evidence and a plain-English recovery action. Callers
must stop encoding lifecycle choreography.

## Objective

Add a transactional Plan mutation and lifecycle boundary that:

- serializes every operation for the same Plan while allowing unrelated Plans to execute concurrently;
- uses atomic, revision-checked Plan persistence for every RunWield-owned Plan writer and detects unmanaged external
  edits before settlement;
- coordinates Plan Events, registry entries, Git worktrees/branches, Direct Delivery proof, and recovery evidence;
- preserves the event-driven state machine as the only authority for Plan Status changes;
- prevents ambiguous or malformed state from being treated as a missing Plan;
- automatically completes or rolls back only mechanically proven effects and never blindly replays uncertain Git or
  filesystem work;
- gives `/load-plan`, Workspace, and `wld plans doctor` the same typed blocked/recovery results;
- preserves current Direct Delivery semantics, including atomically advancing an eligible parent Epic with the final
  child FEATURE Plan.

## Approach

Introduce `src/shared/workflow/state-transition.js` as the single public boundary for lifecycle-changing operations.
Keep `buildPlanEventUpdates()` pure and event-driven, but make transition code re-read canonical Plan state under lock,
validate the Plan Event against that state, apply all related durable effects, and verify postconditions before
settling. High-level callers request semantic operations such as execution start, implementation finish, validation
failure, Direct Delivery publication, Plan Recovery, hold/reset, or review reopen; they do not receive a generic
callback with which to rebuild the old choreography.

Use a logical lock coordinator rather than one project-wide lock. A transition holds the same-Plan and exact-attempt
locks for its full prepare/apply/verify/settle lifetime. Multi-Plan transitions acquire Plan IDs in deterministic order.
Final-child completion additionally locks the Plan catalog, parent Epic, and complete sibling set because Epic
eligibility depends on stable hierarchy membership and every sibling's current revision/status/evidence. Target-ref
resources use the same canonical ordering scheme. The global registry-file lock is held only for a short atomic
read-modify-write; targeted registry patches re-read under that lock and never restore an old whole-file snapshot over
another Plan's update. Archive/restore and identity/path discovery likewise use the catalog lock only while namespace
facts must remain stable. This preserves ADR-005's concurrent Plan execution while preventing deadlocks and same-Plan
races.

These mutation locks are not a Plan Workflow Lease. They provide short-lived repository serialization now and must
accept expected ownership/fencing data when supplied. Future Plan Workflow Lease enforcement remains keyed to Project,
Plan, and stable Session; a stale or uncertain lease must route to Plan Recovery rather than be overridden by a local
lock. Execution preparation must settle before any ADR-012 execution Session Transcript Segment is activated. This
feature exposes a committed execution context/idempotency token for that handoff but does not implement the future owner
coordination layer or Change Request Delivery.

Give every Plan read a revision token derived from the exact bytes read. Every RunWield-owned writer supplies the
expected revision, re-reads under the Plan lock, and fails with a typed stale-write result if the bytes changed. Persist
with a temporary file in the destination directory, flush the file, rename it, and sync the parent directory where
supported. Preserve unknown Front Matter fields and body bytes. Add strict load results for loaded, not found, malformed
Front Matter, unreadable, and non-regular-file cases; compatibility wrappers may return `null` only for a true not-found
result.

Wrap the Agent `write`, `edit`, and `multi_file_edit` tools for canonical `plans/**/*.md` paths. Initial Plan creation
is create-if-absent under the catalog/path lock. Existing Plan edits must use exact-text/revision-aware mutation and
atomic replacement; a whole-file `write` cannot overwrite an existing Plan without an expected revision. `plan_written`
captures the declared Plan revision before opening review so review approval/feedback cannot silently apply to a later
external edit. Shell commands and external editors cannot be made participants in RunWield's lock, so every later
transition must detect their byte changes through CAS and return a stale/review-again result rather than overwrite them.

Store transition recovery records under an ignored `.wld/` transaction directory. A record contains a transition id,
semantic operation, locked Plan IDs/resources, expected revisions, compact before-facts, intended postconditions,
completed effect markers, and a typed recovery recipe. States are `prepared`, `applying`, `verifying`, `committed`,
`rolled_back`, or `needs_recovery`. Settled records and temporary backups are removed after durable settlement;
unresolved records remain until reconciliation. Do not persist model messages, command transcripts, large Plan bodies,
or secrets.

Treat Git as an external effect, not a transactional datastore. Record pre-operation refs and worktree facts before each
Git mutation, then prove the result from current refs, ancestry, worktree attachment, and cleanliness. After a crash,
automatic continuation is allowed only when those facts prove an idempotent next step. An uncertain target-ref update,
branch deletion, dirty worktree, or ownership mismatch becomes `needs_recovery`; it is never guessed or replayed.

Migrate `.wld/worktrees.json` to a versioned schema that includes stable `planId` and retains historical attempts. A
Plan keeps `worktreeId` as its durable attempt pointer and `worktreeBaseBranch` as pre-execution delivery intent.
Existing `worktreePath`, `worktreeBranch`, `executionBaselineTree`, and `worktreeStatus` fields remain compatibility
snapshots in this feature, but transaction logic derives attempt truth from the exact registry id plus Git facts and
verifies the snapshots rather than trusting independent copies. Do not remove those fields without a later ADR-005
amendment.

Make Epic decomposition a composite transaction rather than a Slicer write loop followed by `decomposition_finalized`.
Under the catalog, Epic, and existing-child locks, validate/create/update the complete child set, verify stable
`planId`/`parentPlan` relationships, then record the Epic Plan Event. A failed child write or Epic transition restores
the prior child files and removes only transaction-created files; concurrent child creation or edit fails by revision
instead of producing a partially finalized Epic.

Scope publication to current Direct Delivery. Lock the catalog, child, parent Epic, complete sibling set, exact attempt,
and target ref; revalidate hierarchy membership plus every sibling's dependency-satisfied status and mode-appropriate
Delivery Evidence immediately before target-ref movement. Stage the child FEATURE Plan's `validation_passed` event,
Delivery Evidence, and eligible parent Epic advancement in the execution branch; seal the candidate; update the target
ref; and prove candidate plus Plan metadata ancestry as one multi-Plan transaction. The same sibling/catalog fencing
applies when `manual_user_verified` could complete an Epic, though that Plan-only transition performs no Git
publication. Once the target ref has moved, do not promise to restore the primary Plan to `implemented`. Reinspect the
actual target ref and either prove publication or leave a publication-reconciliation recipe. Cleanup and Work Record
generation occur after verified publication; failures there must not revoke a Verified Plan.

Add `wld plans doctor` as the single reconciliation surface. It is report-only by default. `--repair` may perform only
mechanically proven, non-destructive repairs; deleting a worktree, directory, or branch requires explicit confirmation
or a printed manual command.

## Files to Modify

- `src/plan-store.js`, `src/plan-store.test.js` — add strict load outcomes, byte revisions, per-Plan/catalog locking,
  crash-safe atomic replacement, compare-and-set writers, and migrate every Plan write path including body edit,
  archive/restore, collaboration, and identity backfill. Replace malformed-Front-Matter self-healing tests with
  fail-closed preservation tests.
- `src/shared/workflow/state-transition.js`, `src/shared/workflow/state-transition.test.js` — add the semantic
  transition API, ordered resource locks, journal/recovery schema, apply/verify/settle orchestration, safe rollback,
  crash reconciliation, typed blocked results, and fault-injection coverage. These are new files.
- `src/shared/workflow/plan-lifecycle.js`, `src/shared/workflow/plan-lifecycle.test.js` — keep Plan Event mapping pure;
  route persistence through transactions; derive status/classification from locked canonical attrs; atomically include
  eligible parent Epic advancement; and block manual movement into execution-derived statuses without prerequisites.
- `src/shared/workflow/architecture-boundary.test.js` — new boundary tests preventing workflow, validation, recovery,
  Workspace, and review callers from composing raw Plan/registry/Git lifecycle writes.
- `src/shared/workflow/execution-context.js`, `src/shared/workflow/execution-plan-file.js`, and tests — resolve attempt
  state by Plan id/worktree id, return typed disagreement and recovery evidence, and use revision-checked atomic
  Plan-file materialization in execution worktrees.
- `src/shared/workflow/workflow.js`, `src/shared/workflow/workflow.test.js` — replace execution-start and
  implementation-finish choreography with semantic transitions and activate in-memory execution state only from a
  committed execution context.
- `src/shared/workflow/workflow-slicer.js`, `src/shared/workflow/workflow-slicer.test.js` — make child Plan
  materialization plus `decomposition_finalized` one catalog/Epic/children transaction, including create/update rollback
  and concurrent-membership tests.
- `src/shared/workflow/validation.js` and validation-loop tests — replace validation failure, retry, target-advanced,
  Direct Delivery, merge-failure, cleanup, and post-verification choreography with transaction outcomes.
- `src/shared/worktree.js` and worktree tests — split Git primitives from registry mutation, expose explicit pre/post
  facts, remove unconditional `git branch -D`, and support proof-based cleanup and publication reconciliation.
- `src/shared/worktree-registry.js`, `src/shared/worktree-registry.test.js` — add versioned migration, `planId`, strict
  missing-id updates, exact-id lookup, one nonterminal attempt per Plan, durable atomic writes, and non-destructive
  reconciliation primitives. Replace the test that deliberately permits duplicate live attempts.
- `src/cmd/load-plan/index.js` and load-plan tests — route continue, retry validation, merge, recreate, abandon,
  hold/reset, User Verification, and review reopen through semantic transactions; display their concrete recovery
  recipes and never repair by Plan-name-first registry lookup.
- `src/cmd/plans/index.js`, `src/cmd/plans/doctor.js`, `src/cmd/plans/archive.js`, command tests, and
  `src/cmd/registry.js` — add `wld plans doctor [--repair]`, register/help-document it, and put archive/restore under
  the same Plan locking/CAS and recoverable-worktree guards.
- `src/shared/session/session.js`, session tool-policy tests, `src/tools/plan-safe-file-tools.js`, and
  `src/tools/multi_file_edit.js` tests — wrap structured Agent writes to canonical Plan paths with create-if-absent,
  exact-text/revision checks, Plan locks, and the shared atomic writer; refuse unversioned whole-file overwrite of an
  existing Plan.
- `src/tools/plan-written.js`, `src/tools/__tests__/plan-written.test.js`, `src/ui/review/plan-review.js`, and review
  tests — capture the declared Plan revision before review and atomically apply reviewed body/policy changes plus the
  corresponding review Plan Event; stale review decisions must reopen review instead of overwriting later edits.
- `src/ui/workspace/server/plan-adapter.js`, `src/ui/workspace/workspace-lifecycle.test.js` — use revision tokens for
  body saves and semantic transitions for lifecycle actions. Keep owner Workspace Plan Boards read-only until Plan
  Workflow Lease enforcement exists.
- `src/shared/work-records/generation.js`, `src/shared/work-records/work-records.test.js` — use Plan CAS for backlinks
  and treat generation/backlink failures as post-settlement bookkeeping, not a reason to undo terminal Plan Status.
- `src/constants.js` — define ignored lock, journal, backup, and registry-schema paths without exposing local paths in
  portable Delivery Evidence.
- `docs/plan-lifecycle.md`, `docs/workflows.md`, `docs/usage.md` — document transaction guarantees, strict parse
  behavior, Direct Delivery proof, recovery messages, lock/lease separation, and doctor usage.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/workflow/plan-lifecycle.js#buildPlanEventUpdates` — retain as the pure Plan Event-to-Front-Matter mapping;
  do not introduce raw status transitions in the transaction layer.
- `src/shared/workflow/plan-lifecycle.js#stageValidationPassedInExecutionWorktree` — preserve its child/parent staging
  semantics while moving temporary hierarchy writes and publication proof under the multi-Plan transaction.
- `src/shared/workflow/execution-context.js` — reuse existing Plan/registry/Git identity checks as prepare and verify
  assertions.
- `src/shared/workflow/execution-plan-file.js` — reuse canonical Plan identity and parent-chain checks while adopting
  the shared atomic writer and revision checks.
- `src/shared/worktree.js#mergeExecutionWorktree` and ancestry helpers — retain detached-target merge support and sealed
  candidate proof, but expose effect facts to the transition runner.
- `src/shared/worktree-registry.js#withWorktreeRegistryLock` — reuse lock ownership/staleness mechanics inside the new
  ordered lock coordinator; do not nest ad hoc registry locks in callers.
- `src/plan-store.js#parsePlanFrontMatter`, `injectFrontMatter`, and `splitPlanMarkdownBody` — retain canonical parsing
  and formatting after separating not-found from malformed/unreadable outcomes.
- `src/shared/workflow/metrics.js` — record settled outcome/recovery classes after the transaction; metrics remain
  optional observability and are never a commit postcondition.

## Implementation Steps

- [ ] Inventory every current `PlanEvent` and every caller of Plan writers, registry writers, worktree create/merge/
      remove helpers, Plan review writes, Workspace writes, archive/restore, Work Record backlinks, and Plan Recovery.
      Add a checked-in transition matrix to `docs/plan-lifecycle.md` plus table-driven tests naming inputs, locked
      resources, Plan/registry/Git effects, success proof, rollback limit, and recovery action. Workflow actions such as
      “Retry Workflow Validation” map to existing Plan Events; they do not become parallel status semantics.
- [ ] Build the shared Plan persistence foundation in `plan-store.js`: strict load outcomes; exact-byte revision tokens;
      logical Plan/catalog locks; atomic temp-write, file sync, rename, and parent-directory sync; CAS errors;
      stale-lock handling; and preservation of unknown Front Matter/body bytes. Update all RunWield-owned Plan writers
      to use it, including structured Agent write/edit/multi-edit tools, review, Slicer, Workspace body save,
      archive/restore, collaboration metadata, identity backfill, and Work Record backlinks. Test create-if-absent,
      update CAS, stale rejection, and atomic multi-file rollback.
- [ ] Make malformed state fail closed. `loadPlan()` may return `null` only for true absence; malformed YAML, conflict
      markers, unreadable files, directories/symlinks where a Plan file is expected, duplicate Plan IDs, and unsupported
      Front Matter produce typed errors/issues without changing bytes. Listings and doctor must surface issues instead
      of silently dropping them. Explicit repair must work from preserved bytes/backups and complete replacement
      metadata.
- [ ] Implement the ordered lock coordinator and transition journal in `state-transition.js`. Use canonical resource
      keys and deterministic acquisition for catalog, sorted Plan IDs, exact attempts, and target refs. Hold those
      logical resources through settle, but hold the global registry-file lock only around a fresh targeted
      read-modify-write; rollback patches only the owned entry after another fresh read. Journal before external
      effects, atomically record completed effect markers, verify from fresh reads, roll back only proven reversible
      state, and leave `needs_recovery` recipes for uncertainty. Remove settled journals/backups only after durable
      settle.
- [ ] Define a small semantic API for Plan-only events, execution preparation, implementation checkpoint, validation
      outcome, Direct Delivery publication, recovery continue/reset/recreate/abandon, hold/resume, review reopen, User
      Verification/close, and archive/restore. Require expected Plan revisions and accept optional Plan Workflow Lease/
      checkpoint generations without implementing the future lease store.
- [ ] Route all simple Plan Events through the transition API. Ignore caller-supplied `currentStatus` as authority;
      compare it only as an optional stale-state precondition. Build updates from canonical attrs inside the lock,
      preserve Shared Plan lock rules, and verify exact postconditions. Review approval must commit reviewed Plan
      content and its review event together.
- [ ] Make Epic decomposition one transaction. Lock the catalog, Epic, and all existing children; validate expected
      revisions and requested child names/ids; stage every child create/update; verify the complete child set; and only
      then apply `decomposition_finalized`. Roll back all staged child effects if any write or Epic event fails. If the
      Epic is already Ready For Work, child updates still use the same composite Plan mutation without replaying the
      Plan Event.
- [ ] Make execution preparation one transaction. Resolve/create a target branch, create or reuse exactly one
      nonterminal attempt, materialize the canonical Plan, capture baseline facts, update registry schema v2, record
      `worktreeId` and compatibility snapshots, and apply `execution_started`. If a fresh worktree cannot be safely
      removed after later failure, preserve it and journal exact inspect/retry/abandon actions. Return a committed
      execution context before in-memory Session state or a future execution Session Transcript Segment is activated.
- [ ] Make implementation completion one transaction. Checkpoint all execution-worktree changes, prove a clean checkout
      and checkpoint commit, update the exact registry attempt, and record `implementation_finished`. A failed
      checkpoint leaves the Plan In Progress. A committed checkpoint followed by uncertain metadata settlement records
      the commit and recovery recipe rather than losing the attempt.
- [ ] Make validation failure and retry state transactional. Record `validation_failed` with the exact attempt, preserve
      the worktree, and express target-advanced rollback as a Plan Event transaction rather than a raw Front Matter
      write. Retry must validate current Plan revision, registry attempt, worktree identity, candidate state, and any
      unresolved journal before running Workflow Validation again.
- [ ] Implement proof-bearing Direct Delivery. Lock the Plan catalog, child, eligible parent Epic, complete sibling set,
      exact registry attempt, and target ref in canonical order. Re-read membership and each sibling revision/status;
      require dependency-satisfied status and mode-appropriate Delivery Evidence where applicable; then stage child and
      parent Plan Events in the execution branch, seal the candidate, capture target head, merge/update the target, and
      prove implementation plus metadata ancestry. Before target-ref movement, safe failure restores snapshots and
      settles `worktree_merge_failed`. After possible target-ref movement, inspect facts and either finalize verified
      publication or leave publication reconciliation—never force the Plan back to `implemented` or replay the merge
      blindly. Apply the same catalog/sibling fencing to Plan-only `manual_user_verified` Epic completion.
- [ ] Separate post-publication cleanup. Once publication is proven, a cleanup failure cannot revoke Verified Plan
      status. Remove only a clean attached worktree and delete its branch only after publication ancestry proves it
      safe; otherwise retain the registry attempt and a cleanup recipe. Generate the Work Record afterward and make any
      backlink retry revision-safe.
- [ ] Enforce registry integrity and migrate existing projects. Registry v2 adds `planId`, validates unique ids and one
      nonterminal attempt per Plan, throws on missing-id update, and keeps terminal attempt evidence. Migration resolves
      the Plan named by each v1 entry and records ambiguity instead of guessing. For duplicate legacy attempts, honor an
      exact Plan `worktreeId`; classify other live/uncertain attempts for recovery and mark one abandoned only after Git
      facts or explicit user confirmation prove that action safe.
- [ ] Route `/load-plan`, Workspace, hold/reset, review reopen, manual status movement, and archive/restore through the
      same rules. Reset/reopen cannot merely clear Plan pointers while leaving a physical attempt: explicitly abandon it
      transactionally or block with concrete choices. Disallow manual moves into `in_progress` or `implemented` unless
      their execution/checkpoint prerequisites are proven. `--force` archive must not bypass ADR-008 recoverable-
      worktree guards.
- [ ] Add `wld plans doctor [--repair]`. Scan active and archived Plans (including parse issues), registry v1/v2,
      unresolved transition records, `git worktree list --porcelain`, `runwield/worktree/*` branches, target refs, and
      Delivery Evidence. Report malformed Plan, duplicate Plan id, missing registry id, duplicate attempt, Plan/registry
      mismatch, orphan worktree/branch, archived Plan with recoverable attempt, uncertain publication, verified without
      mode-appropriate evidence, and stale settled artifacts. Auto-repair only provable metadata drift; require explicit
      confirmation for branch/worktree/directory deletion or attempt abandonment.
- [ ] Add crash-resume integration. Execution preparation, `/load-plan`, validation retry, and doctor inspect unresolved
      records before conflicting work. Re-run only verification or an idempotent step whose pre/post facts prove safety;
      otherwise return a typed blocked result with actions such as “inspect this worktree,” “retry proof for target
      branch,” “abandon this attempt,” or “repair this Plan Front Matter.” Do not surface bare internal labels without
      an explanation and next action.
- [ ] Remove or quarantine bypasses. Split `createExecutionWorktree()` so Git creation does not secretly mutate the
      registry, remove unconditional force branch deletion, make raw Plan/registry/Git mutators private or
      storage-level, and add architecture-boundary tests preventing high-level caller choreography from returning.
- [ ] Update docs and migration guidance. Explain same-Plan serialization versus concurrent unrelated Plans, CAS errors,
      transaction/Plan Workflow Lease separation, strict parse behavior, registry v2 migration, Direct Delivery proof,
      post-publication cleanup, recovery recipes, and doctor use before/after upgrading.

## Verification Plan

- Automated:
  `deno test -A src/plan-store.test.js src/shared/workflow/state-transition.test.js src/shared/workflow/plan-lifecycle.test.js src/shared/workflow/architecture-boundary.test.js`.
- Automated:
  `deno test -A src/shared/worktree-registry.test.js src/shared/worktree-creation.test.js src/shared/worktree-guards.test.js src/shared/worktree-merge-risk.test.js src/shared/worktree-merge.test.js src/shared/worktree-plan-handoff.test.js`.
- Automated:
  `deno test -A src/shared/workflow/execution-context.test.js src/shared/workflow/execution-plan-file.test.js src/shared/workflow/workflow.test.js src/shared/workflow/workflow-slicer.test.js`.
- Automated:
  `deno test -A src/shared/workflow/validation-loop-core.test.js src/shared/workflow/validation-loop-delivery.test.js src/shared/workflow/validation-loop-human-review.test.js src/shared/workflow/validation-loop-recovery.test.js src/shared/workflow/validation-loop-repair.test.js src/shared/workflow/validation-loop-review.test.js`.
- Automated:
  `deno test -A src/cmd/load-plan/load-plan-execution.test.js src/cmd/load-plan/load-plan-hold.test.js src/cmd/load-plan/load-plan-recovery.test.js src/cmd/load-plan/load-plan-session-lifecycle.test.js src/cmd/plans/doctor.test.js src/cmd/plans/archive.test.js src/cmd/plans/index.test.js src/cmd/__tests__/registry.test.js`.
- Automated:
  `deno test -A src/tools/plan-safe-file-tools.test.js src/tools/__tests__/multi-file-edit.test.js src/tools/__tests__/plan-written.test.js src/shared/session/__tests__/session-tools-policy.test.js`.
- Automated:
  `deno test -A src/ui/review/plan-review.test.js src/ui/workspace/workspace-lifecycle.test.js src/shared/work-records/work-records.test.js`.
- Automated: `deno task ci`.
- Manual: run two unrelated FEATURE Plan execution-start transactions concurrently and verify their prepare/apply work
  overlaps except for brief registry-file writes; race two writes or recovery actions for the same Plan and verify one
  succeeds while the other receives a stale revision or lock/ownership result without overwriting state.
- Manual: inject failure after each execution-start, implementation-checkpoint, validation-failure, Direct Delivery,
  target-ref update, cleanup, archive, and review-write phase. Restart and verify the operation is committed, safely
  rolled back, or blocked by a durable recipe with enough evidence to continue.
- Manual: fail Slicer child creation/update at each file boundary and verify no partial decomposition or premature
  `decomposition_finalized`; concurrently create/edit a child and verify membership/revision fencing blocks stale
  finalization.
- Manual: deliver the final child FEATURE Plan of an Epic and verify implementation, child `verified`, eligible parent
  Epic `verified`, and Delivery Evidence arrive in one target-branch commit graph outcome. Race sibling reopen, User
  Verification, and child creation before target-ref movement and verify eligibility is rechecked. Also test ineligible
  siblings and a crash after target-ref movement; reconciliation must prove the result without replaying the merge.
- Manual: corrupt Plan Front Matter with invalid YAML and conflict markers, replace a Plan path with a directory or
  symlink, and create duplicate Plan IDs. Verify reads/listings/doctor distinguish each case, preserve bytes, and refuse
  mutation until explicit repair.
- Manual: migrate registry v1 data containing duplicate live attempts, stale paths, archived Plans, and missing Plan
  files. Verify doctor never selects by first Plan-name match or deletes evidence without proof/confirmation.
- Expected: no lifecycle operation can silently leave Plan Front Matter, hierarchy membership, the exact registry
  attempt, and Git publication facts inconsistent. No RunWield-owned Plan writer silently loses a concurrent edit. Every
  interrupted operation is proven complete, safely rolled back, or represented by a visible recovery recipe.
- Execution policy matrix:
  - This is Core backend/workflow work, so `executionAgent: "engineer"` and autonomous execution are appropriate.
  - Workspace edits are server lifecycle plumbing and focused tests; no browser-rendered visual outcome is planned, so
    no dev server or headed-browser verification is required unless implementation introduces visible UI.

## Edge Cases & Considerations

- Same-Plan and exact-attempt locking covers the whole transition, not only the final Plan-file rename. Unrelated Plans
  remain concurrent; the registry-file lock is brief, while shared parent/siblings, target branch, and catalog resources
  use deterministic additional locks only when their facts affect the transition.
- Logical mutation locks do not prove workflow ownership. When Plan Workflow Lease enforcement becomes available, stale
  or uncertain lease/checkpoint generations must block before repository effects; local lock expiry cannot authorize
  takeover.
- `worktreeBaseBranch` remains user-selected delivery intent before an attempt exists. The registry owns resolved
  attempt path/branch/base/baseline/status; compatibility Plan snapshots remain until a separately accepted ADR-005
  migration removes them.
- Registry migration and doctor must use stable `planId`, then exact `worktreeId`. Plan name is display/fallback
  evidence, never sufficient authority when ids disagree.
- Git ref movement and branch deletion are the principal irreversible effects. Never auto-delete a branch without
  ancestry proof of publication or an explicit abandon decision.
- A cleanup or Work Record failure after proven Direct Delivery does not make a Verified Plan Implemented again.
  Preserve the verified outcome and expose the remaining bookkeeping action.
- Non-Git in-place execution cannot make arbitrary implementation edits transactional. The state-transition layer still
  serializes and proves Plan Events, but recovery messaging must honestly distinguish lifecycle settlement from source
  rollback capability.
- Structured Agent Plan tools are RunWield-owned writers and must participate in Plan locking/CAS. Arbitrary shell
  commands, Git checkout changes, and external editors cannot be locked reliably; byte revisions must detect them before
  review or lifecycle settlement and require the user/Agent to re-read rather than overwriting them.
- Shared Plans retain collaboration lock semantics. A transition surfaces the existing collaboration repair path rather
  than bypassing or replacing it.
- Journal recovery records may contain local paths and commit ids needed for local recovery, but Delivery Evidence and
  Work Records must remain portable and must not expose absolute paths.
- Metrics are best-effort post-settlement observability. A metrics write failure never rolls back a Plan transition.
- No Change Request Delivery behavior is implemented in this feature. Its future publication/finalization flow may reuse
  the lock, CAS, journal, and proof interfaces without weakening Direct Delivery guarantees.
