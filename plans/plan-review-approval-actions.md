---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Move the save-versus-continue decision into a classification-aware Plan Review split button so approval can immediately run a FEATURE Plan, start Slicer for a PROJECT Epic, or prepare either artifact for later without a second TUI prompt."
affectedPaths:
    - "src/ui/workspace/react/PlanReviewSurface.tsx"
    - "src/ui/workspace/react/ReviewDevSurface.tsx"
    - "src/ui/workspace/react/plannotator.css"
    - "src/ui/workspace/routes/api/review-handlers.js"
    - "src/ui/workspace/workspace.test.js"
    - "src/ui/review/plan-review.js"
    - "src/ui/review/plan-review.test.js"
    - "src/ui/tui/runtime-interaction-adapter.test.js"
    - "src/shared/workflow/plan-approval.js"
    - "src/shared/workflow/plan-approval.test.js"
    - "src/shared/workflow/workflow-prompts.js"
    - "src/shared/workflow/workflow.js"
    - "src/shared/session/session-runtime.js"
    - "src/tools/plan-written.js"
    - "src/tools/__tests__/plan-written.test.js"
    - "src/cmd/load-plan/index.js"
    - "src/cmd/load-plan/index.test.js"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
collaborationMode: "pair"
devServerCommand: "deno task workspace:dev:plan-review"
devServerUrl: "http://127.0.0.1:5173/dev/plan-review"
devServerHmr: true
createdAt: "2026-07-21T23:26:12-04:00"
updatedAt: "2026-07-22T12:06:28.943Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-22T03:57:58.553Z"
verifiedAt: "2026-07-22T12:06:28.943Z"
executionReport: "- Changes: added shared Plan approval-action contract (`run`/`decompose`/`later`) with safe fallback; replaced Plan Review single Approve with FEATURE **Approve & Run** / PROJECT **Approve & Slice** split button plus **Approve for Later** menu; threaded `approvalAction` through review API, TUI adapter metadata, `plan_written`, and loaded-Plan re-review; removed obsolete post-approval TUI prompt APIs.\n- Tests/commands: focused tests passed (`plan-approval`, `plan-review`, `runtime-interaction-adapter`, `plan-written`, `workspace`, `load-plan`); `deno task workspace:check` passed; `deno task workspace:build` passed; `deno task ci` passed.\n- URL: `http://127.0.0.1:5173/dev/plan-review` via `deno task workspace:dev:plan-review`.\n- Headed browser checks: desktop FEATURE menu + Escape + Approve for Later completion; desktop PROJECT **Approve & Slice** and menu; mobile 390x844 PROJECT/FEATURE responsive state; final URL/title, console, errors, and failed fetches checked.\n- Evidence: `artifacts/plan-approval-final-desktop-feature-menu.png`, `artifacts/plan-approval-final-desktop-project.png`, `artifacts/plan-approval-final-mobile-project.png`.\n- Notes/blockers: no unresolved blockers; final browser errors empty. Failed network list only showed existing dev editor `POST /api/doc/exists` 404 probes, unrelated to approval flow."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
---

# Plan Review Approval Actions

## Context

Plannotator currently returns one generic approval decision. After the browser closes, `plan_written` and the
loaded-Plan review path ask in the TUI whether to continue immediately or save the approved Plan for later. This splits
one workflow decision across two surfaces and makes browser approval incomplete.

RunWield already distinguishes **Approve & Run** from **Approve for Later**, and PROJECT Epics must start Slicer
decomposition rather than execute directly. The browser review should capture that intent atomically while preserving
edited Plan content, Feedback, annotations, and attached images.

## Objective

Replace the single Plan Review approval button with a classification-aware split button:

- FEATURE Plan: the primary action is **Approve & Run**; the dropdown alternative is **Approve for Later**.
- PROJECT Epic: the primary action is **Approve & Slice**; the dropdown alternative is **Approve for Later**.

The selected action must flow through the review transport and directly produce the existing `approved_execute`,
`approved_decompose`, or `saved` orchestration outcome without a second TUI prompt. Missing, invalid, or
classification-incompatible action values must safely resolve to **Approve for Later**.

## Approach

Add a small shared approval-action contract with explicit `run`, `decompose`, and `later` values plus
classification-aware normalization. The Plan Review surface will derive whether it is reviewing a FEATURE Plan or
PROJECT Epic from Front Matter, render a RunWield-styled split control using the existing Plannotator button/action-menu
primitives, and include the selected action in the existing one-shot approval request.

