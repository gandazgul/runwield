# Plans and Workflows

RunWield routes requests by intent so answers stay lightweight, ideas get sharpened before planning, operations stay
simple, bounded quick fixes get mechanical validation, and larger changes get reviewable plans.

## Routing intents

| Intent      | Meaning                                                             | Primary role |
| ----------- | ------------------------------------------------------------------- | ------------ |
| `INQUIRY`   | Direct answer, explanation, repository guidance, or general help.   | Guide        |
| `IDEATION`  | Research, interview, PRD, or idea-sharpening before implementation. | Ideator      |
| `OPERATION` | Direct non-code repository or environment operation.                | Operator     |
| `QUICK_FIX` | Bounded no-plan code implementation.                                | Engineer     |
| `FEATURE`   | Non-trivial implementation that needs a plan first.                 | Planner      |
| `PROJECT`   | Large work that needs architecture, approval, and feature slicing.  | Architect    |

## INQUIRY

An `INQUIRY` is handled by Guide. It is for answers, explanations, repository guidance, and other non-executable help.
Guide should answer directly and can send the user back to Router if the conversation turns into implementation work.

## IDEATION

An `IDEATION` request is handled by Ideator. It is for exploring an unclear idea, interviewing the user, researching
options, or drafting a PRD/synthesis before implementation planning. When the user is ready to build, the next
implementation request should go back through Router so it can be classified as `FEATURE` or `PROJECT`.

## OPERATION

An `OPERATION` is handled directly by the Operator. It covers non-code repository or environment work such as status,
commit, one-off commands, memory maintenance, and explicitly requested dependency upgrades while they do not require
code edits. It creates no saved plan and no RunWield validation loop runs after `task_completed`; the Operator
self-verifies.

## QUICK_FIX

A `QUICK_FIX` is handled directly by the Engineer for bounded no-plan code changes. It creates no saved executable plan.
After Engineer calls `task_completed`, RunWield runs no-plan Mechanical Validation using the configured local CI
command, sends CI failures back to Engineer, and stops after three total repair attempts. It does not run Reviewer,
Plannotator code review, Plan Events, Plan Status changes, or worktree merge-back.

## FEATURE

A `FEATURE` creates a Markdown plan under `plans/` and sends it through review before execution.

Typical flow:

1. An Agent, usually Router, emits a Triage Report through `triage_report`.
2. Planner writes a plan.
3. The user reviews it in Plannotator.
4. On approval, RunWield marks it ready for work.
5. RunWield dispatches the recorded `executionAgent`. Browser UI FEATURE Plans may use Frontend Engineer; other Plans
   use Engineer. Frontend Engineer runs autonomously or, in a capable TUI, through blocking Pair checkpoints.
6. RunWield runs workflow validation.
7. The plan is marked verified after validation and merge-back succeed.

The selected `collaborationMode` is durable Plan execution metadata. A resumed Pair run automatically pairs again in a
capable TUI after Frontend Engineer restarts or reconnects its dev server and headed browser. ACP, headless, and other
incapable hosts temporarily run autonomously without changing the stored Pair selection. Validation repairs preserve the
original execution owner and collaboration mode.

## PROJECT

A `PROJECT` is represented as an Epic: a container for the larger design and decomposition state, not a single
executable implementation unit. RunWield uses this when the work is too large or ambiguous to run as one plan.

Typical flow:

1. Architect writes the high-level Epic design plan with `classification: PROJECT`.
2. The user reviews and approves the design in Plannotator.
3. RunWield moves the Epic to `ready_for_decomposition`.
4. Slicer opens as an interactive PM/lead-engineer session. It discusses vertical slice boundaries, sequencing,
   dependencies, MVP scope, and deferred work with the user.
5. After explicit user confirmation, Slicer writes draft child FEATURE plans under `plans/<epic-name>/`.
6. Slicer finalizes decomposition, moving the Epic to `ready_for_work` for child selection.
7. The user chooses child FEATURE plans to review, execute, validate, and merge independently.

Child FEATURE plans are ordinary FEATURE plans with `parentPlan: <epic-name>` and optional sibling `dependencies`. They
carry their own lifecycle, worktree, review, validation, and merge history. The parent Epic can later be marked "done
enough for now" without pretending it produced an implementation diff.

