# Workflow Validation Authority

Workflow Validation never chooses truth from the most convenient copy. Each fact below has one durable owner. Agent
reports, Session objects, progress panels, and Workspace/TUI records are inputs or projections; they cannot advance Plan
Lifecycle, close Review Issues, move a target branch, or authorize cleanup.

## Authority matrix

| Fact                                                         | Durable owner                                                                                                                          | Read/resume rule                                                                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Plan definition and lifecycle status                         | Primary Plan before execution; execution-worktree Plan after activation                                                                | Locate the live attempt in the registry and read that document. Never compare its runtime metadata with another copy.     |
| Human planning policy and history                            | Plan document: identity, classification, execution policy, actual `targetBranch`, relationships, holds, archive and verification notes | Preserve the body and human fields. Derive summaries from Context.                                                        |
| Validation attempt, next phase, counters, and repair receipt | `.wld/controller/plans/<planId>.json`                                                                                                  | Reload the controller record and claim with its revision; a Plan revision is not a checkpoint revision.                   |
| Review Issues and semantic repair generation                 | Controller `validationCheckpoint.reviewState` and repair fields                                                                        | Resume the same ledger and consume the matching repair completion once.                                                   |
| Human code-review decision                                   | Controller human-review fields                                                                                                         | Reload the decision; a closed browser is not approval.                                                                    |
| Worktree identity, path, branch, target and baseline         | `.wld/worktrees.json` and Git                                                                                                          | The registry is the owner, not a value to compare against Plan YAML. Verify actual Git facts before a destructive action. |
| Mechanical repair result                                     | Structured isolated Agent result                                                                                                       | Rerun CI after completion; after process loss rerun checks, never replay an Agent turn.                                   |
| Publication phase and target movement                        | Registry publication record and local/remote Git refs                                                                                  | Reconcile idempotent effects from Git; retain the attempt until publication and cleanup are proven.                       |
| Delivery evidence and workflow timestamps                    | Controller record; implementation and delivery commits in Git                                                                          | Never require runtime proof to be copied back into Plan Front Matter.                                                     |
| Interrupted lifecycle transition                             | Controller/Plan transition journal                                                                                                     | Restore only writes owned by the transition. Include controller state when proving rollback or restart safety.            |

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

After process loss, RunWield reads the execution Plan for every registered live attempt, the controller's validation
checkpoint, worktree registry publication record, local and remote Git facts, Review Issue state, and non-publication
lifecycle journals. Those sources must produce one safe next action. If they conflict and no recorded proof establishes
the newer state, RunWield preserves the candidate and fails closed with concrete recovery actions. It never asks an
Agent to edit Front Matter, the worktree registry, a Review Issue, a phase counter, Delivery Evidence, or a lifecycle
journal. Publication never uses a lifecycle journal: its one mutable authority is the compare-and-swap publication
record, reconciled against Git.

Runtime state is imported once from older Plan files when no controller record exists. Once execution has an attempt,
only its execution copy can seed that import. Later Plan edits and ordinary document saves cannot overwrite controller
state. All new Plan writes omit runtime fields. The primary checkout can be dirty, missing its Plan, or contain a stale
Plan without changing which document an active attempt reads.

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
