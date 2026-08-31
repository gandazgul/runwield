---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "docs/design-system.md"
    - "src/ui/tui/"
    - "src/ui/workspace/"
    - "src/ui/design-system/"
    - "src/cmd/load-plan/"
    - "src/shared/workflow/"
    - "src/testing/"
executionAgent: "frontend-engineer"
collaborationRecommendation: "pair"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-08-31T02:51:48.044Z"
status: "draft"
origin: "internal"
parentPlan: "forge-change-request-delivery"
order: 13
dependencies:
    - "12-extend-change-request-delivery-to-quick-fix-and-host-preflight"
planId: "25477c22-ff54-4d89-840f-5033e0cd4f40"
targetBranch: "project/forge-change-request-delivery"
---

# Expose complete TUI and Workspace Change Request controls

## Context

The application model can now handle Change Request Delivery, but users need clear controls and status displays. The TUI
and Workspace must show the same truth from the same stored attempt and receipt. Workspace must use the existing
RunWield browser design system.

## Objective

Add complete TUI and Workspace controls for delivery/review presets, Forge Change Request phase display, refresh, stale
and closed states, feedback selection, repair/fold actions, merge proof, finalization pending, and completion.

## Approach

Build UI over the shared read model. Do not create Workspace-only lifecycle authority. Use presets rather than a large
matrix of independent toggles.

```text
stored attempt + receipt
  -> shared progress/read model
  -> TUI presentation
  -> Workspace presentation
  -> same actions call workflow coordinator
```

The option set aside is to build a separate Workspace state machine. That might speed browser work, but it would split
truth from Core and TUI.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `docs/design-system.md` — document any new visual pattern only if existing primitives are not enough.
- `src/ui/tui/` — add selection, status, refresh, feedback, and recovery controls.
- `src/ui/workspace/` — show the same read model through current browser design-system primitives.
- `src/ui/design-system/` — add shared primitives only if a new reusable pattern is necessary.
- `src/cmd/load-plan/` — wire user actions to workflow coordinator operations.
- `src/shared/workflow/` — expose safe read-model and action interfaces for UI callers.
- `src/testing/` and Workspace tests — cover TUI golden journeys and browser-visible states.

## Reuse Opportunities

- `src/ui/workspace/react/PlanProgressSurface.tsx` and owner plan progress server modules — reuse Plan progress
  patterns.
- `src/ui/workspace/server/plan-adapter.js` — reuse canonical Plan hydration and lifecycle-safe action handlers.
- Existing TUI validation and load-plan golden scenarios — reuse conversation and recovery patterns.
- `src/ui/design-system/` tokens and primitives — use `--rw-*` semantic tokens and shared components.

## Implementation Steps

- [ ] TUI users can choose Direct Delivery, Change Request Delivery, or Dual Review through clear presets without
      changing unrelated execution settings.
- [ ] TUI and Workspace show source repository, target repository, target branch, Forge Change Request URL, published
      revision, current delivery phase, known uncertainty, owner, and next action.
- [ ] TUI and Workspace distinguish open review, stale revision, closed-unmerged, inaccessible, merged code,
      finalization_pending, protected metadata request, and complete states.
- [ ] Users can refresh Forge state and select feedback for repair or Review Memory Fold from supported surfaces.
- [ ] Workspace uses the current RunWield design system, semantic tokens, and shared primitives; any new visual pattern
      is documented and added to the shared layer in the same change.
- [ ] UI actions call the shared coordinator/read-model interfaces and do not write lifecycle or attempt state directly.
- [ ] Browser fixture routes or Surface Lab entries cover the important states without adding extra `workspace:dev`
      aliases.

## Verification Plan

- Automated: run focused TUI, load-plan, Workspace server, and Workspace React tests with
  `deno run -A scripts/run-tests.js <test paths>`.
- Automated: run `deno task workspace:check` and relevant Workspace integration tests.
- Automated: run golden TUI scenarios for selection, refresh, stale state, feedback repair/fold, finalization pending,
  and complete delivery.
- Manual headed browser: start `deno task workspace:dev`, open `http://127.0.0.1:5173`, and inspect the Change Request
  Delivery states in Workspace routes or Surface Lab fixtures.
- Manual headed browser: verify the phase labels, action buttons, feedback selection, and disabled/uncertain states are
  visible and coherent at desktop sizes and narrower desktop widths.
- Expected result: TUI and Workspace report the same facts and never claim completion before final proof.

## Edge Cases & Considerations

- Browser UI must not hard-code colors; use `--rw-*` tokens and existing primitives.
- If a headed browser check is blocked, the Frontend Engineer must report the blocker and still run available automated
  checks.
- The UI should name uncertainty plainly instead of inventing provider policy or saying work is safe when proof is
  incomplete.
- Keep `deno task workspace:dev` as the Workspace development command; do not add new dev aliases for this feature.
