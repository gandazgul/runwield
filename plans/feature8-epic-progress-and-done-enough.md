---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add an Epic progress summary and a human-confirmed way to mark an Epic done enough without implementing every child FEATURE."
affectedPaths:
    - "src/cmd/load-plan/index.js"
    - "src/cmd/plans/index.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/cmd/load-plan/index.test.js"
    - "src/cmd/plans/index.test.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
createdAt: "2026-06-16T16:25:04Z"
status: "draft"
---

# Epic Progress and Done Enough

## Context

This is a `HITL` slice. The implementation is ordinary code, but the product behavior needs human judgment: what should
"done enough" mean for an Epic whose future slices remain unimplemented?

The PRD's strongest product idea is that a user can ship one FEATURE as an MVP and defer the rest. Harns needs an
explicit affordance for that moment, otherwise the Epic can look permanently unfinished even when the user's current
goal has been met.

## Objective

Show useful Epic progress and let the user declare an Epic sufficiently complete for now without requiring every child
FEATURE to be verified.

## Approach

Start with a small user-confirmed action in `load-plan` for Epics. The action should record durable state through the
Plan Lifecycle, show a summary of verified and remaining child FEATUREs, and avoid depending on the future general
`on_hold` status.

## Files to Modify

- `src/cmd/load-plan/index.js` - add Epic summary and done-enough action.
- `src/cmd/plans/index.js` - show progress and sufficiently-complete state clearly.
- `src/shared/workflow/plan-lifecycle.js` - add a narrowly scoped event if needed.
- `src/cmd/load-plan/index.test.js` - cover confirmation and cancellation flows.
- `src/cmd/plans/index.test.js` - cover display of a sufficiently-complete Epic.
- `src/shared/workflow/plan-lifecycle.test.js` - cover any new lifecycle event.

## Reuse Opportunities

- `src/plan-store.js` - reuse parent-child discovery to compute progress.
- `src/shared/workflow/plan-lifecycle.js` - reuse event-driven front matter updates.
- `src/cmd/plans/index.js` - reuse progress summary from feature 6.

## Implementation Steps

- [ ] Decide the v1 front matter representation for "done enough for now" with the user before implementation.
- [ ] Add an Epic summary action that lists verified, active, draft, and remaining child FEATUREs.
- [ ] Add a confirmation prompt for marking the Epic done enough.
- [ ] Record the decision durably without requiring `on_hold`.
- [ ] Ensure an Epic can later be re-entered if the user adds or executes more child FEATUREs.
- [ ] Add tests for partial completion, all children verified, no children, and re-entry.
- [ ] Human review: confirm the wording and lifecycle semantics before merging the slice.

## Verification Plan

- Automated:
  `deno test src/cmd/load-plan/index.test.js src/cmd/plans/index.test.js src/shared/workflow/plan-lifecycle.test.js`
- Automated: `deno run ci`
- Manual: verify one child FEATURE, leave another draft, then load the Epic and mark it done enough.
- Expected result: the Epic clearly communicates partial completion without hiding future work.

## Edge Cases & Considerations

- Avoid implementing the general `on_hold` status here.
- "Done enough" should be reversible or at least re-enterable.
- If all visible child FEATUREs are verified, the same path may be used to mark the Epic fully complete.
