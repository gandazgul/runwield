---
planId: "f9544cf4-7c0c-4564-8e1c-52ee10369263"
classification: "FEATURE"
complexity: "HIGH"
summary: "Make Plan Lifecycle and worktree state transitions transactional, fail-closed, and automatically recoverable across Plan front matter, the worktree registry, and Git publication state."
affectedPaths:
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
    - "src/shared/workflow/state-transition.js"
    - "src/shared/workflow/state-transition.test.js"
    - "src/shared/workflow/execution-context.js"
    - "src/shared/workflow/execution-context.test.js"
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/validation-loop-delivery.test.js"
    - "src/shared/workflow/validation-loop-recovery.test.js"
    - "src/shared/worktree.js"
    - "src/shared/worktree-registry.js"
    - "src/shared/worktree-registry.test.js"
    - "src/shared/worktree-creation.test.js"
    - "src/shared/worktree-merge.test.js"
    - "src/cmd/load-plan/index.js"
    - "src/cmd/load-plan/load-plan-recovery.test.js"
    - "src/cmd/plans/index.js"
    - "src/cmd/plans/index.test.js"
    - "src/ui/workspace/server/plan-adapter.js"
    - "src/ui/workspace/workspace-lifecycle.test.js"
    - "docs/plan-lifecycle.md"
    - "docs/workflows.md"
    - "docs/usage.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-07-26T00:56:36-04:00"
status: "draft"
origin: "internal"
---

# Transactional Plan Lifecycle and Worktree Recovery

## Context

The Plan Lifecycle state machine is the critical Core authority for RunWield delivery truth. It decides whether work is
drafted, approved, executing, implemented, verified, closed, held, recoverable, or safe to continue. Worktree execution
adds two more durable truth sources: `.wld/worktrees.json` and Git's actual worktree/branch state. Today the happy path
is strong, especially staged `validation_passed` metadata landing through the merge commit, but the system has no single
transaction boundary across Plan Front Matter, registry entries, and Git postconditions.

The result is observable drift: verified FEATURE Plans can lack required evidence, registry entries can outlive archived
Plans, registry and Plan worktree statuses can disagree, stale live worktrees can remain attached forever, and malformed
Plan Front Matter can be treated like a missing Plan. These failures are especially dangerous because lifecycle writes
are durable user-facing state. A transition that partially succeeds must not leave the user stranded in a state RunWield
cannot explain or recover.

This feature makes every consequential lifecycle action behave as one recoverable transaction: either all intended state
changes commit and verify together, or RunWield automatically rolls them back or records a precise resumable recovery
marker with helpful next steps.

## Objective

Introduce a transactional state-transition layer for Plan Lifecycle and worktree operations so one Plan Event produces
one coherent durable outcome across Plan Front Matter, `.wld/worktrees.json`, and Git publication checks. Every failure
path must preserve enough evidence to recover automatically when safe, or guide the user to a bounded repair flow when
automatic repair would risk data loss.

## Approach

Add a Core `state-transition` module that becomes the only write path for lifecycle-changing operations. A transition
has four phases:

1. `prepare`: acquire the project lifecycle lock, read canonical Plan state, parse Front Matter fail-closed, read the
   matching registry entry by exact id when relevant, inspect Git facts, and write a transition journal entry containing
   before-snapshots and intended postconditions.
2. `apply`: perform atomic file writes and registry writes, plus any Git operation that is part of the transition.
3. `verify`: re-read Plan, registry, and Git postconditions under the same lock; confirm that all three agree with the
   transition result.
4. `settle`: mark the journal entry committed. If apply or verify fails, automatically rollback file/registry state from
   snapshots when safe; otherwise mark the entry `needs_recovery` with a typed recovery recipe.

Use atomic Plan writes everywhere Plan Front Matter changes. Malformed YAML is not a recoverable "missing Plan" case:
loading should distinguish NotFound from parse failure, block the transition, preserve bytes, and offer an explicit
repair path. Registry writes already use tmp-and-rename; keep that behavior but make missing-id updates and duplicate
active entries fail loudly.

