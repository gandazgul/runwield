---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/ui/workspace/layouts/WorkspaceLayout.astro"
    - "src/ui/workspace/static/workspace-shell.ts"
    - "src/ui/workspace/routes/owner-api.js"
    - "src/ui/workspace/server/owner-plan-progress.ts"
    - "src/ui/workspace/server/owner-projects.js"
    - "src/ui/workspace/server/session-continuation.js"
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/ui/workspace/react/PlanProgressSurface.tsx"
    - "src/ui/workspace/react/ArtifactConversationSidebar.tsx"
    - "src/shared/workflow/"
    - "docs/design-system.md"
    - "docs/domain-language.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "pair"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-09-03T00:54:13.050Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v2"
order: 3
dependencies:
    - "01-durable-plan-to-session-continuity"
    - "02-durable-session-attention-and-browser-tab-notifications"
---

# Plan-Centered Workspace Home and Navigation

## Context

The current Workspace home redirects from `/` to the last Session, and the sidebar treats Sessions as the main objects.
This hides the work that needs the owner and makes Plans hard to find. The current owner sidebar also uses one
all-or-nothing `Promise.all`, so one damaged Project can fail the full response.

There is also a standalone Plan Progress page. The v1 flow made the associated Session timeline the progress surface and
put workflow state beside that timeline. V2 should keep the shared workflow summary data, but remove the duplicate page
and links.

## Objective

Make the Attention Dashboard the Workspace home. It groups Plan-centered work into Needs You, Ready to Continue, In
Progress, and Recently Finished. Open Plans lead Project navigation, with associated Sessions nested under Plans.
Standalone Sessions follow.

Dashboard and sidebar rows are springboards to the owning Plan, review, Session interaction, or Project surface. They
show state and evidence, but they do not duplicate approval, run, recovery, or message mutation controls.

## Approach

Compose existing canonical readers on the server and render one compact home view. Keep workflow truth in Plan,
controller, worktree, and Session files.

```text
registered Projects
  canonical Plan and workflow readers
  Session association and attention projection
  per-Project failure isolation
  Dashboard categories and Plan-first sidebar
  owning destination opens for action
```

The option set aside is keeping the Session-first sidebar and adding a separate Dashboard link. That is less code, but
it leaves the main continuity problem in place.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/ui/workspace/layouts/WorkspaceLayout.astro` and `src/ui/workspace/static/workspace-shell.ts` — make Dashboard and
  Search stable top navigation actions, stop last-Session home redirection, and render Plan-first Project navigation.
- `src/ui/workspace/routes/owner-api.js` — return per-Project sidebar and Dashboard data without one damaged Project
  failing all healthy Projects.
- `src/ui/workspace/server/owner-plan-progress.ts` and `src/shared/workflow/` — reuse canonical workflow interpretation
  for Dashboard categories and Session sidebar presentation, with Epic-appropriate classification.
- `src/ui/workspace/server/owner-projects.js` and `src/ui/workspace/server/session-continuation.js` — compose Project
  health, Plan summaries, associated Sessions, standalone Sessions, and diagnostics.
- `src/ui/workspace/pages/`, `components/`, `islands/`, and `react/` — add the responsive Attention Dashboard and
  Plan-first navigation UI using RunWield design-system patterns.
- `src/ui/workspace/react/PlanProgressSurface.tsx` and
  `src/ui/workspace/pages/projects/[projectId]/plans/[planId]/progress.astro` — remove the standalone progress surface
  and its routes.
- `src/ui/workspace/react/ArtifactConversationSidebar.tsx` — keep the detailed stage sequence only in the Session
  context sidebar.
- `docs/design-system.md` — document only reusable Dashboard, search action, or nested Plan/Session navigation patterns
  that are not already covered.
- `docs/domain-language.md` — align Dashboard category language with implemented behavior.

When the implementation makes proposed domain language true, include the applicable domain-language file:
`docs/domain-language.md` for a single-context project, or the context-specific `domain-language.md` identified by
`docs/domain-language-map.md` for a multi-context project.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/server/owner-projects.js` — registered-root eligibility and browser-safe Project projection.
- `src/ui/workspace/server/session-continuation.js` — stable Session listing and activation state.
- `src/ui/workspace/server/owner-plan-progress.ts#loadOwnerPlanProgress` — joined Plan, controller, worktree,
  validation, delivery, and Session evidence.
