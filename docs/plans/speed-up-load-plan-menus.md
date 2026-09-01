---
planId: "c8d3b0b6-413d-468f-9444-950f6853eea2"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
affectedPaths:
    - "src/cmd/load-plan/index.ts"
    - "src/cmd/load-plan/plan-session-surface.ts"
    - "src/cmd/load-plan/plan-epic-flow.ts"
    - "src/cmd/load-plan/plan-hold.ts"
    - "src/cmd/load-plan/plan-recovery-flow.ts"
    - "src/shared/workflow/transition-recovery.ts"
    - "src/shared/workflow/state-transition.ts"
    - "src/cmd/load-plan/index.integration.test.ts"
    - "src/cmd/load-plan/plan-recovery-flow.test.ts"
    - "src/shared/workflow/transition-recovery.test.ts"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-31"
status: "validated"
origin: "internal"
userVerifiedAt: null
workRecord:
    status: "generated"
    recordId: "c867c635-9988-4610-8524-ef548b0fcb49"
    path: "docs/work-records/2026-09-01-load-plan-menus-made-faster.md"
    lastAttemptAt: "2026-09-01T19:22:16.042Z"
routingIntent: "PLANNED_CHANGE"
sessionName: "load plan latency"
targetBranch: "main"
---

# Speed Up Load Plan Menus

## Context

After a user selects a Plan in `/load-plan`, the terminal-based interactive user interface (TUI) can pause for a long
time before it shows the next menu. The current path performs work that is not needed to present that menu:

- it durably renames the Session before the user chooses whether to continue, view details, or cancel; for a persisted
  Session this hydrates the Session, verifies and opens its transcript, appends rename history, syncs and hashes the
  transcript, and publishes a new Session generation;
- it checks saved publication cleanup twice when the Plan picker was used;
- it starts Git worktree evidence collection even when there are no transition recovery records; and
- for a recovery-state Plan, it runs the full repository-wide `plans doctor` repair loop before the first recovery menu.
  That loop can scan all active and archived Plans, worktrees, journals, locks, branches, and publication evidence for
  up to 17 passes. Recovery does not use most of that diagnosis.

The selected Plan still needs authoritative Plan, worktree, journal, Git-capability, physical-loss, and completed-
publication evidence before RunWield can offer safe actions. The problem is repository-wide and durable Session work in
the menu hot path, not those selected-Plan safety checks.

The user decided that selecting, viewing, or canceling a Plan must not rename the Session. RunWield will rename the
Session and terminal title only when the user chooses an action that continues work on that Plan.

## Objective

Make the first action menu after Plan selection appear without durable Session hydration or unrelated repository
maintenance, while preserving authoritative Plan selection, recovery safety, menu choices, and the Session name when
work actually continues.

## Approach

Separate menu preparation from Plan continuation and full repository maintenance.

```text
Before
select Plan
  -> full or repeated repository checks
  -> hydrate and durably rename Session
  -> show status-specific menu

After
select Plan
  -> load selected Plan and bounded safety evidence
  -> show status-specific menu
       -> View / Cancel: no Session rename
       -> Continue action: rename once, then run that action
```

`/load-plan` will use one selected-Plan recovery snapshot for the first recovery menu. It will not call
`runPlansDoctor`. The snapshot will contain only the refreshed authoritative Plan, its recorded or safely discovered
execution worktree, its unresolved transition records, Git capability, physical-loss state, and the selected Plan's
completed-publication result when that result can settle recovery. Action-specific inspection and mutation stay behind
the selected action. The standalone `wld plans doctor` command keeps its repository-wide meaning and behavior.

A one-shot Plan-continuation operation will keep Session naming consistent across normal, on-hold, Epic, and recovery
flows. It will set the terminal title and durably rename the Session once, immediately before the first action that
opens or resumes Planner, Architect, Slicer, Plan Engineer, Frontend Engineer, execution, Workflow Validation, or a
recovery restart. Detail, cancel, archive, hold, User Verified, and other terminal bookkeeping actions will not rename
the Session. Loading an Epic child will defer naming to the child Plan's eventual continuation action.

Transition recovery will filter by Plan before it proves or removes records. When no relevant records exist, it will
return without reading worktree evidence or starting Git. Full callers that do not provide a Plan name will retain
repository-wide reconciliation.

