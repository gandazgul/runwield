---
planId: "f2df38b8-4a48-4e28-b41d-08a72c966536"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Make Plan review one Workspace surface across Core Sessions, with canonical Feedback, Approve for Later, Approve & Run, and Epic approval outcomes."
affectedPaths:
    - "src/shared/workflow/"
    - "src/shared/session/"
    - "src/tools/plan-written.ts"
    - "src/ui/review/"
    - "src/ui/tui/runtime-interaction-adapter.js"
    - "src/ui/workspace/server/"
    - "src/ui/workspace/routes/"
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/ui/workspace/react/"
    - "src/ui/workspace/static/workspace.css"
    - "docs/design-system.md"
objectiveChecks:
    - id: "OC1"
      command: "test -f src/shared/workflow/plan-review-actions.ts && grep -Fq 'plan-review-actions' src/ui/review/plan-review.ts && test -f src/shared/workflow/plan-review-actions.test.ts && grep -Fq \"shared Plan review rejects stale revision status and worktree before mutation\" src/shared/workflow/plan-review-actions.test.ts && grep -Fq \"shared Plan review commits edited Feedback and approval notes with classification-correct outcomes\" src/shared/workflow/plan-review-actions.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/plan-review-actions.test.ts"
      rationale: "The shared module must exist AND src/ui/review/plan-review.ts must import it, so a stub module beside the surviving TUI duplicate fails. Delegation is the actual objective of the extraction. Both anchors are red today: the module is absent and plan-review.ts owns the mutation logic."
    - id: "OC2"
      command: "test -f 'src/ui/workspace/pages/projects/[projectId]/plans/[planId].astro' && grep -Fq 'plan_review' src/ui/workspace/server/session-continuation.js && test -f src/ui/workspace/workspace-plan-review.integration.test.ts && grep -Fq \"stable Plan page switches from live review to settled detail\" src/ui/workspace/workspace-plan-review.integration.test.ts && grep -Fq \"Workspace Plan review returns Feedback to the same live Core interaction\" src/ui/workspace/workspace-plan-review.integration.test.ts && grep -Fq \"lost review interaction prepares but does not send Agent resubmission\" src/ui/workspace/workspace-plan-review.integration.test.ts && deno run -A scripts/run-tests.js src/ui/workspace/workspace-plan-review.integration.test.ts"
      rationale: "Requires the Project-scoped Plan route to exist and session-continuation.js to recognize plan_review, so passing tests alone cannot satisfy it. Verified red: the route is absent and the string plan_review appears nowhere under src/ui/workspace/ today."
    - id: "OC3"
      command: "grep -Fq 'PlanReviewSurface' 'src/ui/workspace/pages/projects/[projectId]/plans/[planId].astro' && grep -Fq 'PlanDetail' 'src/ui/workspace/pages/projects/[projectId]/plans/[planId].astro' && test -f src/ui/workspace/workspace-plan-review-ux.test.tsx && grep -Fq \"Phone Plan review keeps full editing annotations and actions reachable\" src/ui/workspace/workspace-plan-review-ux.test.tsx && grep -Fq \"Feedback and Run return to Session while Later stays on confirmation\" src/ui/workspace/workspace-plan-review-ux.test.tsx && grep -Fq \"Plan and Epic reviews expose classification-correct actions\" src/ui/workspace/workspace-plan-review-ux.test.tsx && deno run -A scripts/run-tests.js src/ui/workspace/workspace-plan-review-ux.test.tsx"
      rationale: "Forces the one stable page to reference both surfaces, proving the live-versus-settled switch is wired rather than only described in test names. Red today because the route file does not exist."
objectiveCheckWaivers:
    []
executionAgent: "frontend-engineer"
collaborationRecommendation: "pair"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-26T20:48:25.378Z"
updatedAt: "2026-08-18T17:52:50.085Z"
status: "verified"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 16
dependencies:
    - "15-complete-workspace-session-navigation-and-timeline-ux"
    - "13-execution-segment-handoff-backend"
