---
classification: "PROJECT"
complexity: "LOW|MEDIUM|HIGH"
summary: "<Brief summary of the project-level change>"
affectedPaths:
    - "path/to/file1"
    - "path/to/file2"
createdAt: "<ISO-8601 timestamp>"
status: "draft"
---

# <Plan Title>

## Context

What problem/request this plan addresses and the intended outcome.

## Objective

Clear statement of what changes and why. Reference any ADRs created.

## Vertical Slice Findings

Brief summary of what you traced deeply and how it informs the plan.

## Files to Modify

- `path/to/file` — what changes here and why
- `path/to/another-file` — what changes here and why

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `path/to/existing/module.ts` — what to reuse
- `path/to/utility.ts` — what to reuse

### Tasks

Tasks must form a Directed Acyclic Graph (DAG). Do not combine tasks that can be done in parallel.

| Task | Assignee   | Dependencies | Description                                                                                                                            |
| ---- | ---------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | engineer   | none         | Scaffold database schemas...                                                                                                           |
| 2    | tester     | 1            | Write DB unit tests...                                                                                                                 |
| 3    | doc-writer | none         | Update API documentation...                                                                                                            |
| 4    | tester     | 1, 2, 3      | Run the project's full verification command (e.g. `deno run ci`). Report any failures explicitly so a follow-up engineer task can fix. |

_Allowed Assignees: `engineer`, `tester`, `doc-writer`._

The final row above is the **mandatory global verification task**: every PROJECT plan must end with a `tester` task that
depends on all prior tasks and runs the project's full verification command.

## Verification Plan

- Automated: exact command(s) to run
- Manual: precise user flows / checks
- Expected results for key scenarios

## Edge Cases & Considerations

- Risk 1 + mitigation
- Compatibility or migration concerns
- Open assumptions (if any)
