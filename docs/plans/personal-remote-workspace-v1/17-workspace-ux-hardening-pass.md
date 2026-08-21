---
planId: "6ae27038-fabf-4e8f-939f-cb2bef4c2a59"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Give Workspace a dedicated, read-only Plan progress view with authoritative execution, validation, repair, delivery, completion, and safe Session segment state."
affectedPaths:
    - "src/ui/workspace/pages/projects/[projectId]/plans/[planId]/progress.astro"
    - "src/ui/workspace/pages/dev/plan-progress.astro"
    - "src/ui/workspace/react/PlanProgressSurface.tsx"
    - "src/ui/workspace/server/owner-plan-progress.ts"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/routes/owner-api.js"
    - "src/ui/workspace/pages/projects/[projectId]/plans/[planId].astro"
    - "src/ui/workspace/react/PlanReviewSurface.tsx"
    - "src/ui/workspace/components/PlanDetail.jsx"
    - "src/ui/workspace/components/SessionActivationStatus.jsx"
    - "src/ui/workspace/components/SessionTimeline.jsx"
    - "src/ui/workspace/islands/SessionSurface.jsx"
    - "src/ui/workspace/server/session-continuation.js"
    - "src/ui/workspace/static/workspace.css"
    - "src/shared/session/session-transcript-manifest.ts"
    - "src/shared/session/session-transcript-manifest.test.js"
    - "src/ui/workspace/workspace-plan-progress.integration.test.ts"
    - "src/ui/workspace/workspace-session-ux.test.tsx"
    - "src/ui/workspace/workspace-plan-review-ux.test.tsx"
    - "src/ui/workspace/owner-workspace.test.js"
    - "docs/design-system.md"
objectiveChecks:
    - id: "OC1"
      command: "test -f src/ui/workspace/server/owner-plan-progress.ts && test -f src/ui/workspace/workspace-plan-progress.integration.test.ts && grep -Fq 'from \"./server/owner-plan-progress.ts\"' src/ui/workspace/workspace-plan-progress.integration.test.ts && grep -Fq \"Workspace progress uses the authoritative execution Plan and never mutates workflow state\" src/ui/workspace/workspace-plan-progress.integration.test.ts && deno run -A scripts/run-tests.js src/ui/workspace/workspace-plan-progress.integration.test.ts"
      rationale: "The production projector and behavioral integration suite do not exist. The focused test must exercise authoritative execution-worktree selection, conservative stage derivation, redaction, Session matching, and byte-for-byte read-only behavior."
    - id: "OC2"
      command: "test -f 'src/ui/workspace/pages/projects/[projectId]/plans/[planId]/progress.astro' && grep -Fq 'ownerProjectPlanProgressApi' src/ui/workspace/routes/owner-api.js && grep -Fq '/plans/:planId/progress' src/ui/workspace/server.js && grep -Fq 'progressUrl' src/ui/workspace/react/PlanReviewSurface.tsx && grep -Fq \"Approve and Run opens stable Plan progress without changing other review outcomes\" src/ui/workspace/workspace-plan-review-ux.test.tsx && deno run -A scripts/run-tests.js src/ui/workspace/workspace-plan-review-ux.test.tsx src/ui/workspace/owner-workspace.test.js"
      rationale: "No stable progress page, owner API, or Approve & Run destination exists today. This requires the production route chain and action-specific navigation while preserving Feedback, Later, and Slice behavior."
    - id: "OC3"
      command: "grep -Fq 'segmentOrdinal' src/shared/session/session-transcript-manifest.ts && grep -Fq \"aggregate projection adds safe segment context without exposing segment evidence\" src/shared/session/session-transcript-manifest.test.js && grep -Fq \"Session timeline renders safe segment boundaries and Plan progress navigation\" src/ui/workspace/workspace-session-ux.test.tsx && deno run -A scripts/run-tests.js src/shared/session/session-transcript-manifest.test.js src/ui/workspace/workspace-session-ux.test.tsx"
      rationale: "Workspace currently deletes segment metadata and cannot render boundaries. These tests require verified aggregate replay to add safe ordinal/kind context and the timeline to use it without exposing IDs, paths, lineage, or proof fields."
executionAgent: "frontend-engineer"
collaborationRecommendation: "pair"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-08-13T00:24:38-04:00"
updatedAt: "2026-08-21T01:22:22.185Z"
status: "ready_for_work"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 17
dependencies:
    - "16-workspace-plan-review-and-approve-ui"
userVerifiedAt: null
---