implementedAt: "2026-08-17T21:44:44.235Z"
verifiedAt: "2026-08-18T17:52:50.085Z"
userVerifiedAt: null
executionReport: "- Implemented partial Slice 16: planning-only workflow Sessions now continue from Workspace; live execution workflows still refuse continuation with product-state copy.\n- Implemented safe `plan_review` projection: Plan id/name/classification/revision/status/worktree evidence are carried in metadata; Workspace live operation status exposes only a bounded safe review reference and a stable Plan link.\n- Implemented visible Workspace review improvements: context header, Plan-specific Session timeline card, classification-specific Run/Slice/Later labels, stale/expired/recovery notices, and phone sticky action-bar/bottom-sheet layout.\n- Revised per pair feedback: removed the added top Overall feedback form; Plannotator Global comment remains the Plan-level feedback path and was browser-checked.\n- Updated tests for the new continuation split, Plan review timeline projection, and owner Workspace copy; no tests were deleted.\n- Verification passed: `deno task workspace:check`, `deno task workspace:test`, `deno task workspace:build`, `deno task language-policy:check`, `deno task seams:check`, and final `deno task ci` all passed.\n- Browser checked `http://127.0.0.1:5173/dev/plan-review` in headed browser at 1440×900 and 390×844; evidence: `artifacts/s16-checkpoint1-revised-desktop.png`, `artifacts/s16-checkpoint2-phone.png`, `artifacts/s16-checkpoint3-states.png`; final snapshot confirmed context header, Plan actions, Global comment, and no mobile horizontal overflow.\n- Incomplete against the full approved Plan: shared Core review-decision extraction, owner review-document/decision endpoints, live stable Project Plan page rendering `PlanReviewSurface`, exact request-id deduplication, and real paired Core cross-surface journey automation are not fully implemented in this change."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
validationCheckpoint: null
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "7ff21c54f3e18d3133496f5cf15b79ba6fe3c02d"
    targetBranch: "main"
    targetHeadBeforeMerge: "78ad6b12f3f14f5a5c69cc98d05ac47edcc399af"
validationCiAttempts: 0
validationObjectiveCheckAttempts: 0
validationSemanticRounds: 1
---

# Workspace Plan Review and Approve UI

## Context

RunWield Core owns one stable Session and workflow. TUI and Workspace are peer user interfaces over that Core state; the
surface that started a Session must not become the workflow authority.

Today, the browser Plan review experience already has the required Plannotator document, annotations, Feedback, and
split approval controls, but it is launched as a short-lived review page by the active process. The owner Workspace has
canonical Project Plan pages and generic live-interaction handling, but its Plan pages are read-only and a Workspace-run
`plan_review` interaction exposes only a plain “Agent needs input” item. The review decision logic also lives in
`src/ui/review/plan-review.ts`, even though its Plan Lifecycle and worktree effects are Core workflow behavior.

This slice makes these parts one product surface. A Planner or Architect working through Workspace returns a link to the
stable Project-scoped Plan page. That page renders the existing `PlanReviewSurface` while the linked Session has a live
review interaction and the existing `PlanDetail` after settlement. TUI uses the same review component and Core decision
contract rather than a second Plan review product. The process that currently runs the Core turn still owns its
unanswered interaction. If that process stops and the Session is resumed from the other surface, the model resubmits the
Plan and creates a new review interaction. Transferring an unanswered in-memory review between processes is
intentionally deferred.

Slices 12 and 13 are verified. Slice 12 supplies action-time Plan revision, Plan Status, and worktree evidence checks;
slice 13 supplies the planning-to-execution Session Transcript Segment handoff. Slice 15 supplies Workspace Session
navigation, live operations, interaction answers, interruption handling, and the Session timeline.

## Objective

- Provide one Workspace-styled Plannotator Plan review surface for Core Sessions, whether the active conversation uses
  Workspace or TUI.
- Make Planner and Architect review requests present a direct review link instead of a generic interaction prompt.
- For PLANNED_CHANGE Plans, support Feedback, Approve for Later, and Approve & Run. For PROJECT Epics, preserve the
  existing Feedback, Approve for Later, and Approve & Slice outcomes.
- Apply every decision only for the matching Project, stable Session, live review interaction, canonical Plan revision,
  Plan Status, and worktree evidence while the current Core operation holds Session Activation.