Carry the action through `review-handlers.js`, `submitPlanForReview`, and the TUI Runtime interaction adapter metadata.
Both `plan_written` and loaded-Plan re-review will normalize the action against trusted Plan Classification, pass the
existing Readiness Gate, and either return/dispatch immediate work or stop at Ready For Work/Ready For Decomposition.
Remove the now-unused post-approval TUI prompt methods and wiring rather than leaving an alternate two-step path.

Do not modify the vendored Plannotator implementation: its existing `ApproveDropdown` controls agent switching and has
the wrong semantics. Reuse its generic `Button` and `ActionMenu` interaction patterns while retaining RunWield labels,
theme tokens, loading behavior, and visible focus states.

## Files to Modify

- `src/ui/workspace/react/PlanReviewSurface.tsx` — render the classification-aware split approval control and submit the
  selected approval action with the existing review payload.
- `src/ui/workspace/react/ReviewDevSurface.tsx` — expose both FEATURE and PROJECT fixtures so each label/action
  combination can be exercised in the HMR review surface.
- `src/ui/workspace/react/plannotator.css` — add only the local split-button layout/state rules not covered by existing
  token-backed utility classes.
- `src/ui/workspace/routes/api/review-handlers.js` — validate/forward the approval-action field in the one-shot decision
  object.
- `src/ui/workspace/workspace.test.js` — assert approval transport preserves each action alongside annotations,
  attachments, edited Plan content, and save settings.
- `src/ui/review/plan-review.js` — add the action to `PlanReviewResult` and return it without disturbing lifecycle
  approval or image loading.
- `src/ui/review/plan-review.test.js` — cover action preservation and the existing approval/Feedback/cancellation
  behavior.
- `src/ui/tui/runtime-interaction-adapter.test.js` — prove the browser-selected action survives in PLAN_REVIEW Runtime
  response metadata without another select interaction.
- `src/shared/workflow/plan-approval.js` — define approval-action constants and the fail-safe classification-aware
  normalizer.
- `src/shared/workflow/plan-approval.test.js` — cover FEATURE, PROJECT, missing, unknown, and mismatched action values.
- `src/tools/plan-written.js` and `src/tools/__tests__/plan-written.test.js` — consume the normalized action directly
  and test immediate execution/decomposition, deferred outcomes, and safe fallback while preserving review context.
- `src/cmd/load-plan/index.js` and `src/cmd/load-plan/index.test.js` — make loaded-Plan re-review honor the same browser
  action before execution or Slicer dispatch.
- `src/shared/workflow/workflow-prompts.js`, `src/shared/workflow/workflow.js`, and
  `src/shared/session/session-runtime.js` — remove the unreferenced post-approval FEATURE/PROJECT TUI prompt APIs and
  exports after both consumers migrate.

## Reuse Opportunities

- `third_party/plannotator/packages/ui/components/ui/button.tsx` — token-backed success button primitive for the joined
  primary and caret controls.
- `third_party/plannotator/packages/ui/components/ActionMenu.tsx` — established outside-click, Escape, and menu-panel
  behavior for the deferred option.
- `src/ui/workspace/react/PlanReviewSurface.tsx` — existing `submit`, review payload, Plan-save payload,
  disabled/loading, error, and completion-overlay behavior.
- `src/shared/workflow/plan-lifecycle.js` — preserve `review_approved`, `readiness_passed`, and `epic_readiness_passed`;
  approval intent changes orchestration, not lifecycle rules.
- `src/shared/workflow/decisions.js` and `src/shared/session/agent-handler.js` — retain the current `approved_execute`,
  `approved_decompose`, and `saved` outcome dispatch paths.

## Implementation Steps

- [ ] Step 1: Add the shared `run` / `decompose` / `later` approval-action contract and normalize against Plan
      Classification so FEATURE accepts only `run`, PROJECT accepts only `decompose`, and every
      absent/invalid/mismatched value becomes `later`.
- [ ] Step 2: Replace `ApproveButton` in `PlanReviewSurface` with an accessible split control. The main segment
      immediately submits `run` for FEATURE or `decompose` for PROJECT, the caret exposes **Approve for Later**, both
      segments share pending/disabled state, and duplicate submission remains blocked.
