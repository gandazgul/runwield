---
planId: "a708681a-0823-432d-8af8-d881df540309"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Build the owner Attention Dashboard and projection services for running, waiting, ready, failed, and recently completed work across registered Projects."
affectedPaths:
    - "src/ui/workspace/server/"
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/shared/session/"
    - "src/shared/workflow/"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-22T03:56:51.474Z"
updatedAt: "2026-07-22T03:56:51.474Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 10
dependencies:
    - "09-plan-workflow-lease-enforcement"
---

# Attention Dashboard and Multi-Project Projections

## Context

Once Projects, Sessions, activation, checkpoints, and Plan leases exist, the owner needs a single remote surface to find
what needs attention. The Attention Dashboard should show running, waiting, ready, failed, and recently completed work
across registered Projects without becoming a second canonical store for Plans or transcripts.

## Objective

Build Attention Dashboard projection services and UI:

- aggregate Project health, active/idle Session states, pending checkpoints, Plan workflow lease states,
  validation/execution status, and recent completions;
- group work by attention category with clear Project identity;
- provide deep links to Session continuation, Plan review/recovery, Project details, and later search/code surfaces;
- support responsive phone and desktop layouts;
- preserve notification destination hooks for future local/browser notifications.

## Approach

Create server-side projection services that hydrate from canonical sources and owner coordination state, then render
dashboard cards using existing Workspace design patterns. Keep projections denormalized only where useful for
performance and rebuildable from canonical artifacts. Avoid making dashboard state authoritative for workflow decisions.

## Files to Modify

- `src/ui/workspace/server/` — add attention projection services and authenticated API endpoints.
- `src/ui/workspace/pages/` — add dashboard and Project detail routes.
- `src/ui/workspace/components/` — add attention cards, Project health summaries, checkpoint badges, Plan status
  summaries, and empty/degraded states.
- `src/ui/workspace/islands/` — add refresh, filtering, and responsive interaction behavior.
- `src/shared/session/` — expose Session/activation/checkpoint summary helpers.
- `src/shared/workflow/` — expose Plan lease/lifecycle/validation summary helpers.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/tui/system-notifications.js` — reuse attention category concepts and notification semantics.
- `src/ui/workspace/server/plan-adapter.js` — reuse canonical Plan hydration for Plan summaries.
- `src/shared/workflow/plan-lifecycle.js` — reuse lifecycle status/action metadata.
- `src/ui/design-system/` — use existing card, badge, status, and layout patterns.

## Implementation Steps

- [ ] Define attention projection categories and precedence for running, waiting, ready, failed, recently completed,
      degraded, and idle work.
- [ ] Implement server projection queries that combine owner DB state with canonical Plan/transcript/worktree evidence.
- [ ] Add dashboard route with Project groupings, category filters, counts, and deep links.
- [ ] Add Project detail route or panel showing Sessions, Plans, checkpoints, health, and recent activity.
- [ ] Add responsive phone layout and accessible keyboard/focus behavior.
- [ ] Add tests for projection accuracy, missing Project roots, stale index/evidence, checkpoint states, and Plan lease
      categories.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: tests should cover category assignment for running, waiting, ready, failed, recently completed, disabled
  Project, missing Project, pending checkpoint, and held lease states.
- Manual headed browser: run `deno task workspace:dev`, create or seed multiple Projects/Sessions/Plans in different
  states, open `http://127.0.0.1:5173`, and verify the dashboard categories, counts, deep links, and responsive phone
  layout.
- Expected result: the dashboard helps the owner decide what to act on without claiming authority over canonical
  workflow state.

## Edge Cases & Considerations

- Partial/degraded Project health should be visible rather than hiding the Project.
- Projection refresh must not discard local UI state unnecessarily.
- Denormalized attention rows must be reconstructible.
- Do not broaden Agent retrieval or cross-Session memory from dashboard projections.
