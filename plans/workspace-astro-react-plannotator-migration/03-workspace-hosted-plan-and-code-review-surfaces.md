---
planId: "24d8eefb-a688-4559-8519-33b123a3eb49"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Replace compiled Plannotator plan/code review launch surfaces with Workspace-hosted Astro/React/Plannotator routes behind the existing review-launcher adapter. Preserve workflow decision behavior while keeping direct HMR dev commands for visual testing and iteration."
affectedPaths:
    - "src/shared/workflow/review-launcher.js"
    - "src/shared/workflow/submit-plan.js"
    - "src/shared/workflow/code-review.js"
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/react/"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/routes/api/handlers.js"
    - "src/ui/design-system/theme-bridge.js"
    - "deno.json"
    - "third_party/plannotator/"
frontend: true
devServerCommand: "deno task workspace:dev:plan-review"
devServerUrl: "http://localhost:5173/"
devServerHmr: true
createdAt: "2026-07-07T18:01:43.370Z"
updatedAt: "2026-07-07T18:01:43.370Z"
status: "draft"
origin: "internal"
parentPlan: "workspace-astro-react-plannotator-migration"
order: 3
dependencies:
    - "01-astro-react-workspace-platform-and-review-dev-entrypoints"
    - "02-core-workspace-astro-react-parity-and-fresh-retirement"
worktreeBaseBranch: "workspace-astro-react-plannotator-migration"
---

# Workspace Hosted Plan and Code Review Surfaces

## Context

RunWield currently opens compiled Plannotator plan and code review surfaces through
`src/shared/workflow/review-launcher.js`, which imports `@gandazgul/plannotator-pi-extension-compiled/server` and calls
`startPlanReviewServer` or `startReviewServer`. The Astro/React Workspace migration should eventually replace those
compiled review surfaces with internal Workspace-hosted routes that reuse pinned Plannotator UI components while
preserving the workflow adapter contract.

The user also wants direct HMR-friendly dev commands for these review UIs so they can be opened and tweaked without
running a full agent workflow.

## Objective

Implement Workspace-hosted Plan review and code review surfaces behind the existing review-launcher seam. Preserve plan
approval/feedback and code review annotation/decision behavior, browser-open fallback, wait-for-decision behavior, and
server shutdown semantics. Keep `workspace:dev:plan-review` and `workspace:dev:code-review` useful as direct browser
development entrypoints for these internal UIs.

its important that our code review reuses plannotator's components I want to see the actual code review interface, same
with the plan review interface it has to use plannotator's annotating editor. The visual and feature parity here is with
plannotator's interfaces and is not done unless there's parity. Lets talk about the features that matter.

## Approach

Start by auditing the compiled Plannotator server contract rather than assuming it only serves static UI. Identify
payload formats, decision transport, endpoint/event behavior, URL/open lifecycle, origin-specific behavior, fallback
behavior, `waitForDecision`, and `stop` semantics. Then add internal Workspace routes and local API endpoints that
reproduce the required behavior using Astro/React and selectively reused pinned Plannotator UI components. Update
`review-launcher.js` so higher-level workflow callers continue using the adapter seam rather than knowing about route
details.

Keep the compiled server available as a reference or fallback until the Workspace-hosted route has equivalent behavior
and browser verification.

## Files to Modify

- `src/shared/workflow/review-launcher.js` — audit current compiled server usage and route Plan/code review launches to
  Workspace-hosted surfaces when equivalent.
- `src/shared/workflow/submit-plan.js` — verify existing Plan review caller behavior remains unchanged behind the
  adapter.
- `src/shared/workflow/code-review.js` — verify existing code review caller behavior remains unchanged behind the
  adapter.
- `src/ui/workspace/pages/` — add internal Astro routes for Plan review and code review surfaces.
- `src/ui/workspace/react/` — implement React/Plannotator review, editor, diff, annotation, approve/feedback, and
  exit/cancel components.
- `src/ui/workspace/server.js` — support internal review surface serving and decision transport while preserving
  token/cwd/security boundaries appropriate to internal launchers.
- `src/ui/workspace/routes/api/handlers.js` — add or reuse JSON endpoints for review payloads and decisions if the
  server wrapper needs local API support.
- `src/ui/design-system/theme-bridge.js` — ensure Plan review and code review screens receive selected RunWield theme
  variables.