- Continue Feedback in the same Planner or Architect turn. Continue Approve & Run through slice 13. Stop Approve for
  Later at Ready For Work, and stop Epic approval at the established readiness or Slicer outcome.
- Show canonical Plan metadata, acting Session, annotations, warnings, submission progress, stale/recovery errors, and a
  route back to the Session timeline on phone and desktop.
- Deduplicate an exact repeated review-decision request without allowing a new request to reuse old evidence or revive a
  lost process-local interaction.
- Keep owner Workspace authorization separate from public Shared Plan capabilities.

### Intended user journeys

#### 1. Workspace planning → Feedback → revised Plan

1. The owner talks to Planner or Architect in a Workspace Session.
2. When the Agent submits the Plan, the timeline adds a distinct **Plan ready for review** card with Plan title, Plan
   Status, and a primary **Review Plan** link. It does not look like a generic question.
3. The stable Project Plan page opens in live-review mode inside the Workspace shell. A compact context header shows
   **Projects → Session → Plan**, the acting Session name, current Plan Status, and whether the review is live.
4. The owner can directly edit the Plan markdown, add inline annotations, or add an **Overall feedback** comment. Direct
   editing preserves the current Plan review capability; Feedback does not require a text selection or image.
5. Selecting **Send Feedback** means “revise this Plan.” After the decision commits, Workspace returns to the Session
   timeline. The review card becomes **Feedback sent**, submitted context remains visible, and the Planner or Architect
   revision appears in the same timeline.
6. When the Agent resubmits, the new review card links to the latest canonical revision. The old link is visibly settled
   and cannot submit another decision.

#### 2. Workspace planning → Approve for Later

1. The owner opens the same stable Plan page in live-review mode and can inspect the planned execution owner and
   collaboration recommendation.
2. The approval split action describes the consequence before submission: the Plan is prepared but no implementation
   starts. For an Epic, no Slicer starts.
3. On success, the Plan page stays on a clear **Approved for later** confirmation that states the resulting Plan Status
   and provides **Return to Session**. It does not navigate automatically because no running work needs observation.
4. After the owner returns, the timeline shows **Approved for later** and the canonical next action. It must not show an
   Engineer, execution segment, or running indicator.

#### 3. Workspace planning → Approve & Run or Approve & Slice

1. For a PLANNED_CHANGE Plan, the dominant action is **Approve & Run**. For a PROJECT Epic, it is **Approve & Slice**.
2. The owner can review or change the allowed execution policy before approval. Pair is available only for Frontend
   Engineer, as in the existing review surface.
3. Annotations present at approval become clearly labeled non-blocking implementation or Slicer notes. They do not ask
   Planner or Architect for another Revision; **Send Feedback** is the explicit revision action.
4. Submission disables all decision controls and announces progress without clearing annotations.
5. On success, Workspace returns to the Session timeline automatically. The timeline becomes the progress surface:
   readiness, execution/Slicer handoff, Agent change, tools, validation, and failures appear there.
6. A persistent **View Plan** link remains available from the timeline. The owner is not left on a completed overlay
   that only says to return to RunWield.

#### 4. TUI planning → review → continue in TUI

1. Planner or Architect in TUI emits a link to the same Workspace-styled review experience and action language.
2. The owner can open the link in a browser, make a decision, and continue in the same stable Session.
3. The active TUI process receives the Core interaction result. TUI-specific transport is not visible in Plan review
   semantics or layout.

#### 5. Cross-surface resume while review is unanswered

1. A review is pending in one process and that process stops or is deliberately left behind.
2. The owner resumes the stable Session from the other surface and sees the standard interruption message, not a
   recreated or silently answered review.
3. The owner asks the Planner or Architect to continue. The Agent reloads canonical Plan state and resubmits review.
4. The earlier Plan page explains that its review is no longer active and offers **Return to Session** with a prepared
   “Please resubmit this Plan for review” composer message. The owner must explicitly send it; the page cannot mutate
   the Plan or start an Agent turn itself.
5. The Agent's new submission makes the same stable Plan page enter live-review mode for the new interaction.

