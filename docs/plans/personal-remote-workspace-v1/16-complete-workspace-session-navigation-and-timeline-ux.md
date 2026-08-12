---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Expand the phone tracer bullet into complete Workspace Session navigation and aggregate timelines for committed Pi history, with explicit retry after owner-process loss."
affectedPaths:
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/ui/workspace/react/"
    - "src/ui/workspace/server/"
    - "src/shared/session/"
    - "docs/design-system.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-26T20:48:25.378Z"
updatedAt: "2026-07-26T20:48:25.378Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 16
dependencies:
    - "15-attention-dashboard-and-multi-project-projections"
planId: "7d873089-5c41-4c43-95cd-e748fdc6b38a"
---

# Complete Workspace Session Navigation and Timeline UX

## Context

The phone ideation tracer bullet proved minimal remote continuation. The complete Session surface must combine Project
navigation, ordered aggregate history, ownership visibility, reconnect behavior, creation, and continuation while
preserving one stable Session identity.

Pi persists completed tool calls and results in Session JSONL. A structured interaction that is still waiting belongs to
the live owning process. If that process is lost, Workspace reloads committed history and tells the owner to ask the
Agent to retry; it does not recreate the unfinished interaction.

## Objective

- Navigate Projects, Session lists, recent activity, and Session detail on phone and desktop.
- Render messages, thinking, completed tools/interactions, workflow events, usage, attention, segment boundaries, and
  recovery events from aggregate committed projection.
- Show a live process-local wait while its owner remains connected, without presenting it as persisted history.
- After owner-process loss, remove the stale wait and provide explicit retry guidance.
- Preserve stable Session identity across segments and activation handoff.
- Preserve drafts, attachments, and local annotations across refresh/reconnect.
- Reject competing turns safely and require resubmission after refresh.

## Approach

Build reusable components from slice 5 and dashboard navigation from slice 15. Render committed Pi semantic events from
shared projection APIs. Overlay live process state only while connected to its owner. Keep activation proof details and
Pi segment IDs out of user-facing navigation.

## Files to Modify

- `src/ui/workspace/pages/` — Session routes, Project navigation, creation, and deep links.
- `src/ui/workspace/components/` — timeline entries, completed interaction/tool cards, live-wait state, ownership, and
  navigation.
- `src/ui/workspace/islands/` — live updates, reconnect, draft preservation, submission, filters, and attachments.
- `src/ui/workspace/react/` — integrate with existing React/Plannotator surfaces where needed.
- `src/ui/workspace/server/` — Session list/detail/create/update APIs over shared coordination services.
- `src/shared/session/` — adapter-neutral display summaries where necessary.
- `docs/design-system.md` — document reusable timeline/ownership patterns only if newly introduced.

## Reuse Opportunities

- `src/shared/session/session-runtime-events.js` semantic events.
- Slice 9 aggregate projection and segment-namespaced cursors.
- `src/ui/tui/runtime-adapter.js` interpretation concepts without UI imports.
- Existing Workspace navigation, cards, badges, and RunWield primitives.

## Implementation Steps

- [ ] Refactor the tracer bullet into reusable Project/Session navigation and timeline components.
- [ ] Add Session list, creation, continuation, filtering, recent activity, and dashboard deep links.
- [ ] Render committed semantic event families, including completed Pi tool calls/results, with stable aggregate keys.
- [ ] Render connected process-local waits distinctly; on owner loss, replace them with retry guidance.
- [ ] Add activation/handoff, running, failed, recovery, idle, and segment-boundary states.
- [ ] Refresh committed events after reconnect while preserving drafts, attachments, and annotations.
- [ ] Test rendering, navigation, owner loss, retry guidance, reconnect, and local-state preservation.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: cover completed interaction rendering, live wait removal after owner loss, aggregate timelines, activation
  loss, reconnect, and draft/attachment preservation.
- Manual: continue a Session TUI → Workspace → TUI and confirm one writer, linear history, completed interaction cards,
  unobtrusive ownership changes, and explicit retry after terminating a pending interaction's process.

## Edge Cases & Considerations

- A displayed live wait is not committed transcript history.
- Do not queue unseen competing turns after activation loss.
- Browser disconnect alone does not end a wait if its owning process remains alive.
- Use semantic `--rw-*` tokens and existing Workspace patterns.
