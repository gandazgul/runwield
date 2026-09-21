---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/ui/tui/"
    - "src/ui/workspace/"
    - "src/ui/review/"
    - "src/shared/session/"
    - "src/shared/epic-artifacts.ts"
    - "docs/design-system.md"
    - "docs/prd/runwield-workspace-prd.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "pair"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173/dev"
devServerHmr: true
createdAt: "2026-09-21T17:14:03.300Z"
status: "draft"
origin: "internal"
parentPlan: "plan-packages-and-independent-validation"
order: 8
dependencies:
    - "02-author-and-approve-complete-plan-packages"
    - "03-share-plan-packages-without-content-loss"
    - "04-run-independent-validation-and-advisory-human-qa"
    - "05-repair-findings-through-one-recoverable-loop"
    - "06-assemble-and-validate-epics-on-epic-branches"
    - "07-migrate-legacy-plans-and-unfinished-work"
targetBranch: "epic/plan-packages-and-independent-validation"
planId: "0ed25ea6-3b19-4a1e-baab-c061a45cd845"
---

# Expose Plan Packages and Validation Across User Surfaces

## Context

The preceding children establish package, approval, validation, repair, Epic assembly, collaboration, and migration
authority. Owners still need coherent TUI and Workspace projections that distinguish authored intent, generated
evidence, acceptance, and delivery. A stale tab or database projection must never manufacture approval or proof.

The dependent frontend-experience Epic will later add experience-contract planning, representative states, and prototype
policy. This child implements the package management and workflow surfaces required by the current Epic without
preempting that later design system.

## Objective

Let users browse and edit package documents, inspect current and historical proof, open advisory human QA, understand
lifecycle separately from delivery, recover paused work, and accept Planned Changes or Epics from TUI and Workspace
without weakening Core authority.

## Approach

Project controller and Plan-store state into shared view models used by TUI and Workspace. Keep one outer workflow entry
for prominent workflow events and expose package artifacts through existing review, Plan Board, Session, and
artifact-reader patterns. Reconcile evidence staleness on load and immediately before actions.

The option set aside is adding a new Workspace database as package authority; it would duplicate Core state and make
browser projections capable of inventing approval or proof.

## Expected Change Surface

The boundaries below are guidance, not an allowlist: verify the real footprint during implementation and change whatever
the Implementation Steps need, including files not named here. Stop and report only when discovery changes approved
intent — the change reaches another subsystem, public behavior or architecture shifts, migration or compatibility risk
grows, or the Verification Plan no longer proves the objective.

- `src/ui/tui/` — package navigation, workflow progress, pause and acceptance actions, and delivery distinction.
- `src/ui/workspace/components/PlanBoardPage.astro`, `PlanCard.jsx`, `PlanDetail.jsx`, and related shared view models —
  package, lifecycle, assembly, and delivery presentation.
- `src/ui/workspace/islands/PlanBodyEditor.jsx` and `PlanLifecycleActions.jsx` — document-aware editing and safe owner
  actions.
- `src/ui/workspace/react/PlanReviewSurface.tsx`, `WorkspacePlanDocument.tsx`, and related review components — authored
  versus generated document presentation and retained artifacts.
- `src/shared/session/` — continuous Session presentation across Validator, Reviewer, repair, pause, and acceptance.
- `src/shared/epic-artifacts.ts` — accessible current and retained QA and report links.
- `docs/design-system.md` — document any necessary shared visual pattern only if current primitives do not cover it.
- `docs/prd/runwield-workspace-prd.md` — update Local Plan management and Browser Plan review and workflow requirements
  and scenarios.

## Reuse Opportunities

- `docs/design-system.md` and `src/ui/design-system/` semantic tokens, theme bridge, and shared primitives.
- Existing shared Plan Review, Code Review, Plan Board, Session workflow entries, and artifact reader.
- Existing stale interaction and Session-scoped action routes.
- Core package, controller, acceptance, and delivery APIs from preceding children.
- Workspace `/dev` Surface Lab and paired local/TUI presentation fixtures.

## Implementation Steps

