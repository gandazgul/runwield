---
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
affectedPaths:
    - "src/plan-store.js"
    - "src/shared/workflow/state-transition.ts"
    - "src/shared/work-records/supersession.ts"
    - "src/plan-store.test.js"
    - "src/shared/workflow/plan-location.integration.test.ts"
    - "src/shared/workflow/validation-lifecycle-resume.test.js"
    - "src/shared/workflow/validation-operational-recovery.test.ts"
    - "src/shared/workflow/state-transition.test.js"
    - "src/shared/work-records/supersession.test.ts"
    - "src/cmd/plans/doctor.ts"
    - "src/cmd/plans/doctor.test.ts"
    - "src/cmd/load-plan/plan-recovery-flow.test.ts"
    - "src/shared/project-runtime-layout.test.ts"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-29T03:04:57.881Z"
status: "draft"
origin: "internal"
parentPlan: "consolidate-project-runtime-state"
order: 4
dependencies:
    - "03-move-primary-runtime-stores"
planId: "a1a0491f-1e3f-44c4-b083-9b71558f239f"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
targetBranch: "epic/consolidate-project-runtime-state"
---

# Move Selected-Checkout Runtime Stores

## Context

Plan document locks, catalog locks, transition journals, and Work Record supersession locks are selected-checkout state.
They protect the checkout that owns the document mutation or checkout-local operation. Today they use the old `.wld/`
runtime location.

This child requires child 03 to finish moving primary stores. At planning review on 2026-09-10, the layout and migration
code exists on `epic/consolidate-project-runtime-state`, not `main`; child 03 is ready for work but not yet delivered.
Verify its completed result on the execution branch before starting. Do not recreate its changes here.

The parent Epic and ADR-017 already settle checkout ownership and the one-way migration policy. This child moves
selected-checkout stores and preserves their authority. Shared project-entry checks remain child 06 work; this slice
alone is not a safe upgrade for a legacy project.

## Objective

Move selected-checkout runtime readers and writers below the selected checkout's `.wld/internal/` root. Plan lifecycle
behavior must remain the same: Plan Markdown remains the human lifecycle authority, and transaction journals continue to
protect rollback and recovery.

## Approach

Use `resolveProjectRuntimeLayout(checkoutRoot).selected` from `src/shared/project-runtime-layout.ts`. Keep public
function signatures, caller-selected roots, lock order, stale-lock rules, and transition journal semantics.

| Existing owner                          | Named selected-layout field                          |
| --------------------------------------- | ---------------------------------------------------- |
| `withPlanLock()`                        | `planLocksDir`, with the existing sanitized filename |
| `withPlanCatalogLock()`                 | `planCatalogLockPath`                                |
| `getTransitionJournalDir()`             | `transitionJournalsDir`                              |
| Work Record `acquireSupersessionLock()` | `workRecordSupersessionLockPath`                     |
| Work Record `acquireRecoveryLock()`     | `workRecordSupersessionRecoveryLockPath`             |
| Doctor `collectStalePlanLockIssues()`   | `planLocksDir`                                       |

`withOrderedTransitionResources()` must retain each explicit `resource.root`; otherwise it uses the operation root.
Attempt and target-ref resources still use the Plan-lock namespace. The journal stays with the transition's
`projectRoot`, even when some locks use another root.

Recovery keeps this path:

```text
Doctor / Plan Recovery
  select checkout or registered execution path
  list and reconcile journals in that checkout's internal root
  remove proven-settled records, retain uncertain records
  archive user-attested records in that same root's plan-transitions/attested/
```

Do not make single-checkout journal listing scan every worktree. Its callers already select registered worktrees and
retain the recovery record's owner. Do not change `getRunWieldRuntimeDir()` globally, add legacy fallback reads, or
write both layouts. Migration owns legacy data; this child owns normal current-layout access.

Selected ownership after this slice:

```text
selected .wld/internal
  plan-locks/*.lock
  plan-transitions/*.json
  work-record-supersession.lock
  work-record-supersession-recovery.lock
```