Do not try to make Git itself transactional. Instead, treat Git operations as prepare/apply/postcondition work with
durable evidence. If Git publication succeeds but cleanup fails, the verified Plan remains verified and cleanup becomes
recoverable bookkeeping. If Git publication or proof is inconclusive, the canonical Plan remains implemented with
recoverable worktree metadata, and the journal records how to retry or continue.

Finally, add a `wld worktrees doctor` or equivalent `wld plans doctor --worktrees` command that reconciles current drift
from Plan files, the registry, and `git worktree list --porcelain`. It should report exact drift classes, safely repair
mechanical metadata disagreements, and avoid deleting branches or directories without explicit user confirmation.

## Files to Modify

- `src/plan-store.js` - add atomic Plan write helpers, explicit malformed Front Matter errors, parse-issue reporting,
  and safe update APIs that never silently rebuild unknown Front Matter.
- `src/plan-store.test.js` - cover crash-safe writes, malformed YAML preservation, conflict markers in Front Matter,
  missing-file distinction, and update refusal behavior.
- `src/shared/workflow/state-transition.js` - add the project lifecycle lock, transition journal, snapshot model,
  apply/verify/settle orchestration, rollback helpers, typed blocked/recovery results, and reusable invariants.
- `src/shared/workflow/state-transition.test.js` - cover commit, rollback, crash-resume, needs-recovery, lock ordering,
  and user-facing recovery recipe output.
- `src/shared/workflow/plan-lifecycle.js` - route `recordPlanEvent`, staged validation, manual status changes,
  hold/reset/reopen events, parent Epic advancement, and validation rollback through transactional updates.
- `src/shared/workflow/plan-lifecycle.test.js` - verify every Plan Event either commits all metadata or leaves canonical
  state unchanged/recoverable, including partial `triageMeta` and FEATURE Delivery Evidence guard cases.
- `src/shared/workflow/execution-context.js` - return typed transaction prerequisites and recovery recipes when Plan,
  registry, and Git evidence disagree.
- `src/shared/workflow/workflow.js` - make worktree creation plus registry insertion plus `execution_started` one
  transaction, including orphan cleanup when later steps fail.
- `src/shared/workflow/validation.js` - make `validation_failed`, target-advanced rollback, `validation_passed`,
  merge-back, registry updates, cleanup, Work Record generation gates, and Epic continuation use the transaction layer.
- `src/shared/worktree.js` - expose Git operations with explicit postconditions and non-destructive recovery metadata;
  avoid force-deleting branches unless prior proof says the delivered commits are safely published or explicitly
  abandoned.
- `src/shared/worktree-registry.js` - make `updateEntry` throw on missing id, reject duplicate non-terminal entries per
  Plan, mark stale entries detached instead of deleting them, and expose reconciliation primitives.
- `src/cmd/load-plan/index.js` - use transaction recovery recipes for continue, retry validation, merge, reset, and
  abandon flows; never infer unsafe state from first registry match by Plan name.
- `src/cmd/plans/index.js` - add or route to a doctor/reconcile command that reports and repairs Plan/registry/Git
  drift.
- `src/ui/workspace/server/plan-adapter.js` - ensure Workspace lifecycle actions use the same transactional write path
  and cannot bypass registry/worktree cleanup rules.
- `docs/plan-lifecycle.md`, `docs/workflows.md`, and `docs/usage.md` - document transactional lifecycle semantics,
  recovery guarantees, doctor output, and manual repair instructions.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/worktree-registry.js#withWorktreeRegistryLock` - reuse the lock shape and tmp-rename registry writer, but
  place it under a broader lifecycle lock so Plan and registry updates cannot interleave.
- `src/shared/workflow/plan-lifecycle.js#buildPlanEventUpdates` - keep the state machine's event-to-metadata mapping
  pure; wrap persistence and cross-source verification around it rather than scattering transition rules.
- `src/shared/workflow/execution-context.js` - reuse existing Plan/registry/Git identity checks as transaction
  prerequisites and postcondition assertions.