#### 6. Stale Plan or worktree while reviewing

1. The owner keeps a review open while the Plan, Plan Status, or worktree evidence changes elsewhere.
2. The decision is rejected before mutation. The page stays open, preserves unsent Overall feedback and annotations, and
   shows whether the owner must **Refresh Plan** or use TUI recovery.
3. Refresh replaces the document and evidence only after warning about anchors that no longer match. It never retries
   the decision. The owner reviews the changed content and submits a new explicit request.

### Responsive review experience

- **Desktop:** retain the efficient three-area Plannotator layout: navigation/table of contents, readable Plan document,
  and annotation panel. Add the Workspace breadcrumb/context header above it, not a second competing shell.
- **Phone:** use one document column. Table of contents and annotations open as accessible drawers; neither permanently
  narrows the document. Keep **Feedback** and the classification-correct primary approval action in a safe-area-aware
  sticky bottom action bar with touch-sized controls. Put execution-policy settings in a labeled sheet or disclosure,
  not in an overflowing toolbar.
- **All sizes:** show loading, live, submitting, settled, stale, recovery-required, and expired-interaction states in
  text. Preserve focus after drawers and errors. Long headings, code, tables, and Front Matter must scroll within the
  document without causing whole-page horizontal overflow.

## Approach

Move the canonical review-decision operation out of the TUI-facing browser wrapper into a shared workflow module. Both
interaction adapters call that operation. The adapters can differ in transport and authorization, but they must render
the same `PlanReviewSurface`, submit the same decision shape, and receive the same Core interaction result.

```text
Planner or Architect calls plan_written
  → Core requests plan_review with Plan ID + expected evidence
  → active adapter links the stable Project Plan page
  → Plan page selects live PlanReviewSurface or settled PlanDetail
  → PlanReviewSurface loads canonical owner-safe Plan data
  → Feedback / Later / Run / Slice submits a request ID
  → active process verifies live interaction + Session Activation
  → shared review decision rechecks Plan/worktree evidence and records review outcome
  → plan_written continues with Feedback or readiness
  → Run: slice 13 execution rollover
  → browser returns to the Session timeline
```

For a Workspace-owned turn, `WorkspaceSessionContinuationService` keeps the pending `plan_review` in its existing
process-local operation record and exposes a safe review reference instead of stripping it to a generic prompt. The
owner decision route verifies Project, Session, operation, interaction, Plan, and device scope before it resolves that
specific Runtime interaction. It reuses the bounded `owner_session_operations` result receipt for exact HTTP redelivery,
but it does not treat the receipt as review or workflow state.

For a TUI-owned turn, the existing review launcher hosts the same Workspace review component and calls the same shared
decision operation. It is an adapter for the active Core interaction, not a separate review system. If either owner
process disappears before the decision is committed, no other process reconstructs its Promise:

```text
pending review + owner alive   → submit to that live Core interaction
pending review + owner lost    → show interruption; old decision is not accepted
resume on Workspace or TUI     → ask Agent to continue; Agent resubmits Plan review
```

The option set aside is durable transfer of an unanswered review interaction. It would improve cross-surface handoff,
but it requires a session-independent continuation protocol and is not necessary for the accepted v1 retry behavior.

## Files to Modify

- `src/shared/workflow/plan-review-actions.ts` and focused tests — own the adapter-neutral review request, current
  evidence comparison, reviewed-markdown commit, Plan Lifecycle transition, approval policy validation, and safe typed
  result extracted from `src/ui/review/plan-review.ts`.
- `src/shared/session/session-runtime-interactions.js` and runtime-event projection tests — carry a bounded Plan review
  reference (`planId`, Plan name, expected revision/status/worktree, classification) while keeping callbacks, local
  paths, activation proofs, and raw Front Matter private.
- `src/tools/plan-written.ts` — include the canonical Plan identity/evidence in `plan_review`, consume the shared review
  result, preserve Feedback revision behavior, and keep readiness and workflow outcomes authoritative.
- `src/ui/review/plan-review.ts` and `review-launcher.ts` — retain image loading, browser lifecycle, and TUI transport,
  but delegate Plan mutation to the shared review action and render the common Workspace review component.
