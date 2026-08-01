# Transactional Plan Lifecycle — end-to-end review findings

Review of the implemented feature (`d0b54174`, `be2f9bbf`) against the intent in
`plans/transactional-plan-lifecycle-and-worktree-recovery.md`. Every finding below was reproduced against real code, not
inferred from reading. Fixed items were fixed in this pass; open items are ranked by how badly they strand a user.

## What holds up

The core is sound. `runSemanticTransition` journals before external effects, marks effects with proof, runs registered
compensations in reverse, and refuses to restore Plan bytes it cannot prove it authored. Direct Delivery verifies
candidate _and_ metadata ancestry inside the transaction before marking success, re-reads the whole sibling set under
lock, and declares `direct_delivery_target_ref_moved` irreversible so a post-merge fault can never be reported as a
clean rollback. `classifyTransitionFailure` demands positive evidence for "nothing happened" rather than assuming it.
Those are the hard parts and they are right.

## Fixed in this pass

### 1. One stranded Plan froze lifecycle work on every Plan in the project

Journal conflict detection treated any shared resource key as ownership, and nearly every composite transition locks
`{kind:"catalog"}`. So a single `needs_recovery` record on Plan A blocked validation, publication, and archive for Plans
B…Z. Reproduced: alpha stranded → `beta` validation and `beta` archive both returned `blocked` naming alpha's transition
id.

Ownership is now the Plan, the exact attempt, and the target ref. The catalog is a lock-ordering device and no longer
confers ownership.

### 2. `wld plans doctor --repair` could not clear records RunWield itself wrote

Any journaled effect made a record permanently unresolvable: `reconcileTransitionRecoveryRecords` had no way to see Git
or the registry, so it kept everything. Reproduced end to end — a merge-failure settlement interrupted after an atomic
registry write left a record that blocked archive _and_ validation retry, that `--repair` explicitly refused, and whose
only escape was deleting a JSON file by hand or destroying the attempt through recovery.

The worst version: a Plan whose publication _succeeded_ keeps a blocking record forever, because verification or cleanup
threw after the target ref moved. The Plan is finished and cannot even be archived.

Reconciliation now accepts an evidence prover, and doctor supplies one:

| Journaled effect                                                           | Evidence used                                                      | Closable when                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `worktree_registry_updated` / `_settled` / `_abandoned`                    | registry row by id                                                 | always — registry writes are atomic, so no partial row can exist |
| `git_worktree_created` / `_reused`                                         | `stat` + registry claim                                            | the directory is gone, or it exists and an attempt claims it     |
| `direct_delivery_target_ref_moved`                                         | `git merge-base --is-ancestor` for candidate _and_ metadata commit | ancestry proves publication                                      |
| `direct_delivery_publication_started`                                      | staged Plan paths present in the checkout                          | no staged Plan file is missing                                   |
| completion markers (`execution_prepared`, `validation_outcome_settled`, …) | Plan file readable                                                 | the operation had already applied and proved itself              |

An unclaimed worktree directory stays open, deliberately — that is the one place uncommitted work hides.

### 3. Unreadable Plan bytes created an unclosable blocker

A malformed Plan made `runPlanTransition` journal `needs_recovery` with no before-revision. Nothing could ever prove
that record settled, so it blocked the Plan **even after the user fixed the file**. Nothing had been applied — it was a
rejected precondition wearing a recovery record.

Now returned as `blocked` with no journal, carrying the file path, `git diff`, and `wld plans doctor`. Fixing the file
is the whole recovery; a test pins that the retry commits with no intermediate step.

### 4. `--repair` reported strictly less than a read-only run

`listEntries` enforces invariants on read and _throws_. With a legacy registry holding two live attempts for one Plan,
`--repair` migrated planIds in memory, hit the duplicate check, and collapsed the entire report to
`registry_integrity_error: restore the registry from backup`. Report-only mode diagnosed the same registry correctly.
Reproduced both ways.

Doctor now reads through `inspectWorktreeRegistry()` — a non-throwing, non-migrating inspection returning entries plus
what is wrong with them — so per-entry facts survive a violated invariant. Migration is persisted only when the file is
already consistent.

### 5. Migration could make a readable registry permanently unreadable

Two legacy v1 entries with the same `planName` both got the same `planId` from name matching, which violates
one-live-attempt, so `assertRegistryIntegrity` threw on _every_ subsequent read. Every worktree command dead,
deterministically, on data RunWield migrated. Reproduced:
`Worktree registry already has a nonterminal attempt
for demo: wt-b`.

Migration now resolves exact `worktreeId` back-pointers in a first pass (order-independent), and refuses a name-based
binding that would create a second live attempt, recording `duplicate_live_attempt_for_plan` instead.