- `src/shared/worktree.js#mergeExecutionWorktree` and related merge proof helpers - keep the existing target-branch and
  detached-merge support while requiring explicit postconditions before lifecycle settlement.
- `src/plan-store.js#parsePlanFrontMatter` and `injectFrontMatter` - reuse canonical formatting and normalization after
  separating parse failures from missing files.
- `src/shared/workflow/metrics.js` - record transaction outcomes and recovery classes without adding another telemetry
  mechanism.

## Implementation Steps

- [ ] Add atomic Plan-file persistence. Introduce a shared write helper that writes to a temp file in the target
      directory, flushes, renames, and cleans up temp files on failure. Replace direct lifecycle-related
      `Deno.writeTextFile` calls in `savePlan`, `updatePlanStatus`, `updatePlanFrontMatter`, collaboration metadata
      updates, and lifecycle staging paths.
- [ ] Make Plan loading fail closed. Introduce typed NotFound vs FrontMatterParseError outcomes, preserve malformed
      bytes exactly, and change update paths to refuse self-healing unless an explicit repair command supplies complete
      recovery metadata. Add user-facing messages that name the exact Plan path and parse problem.
- [ ] Implement `state-transition.js`. Define transition ids, lifecycle lock path, journal location, before/after
      snapshots, intended Plan/registry/Git postconditions, rollback strategy, and `needs_recovery` recipes. Keep the
      public API small: `runPlanStateTransition(opts)` plus typed helpers for common Plan/worktree transitions.
- [ ] Route `recordPlanEvent` through the transaction layer. Re-read canonical Plan state inside the lock, reject stale
      `currentStatus`, derive classification from canonical attrs for FEATURE evidence guards, and verify the final Plan
      attrs after writing. Parent Epic advancement must be a separate nested-safe transaction that only runs after the
      child transaction settles.
- [ ] Make execution start atomic. Create the worktree, add the registry entry, materialize required Plan metadata, and
      record `execution_started` as one transition. If registry or Plan metadata writing fails after `git worktree add`,
      automatically remove the new worktree and branch when clean; otherwise journal a recoverable orphan with exact
      cleanup steps.
- [ ] Make implementation completion atomic. Checkpoint the execution worktree, update registry status, and record
      `implementation_finished` together. A failed checkpoint leaves the Plan `in_progress`; a failed metadata update
      rolls back registry status or records a recovery marker that points to the checkpoint commit.
- [ ] Make validation outcomes atomic. `validation_failed` updates Plan failure metadata and registry status together.
      Target-advanced validation rollback becomes an explicit lifecycle event instead of a raw `updatePlanFrontMatter`
      write. Partial failure must keep the worktree recoverable and report retry steps.
- [ ] Make merge publication a proof-bearing transition. Stage `validation_passed` in the execution worktree, merge or
      update the target branch, prove candidate and metadata commits are ancestors of the target, update registry
      status, clear canonical worktree metadata, and settle only after those postconditions pass. Cleanup and Work
      Record generation happen after settlement and, if they fail, become separate recoverable bookkeeping.
- [ ] Fix registry integrity. Make missing-id updates throw, reject duplicate active/completed/failed entries for the
      same Plan unless the older entry is abandoned/detached, prefer exact id over Plan-name fallback everywhere, and
      convert stale-prune deletion into a detached/tombstone status with branch/base metadata retained.
- [ ] Bring Workspace lifecycle actions under the same transaction rules. Manual movement away from execution states
      must either preserve recoverable metadata, explicitly abandon it through a transaction, or block with a clear
      recovery action. Workspace should not call raw lifecycle writes that ignore registry state.
- [ ] Add worktree doctor/reconcile. Inspect active and archived Plans, `.wld/worktrees.json`,
      `git worktree list
      --porcelain`, matching `runwield/worktree/*` branches, and Delivery Evidence. Report
      verified-without-evidence, registry-with-archived-plan, Plan/registry status mismatch, dangling worktree metadata,
      orphaned worktree, and missing registry entry classes. Provide safe automatic fixes and explicit manual commands
      for destructive cases.