# Workspace Execution Progress and State Presentation

## Context

Slices 15 and 16 provide the Project → Session flow and Plan review surface, but active work still collapses into a
plain **Running work** label and Session timeline messages. After **Approve & Run**, the owner has no stable browser
surface that answers which part of execution or Workflow Validation is active, what passed, whether a repair is running,
whether delivery needs attention, or whether work completed.

This Plan was narrowed with the owner after real-use review. The former hardening list is now three outcomes:

- this Plan owns read-only execution progress and richer state presentation;
- a later v1 sibling owns pasted images, timeline filters, and recent activity; and
- a later v1 sibling owns full Workspace Plan Recovery by moving the existing `/load-plan` recovery operations behind a
  shared Core service.

The Attention Dashboard and multi-Project attention projections remain in Personal Remote Workspace v2. This Plan does
not build an interim dashboard.

Slice 16 is verified with a partial execution report. This Plan uses the stable Project Plan page, current live review
payload, and current interaction answer path. It does not absorb slice 16's deferred review-decision extraction,
cross-process interaction transfer, or full journey automation.

## Objective

Provide one stable, phone- and desktop-ready progress route for executable Plans:

`/projects/:projectId/plans/:planId/progress?session=:runwieldSessionId`

The page must:

- show execution, Mechanical Validation, Semantic Code Review, repair, delivery, and completion as distinct stages;
- derive each stage from the authoritative Plan, worktree registry, Validation Checkpoint, and verified committed
  Session projection without becoming workflow authority;
- show failures, pauses, degraded evidence, and publication-pending state without claiming success from incomplete
  evidence;
- show safe Planning, Execution, and Semantic Repair Session Transcript Segment boundaries without exposing internal
  segment or activation evidence;
- become the destination after **Approve & Run**, and remain reachable from Plan detail and the related Session; and
- poll while work is unsettled, then stop on a terminal or degraded result.

## Approach

Add one owner-only, read-only progress projector under `src/ui/workspace/server/`. It first resolves stable Plan
identity from the registered Project. It then reads the worktree registry by Plan ID. While an execution attempt is
live, the Plan inside that execution worktree is authoritative; otherwise the primary-checkout Plan is authoritative.
Duplicate, unreadable, missing, or mismatched evidence produces a degraded result. The projector never chooses one
ambiguous attempt and never mutates Plan, registry, Session, transcript, or Git state.

```text
GET Plan progress
  registered Project root
  → primary Plan: stable identity and Plan name
  → worktree registry by Plan ID
      live attempt → load and verify execution-worktree Plan  ← authoritative
      no attempt   → use primary Plan                          ← authoritative
      ambiguity    → degraded; do not guess
  → derive stages from Plan Status + compatible Validation Checkpoint + registry state
  → optionally attach matching verified Session projection
  → return browser-safe progress model
```

Use a bounded browser contract with these user-facing facts:

- overall state: waiting, running, repairing, paused, needs attention, delivering, completed, or degraded;
- ordered stage state: pending, running, passed, needs attention, paused, failed, not required, completed, or unknown;
- sanitized failure phase, message, and time;
- safe Plan identity, title, status, update time, and execution Agent label;
- safe Session name, navigation ID, active surface, active Agent, and projection health; and
- segment ordinal, normalized kind, label, sealed/current state, plus safe segment ordinal/kind on timeline events.

Never serialize Project roots, worktree or transcript paths, worktree IDs, branches, commit hashes, Pi Session IDs,
segment IDs, lineage, byte lengths, digests, terminal entry IDs, activation proofs, fences, process identity, operation
or repair receipt IDs, raw Validation Checkpoints, or Review Issue evidence. Raw Session text may explain a stage, but
it must not advance one.

Derive stage completion conservatively from canonical evidence:

- `ready_for_work` means execution is pending; `in_progress` means execution is running; `failed` means execution
  failed;
- `implemented` or a later validation status proves execution passed;
- `validated_ci` or a later status proves Mechanical Validation passed;
- `validated_reviewer` or a later status proves Semantic Code Review passed;
- a compatible Validation Checkpoint refines only its current phase into running, paused, or awaiting repair;
- an active current `semantic_repair` segment can show repair running, but segment presence cannot prove repair passed;
- registry `validated` means delivery is in progress, while `publication_failed` or `merge_conflict` needs attention;
  and
- completion requires settled canonical Plan and delivery evidence. A validated execution Plan or transcript completion
  message alone does not prove publication.