- `deno.json` — keep or refine `workspace:dev:plan-review` and `workspace:dev:code-review` tasks for direct HMR
  development.
- `third_party/plannotator/` — reuse pinned Plannotator UI source components only; do not float the pinned revision
  unless separately reviewed.

## Reuse Opportunities

- `src/shared/workflow/review-launcher.js` — preserve the review-surface adapter seam and public functions
  `startPlanReviewSurface` and `startCodeReviewSurface`.
- `@gandazgul/plannotator-pi-extension-compiled/server` — use current `startPlanReviewServer` and `startReviewServer`
  behavior as the contract reference during audit.
- `third_party/plannotator/packages/ui` — selectively reuse Plannotator Viewer, Markdown/editor, diff, annotation, and
  rendered document components where they match RunWield semantics.
- `src/ui/design-system/theme-bridge.js` — reuse selected RunWield theme CSS generation for review screens.
- `src/ui/design-system/components/` — reuse React/Radix primitives for dialogs, menus, tabs, tooltips, buttons, cards,
  notices, and form controls.
- Direct dev routes from the platform slice — reuse fixture-backed review entrypoints for visual iteration and
  regression checks.

## Implementation Steps

- [ ] Audit compiled Plannotator plan review startup, payload shape, decision endpoints/events, `waitForDecision`,
      shutdown, browser-open fallback, and origin-specific behavior.
- [ ] Audit compiled Plannotator code review startup, raw patch/diff payload shape, annotation/decision transport,
      `waitForDecision`, shutdown, browser-open fallback, and origin-specific behavior.
- [ ] Define internal Workspace review payload and decision contracts that preserve current `review-launcher.js`
      behavior for callers.
- [ ] Implement Workspace-hosted Plan review route using Astro/React/Plannotator components, including approve,
      feedback/request changes, exit/cancel, and visible Plan/document content.
- [ ] Implement Workspace-hosted code review route using Astro/React/Plannotator components, including diff display,
      annotations where supported, decision submission, exit/cancel, and failure states.
- [ ] Wire local server/API decision transport so `review-launcher.js` can return the same kind of surface object and
      `waitForDecision` result as before.
- [ ] Update `review-launcher.js` to launch Workspace-hosted review routes behind the existing adapter seam without
      changing higher-level workflow callers.
- [ ] Keep `workspace:dev:plan-review` and `workspace:dev:code-review` opening directly to useful fixture-backed routes
      with HMR.
- [ ] Verify selected RunWield theme reaches the review shell, Radix controls, Plannotator-rendered content, and
      diff/editor surfaces.

## Verification Plan

- Automated: `deno task -q check`.
- Automated: `deno task -q workspace:check`.
- Automated: `deno task -q workspace:test`.
- Automated: `deno task -q test` or targeted workflow tests covering `review-launcher.js` if available.
- Manual/frontend: run `deno task workspace:dev:plan-review`, verify the Plan review UI opens directly, HMR works, Plan
  content is visible, theme variables apply, and approve/feedback/exit controls are usable in the fixture flow.
- Manual/frontend: run `deno task workspace:dev:code-review`, verify the code review UI opens directly, HMR works, diff
  content is visible, annotations/decision controls are usable in the fixture flow, and theme variables apply.
- Manual/frontend: exercise a real or test Plan review workflow and verify browser opens, no unexplained console errors
  occur, decision submission returns to the workflow, `waitForDecision` resolves correctly, and the server shuts down.
- Manual/frontend: exercise a real or test code review workflow and verify browser opens, diff/annotations render,
  decision submission returns to the workflow, `waitForDecision` resolves correctly, and the server shuts down.
- Expected result: compiled Plannotator review launch surfaces can be replaced by Workspace-hosted
  Astro/React/Plannotator routes without changing workflow callers.

## Edge Cases & Considerations

- Do not assume the compiled Plannotator server is static asset serving only; audit before replacing.
- Preserve approve/feedback/annotation/exit/cancel semantics and decision transport exactly enough for workflows to keep
  working.
- Keep browser-open fallback, `waitForDecision`, and shutdown behavior reliable; failure here can hang agent workflows.
- Internal review routes may have different URL shape from public `wld plans ui`, but callers should stay behind
  `review-launcher.js`.
- Theme propagation to review surfaces is product behavior, not optional polish.
- Direct dev commands are required for this slice; do not leave review UI development dependent on a full workflow run.
