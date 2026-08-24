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

| Phase                  | Required evidence                                                       |
| ---------------------- | ----------------------------------------------------------------------- |
| `candidate_sealed`     | Validated execution commit and target head observed at sealing          |
| `artifacts_committed`  | Commit containing the final Plan and generated delivery artifacts       |
| `target_integrated`    | Target base commit and assembled integration commit                     |
| `target_published`     | Exact local or remote target commit and publication mode                |
| `publication_verified` | A fresh Git read proves the target still names the published commit     |
| `cleanup_complete`     | Execution checkout, branch, and temporary publication clone are settled |

Every registry update uses a compare-and-swap revision under the existing registry lock. A stale process cannot
overwrite newer proof. A failure annotates the current phase without moving it backward.

On restart, RunWield reads the record and current Git facts. It may advance a missing receipt only when Git proves the
external effect already happened—for example, an integration commit exists in the saved publication clone or the remote
target already equals the recorded integration commit. Otherwise it retries the current phase. It never reruns
validation or regenerates committed artifacts merely because publication was interrupted.

Publication uses a stable temporary clone and never checks out, rebases, stashes, resets, or writes the user's primary
checkout. Remote publication pushes the assembled commit with a lease. A project without a remote advances the local
target ref through the existing isolated local-publication path.

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