`PlanProgressSurface.tsx` renders existing RunWield card, badge, notice, metadata, and action-link patterns. Add a small
shared workflow-progress pattern to the design system only because this ordered stage presentation is reusable. Add a
development fixture route for fast visual work, but validate authentication and live data on the paired owner server.

The option set aside is an inline Session-only progress panel. It would be simpler, but it would disappear outside the
acting Session and encourage transcript display state to become the source of truth. A stable Plan-scoped page keeps the
canonical object and recovery destination clear.

## Files to Modify

- `src/ui/workspace/server/owner-plan-progress.ts` — new typed read-only projector that selects the authoritative Plan,
  derives safe ordered stages, attaches only a matching Project Session, and returns degraded state instead of guessing.
- `src/ui/workspace/routes/owner-api.js` and `src/ui/workspace/server.js` — register the paired-owner progress GET API
  and HTML route with Project containment and response redaction; no progress POST route exists.
- `src/ui/workspace/pages/projects/[projectId]/plans/[planId]/progress.astro` — stable Astro route that preserves the
  optional acting Session context and renders the progress island.
- `src/ui/workspace/pages/dev/plan-progress.astro` — fixture-backed hot-module-reload surface for visual stage, failure,
  degraded, desktop, and phone states.
- `src/ui/workspace/react/PlanProgressSurface.tsx` — ordered stage UI, polling, terminal/degraded settlement,
  navigation, loading/empty/error states, and accessible responsive presentation.
- `src/ui/workspace/pages/projects/[projectId]/plans/[planId].astro` and `src/ui/workspace/react/PlanReviewSurface.tsx`
  — pass a stable `progressUrl` and navigate there only after successful **Approve & Run**; Feedback, Approve for Later,
  and Approve & Slice retain their current outcomes.
- `src/ui/workspace/components/PlanDetail.jsx` — show **View progress** for executable Plans, preserving acting Session
  context when known; Epics do not offer this route.
- `src/shared/session/session-transcript-manifest.ts` and its test — project only safe segment ordinal and normalized
  kind onto replay events and verified segment summaries while retaining opaque segment-namespaced cursor IDs
  internally.
- `src/ui/workspace/server/session-continuation.js` — retain the safe segment summary instead of deleting all segment
  information; continue to remove internal proof fields.
- `src/ui/workspace/components/SessionTimeline.jsx` and `src/ui/workspace/islands/SessionSurface.jsx` — render safe
  Planning, Execution, and Semantic Repair boundaries and a persistent progress link for the Session's active Plan.
- `src/ui/workspace/components/SessionActivationStatus.jsx` — derive active workflow presentation from the committed
  `workflowContext` shape returned after refresh, and distinguish execution, validation, repair, delivery, failure,
  completion, and degraded states without granting continuation.
- `src/ui/workspace/static/workspace.css` and `docs/design-system.md` — implement and document the reusable ordered
  workflow-progress pattern with existing semantic `--rw-*` tokens.
- `src/ui/workspace/workspace-plan-progress.integration.test.ts` — real Project/worktree/Session tests for authoritative
  derivation, read-only behavior, safe projection, mismatch, ambiguity, and publication states.
- `src/ui/workspace/workspace-session-ux.test.tsx`, `workspace-plan-review-ux.test.tsx`, and `owner-workspace.test.js` —
  cover segment and state rendering, action-specific navigation, owner authorization, route ordering, and response
  redaction.

No domain-language update is required. This Plan implements the existing terms Plan, Session, Session Transcript
Segment, Aggregate Transcript Projection, Mechanical Validation, Semantic Code Review, Workflow Validation, Validation
Checkpoint, and Delivery Evidence without redefining them.

## Reuse Opportunities

- `findPlanEvidenceById()` in `src/plan-store.js` — establish stable primary Plan identity before selecting execution
  authority.
- `findByPlanId()` and registry status in `src/shared/worktree-registry.js` — find one live attempt and preserve
  existing duplicate-attempt refusal.
- `validationPhaseForStatus()`, `validationCheckpointCanResume()`, and `readValidationReviewState()` in
  `src/shared/workflow/validation-checkpoint.ts` — validate and safely summarize current validation state.
- `projectAggregateTranscript()` in `src/shared/session/session-transcript-manifest.ts` — verify committed segments and
  projection before any Session state appears in the browser.
- `PlanReviewSurface`, `PlanDetail`, `SessionTimeline`, `SessionActivationStatus`, and existing Workspace polling —
  extend current owner surfaces rather than create a second shell or workflow engine.