The set-aside option was a lightweight manifest-only Session rename. That would make the menu fast, but it would weaken
transcript-backed Session recovery evidence. This Plan keeps the existing durable rename and moves its cost to the point
where the user chooses to continue.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/cmd/load-plan/index.ts` — remove the eager Session rename, avoid the duplicate publication-cleanup check after a
  picker selection, and activate the selected Plan only for continuation actions.
- `src/cmd/load-plan/plan-session-surface.ts` — give the concrete load-Plan flow one idempotent continuation operation
  that applies the existing terminal-title and durable Session-name behavior without adding an injection seam.
- `src/cmd/load-plan/plan-epic-flow.ts` — activate the Epic only for Architect, direct review, or Slicer continuation;
  viewing, canceling, child browsing, hold, archive, and completion bookkeeping stay rename-free.
- `src/cmd/load-plan/plan-hold.ts` — keep the first on-hold menu immediate and activate the Plan only after a confirmed
  resume/reset path continues its workflow.
- `src/cmd/load-plan/plan-recovery-flow.ts` — replace repository-wide Doctor repair with a selected-Plan recovery
  snapshot, reuse its Git and physical-loss facts for the first menu, and defer action-specific work until selection.
- `src/shared/workflow/transition-recovery.ts` and `src/shared/workflow/state-transition.ts` — enumerate and filter
  relevant records before evidence collection or deletion, with an empty-record fast path.
- `src/cmd/load-plan/index.integration.test.ts` — prove the next menu precedes durable Session rename, cancel/view do
  not rename, and real continuation still renames exactly once.
- `src/cmd/load-plan/plan-recovery-flow.test.ts` — prove recovery menu options from bounded selected-Plan evidence and
  prove cancel does not run unrelated Doctor repairs or deferred action checks.
- `src/shared/workflow/transition-recovery.test.ts` — prove empty and Plan-filtered journal reconciliation does not
  start unrelated Git work or remove another Plan's journal.

`src/cmd/plans/doctor.ts` is deliberately outside the expected behavior change. Its full repository diagnosis and repair
remain available through `wld plans doctor`.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/cmd/load-plan/plan-recovery-worktree.ts#resolveRecoveryWorktree` — resolve the selected Plan's recorded or legacy
  attached worktree without recreating repository-wide Doctor behavior.
- `src/shared/workflow/plan-location.ts#resolveWorkflowPlanLocation` — refresh the authoritative selected Plan from its
  execution document worktree when one owns it.
- `src/shared/workflow/transition-recovery.ts#healSettledTransitionRecords` — retain effect proof and safe journal
  removal, but apply Plan scoping before evidence gathering and mutation.
- `src/shared/workflow/validation-merge-verification.ts` publication helpers — retain the existing local ancestry proof
  for a selected validated Plan that can be settled without a recovery menu; do not reproduce all-Plan publication
  diagnosis.
- `src/cmd/load-plan/index.integration.test.ts` real runtime and Plan fixtures — observe Session snapshots at prompt
  boundaries without a fake Session mutation seam.
- Git Trace2 and the repository's real Git fixtures — prove which Git commands occur before the menu without fragile
  wall-clock assertions or dependency injection.

## Implementation Steps

- [ ] A picker invocation performs saved publication-cleanup discovery at most once before the selected Plan's first
      action menu; direct `wld load-plan <name-or-path>` invocation retains its targeted cleanup check.
- [ ] The load-Plan Session surface has one idempotent continuation operation that applies the existing sanitized
      terminal title and durable Session rename exactly once. The operation uses the concrete Session Runtime and does
      not add a dependency-injection seam or a manifest-only name authority.
- [ ] Normal, validated, on-hold, Epic, and recovery menus are shown before the continuation operation. View, Cancel,
      archive, hold, User Verified, done-enough, and child-browsing paths leave the current Session Name unchanged.
- [ ] Resume planning, direct Plan Review, Planner/Architect re-review, Slicer decomposition, execution, Workflow
      Validation retry, Plan Engineer or Frontend Engineer follow-up, and recovery continuation/restart activate the
      selected Plan before their workflow work begins. Recursive Epic child loading names the Session for the child that
      actually continues, not the parent that only supplied navigation.
- [ ] `handlePlanRecovery` no longer calls `runPlansDoctor`. Its first menu is based on one selected-Plan snapshot that
      refreshes the authoritative Plan, resolves its recovery worktree and relevant journals, probes Git once,
      determines physical loss, and performs only the selected Plan's local completed-publication proof when applicable.
- [ ] Recovery preflight does not backfill identities, migrate or prune unrelated registry rows, inspect unrelated Plans
      or worktrees, enumerate unrelated RunWield branches, clone, fetch, or repair unrelated journals. Worktree
      metadata, detailed state/diff reports, publication retry, validation reconstruction, reset, abandon, and review
      checks run only after the action that needs them.
- [ ] Plan-scoped transition reconciliation filters records before effect proof and before `apply` removes journals in
      both the primary checkout and an execution worktree. With no relevant journal, it returns empty results without
      reading worktree registry evidence or starting `git worktree list`; unscoped reconciliation remains
      repository-wide.