- `src/ui/tui/runtime-interaction-adapter.js` — map TUI review requests to the common review surface without changing
  Core review semantics.
- `src/ui/workspace/server/session-continuation.js` — recognize `plan_review`, retain only its safe reference in the
  live operation, create a Workspace review URL, apply one decision to the exact pending interaction, and reject stale
  or lost operations without replay.
- `src/ui/workspace/server/plan-adapter.js` — load the canonical owner-safe review document and slice 12 Plan Action
  Evidence; do not create a Workspace copy of Plan or workflow state.
- `src/ui/workspace/routes/owner-session-api.js`, `owner-api.js`, and `src/ui/workspace/server.js` — register
  authenticated, Project-bound review-document and decision endpoints with Origin, cross-site request forgery (CSRF),
  request-size, request-ID, and response-redaction checks.
- `src/ui/workspace/pages/projects/[projectId]/plans/[planId].astro` — provide one stable owner Plan page that renders
  the existing `PlanReviewSurface` for a matching live Session review and `PlanDetail` otherwise; preserve the acting
  Session in navigation without creating a second review URL.
- `src/ui/workspace/react/PlanReviewSurface.tsx` and supporting Plannotator components — accept a transport-neutral
  review payload, render canonical status/evidence/acting-Session context, and submit the classification-correct actions
  to either active adapter. New components here are `.tsx`; see the language-policy step below.
- `src/ui/workspace/pages/review/plan.astro` and `src/ui/workspace/react/ReviewDevSurface.tsx` — the two existing
  `PlanReviewSurface` callers. Both construct today's header/dev payload directly, so both must move to the
  transport-neutral payload in the same change. `ReviewDevSurface` is the `/dev/plan-review` harness behind
  `deno task workspace:dev:plan-review` and must keep rendering after the payload contract changes.
- `src/ui/workspace/components/SessionTimeline.jsx` and `src/ui/workspace/islands/SessionSurface.jsx` — render live and
  committed Plan review links as Plan workflow items, poll decision settlement, replace lost review waits with the
  standard interruption line, and return from review to the same Session.
- `src/ui/workspace/static/workspace.css` and `docs/design-system.md` — add only the reusable Plan review context,
  outcome, and stale-evidence notice patterns not already covered by existing primitives.
- `src/ui/workspace/workspace-plan-review.integration.test.ts`, `workspace-plan-review-ux.test.tsx`, and affected
  review, owner-route, Session, and lifecycle tests — prove the complete Core-to-browser-to-Core flow and preserve TUI
  behavior.

No domain-language change is required. This Plan implements the existing definitions of Plan, Review Loop, Feedback,
Approve for Later, Approve & Run, Plan Action Evidence Check, Session Activation, and Pending Structured Interaction.

## Reuse Opportunities

- `src/ui/workspace/react/PlanReviewSurface.tsx`, `PlannotatorPlanBody.tsx`, and existing annotation export — reuse the
  established review document and action controls instead of creating a second owner review UI.
- `src/ui/review/plan-review.ts` — extract and reuse its stale-write, review-reopen, policy, image, annotation, and
  transactional worktree-detachment behavior; do not delete covered behavior during extraction.
- `src/shared/workflow/plan-actions.ts` — reuse `loadPlanActionEvidence()` and its exact worktree expectation shape for
  action-time review checks; review outcomes remain a distinct shared operation because slice 12 intentionally excludes
  Feedback, approval, and readiness from generic lifecycle actions.
- `src/shared/workflow/plan-lifecycle.js` and `state-transition.ts` — remain the authorities for review and readiness
  transitions.
- `WorkspaceSessionContinuationService.createInteractionAdapter()` and the slice 15 answer route — specialize their
  `plan_review` presentation and settlement while preserving generic select, text, and approval interactions.
- `owner_session_operations` — store a bounded response for exact decision-request deduplication only.
- Slice 13 `SessionRuntime.executePlan()` handoff — start execution only after the review outcome and readiness
  complete; do not add a Workspace execution implementation.
