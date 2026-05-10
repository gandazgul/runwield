## How the slicer appends to a plan

The architect produces a design-only plan (Context, Objective, Vertical Slice Findings, Files to Modify, Reuse
Opportunities, Verification Plan, Edge Cases). Your job is to **append** the two sections below to that plan, after the
Reuse Opportunities section and before the Verification Plan section. Do not modify any other section.

If a `## Tasks` section already exists in the file (resumed plan, slicer being re-run), replace it and the per-slice
detail blocks below it with your new output.

## Required output structure

## Tasks

Tasks must form a Directed Acyclic Graph (DAG). Each row is a vertical slice (or a parallelizable doc/test task), not a
horizontal layer. Numeric task IDs, `none` or comma-separated IDs in Dependencies, and an assignee from
`engineer | tester | doc-writer`.

| Task | Assignee   | Dependencies | Description                                                                                          |
| ---- | ---------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| 1    | engineer   | none         | One-line summary of slice 1 (full detail in the per-slice block below).                              |
| 2    | engineer   | none         | One-line summary of slice 2.                                                                         |
| 3    | doc-writer | none         | One-line summary of doc work (only if there's user-facing surface).                                  |
| 4    | tester     | 1, 2, 3      | Run the project's full verification command. Report failures explicitly so a follow-up task can fix. |

The final row is the **mandatory cross-slice verification task**: assignee `tester`, dependencies list every prior task
ID, description directs the tester to run the project's full verification command.

If a description must contain a literal `|`, escape it as `\|`.

### Slice Details

For each engineer/doc-writer task above (skip the final tester task), emit one block:

#### Task N — <short title>

**What to build**

Concise description of the end-to-end behavior of this slice. Describe what the slice delivers, not the layer-by-layer
implementation. Avoid hardcoded file paths and code snippets — they go stale fast. Exception: if the architect's design
specifies a precise shape (state machine, schema, type) that prose can't capture, inline only the decision-rich parts.

**Acceptance criteria**

- [ ] Criterion 1 — observable, demoable, or testable on its own
- [ ] Criterion 2
- [ ] Criterion 3

## Rules summary

- Vertical slices, not horizontal layers. If you produced one task per file in "Files to Modify", restart with thicker
  slices.
- Default to fewer slices. First question: "Could one engineer ship this in an afternoon?" If yes, one slice.
- Roles default to **no** unless the slice justifies them:
  - **doc-writer** only when the change has user-facing surface (new command, flag, error message, README-relevant
    behavior) — not for internal refactors, bug fixes without behavior change, or test-only work.
  - **tester** appears in slice rows only if a slice has net-new test infrastructure to build. Slice-level acceptance is
    the engineer's responsibility. The mandatory final tester row is always present and is the only cross-slice
    verification task.
- Engineer slices are vertical (cut through every layer they touch). Doc-writer tasks usually have no engineer
  dependency — they read finished or near-finished code in parallel. Mark them with `none` in Dependencies when truly
  parallel.