- TUI and Workspace list one Plan Package rather than its companion Markdown files and let the user navigate authored
  `plan.md`, authored `validation.md`, and generated evidence with clear document roles.
- Editing uses package byte revisions and authored specification revisions so stale tabs cannot overwrite newer
  documents or approve content the user did not see.
- Plan Review preserves the complete reviewed snapshot behavior from the approval child, while ordinary package browsing
  does not imply review or acceptance.
- Plan Board and detail views distinguish `implemented`, `validating`, `reviewing`, `awaiting_owner_review`,
  `validated`, `user_validated`, paused repair, and `defective` without treating detailed controller phases as extra
  board statuses.
- Delivery state remains independently visible: a validated Plan can have publication pending, and a validated Epic
  branch is not described as delivered to primary.
- Validation reports display check dispositions, candidate and package identity, open findings, stale evidence, loop
  count, repair claims, and operational limits without converting blocked or unrun work into pass indicators.
- `manual-qa.md` is accessible during Code Review and after delivery, includes retained context, and does not render as
  a required checklist or acknowledgement gate.
- Owner actions expose direct `user_validated`, ordinary code review, pause, additional-loop authorization, return to
  planning, and Plan-defect decisions at safe checkpoints for both Plans and Epics.
- Epic views distinguish child status from delivered containment, show accepted gaps and integrated validation inputs,
  and do not offer the later Epic-to-primary publication behavior.
- Process loss and stale Agent events produce one recoverable owner-facing state with valid next actions; reloading
  reconciles current package, candidate, child set, and controller evidence.
- Collaboration compatibility and migration conflict messages explain the affected package documents and preserve
  existing capability and ownership language.
- Workspace Local Plan management and Browser Plan review and workflow requirements and acceptance scenarios match
  delivered package editing, stale-tab handling, artifacts, recovery, acceptance, and delivery distinction; shared
  collaboration requirements remain linked rather than copied.
- Any new visual pattern is added to the shared design-system layer and documented in `docs/design-system.md`; otherwise
  existing primitives and `--rw-*` semantic tokens are reused.

## Verification Plan

- Automated: run focused TUI, Workspace, review, Plan Board, Session, and artifact tests through
  `deno run -A scripts/run-tests.js`, selecting the actual affected test files during planning.
- Automated: prove companion files never create extra cards, stale tabs cannot save or approve unseen content, and
  Workspace projections cannot advance lifecycle without matching Core evidence.
- Automated: prove advisory QA remains accessible before and after delivery without creating a gate, while a real open
  finding stays visibly unresolved.
- Automated: prove accepted status and delivery state render independently for Planned Changes and Epics, including
  pending child publication and stale integrated evidence.
- Automated: run `deno task seams:check` and `deno task ci`.
- Headed browser: start `deno task workspace:dev` and open `http://127.0.0.1:5173/dev`; use package, review, validation,
  repair, Epic, collaboration, and migration fixtures at desktop and narrow widths.
- Headed browser: review and edit both authored documents, force a validation-only stale tab, inspect failed and unrun
  checks, open `manual-qa.md`, authorize another loop, accept a failing result, and confirm delivery still reads
  pending.
- Headed browser: inspect a multi-child Epic with one undelivered child, one accepted gap, a stale integrated report,
  and a current validated assembly; confirm each state has distinct language and available actions.
- Headed browser: verify keyboard navigation, focus restoration, document labels, status semantics, and readable
  evidence in light and dark themes.
- Manual TUI: repeat the acceptance, pause/resume, artifact access, and Epic containment decisions and confirm command
  meanings match Workspace.
- Documentation: confirm Workspace PRD and any design-system additions describe delivered behavior and leave the
  dependent frontend-experience and Epic publication Epics deferred.

## Edge Cases

- Historical legacy statuses and reports remain readable but must not be labeled as current independent Validator proof.
- Closing Plan Review or Code Review is not acceptance.
- Missing candidate evidence is shown as unavailable and does not prevent direct user acceptance.
- Surface-local pending queues need not survive a TUI/Workspace switch, but durable controller decisions and Session
  history do.
- Generated report failure cannot display a passing gate, and stale historical reports remain accessible without being
  current proof.