- [ ] Recovery menu re-prompts reuse Git capability and physical-loss facts until a completed action invalidates them;
      Inspect followed by Cancel does not repeat unchanged repository probes.
- [ ] Integration tests fail against the current eager implementation by proving: a real persisted managed Session's
      generation, transcript byte length/digest evidence, and Session Name are unchanged when the second prompt opens
      and after View then Cancel; a real continuation publishes exactly one new generation whose name is the Plan before
      its Agent/workflow work; selected recovery cancellation leaves unrelated Plan, registry, and journal files
      byte-for-byte unchanged; and Git Trace2 contains no unrelated Doctor branch, clone, fetch, or publication commands
      before the menu.
- [ ] Focused transition tests fail against the current implementation by proving that an empty selected-Plan journal
      set succeeds with Git unavailable and that healing one Plan cannot delete a settled journal owned by another Plan.

## Approval Confirmation

This Plan does not supersede a Work Record.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/cmd/load-plan/index.integration.test.ts src/cmd/load-plan/plan-recovery-flow.test.ts src/shared/workflow/transition-recovery.test.ts`
- Automated architecture check: `deno task seams:check`
- Automated full verification: `deno task ci`
- The key objective-failing integration test must use a real persisted managed Session, capture its committed generation
  and transcript evidence before Plan selection, then stop at the first post-selection menu. The Session Name,
  generation, byte length, terminal entry, and digest must all be unchanged at that boundary and after View then Cancel.
  It fails today because `renameSession` has hydrated and published the Session, and it also fails for any hidden
  same-value Session mutation. A paired continuation case must prove that continuing publishes exactly one new
  generation with the Plan name before workflow work, preventing a counterfeit fix that simply removes automatic Plan
  naming.
- The key recovery regression must load one recovery-state Plan while unrelated repairable state exists, cancel at the
  first recovery menu, and assert the unrelated state is byte-for-byte unchanged. Git Trace2 must show no
  `for-each-ref`, `clone`, `fetch`, or unrelated publication ancestry work before that menu. This fails if full Doctor
  work remains under another wrapper.
- The transition fast-path test must make Git unavailable, provide no relevant journal, and still receive empty healing
  results. The isolation case must include selected and unrelated journals and prove only the selected record can be
  removed.
- Manual normal flow: from a long persisted Session, run `/load-plan`, select a draft or ready Plan, and confirm the
  next menu appears without a busy Session hydration pause. View details and Cancel; `/session` must retain the prior
  name and the terminal title must stay aligned with it.
- Manual continuation flow: load the same Plan again and choose Resume planning or Review. Confirm the Session and
  terminal title change to the Plan name once before the continuation begins.
- Manual recovery flow: load an implemented, failed, or validation-state Plan. Confirm the recovery menu appears after
  bounded selected-Plan checks, Cancel makes no unrelated repairs, and Inspect or Continue runs its deeper checks only
  after selection.
- Existing behavior to preserve: execution-worktree Plan authority, unknown-status rejection, external Plan adoption,
  Plan identity assignment, unfinished-transition safety, physical-loss menus, completed-publication settlement, parent
  hold and dependency checks, all current menu options, and durable Plan naming for actual continuation.
- Behavior expected to stop existing: Plan selection, detail viewing, cancellation, or terminal bookkeeping renames the
  Session; recovery-state Plan loading silently runs full repository Doctor repair before its first menu; Plan-scoped
  healing removes unrelated journals.

## Edge Cases & Considerations

- A Session may already have a manual name. The approved behavior keeps that name for View and Cancel, but actual Plan
  continuation still applies the existing load-Plan convention and names the Session for the Plan.
- Multiple menu loops can lead to one continuation. The one-shot operation prevents repeated transcript generations and
  repeated terminal-title updates.
- An Epic can navigate to a child without continuing the Epic. Only the eventual child continuation owns the rename.
- Recovery facts can become stale after a mutating action. Invalidate and rebuild only the affected snapshot fields; do
  not cache across mutations that can change worktree, Git, journal, or publication state.
- Journal scoping must happen before deletion, not only before returned results are filtered. Full unscoped Doctor and
  maintenance callers must retain repository-wide healing.
- Removing Doctor from the hot path must not suppress selected-Plan conflicts. Ambiguous identity, duplicate live
  attempts for the selected Plan, missing authoritative execution Plan, unresolved selected journals, and physically
  lost attempts must still block or shape the menu as they do now.
- Do not use a wall-clock threshold as the automated acceptance gate. Filesystem and Git timing vary; prove the speedup
  by proving that durable Session hydration, repository-wide Doctor work, repeated probes, and unrelated subprocesses
  are absent before the menu.
