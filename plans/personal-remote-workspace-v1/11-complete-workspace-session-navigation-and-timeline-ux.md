---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Expand the phone ideation tracer bullet into the full Workspace Session surface with multi-Project navigation, semantic timelines, ownership handoff, reconnect behavior, and Session creation/continuation polish."
affectedPaths:
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/ui/workspace/react/"
    - "src/ui/workspace/server/"
    - "src/shared/session/"
frontend: true
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-22T03:56:51.474Z"
updatedAt: "2026-07-22T03:56:51.474Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 11
dependencies:
    - "10-attention-dashboard-and-multi-project-projections"
    - "06-read-only-transcript-projection-and-idle-tui-sync"
---

# Complete Workspace Session Navigation and Timeline UX

## Context

The earlier phone ideation tracer bullet proves minimal remote continuation. Personal Workspace v1 needs a durable
everyday Session surface: Project and Session navigation, semantic timeline rendering, ownership handoff visibility,
reconnect behavior, Session creation, and clear paths back to Plan/review workflows.

## Objective

Complete the Workspace Session UX:

- Project-aware Session list, creation, search/filtering, and recent activity navigation;
- rich semantic timelines for messages, thinking, tools, interactions, workflow events, usage, and attention;
- activation-aware ownership state and handoff behavior across Workspace, TUI, and ACP;
- browser reconnect and refresh behavior that preserves drafts;
- mobile and desktop layouts that feel native to existing Workspace;
- deep links from Attention Dashboard and later Plan/review flows.

## Approach

Build on the tracer-bullet routes and components from slice 5. Promote useful pieces into reusable Workspace Session
components. Keep rendering based on `SessionRuntime` semantic events and committed projection data rather than raw
transcript parsing in the UI. Add polish and completeness without changing the underlying activation/checkpoint
invariants.

## Files to Modify

- `src/ui/workspace/pages/` — expand Session routes, Project navigation, and deep-link handling.
- `src/ui/workspace/components/` — add reusable timeline entries, tool cards, thinking states, interaction states,
  ownership banners, and navigation components.
- `src/ui/workspace/islands/` — add live updates, reconnect, draft preservation, prompt queuing rejection, and filter
  interactions.
- `src/ui/workspace/react/` — integrate React components only where existing Workspace surfaces require them.
- `src/ui/workspace/server/` — provide complete Session list/detail/update APIs backed by shared Session coordination
  services.
- `src/shared/session/` — add any UI-oriented summary helpers that are still adapter-neutral.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-runtime-events.js` — render stable semantic events.
- `src/ui/tui/runtime-adapter.js` — reuse semantic event interpretation concepts without importing TUI UI code.
- `src/ui/workspace/components/` Plan/Epic surfaces — reuse cards, status badges, and navigation patterns.
- `src/ui/design-system/` and `docs/design-system.md` — preserve Workspace visual language and accessibility
  expectations.

## Implementation Steps

- [ ] Refactor tracer-bullet Session UI into reusable Project/Session navigation and timeline components.
- [ ] Add Session creation and continuation entry points for eligible Project contexts.
- [ ] Render all supported semantic event families with stable keys and accessible summaries.
- [ ] Add ownership handoff, activation-lost, waiting-for-human, running, failed, and idle states.
- [ ] Add reconnect handling that refreshes committed events and preserves prompt drafts/attachments.
- [ ] Wire Attention Dashboard deep links to precise Session positions or pending interactions.
- [ ] Add browser and component tests for timeline rendering, navigation, reconnect, draft preservation, and ownership
      status.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: Workspace tests should cover semantic event rendering, Session navigation, Session creation,
  activation-lost states, reconnect refresh, and draft preservation.
- Manual headed browser: run `deno task workspace:dev`, open a phone-sized and desktop-sized Workspace, navigate across
  Projects/Sessions, continue an ideation turn, disconnect/reconnect the browser, and verify timeline continuity and
  local draft behavior.
- Manual cross-surface: continue a Session from TUI to Workspace and back; each turn has one writer, history remains
  linear, and ownership transitions are visible but unobtrusive.

## Edge Cases & Considerations

- Do not queue unseen competing turns when activation is lost; refresh and ask the owner to submit again if needed.
- Browser-owned work should continue or wait durably according to checkpoint policy, not connection lifetime.
- Avoid duplicate visual systems; use RunWield tokens and existing Workspace patterns.
- Keep UI summaries faithful to semantic events.
