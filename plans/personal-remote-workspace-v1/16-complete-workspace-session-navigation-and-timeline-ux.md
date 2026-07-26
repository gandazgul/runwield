---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Expand the phone ideation tracer bullet into the full Workspace Session surface with Project navigation, aggregate semantic timelines, ownership handoff, reconnect behavior, and Session creation/continuation polish."
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
---

# Complete Workspace Session Navigation and Timeline UX

## Context

The earlier phone ideation tracer bullet proved minimal remote continuation. Personal Workspace now needs the complete
everyday Session surface: Project and Session navigation, segmented aggregate timeline rendering, ownership handoff
visibility, reconnect behavior, Session creation, and clear paths back to dashboard and Plan review workflows.

## Objective

Complete Workspace Session UX so that:

- the owner can navigate Projects, Session lists, recent activity, and Session detail from phone and desktop;
- semantic timelines render messages, thinking, tools, interactions, workflow events, usage, attention, checkpoint,
  segment, and recovery events;
- aggregate segmented history appears as one stable RunWield Session without exposing Pi segment IDs as separate
  Sessions;
- activation-aware ownership state and handoff behavior are visible across Workspace, TUI, and ACP;
- reconnect and refresh preserve drafts, attachments, and local annotations;
- Session creation and continuation entry points reject competing turns safely and guide resubmission after refresh.

## Approach

Build on the tracer-bullet routes and components from slice 5 and the dashboard deep-link model from slice 15. Promote
useful pieces into reusable Workspace Session components. Render from committed projection data and semantic Runtime
events rather than raw transcript parsing in the UI. Add polish without changing activation/checkpoint invariants.

## Files to Modify

- `src/ui/workspace/pages/` — expand Session routes, Project navigation, creation flows, and deep-link handling.
- `src/ui/workspace/components/` — add reusable timeline entries, tool cards, thinking states, interaction states,
  checkpoint states, ownership banners, and navigation components.
- `src/ui/workspace/islands/` — add live updates, reconnect, draft preservation, prompt submission, competing-turn
  rejection, filters, and attachment handling.
- `src/ui/workspace/react/` — integrate React components where existing Workspace/Plannotator surfaces require them.
- `src/ui/workspace/server/` — provide complete Session list/detail/create/update APIs backed by shared Session
  coordination services.
- `src/shared/session/` — add adapter-neutral UI summary helpers where needed.
- `docs/design-system.md` — document any reusable timeline or ownership state patterns added to the design system.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-runtime-events.js` — render stable semantic events.
- Aggregate projection APIs from slice 9 — consume segment-namespaced events and cursors.
- `src/ui/tui/runtime-adapter.js` — reuse semantic event interpretation concepts without importing TUI UI code.
- Existing Workspace Plan/Epic components — reuse cards, status badges, navigation, and responsive patterns.
- `src/ui/design-system/` and `docs/design-system.md` — preserve Workspace visual language and accessibility
  expectations.

## Implementation Steps

- [ ] Refactor tracer-bullet Session UI into reusable Project/Session navigation and timeline components.
- [ ] Add Session list, creation, continuation, search/filter, recent activity, and dashboard deep-link entry points.
- [ ] Render all supported semantic event families with segment-namespaced stable keys and accessible summaries.
- [ ] Add ownership handoff, activation-lost, waiting-for-human, running, failed, recovery, idle, and segment-boundary
      states.
- [ ] Add reconnect handling that refreshes committed events and preserves prompt drafts, attachments, and local
      annotations.
- [ ] Reject unseen competing turns after activation races and guide explicit resubmission after refresh.
- [ ] Add browser and component tests for timeline rendering, navigation, reconnect, draft preservation, attachment
      preservation, and ownership status.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: Workspace tests should cover semantic event rendering, aggregate segment timeline rendering, Session
  navigation, Session creation, activation-lost states, reconnect refresh, and draft/attachment preservation.
- Manual headed browser: run `deno task workspace:dev`, open phone-sized and desktop-sized Workspace, navigate across
  Projects/Sessions, continue an ideation turn, disconnect/reconnect the browser, and verify timeline continuity and
  local draft behavior.
- Manual cross-surface: continue a Session from TUI to Workspace and back; each turn has one writer, history remains
  linear, and ownership transitions are visible but unobtrusive.

## Edge Cases & Considerations

- Do not queue unseen competing turns when activation is lost; refresh and ask the owner to submit again if needed.
- Browser-owned work should continue or wait durably according to checkpoint policy, not connection lifetime.
- Avoid duplicate visual systems; use RunWield tokens and existing Workspace patterns.
- UI summaries must stay faithful to semantic events and must not expose private activation proof details.