- RunWield cards, badges, notices, links, metadata groups, `--rw-*` tokens, and theme bridge — preserve the current
  Workspace design language.

## Implementation Steps

- [ ] `owner-plan-progress.ts` returns one typed, bounded progress model from stable Plan identity, exact live worktree
      evidence, canonical Plan Status, compatible Validation Checkpoint, and optional verified Session projection. A
      live execution-worktree Plan overrides a stale primary Plan. Ambiguous or unreadable evidence returns degraded
      state and never selects an attempt.
- [ ] Progress derivation produces ordered Execution, Mechanical Validation, Semantic Code Review, Repair, Delivery, and
      Completion stages with the conservative rules in **Approach**. A Session message or segment can refine display
      detail but cannot mark a canonical stage passed.
- [ ] The projector is observational: progress GET requests leave Plan bytes, worktree registry bytes, Session manifest,
      transcript bytes, Git refs, and owner coordination generation unchanged. Its response contains none of the
      internal paths, IDs, proofs, process fields, receipts, hashes, or raw Review Issue evidence listed in
      **Approach**.
- [ ] The owner server and Astro Workspace expose
      `/projects/:projectId/plans/:planId/progress?session=:runwieldSessionId` plus a paired-owner GET API. The API
      rejects an unpaired device, disabled or wrong Project, unknown or Epic Plan, and mismatched Session/Plan
      association. A missing Session query still returns canonical Plan-only progress.
- [ ] `PlanProgressSurface` shows textual overall and per-stage state, current detail, failure or degraded guidance,
      last-update time, acting Session link, Plan link, loading, polling, stale-response, and network-error states. It
      polls only while state can advance and stops after completion or a non-retryable degraded result.
- [ ] A successful PLANNED_CHANGE **Approve & Run** navigates to the stable progress route with acting Session context.
      Feedback still returns to revision, Approve for Later stays on its confirmation, and PROJECT Approve & Slice keeps
      its existing Session/Slicer outcome.
- [ ] Plan detail and the matching Session timeline expose persistent **View progress** navigation. Epics and unrelated
      Sessions cannot acquire a progress link by passing a browser query value.
- [ ] Verified aggregate replay events carry safe `segmentOrdinal` and normalized `segmentKind`; browser segment
      summaries contain only ordinal, kind, label, sealed, and current. The timeline inserts readable Planning,
      Execution, and Semantic Repair boundaries without rendering segment IDs, Pi IDs, lineage, proof, or filesystem
      data and without changing cursor semantics.
- [ ] Session availability uses the committed `workflowContext` returned by aggregate replay and distinguishes
      execution, Mechanical Validation, Semantic Code Review, repair, delivery, failed, completed, and degraded display
      states. Every active-work state remains read-only from the composer.
- [ ] Desktop and phone layouts use existing RunWield semantic tokens and patterns, visible focus, text plus color for
      state, semantic ordered lists and headings, `aria-live` for refreshed progress, touch-sized navigation, safe-area
      spacing, long failure-text containment, and no whole-page horizontal overflow.
- [ ] The development fixture covers waiting, each running stage, repair, publication failure, completion, and degraded
      evidence. New production files are `.ts`, `.tsx`, or `.astro`; existing `.js`/`.jsx` files are edited in place and
      no language-policy baseline entry or injection seam is added.
- [ ] Existing slice 15 timeline, interruption, stale-generation, and continuation tests and slice 16 Feedback, Later,
      Run/Slice, stale review, and Plan-detail tests remain. No behavior is expected to stop except **Approve & Run**
      returning to the general Session timeline; it now opens dedicated progress. No test is deleted only because its
      component or payload shape changes.
- [ ] Pair execution uses three visible checkpoints: (1) authoritative stage model and desktop progress route, (2)
      phone, segment boundaries, failure, and degraded states, and (3) the complete Approve & Run → progress → semantic
      repair → delivery → completion journey. Each checkpoint uses a headed browser and waits for owner feedback.

## Approval Confirmation

No Work Record is superseded by this Plan.

## Verification Plan

- Automated: run focused behavior with
  `deno run -A scripts/run-tests.js src/shared/session/session-transcript-manifest.test.js
  src/ui/workspace/workspace-plan-progress.integration.test.ts src/ui/workspace/workspace-session-ux.test.tsx
  src/ui/workspace/workspace-plan-review-ux.test.tsx src/ui/workspace/owner-workspace.test.js`.