- [ ] Step 3: Extend the dev surface with FEATURE/PROJECT fixture selection and preserve responsive toolbar behavior,
      RunWield/Plannotator theme bridging, visible focus, Escape/outside-click dismissal, and useful mobile labels.
- [ ] Step 4: Thread the selected approval action through the token-protected review API, `PlanReviewResult`, and
      PLAN_REVIEW Runtime metadata while preserving edited Markdown, Feedback, annotations, global/inline images, and
      Plan-save settings.
- [ ] Step 5: In `plan_written`, run the existing classification-aware Readiness Gate, then return `approved_execute`,
      `approved_decompose`, or `saved` from the normalized browser action without calling a TUI post-approval prompt.
      Keep current metrics, status messages, review Feedback, and image handoff aligned with the chosen outcome.
- [ ] Step 6: Apply the same normalized decision in loaded-Plan re-review: immediate FEATURE approval continues through
      affected-path confirmation, execution, and Workflow Validation; immediate PROJECT approval starts Slicer; deferred
      approval stops after readiness and prints the existing resume guidance.
- [ ] Step 7: Remove the obsolete `askPostApproval` and `askProjectDecompositionApproval` workflow exports,
      SessionRuntime methods, load-plan dependency wiring, and test stubs once no production caller remains.
- [ ] Step 8: Update focused tests for all three valid actions, safe fallback, classification mismatch, one-shot review
      payload integrity, lifecycle events, and absence of a second interaction; then run the complete quality gate and
      browser checks.

## Verification Plan

- Automated: run focused Deno tests for `plan-approval.test.js`, `plan-review.test.js`,
  `runtime-interaction-adapter.test.js`, `workspace.test.js`, `plan-written.test.js`, and the loaded-Plan approval cases
  in `index.test.js`.
- Automated: run `deno task workspace:check` and `deno task workspace:build` to verify the React/Astro boundary and
  bundled browser imports.
- Automated: run `deno task ci` and fix all failures.
- Manual: start `deno task workspace:dev:plan-review` and use a headed browser at
  `http://127.0.0.1:5173/dev/plan-review`.
- Manual: in the FEATURE fixture, verify the joined main button reads **Approve & Run**, the caret is separately
  keyboard-focusable and reports its expanded state, the menu offers **Approve for Later**, Escape/outside click closes
  it, and each choice logs/submits the expected action before showing completion.
- Manual: in the PROJECT fixture, verify the same behavior with **Approve & Slice** as the primary action and **Approve
  for Later** as the alternative.
- Manual: repeat at desktop and phone-sized widths; confirm controls do not clip or overlap, labels remain
  understandable, focus rings are visible, and pending state disables Feedback plus both approval segments.
- Expected: FEATURE `run` reaches existing execution and Workflow Validation; PROJECT `decompose` reaches Slicer;
  `later` reaches readiness and stops; no path displays the old post-approval TUI choice.
- Expected: missing, unknown, FEATURE+`decompose`, and PROJECT+`run` values never authorize immediate work and resolve
  to the deferred outcome.
- Execution policy matrix:
  - `executionAgent: "frontend-engineer"` owns this materially interactive browser workflow change.
  - `collaborationRecommendation: "autonomous"` is sufficient because the interaction shape and labels are settled;
    headed-browser verification remains mandatory.
  - Dev server: `deno task workspace:dev:plan-review`, `http://127.0.0.1:5173/dev/plan-review`, HMR enabled.

## Edge Cases & Considerations

- Approval and execution authorization remain distinct: both choices record approval and pass readiness, but only the
  classification-compatible immediate action authorizes the current Session to continue.
- PROJECT Epics are never executable. **Approve & Slice** maps to the existing Slicer decomposition outcome; tampered
  `run` input falls back to later.
- An older or injected review adapter may return `{ approved: true }` without an action. Treat it as **Approve for
  Later**, not as permission to execute and not as a reason to reopen a TUI prompt.
- The API remains one-shot. Rapid clicks, stale tabs, or a second segment click after submission must not produce two
  decisions.
- Approval with annotations or images must continue forwarding all review context to Engineer or Slicer for an immediate
  action and retain it in the saved tool result for a deferred action.
- A failed request should keep the review open, display the existing local error, re-enable the split control, and avoid
  recording approval.
- The repository currently contains unrelated dirty/untracked documentation and Plan files. Execution must not modify,
  stage, revert, or overwrite them.