- `src/ui/design-system/components/react/RunWieldPrimitives.jsx`, Plannotator toolbar controls, and semantic `--rw-*`
  tokens — preserve the current Workspace visual language and accessibility behavior.

## Implementation Steps

- [ ] `plan_review` requests carry canonical Plan ID, Plan name, classification, expected whole-file revision, expected
      Plan Status, and explicit expected worktree evidence. Workspace-safe projections omit cwd, Plan path, callbacks,
      activation proof, owner IDs, receipt details, and unfiltered Front Matter.
- [ ] One shared review action accepts reviewed markdown, normalized Feedback/annotations/images, approval policy,
      approval action, and expected evidence. It reloads canonical Plan/worktree evidence immediately before mutation,
      preserves the transactional review-reopen/worktree-abandon behavior, records `review_feedback` or
      `review_approved` through Plan Lifecycle, and returns the committed revision and canonical attributes.
- [ ] The common review action rejects a changed body or Front Matter, changed Plan Status, missing/replaced/ambiguous
      worktree, mismatched Plan or Session, invalid execution policy, and unsupported classification/action before it
      resolves the Runtime interaction. Safe results distinguish refresh, recovery, expired interaction, and invalid
      action without exposing local paths.
- [ ] A Workspace-owned `plan_review` interaction appears in operation status and the Session timeline as a direct link
      to the stable Project-scoped Plan page. The page enters live-review mode only for the matching Session
      interaction; after settlement it renders normal Plan detail. Generic Pending Structured Interactions retain their
      existing inline answer behavior.
- [ ] The stable Plan page loads the canonical Plan and current evidence, identifies the acting Session and active
      review state, and never treats browser payloads or timeline projection as authority. Live mode reuses
      `PlanReviewSurface`; settled mode reuses `PlanDetail`. Its context header provides Project, Session, and Plan
      navigation without exposing IDs as the primary user label or rebuilding either existing surface.
- [ ] PLANNED_CHANGE controls submit Feedback, Approve for Later, and Approve & Run. PROJECT controls submit Feedback,
      Approve for Later, and Approve & Slice. The existing classification normalization and invalid-action fallback
      remain covered; the browser does not offer Run for an Epic or Slice for a PLANNED_CHANGE Plan.
- [ ] Live review preserves the current direct markdown editor and supports inline annotations plus a visible Plan-level
      **Overall feedback** field. **Send Feedback** commits the edited canonical Plan and review transition, resolves
      the exact live Core interaction with normalized text and images, and lets the same Planner or Architect continue
      its Revision. It does not require an annotation selection, start a new Session, or bypass `plan_written`.
- [ ] Approve for Later commits review approval and lets `plan_written` pass the classification-aware Readiness Gate. A
      PLANNED_CHANGE Plan becomes Ready For Work with no execution segment; a PROJECT Epic follows its established
      ready-for-decomposition/later outcome with no Slicer or execution segment.
- [ ] Approve & Run commits approval, passes readiness, and follows the existing slice 13 managed execution handoff.
      Approve & Slice follows the established Architect-to-Slicer decision. Existing annotations at approval are carried
      as explicitly non-blocking Engineer/Slicer notes. Neither path copies Planner/Architect transcript history into
      its successor context.
- [ ] Each owner decision includes a bounded request ID. An exact completed duplicate returns its stored safe status and
      body without another Plan transition or interaction resolution. A reused ID with changed input conflicts. A new ID
      rechecks the live interaction and canonical evidence; it cannot act after process loss or after the review was
      already answered.
- [ ] Refresh-required errors show the canonical message and a refresh control that reloads Plan/evidence without
      replaying the decision. Recovery-required and expired-interaction errors preserve annotations locally and explain
      that deeper recovery or Agent resubmission is required; this slice adds no destructive recovery control.
- [ ] Losing the active Workspace or TUI process leaves no answerable review interaction. Session reload shows the
      standard interruption line. The settled Plan page offers **Return to Session** with a prepared resubmission
      message in the composer, but does not send it. After the owner explicitly sends, the current Planner or Architect
      resubmits and the same stable Plan page reloads canonical state in live-review mode.