- [ ] Add crash-resume behavior. On startup, `wld load-plan`, validation retry, and doctor commands should scan
      incomplete transition journal entries, complete idempotent postconditions, rollback safe snapshots, or surface the
      recorded recovery recipe before allowing a new conflicting transition.
- [ ] Update docs and operator guidance. Document that Plan Lifecycle state is transactional, how recovery recipes are
      generated, which failures are automatically fixed, when user confirmation is required, and how to run doctor
      before/after upgrading existing projects.

## Verification Plan

- Automated:
  `deno test -A src/plan-store.test.js src/shared/workflow/state-transition.test.js src/shared/workflow/plan-lifecycle.test.js`.
- Automated:
  `deno test -A src/shared/worktree-registry.test.js src/shared/worktree-creation.test.js src/shared/worktree-merge.test.js`.
- Automated:
  `deno test -A src/shared/workflow/execution-context.test.js src/shared/workflow/workflow.test.js src/shared/workflow/validation-loop-delivery.test.js src/shared/workflow/validation-loop-recovery.test.js`.
- Automated:
  `deno test -A src/cmd/load-plan/load-plan-recovery.test.js src/cmd/plans/index.test.js src/ui/workspace/workspace-lifecycle.test.js`.
- Automated: `deno task ci`.
- Manual: create a temporary Git Project and force failures after each phase of execution start, implementation
  completion, validation failure, target-advanced rollback, merge publication, registry cleanup, and Workspace manual
  movement. Verify each failure either restores previous durable state or records a recovery recipe that can be retried.
- Manual: run the doctor command on a copy of the current project drift and verify it reports the known classes:
  verified FEATURE without evidence, registry entries for archived Plans, Plan/registry status disagreement,
  worktreeStatus without worktreeId, and live registered worktrees needing cleanup or recovery.
- Manual: corrupt a Plan Front Matter block with YAML syntax errors and conflict markers. Verify loading and lifecycle
  updates fail closed, preserve bytes, and provide exact repair guidance instead of rebuilding metadata.
- Expected result: no Plan Event can leave Plan Front Matter, registry state, and Git publication proof silently
  inconsistent. Every interrupted transition is either completed, rolled back, or represented by a visible recovery
  recipe with enough evidence to continue.
- Execution policy matrix:
  - This is Core backend/workflow work, not visual UI work, so it uses `executionAgent: "engineer"` with
    `collaborationRecommendation: "autonomous"`.
  - Workspace changes are server-side lifecycle plumbing and focused tests; no dev server or headed browser verification
    is required unless implementation adds visible UI.

## Edge Cases & Considerations

- The transaction layer must preserve the existing event-driven state machine. It should not smuggle in raw status
  writes, hidden bypasses, or special-case terminal states outside `buildPlanEventUpdates`.
- Git branch deletion is destructive. Automatic branch deletion is allowed only after proof that the branch's relevant
  commits are published or after an explicit abandon transaction. Otherwise provide a recovery recipe.
- Cleanup failure after verified merge is not a reason to unverify the Plan. Treat cleanup as follow-up bookkeeping with
  its own recoverable state.
- Existing historical Plans may lack modern Delivery Evidence. Doctor should distinguish legacy absence from active
  corruption by looking at status, timestamps, worktree metadata, registry entries, and Git branches.
- Lock ordering matters. Use one lifecycle lock as the outer lock and keep registry/file writes inside it to avoid
  deadlocks between Workspace, TUI, validation, and recovery flows.
- Journal entries must not store huge file bodies forever. Keep compact snapshots for metadata and registry entries, and
  store backup file paths for full malformed/corrupt Plan bytes when needed.
- Automatic recovery must be conservative. If RunWield cannot prove ownership of a worktree, branch, or Plan identity,
  it should preserve evidence and explain the next safe command rather than guessing.
- Shared/collaboration-locked Plans must keep their lock semantics. The transaction layer should surface the existing
  Shared Plan lock repair path instead of bypassing it.