### 6. Work Record backlinks silently destroyed recovery evidence

`updateSourceFrontMatter()` wrote backlinks through `runRecoveryTransition`, which sets `supersedesUnresolved` and
**deletes** superseded journals on success. Post-publication bookkeeping could therefore retire the `needs_recovery`
record for an unproven publication it knew nothing about. Now an ordinary `runPlanFrontMatterTransition`.

### 7. Body edits blocked lifecycle operations (product rule)

Revision tokens are whole-file hashes, so a user editing prose in vim invalidated the CAS token for front-matter-only
transitions. Reproduced: `runPlanFrontMatterTransition` → `blocked` with a raw hash-vs-hash message; status unchanged.
This hit Workspace lifecycle actions (`plan-adapter.js:897` requires `expectedRevision`) and every interactive load-plan
recovery action, which capture the revision before prompting.

RunWield owns Front Matter, the user owns the body:

- `getPlanFrontMatterRevisionForText()` plus a `frontMatterRevision` on every load.
- Lifecycle preconditions accept body-only drift, proven by comparing Front Matter bytes — never assumed. An unknown
  token (different process, restart) still falls back to strict whole-file comparison.
- A failed transition can now revert **its own Front Matter onto the user's current body**, converting a class of
  `needs_recovery` into a clean rollback. An external _Front Matter_ edit still fails closed.
- Reconciliation treats a Plan whose Front Matter still matches as unchanged.

### 8. Abandoned Plan locks cost 5 minutes and a raw path

A killed process leaves a `.lock` that self-clears only after 10 minutes; until then every operation waits 5 minutes and
then throws `Timed out waiting for Plan lock: /…/.wld/plan-locks/foo.lock` — thrown from lock acquisition, so it
bypasses the typed-result path entirely and reaches the user with no guidance. Doctor now reports stale locks and
`--repair` clears them (nothing but "someone was here" is stored in them).

### 9. Journals inside execution worktrees were invisible

`validation.js:3548` runs the target-advanced rollback with `projectRoot: executionCwd`, so its journal lands in the
_worktree's_ `.wld/`. `plans doctor` only scanned the primary checkout — the record was unreachable while still blocking
retries that run there. Doctor now scans registry worktree paths too and says where the record lives.

### 10. Validation-loop tests ran against a stand-in, not the transaction

`validation.js` replaced `runValidationOutcomeTransition` and `runDirectDeliveryPublicationTransition` with no-op fakes
whenever **any** `__deps` was injected, so all six validation-loop files — 57 tests — ran with no journaling, locking,
CAS, or rollback. The atomicity guarantees in the largest workflow in the codebase had no coverage.

Removed. The real transaction now runs in every test; injecting a transition by name is still available for a test that
needs to observe one in isolation. Twenty tests were passing `/primary` as a project root, which the real transaction
rightly refuses (it needs somewhere to take a lock), so they now build a real temp project via
`makeValidationProjectRoot()`. Two tests had `Deno.cwd()` reaching into the developer's own checkout.

**The stand-in was hiding a production bug.** `runDirectDeliveryPublicationTransition` catches the merge error and
returns a result, and the caller then threw a _fresh_ `Error` carrying only `message`. That discarded the typed merge
failure — `mergeFailureKind`, `mergeWorktreePath`, `mergeRepairCwd` — so after a real merge conflict, merge repair was
dispatched into the wrong worktree with a generic reason. The fake had a special case rethrowing those errors, which
masked it. `TransitionResult` now carries `cause`, and the Direct Delivery caller rethrows the original error.

### 11. Failed settlement was a one-line warning

When recording a merge failure did not commit, validation emitted `Could not settle merge failure transaction: …` and
continued. The repository had changed but the Plan's record of it had not, so the Plan could still read `implemented`
with no reason attached. It now states the gap in the user's terms, names the commands that resolve it, and carries the
note into the halt reason so a run never ends describing state it failed to write.

### 12. `expectedEffects` could not fail

Each wrapper marked its own expected effect immediately after the callback returned, so the check asserted that the
wrapper had called its own function. It now lists only effects the _caller_ proves: execution preparation requires
`plan_event_recorded`, Direct Delivery requires `direct_delivery_target_ref_moved` (a publication that never moved the
ref did not publish), review reopen requires `worktree_registry_abandoned`. The vacuous entries are gone rather than
left looking like proof.

### 13. `/load-plan`'s manual merge published with no transaction