- [ ] Successful Feedback, Approve & Run, and Approve & Slice show a brief outcome confirmation and return to the stable
      Session timeline automatically. Approve for Later stays on an **Approved for later** confirmation with resulting
      Plan Status and **Return to Session**. Execution or decomposition progress uses the slice 15 timeline; this slice
      does not add a dedicated progress view or leave the owner behind the generic completion overlay.
- [ ] Paired-owner auth, registered-Project containment, exact Origin, CSRF, Session/Plan association, and device scope
      protect owner routes. Public Shared Plan capability links cannot read owner Session context or submit owner review
      decisions, although they can continue to reuse visual components behind their separate authorization path.
- [ ] Desktop preserves the readable three-area Plannotator layout. At phone widths, the Plan is one readable column,
      table of contents and annotations use accessible drawers, execution policy uses a labeled disclosure/sheet, and a
      safe-area-aware sticky action bar keeps Feedback plus the classification-correct primary approval action visible.
      Both layouts preserve annotations and Overall feedback across refresh/errors, use touch-sized controls, visible
      focus, non-color status text, an `aria-live` result region, long-content containment, and semantic `--rw-*` tokens
      only.
- [ ] Every new production file under `src/` is TypeScript: `.ts` for shared/server modules, `.tsx` for React
      components, `.astro` for pages. `scripts/language-policy-baseline.json` is a frozen allowlist of existing
      production JavaScript, and `deno task language-policy:check` runs inside `deno task ci`, so a new `.js` or `.jsx`
      file fails CI even next to the `.jsx` files this slice edits. Editing the already-baselined `SessionTimeline.jsx`,
      `SessionSurface.jsx`, `session-continuation.js`, `plan-adapter.js`, `owner-api.js`, `owner-session-api.js`, and
      `server.js` in place is allowed; do not add to the baseline.
- [ ] Existing TUI Plan review tests continue to protect edited Plan persistence, review reopen, worktree detachment,
      images, policy selection, Feedback, cancellation, stale revision, and classification-specific approval. No
      behavior is expected to stop except the TUI-only ownership of the review component and mutation implementation.
- [ ] Pair execution uses four user-visible checkpoints: (1) Session review card plus desktop context/navigation, (2)
      phone document/drawers/sticky actions, (3) Feedback/Later/Run/Slice success and stale/expired/recovery states, and
      (4) the complete Workspace-started and cross-surface journeys. Each checkpoint runs in a headed browser with real
      Workspace primitives and waits for owner feedback before the Frontend Engineer proceeds.

## Approval Confirmation

No Work Record is superseded by this Plan.

## Verification Plan

- Automated: run focused behavior with
  `deno run -A scripts/run-tests.js src/shared/workflow/plan-review-actions.test.ts
  src/ui/workspace/workspace-plan-review.integration.test.ts
  src/ui/workspace/workspace-plan-review-ux.test.tsx
  src/ui/workspace/owner-workspace.test.js src/ui/workspace/workspace-review.test.js
  src/tools/__tests__/plan-written.test.js`.
- Automated: run `deno task workspace:check`, `deno task workspace:test`, `deno task workspace:build`,
  `deno task seams:check`, and `deno task ci`.
- Automated: with a real managed Session and Project fixture, run Planner to a live `plan_review`, open the returned
  owner route, submit Feedback, and prove the same Planner turn receives the normalized Feedback and can resubmit a new
  canonical revision.
- Automated: repeat the fixture for Approve for Later and Approve & Run. Later must end Ready For Work with no successor
  segment or Engineer turn. Run must create exactly one execution successor through slice 13 and keep Planner history
  out of Engineer context.
- Automated: run an Architect fixture and prove the common surface offers Slice/Later rather than Run, returns Feedback
  to Architect, and uses existing Epic readiness/Slicer outcomes.
- Automated: open review evidence, then separately change Plan bytes, status, and exact worktree identity. Each decision
  must fail before review transition or Runtime interaction resolution. Refresh loads the new canonical evidence; a new
  explicit decision is required.
