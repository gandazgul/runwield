---
planId: "6ae27038-fabf-4e8f-939f-cb2bef4c2a59"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Harden the v1 Workspace UI after real usage: browser recovery actions, a right-side workflow-state sidebar, image-paste Session attachments, TUI-style system event blocks, stick-to-latest scrolling, and clear Session state indicators."
affectedPaths:
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/ui/workspace/server/"
    - "src/shared/session/"
    - "src/shared/workflow/"
    - "docs/design-system.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "pair"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-08-13T00:24:38-04:00"
status: "user_verified"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 17
dependencies:
    - "16-workspace-plan-review-and-approve-ui"
implementedAt: "2026-08-23T17:04:02.000Z"
userVerifiedAt: "2026-08-24T12:28:52.000Z"
userVerificationNote: "Recovered, integrated, and accepted by the user with Codex before the publication state-machine migration."
executionReport: "- Rewrote scope summary to remove cut timeline-filter/dashboard-lite work and reflect the owner-approved scope.\n- Confirmed most Plan 17 work was already implemented: browser recovery/progress surfaces, workflow-state sidebar, image-paste Session attachments, latest-block control, and Session state indicators.\n- Filled the gap in TUI-style system event behavior by merging consecutive system events of the same type into one block and rendering merged lines safely.\n- Removed user-visible dashboard build-state copy from the owner Projects page.\n- Verification passed: focused Workspace/session tests, workspace type check, and full deno task ci.\n- Browser evidence: dev server at http://127.0.0.1:5173; checked /dev/plan-progress in headed Chrome and saved artifacts/plan17-progress-final.png. Auth-gated owner Session fixture at :8788 redirected to /pair, so the existing Session screenshots remain the available visual evidence for the sidebar route."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
updatedAt: "2026-08-24T21:23:47.295Z"
archivedAt: "2026-08-24T21:23:47.295Z"
archivedFromStatus: "user_verified"
archivedFromPath: "docs/plans/personal-remote-workspace-v1/17-workspace-ux-hardening-pass.md"
---

# Workspace UX Hardening Pass

## Context

Slices 15 and 16 deliberately shipped the smallest usable core loop and deferred every capability that was not on its
critical path. This slice collects those deferrals into one pass, executed only after the owner has used the core loop
on real work. That usage review happened on 2026-08-23, and the Objective below is its outcome, not the original
speculative list.

Everything here builds on completed foundations: slice 12 Session-activated Plan actions, slice 13 execution handoff,
slice 15 navigation/timeline, and slice 16 review/approve.

## Objective

The owner re-reviewed the slice 15/16 deferral list against real usage on 2026-08-23 and set the scope below. The
answers are recorded here; the cut items move to a later slice, not to this one.

In scope:

- recovery-action UI, replacing "recover in the TUI" for the recovery actions the shared slice 12 services already
  expose;
- a workflow-state sidebar to the right of the Session scroll (`session scroll | workflow state sidebar`) that carries
  the execution/validation/repair/completion progress the TUI shows, replacing the plain timeline link;
- image-paste attachments in Session submission, preserved across refresh/reconnect — image paste only, no other
  attachment kinds;
- segment boundaries and recovery events rendered as system event blocks, the same way the TUI renders them. The web
  session stream mirrors TUI function but not TUI looks: typed blocks, consecutive events of the same type merged into
  one block, scroll-up available but the view stays with the latest block near the input at the bottom; and
- a session-state indicator showing whether work is running, blocked, failed, idle, or owned and running elsewhere.

Cut from this slice:

- timeline filters and recent-activity views; and
- dashboard-lite grouping of sessions/plans by state.

## Approach

Extend the existing slice 15/16 surfaces in place; introduce no new authority, coordination, or index machinery.
Progress and recovery views read canonical artifacts and committed projections only; display state never advances
workflow truth. Take the block vocabulary and event grouping from the TUI session stream so the two stay behaviorally
the same, and give the web version its own visual treatment through the design system.

## Files to Modify

- `src/ui/workspace/pages/`, `components/`, `islands/` — image-paste attachments, workflow-state sidebar, event blocks,
  recovery actions, state chrome.
- `src/ui/workspace/server/` — endpoints for recovery actions and progress reads over existing shared services.
- `src/shared/session/` and `src/shared/workflow/` — UI-safe summaries only where an existing helper is missing.
- `docs/design-system.md` — document genuinely reusable new patterns (progress, recovery) if introduced.

## Reuse Opportunities

- Slice 12 Session-activated action services (recovery actions already exist server-side).
- Slice 9 aggregate projection and segment-namespaced cursors for progress and segment chrome.
- Slice 15 timeline components and slice 16 review components.
- Existing RunWield design-system primitives and `--rw-*` tokens.

## Implementation Steps

- [x] The deferral list above is re-reviewed with the user against real usage, and this Plan's scope reflects the
      outcome before implementation starts.
- [ ] Recovery actions exposed by slice 12 services are executable from the Plan review UI with plain-language
      confirmation, and "recover in the TUI" text no longer appears for those actions.
- [ ] A workflow-state sidebar sits to the right of the Session scroll and shows execution, validation, repair, and
      completion derived from canonical artifacts and committed projection, and the slice 16 approve flow links to it.
- [ ] An image pasted into the Session composer is submitted with the message and survives refresh and reconnect.
- [ ] Segment boundaries and recovery events render as typed system event blocks that match the TUI's blocks, merging
      consecutive events of the same type, without exposing activation proofs or Pi segment IDs.
- [ ] The session stream allows scroll-up but returns to and stays with the latest block near the input.
- [ ] A session-state indicator shows running, blocked, failed, idle, and owned-elsewhere states.
- [ ] Tests cover recovery actions, progress derivation, image-attachment persistence, event-block grouping and
      stick-to-latest scrolling, and state presentation.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: prove recovery actions require Session Activation and current canonical evidence, and progress views are
  read-only projections.
- Manual headed browser (phone and desktop): exercise a full loop — plan in TUI, review and approve on phone, watch the
  workflow-state sidebar, paste an image into the composer and reload, trigger a semantic repair, recover a stale action
  from the browser — and confirm the TUI stays synchronized.
- Manual headed browser: compare the web session stream against the same session in the TUI and confirm the same events
  appear as the same block types in the same order.
- Behavior protected from slices 15/16: core-loop tests (timeline, approve, stale rejection) must keep passing
  unchanged; the "recover in the TUI" plain-text path is expected to stop existing for actions this slice implements.

## Edge Cases & Considerations

- Timeline filters, recent-activity views, dashboard grouping, and non-image attachments are cut from this slice. Do not
  add an affordance or a message for them; they simply do not exist here.
- Display projections never authorize or advance work.
- No new coordination, authority, or index machinery; anything requiring it belongs in the v2 Epic.
- Use semantic `--rw-*` tokens and existing Workspace patterns.
