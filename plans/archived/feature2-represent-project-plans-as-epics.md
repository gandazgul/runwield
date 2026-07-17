---
planId: "1b4a45ba-665c-48e0-9af1-b1b2a29d9df3"
classification: "FEATURE"
complexity: "HIGH"
summary: "Teach workflow readiness that new PROJECT plans with type epic are containers, not directly executable plans."
affectedPaths:
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/tools/plan-written.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
    - "src/tools/__tests__/plan-written.test.js"
createdAt: "2026-06-16T16:25:04Z"
updatedAt: "2026-07-17T04:43:11.977Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-06-16T19:38:06.024Z"
workRecord:
    status: "generated"
    recordId: "9029558c-c1c9-4b1e-8aff-41c71735da6c"
    path: "docs/work-records/2026-07-17-represent-project-plans-as-epics.md"
    lastAttemptAt: "2026-07-17T04:43:06.275Z"
worktreeStatus: "merged"
---

# Represent PROJECT Plans as Epics

## Context

This is an `AFK` slice. The product decision is already made in the PRD: new `PROJECT` plans are Epic containers and
must not be executed directly.

Today `ready_for_work` means a plan can proceed to execution. The Epic model changes the PROJECT path: an Epic may be
ready for decomposition or ready for child selection, but the Epic itself is not Engineer work. This slice creates that
behavioral guardrail before the interactive Slicer exists.

## Objective

Make Harns distinguish executable FEATURE plans from non-executable PROJECT Epics at workflow boundaries.

## Approach

Add a clear predicate for Epic plans, such as `isEpicPlan(attrs)`, near the workflow or plan-store boundary. Use it in
readiness and execution paths before calling generic executable-plan logic. Preserve legacy PROJECT task-table behavior
only where tests or compatibility require it.

## Files to Modify

- `src/shared/workflow/workflow.js` - branch PROJECT/Epic plans away from direct execution and old project task
  dispatch.
- `src/shared/workflow/plan-lifecycle.js` - add only the status/event support required to mark an Epic decomposition as
  ready without making the Epic executable.
- `src/tools/plan-written.js` - ensure approved PROJECT/Epic plans enter the Epic readiness path instead of requiring a
  task table.
- `src/shared/workflow/workflow.test.js` - cover Epic plans that do not execute.
- `src/shared/workflow/plan-lifecycle.test.js` - cover any new event mappings or guards.
- `src/tools/__tests__/plan-written.test.js` - update PROJECT readiness expectations for Epic plans.

## Reuse Opportunities

- `src/shared/workflow/plan-lifecycle.js` - reuse `recordPlanEvent` for durable status transitions.
- `src/shared/workflow/decisions.js` - reuse existing workflow decision conventions if a new runtime decision is needed.
- `src/tools/plan-written.js` - reuse current review gate and readiness gate plumbing.

## Implementation Steps

- [ ] Add an `isEpicPlan` helper or equivalent local predicate based on `classification: "PROJECT"` and `type: "epic"`.
- [ ] Update readiness behavior so an approved Epic does not require a parseable task table.
- [ ] Ensure Epic readiness does not call Engineer execution or `executeProjectTasks`.
- [ ] Keep old task-table PROJECT behavior import-safe and covered where existing tests require it.
- [ ] Add tests proving an Epic cannot be executed through the normal `ready_for_work` path.
- [ ] Add tests proving normal FEATURE plans still execute as before.

## Verification Plan

- Automated:
  `deno test src/shared/workflow/workflow.test.js src/shared/workflow/plan-lifecycle.test.js src/tools/__tests__/plan-written.test.js`
- Automated: `deno run ci`
- Manual: load or approve a sample PROJECT/Epic plan and verify the next action is decomposition or child selection, not
  execution.
- Expected result: new PROJECT Epics are containers, while existing FEATURE execution behavior is unchanged.

## Edge Cases & Considerations

- The existing lifecycle uses `ready_for_work` as executable. Any Epic-specific use of this status must be guarded.
- Legacy PROJECT task plans may still appear in older saved plan files.
- Avoid introducing a new state machine framework for this slice.