- `src/shared/session/session-transcript-projection.js#summarizeProjectedEntries` — projected attention and Plan
  association data from committed Session evidence.
- `src/shared/workflow/plan-lifecycle.js` — Plan status and lifecycle vocabulary.
- `src/ui/design-system/` — existing Workspace cards, rows, badges, status labels, focus behavior, and responsive shell
  patterns.

## Implementation Steps

- `/` renders the Attention Dashboard and no client code redirects it to the last Session or first Session.
- Dashboard rows classify Plans once into the highest applicable category with precedence Needs You, Ready to Continue,
  In Progress, then Recently Finished.
- Needs You includes Plan review, Workspace-hosted Agent questions from this server, human review, recovery, failed
  validation, committed Session attention, and damaged enabled Projects.
- Ready to Continue includes approved Plans ready to run, approved Epics ready for decomposition, and interrupted
  workflows with safe continuation.
- In Progress includes active Agents, execution, tests and CI, AI code review, repair, and delivery.
- Recently Finished includes only eligible terminal Plans from the last seven days, capped at ten across Workspace and
  five from any one Project, using immutable terminal transition evidence.
- On-Hold Plans and ordinary idle Sessions stay out of the Dashboard and remain available in navigation and search.
- Sidebar Project navigation initially shows at most five nonterminal Plans before standalone Sessions, orders active
  work by the Dashboard category order and latest update, and places muted On-Hold Plans after active work.
- Each Plan shows at most two proven associated Sessions; uncertain name-only matches are not nested.
- Show more expands additional Plans or Sessions in place, and the Plan Board link is not used as sidebar overflow.
- Dashboard, sidebar, and search support per-Project diagnostics for unreadable roots, invalid Plan identity, damaged
  Session projection, or failed Project index while healthy Projects still render.
- The standalone Plan Progress route, `PlanProgressSurface`, and Open/View progress links no longer exist; detailed
  execution stages appear only in the Session context sidebar.
- Dashboard and sidebar APIs expose reads and destinations only; mutation still goes through existing Session Runtime
  and Plan action paths.
- `docs/design-system.md` documents any reusable new visual patterns.
- `docs/domain-language.md` describes implemented Dashboard category language, avoided aliases, and relationships to
  Plans, Sessions, and attention.

## Verification Plan

- Automated: run `deno run -A scripts/run-tests.js src/ui/workspace/personal-remote-workspace-v2.acceptance.test.ts`.
- Automated: run `deno task workspace:check`, `deno task seams:check`, and `deno task ci` at Epic integration.
- Automated: fixtures must use real registered Project fixtures, canonical Plan/controller/worktree readers, file-backed
  Sessions, committed attention, and per-Project failure injection.
- Automated: mutate committed Plan, controller, worktree, and Session-attention evidence after the first Dashboard read
  and prove the next loaded projection changes category within five seconds without restart or manual cache clearing.
- Automated: prove Dashboard and sidebar endpoints cannot submit messages or lifecycle events.
- Automated: prove the Plan Progress route and links are gone and the stage sequence appears only in the Session context
  sidebar.
- Manual headed browser: run `deno task workspace:dev` and review responsive fixtures at `http://127.0.0.1:5173`.
- Manual paired check: verify the home page hierarchy, compact sidebar, phone drawer behavior, and category labels with
  the owner before execution continues if the visual direction is uncertain.
- Manual real-server check: use at least two registered Projects with same-named Plans, one Plan needing review, one
  approved Plan, one active Plan, one recently finished Plan, one On-Hold Plan, one standalone idle Session, one
  TUI-owned Session needing attention, and one Project read failure.
- Expected result: the owner opens Workspace, sees what needs them now, follows a row to the owning surface, and no
  longer has to inspect each Project separately.
- When applicable: confirm the glossary describes implemented behavior and does not promote unimplemented proposals.

## Edge Cases & Considerations

- A damaged Project must produce a source-specific diagnostic, not a generic degraded card with no reader evidence.
- Legacy closed Plans without immutable terminal-time evidence remain searchable but do not enter Recently Finished.
- A Session with no proven Plan association appears on the Dashboard only when it has unresolved attention or is
  actively running.
- Direct Plan and Session URLs must keep working.
- Local Plan Board behavior remains protected even though the owner Workspace home changes.
