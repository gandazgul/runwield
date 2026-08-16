---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Build the owner Attention Dashboard from Session activation, generations, transcript events, and canonical Plan/worktree evidence across registered Projects."
affectedPaths:
    - "src/ui/workspace/server/"
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/shared/session/"
    - "src/shared/workflow/"
    - "docs/design-system.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-26T20:48:25.378Z"
updatedAt: "2026-08-13T00:24:38-04:00"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v2"
order: 1
dependencies: []
planId: "544343e5-ad41-4698-8183-eae0cd3983b2"
---

# Attention Dashboard and Multi-Project Projections

## Context

Deferred from Personal Remote Workspace v1 on 2026-08-13. The v1 Epic ships the core loop (session timeline, Plan
review, approval) with a plain project → session list as the entry point. This dashboard replaces that plain list when
v2 starts. Requires the v1 Epic (through its hardening child) to be complete.

The owner needs one remote surface for running, waiting, ready, failed, degraded, and recently completed work across
Projects. Display state must remain a rebuildable projection rather than a workflow authority.

## Objective

Build dashboard projection services and UI that derive attention from:

- Session Activation state and committed Session generations;
- aggregate transcript events, including completed Pi interactions;
- canonical Plan Lifecycle status and revision;
- canonical worktree and validation evidence; and
- registered Project health.

The dashboard groups attention by category, preserves Project identity, links to relevant Session/Plan surfaces, and
works accessibly on phone and desktop.

## Approach

Hydrate canonical artifacts and owner coordination evidence on the server, then render existing Workspace card, badge,
and status patterns. Cache only rebuildable summaries. Missing or contradictory evidence produces a visible degraded or
recovery state rather than an inferred workflow transition.

## Files to Modify

- `src/ui/workspace/server/` — attention projection services and authenticated APIs.
- `src/ui/workspace/pages/`, `components/`, and `islands/` — dashboard, Project details, filters, and responsive
  behavior.
- `src/shared/session/` — activation, generation, and transcript-event summaries.
- `src/shared/workflow/` — canonical Plan/worktree/validation summaries.
- `docs/design-system.md` — document only genuinely reusable new visual patterns.

## Reuse Opportunities

- `src/ui/tui/system-notifications.js` attention concepts.
- `src/ui/workspace/server/plan-adapter.js` canonical Plan hydration.
- `src/shared/workflow/plan-lifecycle.js` lifecycle metadata.
- Existing RunWield design-system cards, badges, tokens, and layouts.

## Implementation Steps

- [ ] Define category precedence for running, waiting, ready, failed, degraded, recently completed, idle, and disabled.
- [ ] Build projections from Session activation/generations/events and canonical Plans/worktrees.
- [ ] Add dashboard and Project detail routes with grouping, counts, filters, empty/degraded states, and deep links.
- [ ] Add responsive and accessible interactions using semantic `--rw-*` tokens.
- [ ] Test projection rebuilds, missing roots, stale generations, segment integrity failures, changed Plans/worktrees,
      completed interactions, and recovery categories.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: cover every category and prove cached summaries cannot authorize or advance work.
- Manual headed browser: seed multiple Projects and states, then verify counts, links, degraded states, keyboard access,
  and phone layout at `http://127.0.0.1:5173`.

## Edge Cases & Considerations

- Partial Project health remains visible.
- Projection refresh should preserve local filters and navigation state.
- Do not broaden Agent retrieval or cross-Session memory.
- Display projections must never move canonical workflow truth backward.
