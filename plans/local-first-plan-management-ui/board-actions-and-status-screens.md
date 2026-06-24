---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add lifecycle-mediated board actions, closed/on-hold screens, token-protected mutation APIs, and a DnD-ready board architecture where buttons and future drag gestures use the same action path."
affectedPaths:
    - "src/ui/workspace/"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
    - "docs/plan-lifecycle.md"
createdAt: "2026-06-24T20:14:08.683Z"
updatedAt: "2026-06-24T20:14:08.683Z"
status: "draft"
origin: "internal"
parentPlan: "local-first-plan-management-ui"
dependencies:
    - "lifecycle-board-semantics"
    - "secure-workspace-read-only-board"
---

# Board Actions and Status Screens

## Context

The read-only board lets users inspect Plans, but the Workspace must also support lifecycle-safe manual actions. These
actions must go through the central lifecycle module and must be designed so full drag-and-drop can be added without
refactoring the board model.

## Objective

Add token-protected mutation APIs and interactive board controls for allowed manual status movement, manual closure
without verification, hold/resume/reset behavior, and closed/on-hold screens. Build the board components around a
DnD-ready movement model from the start, even if the first gesture shipped is explicit move controls.

## Approach

Expose server-side lifecycle action endpoints that validate requested transitions through
`src/shared/workflow/plan-lifecycle.js`. In the UI, model the board as data-driven `Board`, `BoardColumn`, `PlanCard`,
and `MovePlanAction` components with one central request-move/action dispatcher. Explicit buttons, menus, keyboard
actions, and drag/drop gestures must all call the same movement path. If full DnD gesture support is not shipped in this
slice, leave the architecture and tests proving DnD would be an input-layer addition rather than a board refactor.

## Files to Modify

- `src/ui/workspace/` — add lifecycle action API routes, action metadata, board controls, closed screen, on-hold screen,
  mutation token handling, and DnD-ready board components.
- `src/shared/workflow/plan-lifecycle.js` — add or adjust helper exports needed by the API/UI to compute allowed actions
  and validate requests.
- `src/shared/workflow/plan-lifecycle.test.js` — add coverage if UI/API integration exposes missing lifecycle edge
  cases.
- `docs/plan-lifecycle.md` — document user-visible manual board actions and blocked transitions after implementation
  details settle.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/workflow/plan-lifecycle.js` — reuse `recordPlanEvent`, manual movement helpers, hold helpers, and
  allowed-transition checks from the lifecycle child FEATURE.
- `src/plan-store.js` — reuse `findPlanById`, Plan hierarchy, and front matter update paths rather than writing YAML
  directly.
- `src/ui/workspace/` read-only board — reuse Plan card, board column, route layout, token bootstrap, and server adapter
  boundaries.
- Browser event architecture — implement move buttons and future DnD gestures as input adapters over the same action
  dispatcher.

## Implementation Steps

- [ ] Step 1: Define server action request/response shapes for manual status move, close without verification, hold,
      resume, and reset-to-draft using `planId` as the resource key.
- [ ] Step 2: Implement token-protected API routes that reject missing/invalid tokens, resolve the Plan by `planId`,
      call lifecycle helpers, and return updated Plan/board metadata.
- [ ] Step 3: Refactor or confirm board components are data-driven: status columns come from configuration/API metadata,
      cards use stable `planId`, and all movement calls a central action dispatcher.
- [ ] Step 4: Add explicit move controls, close action, hold action with optional reason, resume/reset controls, and
      blocked-action messaging.
- [ ] Step 5: Add closed and on-hold screens showing `verified`, `closed_without_verification`, and `on_hold` Plans
      outside the active board.
- [ ] Step 6: Add DnD-ready seams: movement intent objects, card/column identifiers, action preview/allowed-target
      metadata, and tests or component checks proving buttons and future DnD call the same path.
- [ ] Step 7: If implementation cost is acceptable, add full drag-and-drop gestures in this slice; otherwise document
      the remaining gesture-only follow-up without changing the movement model.

## Verification Plan

- Automated: run `deno task ci`, `deno task -c src/ui/workspace/deno.json check`, and
  `deno task -c src/ui/workspace/deno.json test` if available.
- Manual: move Plans through allowed manual statuses, close a Plan without verification, hold/resume/reset a Plan, and
  confirm each change updates markdown front matter through lifecycle APIs.
- Expected results for key scenarios: FEATURE Plans cannot be manually moved to `verified`; failed/recovery states
  cannot be papered over by board movement; state-changing requests without the token fail; closed and held Plans appear
  in their dedicated screens.

## Edge Cases & Considerations

- Full drag-and-drop gesture support may be deferred, but the component/action architecture must be DnD-ready from this
  slice.
- The board must not use direct status writes or raw front matter mutation.
- `closed_without_verification` must not set `verifiedAt` or imply Workflow Validation passed.
- Holding an Epic affects visibility/blocking in UI behavior but must not mutate child FEATURE statuses.
- Failed execution, validation failure, and merge conflict recovery remain specialized workflow paths.
- Mutation APIs must not enable permissive CORS or arbitrary filesystem access.