- Automated: deliver one decision request twice and prove byte-equivalent stored results, one Plan transition, and one
  interaction result. Reuse its ID with changed input and expect conflict. Use a new ID after settlement or process loss
  and expect expired interaction with no mutation.
- Automated: prove owner review routes require paired device, registered Project, exact Origin, CSRF, matching Session,
  matching Plan, and a live local review operation. Responses contain no root, Plan path, transcript path/content,
  activation proof, fence, owner instance, callbacks, operation receipt internals, or raw error.
- Automated: prove public Shared Plan reviewer and maintainer capabilities cannot call owner review-document or decision
  routes and that owner credentials do not alter Shared Plan capability behavior.
- Manual production setup: run `deno task workspace:build`, then start the normal paired owner server. Use
  `deno task workspace:dev` at `http://127.0.0.1:5173` only for hot-module visual work; verify live Core interactions
  against the paired owner-server URL.
- Manual pair checkpoint 1, desktop at approximately 1440×900: start a Workspace Planner Session, inspect the **Plan
  ready for review** timeline card, open the stable Plan page in live mode, and confirm the Project/Session/Plan context
  and three-area layout make the next action clear. Settle the review and confirm the same URL renders normal Plan
  detail rather than a duplicate review or Workspace shell.
- Manual pair checkpoint 2, phone at approximately 390×844: review a long Plan, navigate by the table-of-contents
  drawer, add one inline annotation and Overall feedback, inspect/change execution policy, and use the sticky action
  bar. Confirm no clipped toolbar, covered content, lost text, inaccessible drawer/menu, unsafe-area collision, or
  whole-page horizontal overflow.
- Manual pair checkpoint 3: exercise direct Plan editing, Feedback, approval with non-blocking notes, Approve for Later,
  Approve & Run, Approve & Slice, stale refresh, recovery-required, and expired-interaction states. Confirm Feedback and
  Run/Slice return to Session, Later stays on confirmation, and expired review pre-fills but does not send the
  resubmission request.
- Manual pair checkpoint 4, cross-surface: start planning in TUI and confirm its Plan review uses the same
  Workspace-styled component and action language. Stop the TUI before answering, resume the stable Session in Workspace,
  ask the Agent to continue, and confirm it resubmits one new review link without accepting the old pending interaction.
  Repeat Workspace → TUI, then review the complete journey with the owner before autonomous cleanup.
- Expected result: the owner experiences Plan review as one Workspace capability over a Core Session. UI origin does not
  change Plan or workflow semantics, while process loss uses explicit Agent resubmission instead of hidden interaction
  transfer or replay.

## Edge Cases & Considerations

- **Active interaction ownership:** UI origin is not workflow authority, but an unanswered Promise still belongs to the
  live Core process. This slice unifies the product surface and action contract; it does not make arbitrary process
  stacks durable.
- **Review versus readiness:** the shared review action ends at `approved` or `feedback`. `plan_written` still owns the
  Review Loop result and Readiness Gate, and slice 13 still owns execution rollover. Do not collapse these into a broad
  browser endpoint.
- **Manual edits:** any body or Front Matter edit changes the whole-file revision. The owner must refresh and explicitly
  resubmit even when visible Plan Status did not change.
- **Review reopen:** reviewing a previously executed Plan can abandon its prior worktree association. Preserve the
  existing transactional Plan/worktree rollback behavior and classify conflicting evidence as recovery-required.
- **Request deduplication:** a receipt answers only one HTTP request. It does not reserve a Plan, keep an interaction
  alive, transfer Session Activation, or prove that execution continues.
- **Disconnect versus process loss:** a browser disconnect does not cancel a live server operation. Process loss removes
  answerability; the old browser route must not invent or replay a result when it reconnects.
- **Images:** normalize and size-check attachments before the decision commits. A missing image must not silently erase
  text Feedback; preserve the existing fail-soft image behavior and report omitted attachments.
- **Authorization:** owner and Shared Plan surfaces can share React components and design-system patterns, but never
  credentials, decision endpoints, Session context, or canonical mutation authority.
- **Deferred UX:** durable cross-process review transfer, recovery actions, attachments in the general Session composer,
  and a dedicated execution-progress page remain in slice 17 or later.
