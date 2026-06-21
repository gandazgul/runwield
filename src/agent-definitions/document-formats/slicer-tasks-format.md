## How the slicer appends to a plan

The architect produces a design-only plan (Context, Objective, Vertical Slice Findings, Files to Modify, Reuse
Opportunities, Verification Plan, Edge Cases). Your job is to **append** the two sections below to the bottom of that
plan. Do not modify any other section.

If a `## Tasks` section already exists in the file (resumed plan, slicer being re-run), replace it and the per-slice
detail blocks below it with your new output.

## Required output structure

## Tasks

Tasks must form a Directed Acyclic Graph (DAG). Each row is a vertical slice (or a parallelizable test task), not a
horizontal layer. Numeric task IDs, `none` or comma-separated IDs in Dependencies, comma-separated repo-relative paths
in Write Scope, and an assignee from `engineer | tester`.

| Task | Assignee | Dependencies | Write Scope             | Description                                                                             |
| ---- | -------- | ------------ | ----------------------- | --------------------------------------------------------------------------------------- |
| 1    | engineer | none         | src/auth, src/api       | One-line summary of slice 1 (full detail in the per-slice block below).                 |
| 2    | engineer | none         | src/ui, docs/feature.md | One-line summary of slice 2, including required documentation updates.                  |
| 3    | tester   | 1, 2         | none                    | Integration Point: run the project's validation command and report failures explicitly. |

The final row is the **mandatory Integration Point**: assignee `tester`, dependencies list every prior task ID, write
scope `none` unless it edits tests, and description names it as the Integration Point. It should direct the tester to
run the project's validation command and report failures. This is an intra-DAG check before Workflow Validation, not the
independent acceptance gate that marks a Plan verified.

The Write Scope column controls Harns' shared-worktree scheduler:

- Use the narrowest honest repo-relative file or directory paths, comma-separated.
- Use `none` for read-only validation or Integration Point tasks.
- Use `unknown` only when the task cannot be scoped; Harns treats it as broad and will not run it concurrently with
  other writer tasks.
- Dependencies still describe semantic ordering. Write Scope only describes whether dependency-ready tasks can safely
  launch at the same time.

If a description must contain a literal `|`, escape it as `\|`.

### Slice Details

For each engineer task above (skip the final tester task), emit one block:

#### Task N — <short title>

**What to build**

Concise description of the end-to-end behavior of this slice. Describe what the slice delivers, not the layer-by-layer
implementation. Avoid hardcoded file paths and code snippets — they go stale fast. Exception: if the architect's design
specifies a precise shape (state machine, schema, type) that prose can't capture, inline only the decision-rich parts.
If the slice includes documentation updates, state that the engineer should use the **documentation** skill.

**Acceptance criteria**

- [ ] Criterion 1 — observable, demoable, or testable on its own
- [ ] Criterion 2
- [ ] Criterion 3

## Rules summary

- Vertical slices, not horizontal layers. If you produced one task per file in "Files to Modify", restart with thicker
  slices.
- Default to fewer slices. First question: "Could one engineer ship this in an afternoon?" If yes, one slice.
- Roles default to **no** unless the slice justifies them:
  - Documentation belongs in the relevant engineer slice. When the change has user-facing surface (new command, flag,
    error message, README-relevant behavior), include documentation acceptance criteria and tell the engineer to use the
    **documentation** skill.
  - **tester** appears in slice rows only if a slice has net-new test infrastructure to build. Slice-level acceptance is
    the engineer's responsibility. The mandatory final tester row is always present as the Integration Point.
- Engineer slices are vertical (cut through every layer they touch). Documentation updates are part of the slice that
  introduces the behavior they document, not a separate Agent assignment.
