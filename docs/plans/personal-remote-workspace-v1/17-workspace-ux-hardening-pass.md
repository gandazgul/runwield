---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Harden the v1 Workspace UI after real usage: recovery-action UI, attachments, a dedicated execution-progress view, timeline filters, and richer state presentation deferred from slices 15 and 16."
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
updatedAt: "2026-08-13T00:24:38-04:00"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 17
dependencies:
    - "16-workspace-plan-review-and-approve-ui"
planId: "6ae27038-fabf-4e8f-939f-cb2bef4c2a59"
---

# Workspace UX Hardening Pass

## Context

Slices 15 and 16 deliberately shipped the smallest usable core loop and deferred every capability that was not on its
critical path. This slice collects those deferrals into one pass, executed only after the owner has used the core loop
on real work. The owner's own usage friction should reorder and reshape this list before execution — refine this draft
against that experience rather than executing it as speculation.

Everything here builds on completed foundations: slice 12 Session-activated Plan actions, slice 13 execution handoff,
slice 15 navigation/timeline, and slice 16 review/approve.

## Objective

Deferred from slice 15 (Session navigation and timeline):

- attachment support in Session submission, preserved across refresh/reconnect;
- timeline filters and recent-activity views;
- segment-boundary and recovery-event presentation in the timeline; and
- richer activation/handoff, running, failed, degraded, and idle state presentation.

Deferred from slice 16 (Plan review and approve):

- recovery-action UI, replacing "recover in the TUI" for the recovery actions the shared slice 12 services already
  expose; and
- a dedicated execution/validation/repair/completion progress view derived from canonical artifacts and aggregate
  transcript projection, replacing the plain timeline link.

Optional, only if usage shows the plain project → session list is insufficient before v2:

- a dashboard-lite grouping of sessions/plans by state on the existing list pages, without the v2 multi-Project
  attention projection machinery.

## Approach

Before execution, walk the deferral list against the owner's real usage notes and cut or reorder items with the user.
Then extend the existing slice 15/16 surfaces in place; introduce no new authority, coordination, or index machinery.
Progress and recovery views read canonical artifacts and committed projections only; display state never advances
workflow truth.

## Files to Modify

- `src/ui/workspace/pages/`, `components/`, `islands/` — filters, attachments, progress view, recovery actions, state
  chrome.
- `src/ui/workspace/server/` — endpoints for recovery actions and progress reads over existing shared services.
- `src/shared/session/` and `src/shared/workflow/` — UI-safe summaries only where an existing helper is missing.
- `docs/design-system.md` — document genuinely reusable new patterns (progress, recovery) if introduced.

## Reuse Opportunities

- Slice 12 Session-activated action services (recovery actions already exist server-side).
- Slice 9 aggregate projection and segment-namespaced cursors for progress and segment chrome.
- Slice 15 timeline components and slice 16 review components.
- Existing RunWield design-system primitives and `--rw-*` tokens.

## Implementation Steps

- [ ] The deferral list above is re-reviewed with the user against real usage, and this Plan's scope reflects the
      outcome before implementation starts.
- [ ] Recovery actions exposed by slice 12 services are executable from the Plan review UI with plain-language
      confirmation, and "recover in the TUI" text no longer appears for those actions.
- [ ] A dedicated progress view shows execution, validation, repair, and completion derived from canonical artifacts and
      committed projection, and the slice 16 approve flow links to it.
- [ ] Attachments can be submitted with a Session message and survive refresh/reconnect.
- [ ] Timeline filters and recent-activity views exist and preserve navigation state across refresh.
- [ ] Segment boundaries and recovery events render in the timeline without exposing activation proofs or Pi segment
      IDs.
- [ ] Tests cover recovery actions, progress derivation, attachment persistence, filters, and state presentation.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: prove recovery actions require Session Activation and current canonical evidence, and progress views are
  read-only projections.
- Manual headed browser (phone and desktop): exercise a full loop — plan in TUI, review and approve on phone, watch the
  progress view, trigger a semantic repair, recover a stale action from the browser — and confirm the TUI stays
  synchronized.
- Behavior protected from slices 15/16: core-loop tests (timeline, approve, stale rejection) must keep passing
  unchanged; the "recover in the TUI" plain-text path is expected to stop existing for actions this slice implements.

## Edge Cases & Considerations

- This Plan is intentionally provisional: re-scope with the user after real usage before executing.
- Display projections never authorize or advance work.
- No new coordination, authority, or index machinery; anything requiring it belongs in the v2 Epic.
- Use semantic `--rw-*` tokens and existing Workspace patterns.