- Automated: run `deno task workspace:check`, `deno task workspace:test`, `deno task workspace:build`,
  `deno task language-policy:check`, `deno task seams:check`, and `deno task ci`.
- Automated: create a real Git Project where the primary Plan is stale at `in_progress`, the execution-worktree Plan is
  at `validated_ci` with a compatible semantic checkpoint awaiting repair, and the matching managed Session has verified
  Planning, Execution, and Semantic Repair segments. The API must show execution and Mechanical Validation passed,
  Semantic Code Review needing attention, and repair running only while the repair segment is current and Session
  activation is active.
- Automated: hash Plan, registry, Session manifest, transcript, and relevant Git refs before and after the progress GET;
  assert byte-equivalent files and refs. Assert the response excludes root/path strings, worktree and segment IDs, Pi
  IDs, digests, commits, PID/hostname, repair generation/receipt IDs, and raw Review Issue text.
- Automated: cover missing Session context, wrong-Project Session, mismatched committed workflow Plan, duplicate
  worktree attempts, missing execution Plan, future or malformed Validation Checkpoint, degraded transcript projection,
  paused repair, publication pending, publication failure, successful non-Git completion, settled Direct Delivery,
  reopened Plan, and Epic rejection.
- Automated: prove only successful **Approve & Run** selects `progressUrl`; Feedback, Later, failed submission, and
  Approve & Slice do not navigate there.
- Manual visual setup: use `deno task workspace:dev` at `http://127.0.0.1:5173/dev/plan-progress` for hot-module visual
  work. Run `deno task workspace:build`, start the normal paired owner server, and use its exact URL for authenticated
  API and live Core checks.
- Manual pair checkpoint 1 at approximately 1440×900: inspect every stage in pending, running, passed, paused, failed,
  needs-attention, and completed states. Confirm the active stage and next owner action are clear without reading raw
  transcript messages.
- Manual pair checkpoint 2 at approximately 390×844: inspect a long failure, degraded evidence, repeated Semantic Repair
  segments, keyboard focus, and live polling. Confirm stage labels do not clip, status is not color-only, links and
  touch targets remain reachable, and the page has no horizontal overflow or scroll jump.
- Manual pair checkpoint 3 on the paired owner server: start from a Workspace or TUI Plan review, select **Approve &
  Run**, arrive on the stable progress page, observe execution and Mechanical Validation, trigger one Semantic Code
  Review repair, then observe delivery and completion. Open the same Plan without `session` and confirm canonical
  progress remains available while Session-only detail is omitted.
- Browser evidence: at each checkpoint capture desktop and phone screenshots and run `agent-browser errors`,
  `agent-browser console`, and failed fetch inspection. Report the exact owner-server URL, viewport, action sequence,
  and screenshot paths.
- Expected result: the owner can leave the Session timeline, understand exactly where one executable Plan is, return
  after refresh or process restart, and see uncertainty as uncertainty. Viewing progress never advances or repairs work.

## Edge Cases & Considerations

- **Authoritative Plan location:** after execution starts, the execution-worktree Plan is authoritative until
  publication settles. Reading only the primary checkout can show false old progress.
- **Publication:** `deliveryEvidence` or execution Plan status `validated` does not alone prove that Direct Delivery
  committed. Registry `validated`, `publication_failed`, and `merge_conflict` remain unsettled states. Only settled
  canonical evidence can complete Delivery and Completion.
- **Projection versus authority:** Session Transcript Segment kind, Agent status lines, and runtime `validationProgress`
  are display evidence. They can describe current activity but cannot override Plan Status, Validation Checkpoint, or
  registry evidence.
- **Ambiguity:** duplicate attempts, mismatched Plan IDs, missing execution Plans, or unreadable registry data produce
  one degraded view. The projector does not fall back to a plausible-looking primary Plan.
- **Polling races:** each response is a complete projection. Ignore late older responses, retain the last good view on a
  transient network failure, and never infer a stage transition client-side.
- **Reopened work:** old execution and repair segments remain historical. Current canonical Plan Status starts the new
  progress sequence; the page must not mark the reopened attempt complete from old segments.
- **Split scope:** pasted images, arbitrary file upload, timeline filters, recent activity, dashboard grouping,
  lifecycle mutation, full `/load-plan` recovery, and damaged Session Transcript repair are not part of this Plan.
- **Compatibility:** preserve paired-device authorization, registered-Project containment, stable Plan and Session IDs,
  opaque aggregate cursors, TUI/ACP synchronization, zero injection seams, and the existing Workspace visual language.
