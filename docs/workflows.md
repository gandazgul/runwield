# Plans and Workflows

Harns routes work by workflow type so small fixes stay fast and larger changes get reviewable plans.

## Triage classes

| Class       | Meaning                                                            |
| ----------- | ------------------------------------------------------------------ |
| `QUICK_FIX` | Small, low-risk work that can be handled directly.                 |
| `FEATURE`   | Non-trivial work that needs a plan before implementation.          |
| `PROJECT`   | Large work that needs architecture, approval, and feature slicing. |

## QUICK_FIX

A `QUICK_FIX` is handled directly by the Operator. It does not create a saved executable plan and does not get the full
Harns workflow-validation loop. The executing agent is responsible for self-verification before calling
`task_completed`.

## FEATURE

A `FEATURE` creates a Markdown plan under `plans/` and sends it through review before execution.

Typical flow:

1. An Agent, usually Router, emits a Triage Report through `triage_report`.
2. Planner writes a plan.
3. The user reviews it in Plannotator.
4. On approval, Harns marks it ready for work.
5. Engineer executes the plan.
6. Harns runs workflow validation.
7. The plan is marked verified after validation and merge-back succeed.

## PROJECT

A `PROJECT` is represented as an Epic: a container for the larger design and decomposition state, not a single
executable implementation unit. Harns uses this when the work is too large or ambiguous to run as one plan.

Typical flow:

1. Architect writes the high-level Epic design plan with `classification: PROJECT` and `type: epic`.
2. The user reviews and approves the design in Plannotator.
3. Harns moves the Epic to `ready_for_decomposition`.
4. Slicer opens as an interactive PM/lead-engineer session. It discusses vertical slice boundaries, sequencing,
   dependencies, MVP scope, and deferred work with the user.
5. After explicit user confirmation, Slicer writes draft child FEATURE plans under `plans/<epic-name>/`.
6. Slicer finalizes decomposition, moving the Epic to `ready_for_work` for child selection.
7. The user chooses child FEATURE plans to review, execute, validate, and merge independently.

Child FEATURE plans are ordinary FEATURE plans with `parentPlan: <epic-name>` and optional sibling `dependencies`. They
carry their own lifecycle, worktree, review, validation, and merge history. The parent Epic can later be marked "done
enough for now" without pretending it produced an implementation diff.

Project decomposition is described in [Project Decomposition PRD](prd/project-decomposition-PRD.md).

## Plan files

Plans are Markdown files with YAML front matter in `plans/`. Standalone plans live directly under `plans/`; child
FEATURE plans for an Epic live under `plans/<epic-name>/` and point back to the parent with `parentPlan`.

Use:

```bash
hns plans
hns load-plan <name-or-path>
```

`hns plans` groups child FEATURE plans beneath their Epic when the parent exists. `hns load-plan` is Epic-aware: loading
an Epic opens or resumes Slicer decomposition, offers child FEATURE selection once decomposition is finalized, or lets
the user mark the Epic done enough for now. Loading a child FEATURE follows the normal FEATURE workflow and warns about
unverified sibling dependencies when present.

For the durable state machine, see [Plan Lifecycle](plan-lifecycle.md).

## Worktrees and validation

Harns can execute saved plan work in a linked git worktree. The primary checkout remains the metadata root for plan
files and worktree registry state.

Workflow validation applies to executable saved plan work: standalone FEATURE plans, child FEATURE plans, and legacy
non-Epic PROJECT plans. PROJECT Epics do not run an implementation validation loop themselves; their child FEATURE plans
run local validation, semantic review, and merge-back before being marked verified.