The main option set aside is making all selected locks primary-owned. That would simplify paths, but it would break
linked execution worktree isolation and let one checkout lock the wrong document owner.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/plan-store.js` — move Plan and catalog locks to the selected internal root.
- `src/shared/workflow/state-transition.ts` — move transition journals to the selected internal root.
- `src/shared/work-records/supersession.ts` — move Work Record supersession and recovery locks to the selected internal
  root.
- `src/cmd/plans/doctor.ts` — move its direct stale-Plan-lock reader with the writer; preserve existing repair rules.
  Verify its registered-worktree journal scan uses the updated journal helper.
- `src/cmd/load-plan/plan-recovery-flow.ts` and `plan-recovery-actions.ts` — verify existing checkout selection and
  owner-specific reconciliation/attestation; change only if a remaining old-path reader requires it.
- Plan-store, `state-transition.test.js`, lifecycle, Doctor, Plan Recovery, and Work Record tests — prove filesystem
  placement, lock exclusion, rollback, and recovery. Update helpers that currently seed or inspect legacy paths.
- `src/shared/project-runtime-layout.test.ts` — retain explicit legacy migration fixtures; normal writers must not
  silently turn them into current-layout fixtures after this move.

Primary stores, project secrets, entry checks, Git exclusions, and release documentation remain with their assigned
children. The Epic-branch glossary already defines Selected-Checkout Runtime State and its ownership; no definition
change is needed.

## Reuse Opportunities

- `src/shared/project-runtime-layout.ts` — use selected-checkout path helpers.
- `src/plan-store.js` — keep existing lock naming, stale-lock, and revision-checked write behavior.
- `src/shared/workflow/state-transition.ts` — keep journal recovery and rollback guarantees.
- `src/shared/work-records/supersession.ts` — keep existing heartbeat and stale-lock rules.

## Implementation Steps

- [ ] Plan and catalog lock owners use the named selected-layout paths for acquisition, heartbeat, stale recovery, and
      release. Existing sanitized names, nested reentry, and independent-task exclusion remain unchanged.
- [ ] Transition journal writes, reads, removal, reconciliation, and attestation use the selected internal directory,
      including atomic temporary files and `attested/`. Explicit resource roots and lock ordering remain unchanged.
- [ ] Work Record supersession and recovery locks use their named selected-layout paths. Heartbeats, token-checked
      release, snapshot-checked stale removal, and reverse-order document rollback remain unchanged.
- [ ] Doctor finds stale locks at the new location and preserves its existing report/repair rules. Doctor and Plan
      Recovery find registered-worktree journals and settle or attest them at their recorded checkout owner.
- [ ] Real linked-worktree tests prove same-checkout exclusion and cross-checkout independence while primary controller
      and registry state remain primary-owned. Tests inspect actual held locks and populated journals, not only helper
      return values or empty directories after success.
- [ ] Existing concurrency, rollback, and recovery tests exercise the new locations without lost assertions. Legacy
      migration tests still seed literal legacy paths and prove adoption of their original bytes.
- [ ] Focused tests, the seam check, and CI pass without skipping behavior owned by this child.

## Approval Confirmation

No Work Record supersession is proposed.

## Verification Plan

```sh
deno run -A scripts/run-tests.js src/plan-store.test.js src/shared/workflow/state-transition.test.js src/shared/work-records/supersession.test.ts src/shared/workflow/plan-location.integration.test.ts
deno run -A scripts/run-tests.js src/cmd/plans/doctor.test.ts src/cmd/load-plan/plan-recovery-flow.test.ts src/shared/project-runtime-layout.test.ts
deno run -A scripts/run-tests.js src/shared/workflow/validation-lifecycle-resume.test.js src/shared/workflow/validation-operational-recovery.test.ts src/shared/work-records
deno task seams:check
deno task ci
```

Required evidence:

- **Actual placement and exclusion:** use a real primary checkout and linked worktree. While each Plan/catalog lock is
  held, inspect its file below `join(getRunWieldRuntimeDir(selected), "internal", "plan-locks")`. A second independent
  task for the same selected lock must wait; the same lock name in primary must remain usable. Nested reentry must
  complete. Repeat for explicit resource roots and reversed resource ordering. Assert no legacy lock is created while
  held or after release. This fails for an unchanged writer, no-op lock, or primary-only replacement.
- **Stale locks and Doctor:** seed the actual test-routed internal path, not physical `<cwd>/.wld/plan-locks` when the
  test sandbox is active. Assert a stale lock is replaced during acquisition and released afterward. Doctor reports and
  repairs that internal lock, but leaves a fresh valid live lock alone under its existing rules.
- **Journal lifecycle:** pause a real transition after its journal write using the existing transition callback. Inspect
  populated JSON at the independently derived selected internal path. Success removes the journal; rollback restores
  only the transition's own changes. Preserve tests for external Front Matter edits, edited body text, controller
  rollback, and before-facts. Uncertain rollback retains a readable record at that same path. Assert no legacy journal
  or primary copy was written for a selected-root transition.
- **Registered-worktree recovery:** use the existing Doctor and Plan Recovery fixtures to seed valid settled and
  uncertain records at a registered execution checkout's internal path. Read-only inspection retains both. Repair
  removes only proven-settled records; uncertain effects remain. User attestation keeps the record in that owner's
  `plan-transitions/attested/`, not primary. Include this proof even though single-checkout listing tests pass.
- **Work Record locking:** run real apply/confirm/reject operations against canonical fixture files. Pre-seed each new
  lock path with a valid fresh owner and prove the operation cannot mutate documents while it is held; release it and
  confirm the expected document changes. Exercise main and recovery locks separately. Retain stale malformed-lock,
  replacement-token protection, concurrent projection, partial-write rollback, incomplete rollback reporting, and
  successor-preservation tests. Prove independent checkouts do not block each other. Confirm no legacy lock appears
  during operations; source review must also confirm heartbeat/release use the same named paths.
- **Primary ownership:** reuse the child 03 fixture to persist controller and registry data through the selected
  checkout and read it through primary. Assert those populated files stay only in primary's internal root while selected
  locks/journals stay local.
- **Migration fixtures:** explicitly seed old paths and run the real migration engine. Assert journal bytes are retained
  at the new selected path and normal recovery can read them there. Keep live/stale legacy lock preflight coverage;
  moving normal writers must not make a legacy fixture empty.
- **Semantic review:** every listed owner uses its named layout property; no normal old-path fallback or duplicate
  writer remains. Verify import initialization still works with the layout module's existing migration dependencies. The
  glossary remains consistent with checkout ownership. No new injection seam is permitted.

Behavior expected to stop: normal selected-checkout operations no longer create or inspect legacy runtime stores.
Behavior preserved: Plan Markdown authority, revision checks, lock naming/order/exclusion, rollback safety, heartbeat
and stale-lock rules, and owner-specific recovery. Do not restore the unrelated Plan Amendment code removed in the
current working tree. No test skip is expected; a skip cannot replace proof of this child's behavior.

## Edge Cases & Considerations

- Plan locks protect document writes, not controller state.
- Transition journals can exist in execution worktrees as well as the primary checkout.
- Work Record locks were missing from the old owned-path list; the internal boundary must now contain them
  automatically.
- Work Record recovery locks protect lock acquisition and release; they are not transition journals. Keep these two
  recovery mechanisms distinct.
- Preserve `WLD_TEST_SANDBOX_HOME` routing and separate checkout namespaces. Use the safe test runner; tests that change
  process home or cwd must use `withProcessGlobalTestLock`.
- Keep layout calls lazy where imports form cycles. Do not put migration calls into these stores; shared entry checks
  remain child 06 work.
- The Plan file was clean during discovery. Source edits removing Plan Amendment behavior were present in
  `plan-store.js`, its tests, and `state-transition.ts`; this child must not overwrite or reverse them.
- Do not run upgrade experiments on the real project during this intermediate slice. Use disposable fixtures.
