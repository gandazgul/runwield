---
status: accepted
---

# ADR-016: Publication Is a Proof-Bearing State Machine

## Decision

Plan validation and Git publication are different facts.

- Plan Front Matter records that validation succeeded. A worktree-backed Planned Change stops changing at `validated`.
- The matching `.wld/worktrees.json` entry owns publication progress in one `publication` record.
- Git commits and refs are evidence. Status strings, error text, Session memory, and transition journals are not
  publication evidence.
- The registry entry is removed only after verified publication and cleanup. Its absence is the final local fact; there
  is no Plan `published` status.

The record advances monotonically through these proven phases:

| Phase                  | Required evidence                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `candidate_sealed`     | Validated execution commit and target head observed at sealing                             |
| `artifacts_committed`  | Commit containing the final Plan and generated delivery artifacts                          |
| `target_integrated`    | Exact target ref head protected by the next CAS/lease and the assembled integration commit |
| `target_published`     | Exact local or remote target commit and publication mode                                   |
| `publication_verified` | A fresh Git read proves the target still names the published commit                        |
| `cleanup_complete`     | Execution checkout, branch, and temporary publication clone are settled                    |

Every registry update uses a compare-and-swap revision under the existing registry lock. A stale process cannot
overwrite newer proof. A failure annotates the current phase without moving it backward.

The target may advance after an integration is assembled but before it is published. Until `target_published`, RunWield
may replace the `target_integrated` evidence with a newly assembled commit whose target-base commit is the new exact ref
head. This is another revision of the same phase, not a backward transition. Once publication succeeds, the integration
identity is immutable.

On restart, RunWield reads the record and current Git facts. It may advance a missing receipt only when Git proves the
external effect already happened—for example, an integration commit exists in the saved publication clone or the remote
target already equals the recorded integration commit. Otherwise it retries the current phase. It never reruns
validation or regenerates committed artifacts merely because publication was interrupted.

`artifactCommit` is the immutable source-branch boundary. Publication does not commit or otherwise advance the source
branch after that phase. During cleanup, the normal proof is that the published target contains the source-branch tip.
Recovery may also delete a source branch that advanced past `artifactCommit` only when Git proves that the artifact is
published and every later source-branch commit is a single-parent empty commit. Any later commit that changes files or
merges history keeps the branch for the user.

For remote publication, recovery interprets `targetBaseCommit` exactly as the remote branch head used by the push lease,
not as the integration commit's first parent. A temporary reconciliation merge may sit between those commits.

Remote publication uses a stable temporary clone and never checks out, rebases, stashes, resets, or writes the user's
primary checkout. It pushes the assembled commit with a lease.

A repository without a remote has no second target authority that a primary checkout can later pull. In that explicit
local-only mode, RunWield prepares the integration separately, requires the checked-out target to have no unsaved
tracked changes, and then advances that checkout. Non-overlapping untracked files are preserved. This is the sole
primary-checkout exception; users who need publication while the checkout contains parallel tracked work must configure
a remote.

## Removed authorities

This decision retires publication-specific transition journals, manual recovered-worktree merge actions,
`publication_failed`/`merge_conflict`/`merged` registry transitions, and Plan-owned repair-checkout pointers. They
described the same operation from multiple stores and made recovery depend on which write happened last.

This is intentionally a breaking architecture change. Old partial-publication bookkeeping is not translated into the new
machine.

## Verification

Correctness requires two complementary tests:

1. A real-Git, multi-process restart matrix kills publication after every external-effect and registry-write boundary,
   starts a fresh process, and proves exact target ancestry, primary-checkout preservation, artifact uniqueness, and
   cleanup.
2. The authentic composed TUI journey drives Plan review, execution, `task_completed`, Workflow Validation, publication,
   ancestry verification, registry cleanup, and post-completion input readiness.

Presentation-only golden branches may check messages and menus, but they are not publication correctness tests.
