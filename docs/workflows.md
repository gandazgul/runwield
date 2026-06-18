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

A `PROJECT` is treated as an epic/container rather than a single executable task.

Typical flow:

1. Architect writes the high-level design plan.
2. The user reviews and approves the design.
3. Slicer decomposes the work into independently shippable feature plans.
4. Features are executed independently.
5. Validation happens at the feature/workflow boundaries.

Project decomposition is described in [Project Decomposition PRD](prd/project-decomposition-PRD.md).

## Plan files

Plans are Markdown files with YAML front matter in `plans/`. Use:

```bash
hns plans
hns load-plan <name-or-path>
```

For the durable state machine, see [Plan Lifecycle](plan-lifecycle.md).

## Worktrees and validation

Harns can execute saved plan work in a linked git worktree. The primary checkout remains the metadata root for plan
files and worktree registry state.

Workflow validation applies to saved `FEATURE` and `PROJECT` work. It runs local validation, semantic review, and
merge-back before marking a plan verified.
