---
planId: "b0e98f29-33de-44bf-a785-dbda322d2533"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Build the first phone-friendly Workspace Session surface: authenticated timeline, prompt box, activation-aware ownership state, and a basic ideation continuation flow backed by the slice 4 APIs."
affectedPaths:
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/ui/workspace/react/"
    - "src/ui/workspace/server/"
    - "docs/design-system.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-22T03:56:51.467Z"
updatedAt: "2026-07-22T03:56:51.467Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 5
dependencies:
    - "04-activation-gated-workspace-session-continuation-apis"
---

# Phone Ideation Session UI Tracer Bullet

## Context

The first high-value Personal Workspace experience is continuing an ideation or planning conversation from a phone.
Slice 4 provides the narrow activation-gated backend APIs. This slice builds the minimal browser UX that makes that real
without waiting for the full Attention Dashboard, Plan review, or durable workflow checkpoint system.

## Objective

Create a phone-friendly Workspace Session continuation surface that lets a paired owner:

- choose an eligible registered Project and idle Session;
- view a semantic conversation timeline/snapshot;
- see whether Workspace can acquire mutation ownership;
- submit a normal ideation/planning prompt;
- watch streamed or refreshed semantic events for the turn;
- return to an idle state with activation released.

## Approach

Use existing Workspace pages/components and the RunWield design system. Keep the tracer bullet focused on conversation
continuation, not Plan execution. The UI should be responsive and useful on a phone, but visual polish beyond clear
hierarchy, accessible controls, and ownership feedback can move to the later complete Session UX slice.

## Files to Modify

- `src/ui/workspace/pages/` — add Project/Session routes for the minimal continuation flow.
- `src/ui/workspace/components/` — add timeline, ownership/status, Project/Session selector, and prompt controls.
- `src/ui/workspace/islands/` — add client-side prompt submission, live refresh/stream handling, and draft preservation.
- `src/ui/workspace/react/` — reuse existing React/Plannotator boundaries only if needed; keep simple Preact islands
  where possible.
- `src/ui/workspace/server/` — consume the slice 4 APIs and return UI-ready semantic data.
- `docs/design-system.md` — document any new reusable Session timeline or mobile ownership pattern if one is introduced.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/pages/index.astro` — reuse existing Workspace layout and route conventions.
- `src/ui/workspace/components/` — reuse current Plan/Epic card and status visual patterns.
- `src/ui/design-system/components.css` and `src/ui/design-system/tokens.css` — use semantic `--rw-*` tokens.
- `src/shared/session/session-runtime-events.js` — render existing semantic event types rather than parsing raw
  transcript text.

## Implementation Steps

- [ ] Add a minimal Session route reachable from the owner Project list for eligible Sessions.
- [ ] Render semantic timeline entries with stable IDs, timestamps, active Agent identity, messages, thinking summaries,
      tool summaries, and attention/status cues supported by the API.
- [ ] Add an activation-aware prompt box that disables or explains itself when another surface owns mutation.
- [ ] Preserve unsent browser draft text across timeline refreshes, ownership rejection, and reconnect.
- [ ] Submit prompts through the activation-gated API and update the timeline from streaming events or bounded polling.
- [ ] Add responsive phone layout, keyboard/focus behavior, and accessible status announcements.
- [ ] Add UI tests for prompt submission, ownership rejection, draft preservation, and reconnect/refresh behavior.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: Workspace tests should cover authenticated access, no access from unpaired devices, eligible Session
  rendering, ownership rejection display, prompt submission, timeline refresh, and draft preservation.
- Manual headed browser: run `deno task workspace:dev`, open `http://127.0.0.1:5173` in a phone-sized viewport, select a
  Project/Session, submit an ideation prompt, observe the timeline update, and confirm the prompt box returns to idle.
- Manual headed browser: open the same Session in a second browser context and verify only one continuation can submit
  while the loser shows a clear ownership state.

## Edge Cases & Considerations

- Do not expose Plan approval or execution controls in this tracer-bullet surface.
- Browser disconnect must not imply cancellation; the surface should refresh to the current committed state on
  reconnect.
- Keep drafts local and unsent until the owner explicitly submits.
- Use current Workspace aesthetics rather than inventing a separate mobile theme.
