# Workflow Validation Authority

Workflow Validation never chooses truth from the most convenient copy. Each fact below has one durable owner. Agent
reports, Session objects, progress panels, and Workspace/TUI records are inputs or projections; they cannot advance Plan
Lifecycle, close Review Issues, move a target branch, or authorize cleanup.

## Authority matrix

| Fact                                      | Canonical store                                                                                | Legal writer                                                                                                | Commit boundary                                                                                                     | Projections                                           | Cleanup rule                                                                                       | Resume rule                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Approved Plan definition                  | Primary Plan before execution; execution-worktree Plan after attempt activation                | Planner review transition; then lifecycle and approved Plan Amendment transitions in the execution worktree | Revision-checked Plan write under the active Plan lock                                                              | Browser review, Session prompt, stale local checkouts | Retain the validated execution copy through publication                                            | Resolve the live attempt from the registry; never overwrite it from the primary checkout        |
| Plan Lifecycle and validation counters    | Active execution-worktree Plan Front Matter                                                    | `recordPlanEvent` through the lifecycle transition journal                                                  | Event postcondition written under the execution Plan lock                                                           | Session workflow context, TUI/Workspace status        | Final tracked status is `validated`; publication never rewrites it                                 | Reload execution status while the registry exists; after publication read the target branch     |
| Validation attempt and next owner         | Primary `validationCheckpoint`                                                                 | Validation supervisor and lifecycle transitions                                                             | Compare-and-set Plan write; semantic feedback commits its checkpoint with the status rollback                       | Active Session workflow, progress panel               | Clear on terminal validation, review reopen, recovery reset, or replacement attempt                | Claim the matching attempt and phase; a live local owner blocks a duplicate claim               |
| Execution candidate and worktree identity | Git commits plus `.wld/worktrees.json`; primary Plan keeps the durable pointer                 | Worktree creation/checkpoint/publication transitions                                                        | Registry and Plan transition, with Git proof recorded before cleanup                                                | Active workflow and recovery menus                    | Remove only after candidate ancestry, publication, clean checkout, and metadata success are proven | Resolve the Plan pointer through registry and Git; preserve conflicts or uncertainty            |
| Review Issues and semantic round          | `validationCheckpoint.reviewState` for the current attempt                                     | Semantic review lifecycle transition; later Reviewer results applied mechanically                           | `semantic_review_feedback` atomically stores the ledger, repair baseline, repair identity, and `implemented` status | Active Session workflow and repair handoff            | Clear only when semantic review passes or the attempt is replaced                                  | Rebuild the same ledger and repair handoff from the checkpoint; Session state cannot replace it |
| Mechanical repair result                  | Typed result returned by the isolated repair turn                                              | Current validation owner                                                                                    | Isolated Agent turn return; not written to the root Task Completion journal                                         | Progress and immediate fresh CI run                   | Discard after the live validation owner reruns CI                                                  | No replay after process loss; reclaim the checkpoint and rerun Mechanical Validation            |
| Semantic repair completion claim          | Checkpoint `repairGeneration`, state, receipt, and report                                      | Runtime completion boundary after the exact semantic repair Agent calls `task_completed`                    | Compare-and-set checkpoint write for that repair generation                                                         | Session continuation and next Reviewer prompt         | Spend once; retain the report until the Reviewer verifies the findings or the attempt ends         | `ready` resumes Mechanical Validation; `awaiting_repair` resumes the exact semantic repair      |
| Human review decision                     | Primary Plan human-review fields                                                               | Human review transition                                                                                     | Revision-checked lifecycle write before publication                                                                 | Review UI and progress                                | Clear when execution restarts, recovery resets, or review reopens                                  | Reload the primary decision; never infer approval from a closed browser interaction             |
| Publication and target-ref movement       | Remote target ref plus transition journal; validated execution branch and registry until proof | Publication transition only                                                                                 | Lease-protected push followed by exact remote-head verification                                                     | Plan delivery summary and UI                          | Retain candidate, worktree, branch, and registry for every non-success result                      | Verify remote reachability; never infer publication from missing local state alone              |
| Transition recovery                       | `.wld` transition journal                                                                      | State-transition machinery                                                                                  | Journal before external effects; remove only after full postcondition or proven rollback                            | Doctor and recovery actions                           | Remove after commit/rollback proof                                                                 | Block overlapping owned resources and offer the journal's exact recovery actions                |

## Typed inputs

The workflow distinguishes these inputs before choosing a lifecycle event:

- command execution produces a structured CI result;
- Reviewer output contains approval, stable Review Issues, and non-blocking advisories;
- repair completion contains a consume-once repair generation and an untrusted per-item report;
- publication returns committed, rolled back, blocked, or needs recovery, retaining the typed cause;
- user decisions are explicit interaction outcomes, including stop and cancel.

Error text is for people and diagnostics. It is not a lifecycle discriminator.

## Mechanical repair completion and restart

CI repairs run in isolated Reviewer-Feedback Engineer turns. When such a turn returns a structured `task_completed`
result to the live validation owner, that owner immediately reruns Mechanical Validation. The result is not a root
Session Task Completion journal entry, so the root Agent Handler cannot claim or acknowledge it.

If the process stops before dispatch, during the repair, or after the repair edits files but before the result is
handled, RunWield does not replay the Agent turn and does not infer success from transcript text. A later validation
invocation claims the durable checkpoint, reads the current Plan and worktree, and reruns Mechanical Validation. Fresh
checks decide whether the workflow advances or a new bounded repair turn is needed.

A repair turn that returns without `task_completed` leaves the checkpoint paused at Mechanical Validation. A retry
starts from the saved Plan state and reruns checks; it does not wait for a root completion event.

A checkpoint can only carry validation forward. When the Plan status already records that a phase passed, the phase that
the status names runs next, even if a checkpoint that never settled still points at an earlier phase. RunWield does not
undo the recorded status to run those checks again.

## Recovery invariant

After process loss, RunWield reads the execution Plan for every registered live attempt, its validation checkpoint,
worktree registry publication record, local and remote Git facts, Review Issue state, and non-publication lifecycle
journals. Those sources must produce one safe next action. If they conflict and no recorded proof establishes the newer
state, RunWield preserves the candidate and fails closed with concrete recovery actions. It never asks an Agent to edit
Front Matter, the worktree registry, a Review Issue, a phase counter, Delivery Evidence, or a lifecycle journal.
Publication never uses a lifecycle journal: its one mutable authority is the compare-and-swap publication record,
reconciled against Git.

## Relationship to focused validation Plans

This authority model consolidates the boundaries created by the earlier self-healing work without replacing its focused
follow-ups:

- `make-workflow-validation-self-healing` supplies the single supervisor, durable phase checkpoint, Plan doctor, and
  plain recovery surface used here;
- `resume-validation-after-repair-completion` owns the general Session task-completion journal; semantic repair now adds
  its attempt-scoped checkpoint receipt before that completion can restart checks;
- `classify-validation-operational-errors` and `guided-validation-repair` remain focused on failure classification and
  repair guidance rather than canonical state ownership; and
- `deepen-golden-tui-validation-workflow-coverage` remains presentation-level scenario coverage and never becomes a
  workflow authority.

No focused Plan is superseded merely because it touches the same files. Duplicate decision paths should be removed only
when their behavior has equivalent coverage through the canonical boundaries above.