Project decomposition is described in [Project Decomposition PRD](prd/project-decomposition-PRD.md).

## Delegated Agent Sessions

Agents may use `delegate_agent` for bounded foreground assistance without sharing their conversation or tool history. A
read delegation can inspect with the parent's available read-only tools; up to three read delegations may run at once. A
write delegation receives the parent's available write tools, runs synchronously and exclusively in the current
worktree, and preserves any partial edits if it fails so the parent can inspect and report them.

Delegated children receive only the brief plus project/repository context. They cannot route workflows, complete parent
workflow phases, mutate memory, interview the user, recursively delegate, commit changes, or exceed the parent's tool
permissions.

## Plan files

Plans are Markdown files with YAML front matter in `plans/`. Standalone plans live directly under `plans/`; child
FEATURE plans for an Epic live under `plans/<epic-name>/` and point back to the parent with `parentPlan`.

Use:

```bash
wld plans
wld load-plan <name-or-path>
```

`wld plans` groups child FEATURE plans beneath their Epic when the parent exists. `wld load-plan` is Epic-aware: loading
an Epic opens or resumes Slicer decomposition, offers child FEATURE selection once decomposition is finalized, or lets
the user mark the Epic done enough for now. Loading a child FEATURE follows the normal FEATURE workflow and warns about
unverified sibling dependencies when present.

For the durable state machine, see [Plan Lifecycle](plan-lifecycle.md).

## Remote Shared Spaces

Collaborative planning uses remote-canonical Shared Spaces without replacing the local Plan Lifecycle. A maintainer runs
`wld plans share <plan>` to encrypt a Plan and publish it to a Plan Server. While shared, the local Plan carries
non-secret collaboration Front Matter and enters a Shared Plan Lock so normal local mutation is blocked.
Collaboration-aware commands own the loop:

- `wld plans pull <maintainer-url-or-plan>` fetches and decrypts remote Revisions/comments, then launches Planner or
  Architect with review context.
- `wld plans push <plan>` publishes the accepted local revision as the next encrypted remote Revision.
- `wld plans unshare <plan>` destructively deletes the remote Shared Space with maintainer authorization and clears
  local collaboration metadata only after safe remote delete or explicit deleted-remote cleanup.

The browser review page is for reading, commenting, resolving, reopening, and switching Revisions. Browser push,
unshare/delete, and Plan body editing are intentionally deferred. See
[Self-hosted collaborative planning](collaboration.md).

## Worktrees and validation

RunWield can execute saved plan work in a linked git worktree. The primary checkout remains the metadata root for plan
files and worktree registry state.

Workflow validation applies to executable saved plan work: standalone FEATURE plans, child FEATURE plans, and legacy
non-Epic PROJECT plans. PROJECT Epics do not run an implementation validation loop themselves; their child FEATURE plans
run local validation, semantic review, and merge-back before being marked verified.

## Completion-time Work Records

After a supported terminal Plan outcome is durably recorded, RunWield attempts Work Record auto-generation or
reconciliation when `workRecords.autoGenerateOnPlanCompletion` is not set to literal `false`.

Supported automatic hooks:

- standalone FEATURE validation: after in-place `validation_passed`, or after worktree merge-back makes the verified
  Plan visible in the primary checkout;
- post-validation parent Epic resolution: a child FEATURE never receives a record, but if validating a child advances
  its parent Epic to `done_enough`, the parent receives one Epic Work Record;
- `wld load-plan`: after the `epic_done_enough` lifecycle event succeeds;
- Workspace: after a canonical close-without-verification action succeeds.

For verified FEATURE plans, Manual QA checklist generation and Recorder Work Record generation start together after the
Plan is terminal. Manual QA uses the hosted session prompt; Recorder uses a separate non-interactive session, so the two
handoffs can overlap safely. RunWield waits for both before printing the Work Record result.

Automatic generation is best-effort and non-authoritative. A Recorder, Markdown, backlink, or index failure is reported
on the calling surface but does not undo `verified`, `done_enough`, or `closed_without_verification`. Successful
Markdown writes with index warnings remain successful and can be repaired with `wld wr index rebuild`; missing or failed
records can be retried with `wld wr backfill`. Automatic hooks target only the Plan that just completed and its needed
Epic-child context; broad active+archived discovery belongs to explicit backfill.