The "Merge validated worktree changes" recovery action performed the entire Direct Delivery publication — seal, stage,
snapshot, merge (moving the target ref), verify ancestry, update the registry — as bare choreography. No lock, no
journal, no sibling fencing. A crash mid-merge left nothing for `wld plans doctor` to find, and an Epic-completing child
could publish against sibling evidence nobody rechecked.

Now wrapped in `runDirectDeliveryPublicationTransition`, with the snapshot restore registered as a compensation and
`direct_delivery_target_ref_moved` marked at the merge. Post-publication cleanup stays outside, so a cleanup failure
cannot revoke a verified Plan. The original typed Git error is rethrown via `cause` so merge-failure classification
still works.

An earlier attempt was reverted because the merge appeared to leave the Plan `verified` after a conflict. That turned
out to be finding 14, not a transaction problem.

`architecture-boundary.test.js` now fails if `mergeExecutionWorktree` is called outside a publication transaction,
verified by moving it out on purpose.

### 14. A real-Git test was passing on a fake constant it never asked for

`load-plan-recovery.test.js` built a real Git project in a temp directory and asserted that a second merge attempt
refused with "Target branch advanced before publication". It passed — but not for the stated reason.

`validation.js` gated four seams on whether an _unrelated_ dependency was injected:

```js
const getBranchHeadImpl = __deps?.getBranchHead ||
    (__deps?.mergeExecutionWorktree ? (() => Promise.resolve("bbbb…")) : getBranchHead);
```

Because the test injected `mergeExecutionWorktree`, it silently also received a constant branch head, an ancestry check
hardcoded to `true`, a constant sealed commit, and a no-op post-seal check — none of which it requested. The constant
head never matched the real project, so the merge always reported the target as advanced. The assertion was satisfied by
a fake the test did not know it had.

Correct behaviour after resolving a conflict and re-merging is a successful publication, so the test now asserts
`verified` plus Delivery Evidence, and the target-advanced case got its own test that genuinely advances the target
between sealing and merging. Both assert no unresolved journal is left.

The seam-ratchet's conditional check originally caught only `__deps ? … :` (gated on the bag itself). It now also
catches `__deps?.x ? … :` — one seam gated on another dep — which found exactly these four and nothing else. That
widened check is what makes this class visible rather than folklore.

## Open — recommended next

Nothing from the original review remains open. See the next section for what closed A, and "Standing risk" below for
what replaced it as the thing most likely to hide the next defect.

## Closed after the review

### A. Inline `expectedRevision` reads — closed, and the premise was superseded

A said `loadCurrentPlanRevision(...)` passed inline as `expectedRevision` protected a zero-width window and only
documented intent. Both halves have since stopped being true.

The call sites are gone: `validation.js` was split into TypeScript modules (`1846ab2c`) and nothing calls
`loadCurrentPlanRevision` anywhere. The two leftover definitions were dead code and are deleted.

The premise is also obsolete. `classifyPlanPrecondition` now proves body-only drift instead of comparing whole-file
bytes, and `rememberFrontMatterRevision` is called on the **read** path as well as the write path, so a token minted by
an inline read is known to the process. Such a read would now be harmless _and_ correctly tolerant of a user editing the
body. A was superseded by that work rather than merely outgrown.

### B. Registry read threw for ordinary callers — fixed in `3b92a685`

`readRegistry` now returns `{ version, entries, integrityIssues, readError }` instead of throwing a bare invariant, so a
hand-edited or externally-merged registry no longer makes every worktree command fail with an unactionable message.

### C. Plan identity was assigned late and could diverge — fixed in `56f1010a`

Identity was sourced from an injection seam, so any production caller passing a real dep skipped `ensurePlanIdentity`
and the Plan never got a durable id. It is now assigned once and diverged copies heal toward canonical.

### D. Listing Plans wrote to them

`listPlanResources` defaulted `backfillMissing` to `true`, so every caller that merely read the catalog minted Plan IDs
as a side effect. That is not a style complaint: `listEntries` calls it on every registry read, and
`runSemanticTransition` read the registry between snapshotting `beforePlan` and re-reading the Plan in `prepare`. For a
Plan without an id the backfill landed exactly in that window, rewriting Front Matter the transaction had already
snapshotted, and execution aborted with "the Plan changed while preparing execution" on a Plan the user had just created
and never touched.

`56f1010a` stopped the trigger by assigning identity once, and pinned the transaction's own registry read with
`migrate: false`. The default is now `backfillMissing: false`, so listing is a read everywhere. Backfill is opt-in and
belongs to `wld plans doctor --repair`, which heals older Plans deliberately.

The general rule this leaves behind: a function whose name says it reads must not write. Where RunWield needs to mint
durable state it should be a named, deliberate call — `ensurePlanIdentity` — not a side effect of whoever happens to
list first.
