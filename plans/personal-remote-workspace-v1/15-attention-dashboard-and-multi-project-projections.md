---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Build the owner Attention Dashboard and projection services for running, waiting, ready, failed, degraded, and recently completed work across registered Projects. It consumes hardened backend state without becoming authoritative for workflow decisions."
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
updatedAt: "2026-07-26T20:48:25.378Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 15
dependencies:
    - "14-cross-surface-workflow-invariant-hardening"
---

# Attention Dashboard and Multi-Project Projections

## Context

With registered Projects, segmented Sessions, activation, checkpoints, Plan leases, execution handoff, and invariant
hardening in place, the owner needs a single remote surface to find what needs attention. The dashboard should show
running, waiting, ready, failed, degraded, and recently completed work across Projects without becoming a second
canonical store for Plans or transcripts.

## Objective

Build Attention Dashboard projection services and UI so that:

- Project health, active/idle Session states, pending checkpoints, Plan lease states, execution/validation status,
  recovery state, and recent completions are visible across registered Projects;
- work is grouped by attention category with clear Project identity;
- deep links route to Session continuation, Plan review/recovery, Project details, and later search/code surfaces;
- responsive phone and desktop layouts follow the RunWield Design System;
- projection state is rebuildable and never authoritative for workflow decisions.

## Approach

Create server-side projection services that hydrate from canonical artifacts and owner coordination state, then render
dashboard cards using existing Workspace patterns. Denormalize only where useful for performance and always retain
canonical rehydration. Add browser UI with accessible filters, clear degraded states, and mobile-first navigation.

## Files to Modify

- `src/ui/workspace/server/` — add attention projection services and authenticated API endpoints.
- `src/ui/workspace/pages/` — add dashboard and Project detail routes.
- `src/ui/workspace/components/` — add attention cards, Project health summaries, checkpoint badges, Plan status
  summaries, and empty/degraded states.
- `src/ui/workspace/islands/` — add refresh, filtering, and responsive interaction behavior.
- `src/shared/session/` — expose Session, activation, checkpoint, and segment summary helpers.
- `src/shared/workflow/` — expose Plan lease, lifecycle, validation, execution, and recovery summary helpers.
- `docs/design-system.md` — document any genuinely reusable dashboard/status pattern added to the shared design system.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/tui/system-notifications.js` — reuse attention category concepts and notification semantics.
- `src/ui/workspace/server/plan-adapter.js` — reuse canonical Plan hydration for summaries.
- `src/shared/workflow/plan-lifecycle.js` — reuse lifecycle status/action metadata.
- `src/ui/design-system/` and `docs/design-system.md` — use existing card, badge, status, layout, and token patterns.
- Hardened diagnostics from slice 14 — display blocked, uncertain, and recovery states consistently.

## Implementation Steps

- [ ] Define attention projection categories and precedence for running, waiting, ready, failed, degraded, recently
      completed, idle, and disabled Project states.
- [ ] Implement projection queries that combine owner DB state with canonical Plan, transcript, checkpoint, lease,
      worktree, and Project evidence.
- [ ] Add dashboard route with Project grouping, category filters, counts, empty states, degraded states, and deep
      links.
- [ ] Add Project detail route or panel showing Sessions, Plans, checkpoints, leases, health, and recent activity.
- [ ] Add responsive phone layout and accessible keyboard/focus behavior using RunWield design tokens.
- [ ] Add tests for projection accuracy, missing roots, stale evidence, checkpoint states, segment integrity failures,
      Plan lease conflicts, and recovery categories.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: Workspace tests should cover category assignment for running, waiting, ready, failed, recently completed,
  disabled Project, missing Project, pending checkpoint, held lease, uncertain activation, and recovery states.
- Manual headed browser: run `deno task workspace:dev`, seed multiple Projects/Sessions/Plans in different states, open
  `http://127.0.0.1:5173`, and verify categories, counts, deep links, degraded states, and responsive phone layout.
- Expected result: the dashboard helps the owner decide what to act on without claiming authority over canonical
  workflow state.

## Edge Cases & Considerations

- Partial/degraded Project health should be visible rather than hiding the Project.
- Projection refresh must not discard local UI state unnecessarily.
- Do not broaden Agent retrieval or cross-Session memory from dashboard projections.
- New UI must use semantic `--rw-*` tokens and existing Workspace visual patterns.
