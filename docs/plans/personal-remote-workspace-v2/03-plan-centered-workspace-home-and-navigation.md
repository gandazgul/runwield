---
planId: "1d9a226c-defb-4475-bbea-abfbb64bb691"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
affectedPaths:
    - "src/ui/workspace/server.js"
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
    - "src/ui/workspace/islands/SessionSurface.jsx"
    - "src/plan-store.js"
    - "src/plan-front-matter.js"
    - "src/shared/workflow/"
    - "src/shared/session/session-sidebar.ts"
    - "src/shared/session/session-runtime.js"
    - "src/ui/tui/session-sidebar.ts"
    - "src/ui/tui/chat-view.ts"
    - "src/ui/tui/runtime-interaction-adapter.js"
    - "src/cmd/load-plan/"
    - "docs/prd/runwield-workspace-prd.md"
    - "docs/design-system.md"
    - "docs/domain-language.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "pair"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-09-03T00:54:13.050Z"
status: "ready_for_work"
origin: "internal"
parentPlan: "personal-remote-workspace-v2"
order: 3
dependencies:
    - "01-durable-plan-to-session-continuity"
userVerifiedAt: null
---

# Plan-Centered Workspace Home and Navigation

## Context

The current Workspace home redirects from `/` to the last Session, and the sidebar treats Sessions as the main objects.
This hides the work that needs the owner and makes Plans hard to find. The current owner sidebar also uses one
all-or-nothing `Promise.all`, so one damaged Project can fail the full response.

The standalone Plan Progress page does not help the owner advance work. Session Workflow sidebars in Workspace and TUI
show basic labels, not the workflow, its current step, or a useful next action. Replace that separate page with an
actionable workflow diagram in the Session's Workflow sidebar and on the Plan's existing home page.

Current-source review found that owner `/` is served by `src/ui/workspace/server.js`; Astro's `pages/index.astro` is
also used by the local Plan Board. Workspace derives partial stages in `islands/SessionSurface.jsx`; the shared Session
sidebar projection and TUI renderer do not yet carry them. `ArtifactConversationSidebar.tsx` is review chat, not the
Workflow sidebar. Complexity is High: this connects browser and TUI workflow views, existing actions, and reliable
recent completion evidence.

## Objective

Make the Attention Dashboard the Workspace home. It groups Plan-centered work into Needs You, Ready to Continue, In
Progress, and Recently Finished. Open Plans lead Project navigation, with associated Sessions nested under Plans.
Standalone Sessions follow.

Dashboard and left navigation rows open the owning Plan, review, Session interaction, or Project surface. They remain
navigation-only.

The right **Workflow** sidebar in both Workspace and TUI shows a connected workflow diagram, the current step, what
blocks it, and a clear next action. The Plan home shows the same workflow beside the readable Plan and offers a link to
the current working Session. Actions use existing review, question, execution, and recovery flows; they do not create
another workflow engine. This owner feedback replaces the earlier restriction that detailed stages appear only in a
Session.

Owner decisions on resume: actionable child Plans appear on the Dashboard; Sequence containers remain in navigation and
do not add duplicate Dashboard rows. Child 04 owns search, its visible button, shortcuts, and index diagnostics. This
child ships no inactive Search button. The Epic's four Dashboard categories govern this slice; broader PRD categories
such as Pinned and Running Quietly are not added here.

## Approach

Compose existing canonical readers on the server and render one compact home view. Keep workflow truth in Plan,
controller, worktree, and Session files.

```text
registered Projects
  canonical Plan and workflow readers
  Session association, activation, and live Workspace interactions
  per-Project failure isolation
  Dashboard categories and Plan-first sidebar
  owning destination opens for action
```

Owner `/` renders the Dashboard through the existing owner server and shared Workspace shell. A focused server reader
composes current evidence for both Dashboard and sidebar. It reuses `loadOwnerPlanProgress` authority selection, but not
its status-only activity guesses or its rejection of all PROJECT Plans. Use `src/shared/project-plan.ts` to distinguish
Epics from Sequences. Resolve associated Sessions through child 01's committed Plan Association reader, never by names
or a string search in workflow context.

Extend shared workflow presentation under `src/shared/workflow/` and `src/shared/session/session-sidebar.ts`. Combine
canonical Plan/controller/worktree evidence with available live validation and interaction facts. This presentation owns
steps, connections, current step, blocker, and semantic next action. Browser/TUI renderers choose layout and route/focus
actions; they do not each map statuses to steps. A question blocks its current step rather than becoming a fake
lifecycle step. Repairs show their return to the failed check. Epics and Sequences show their own review, decomposition,
or child-work flow, not invented execution stages.

```text
Canonical workflow evidence + live validation/interactions
                    Shared workflow presentation
                      /                    \
             Runtime snapshot          Owner read API
                    |                 /             \
             TUI Workflow pane   Workspace pane   Plan home
                    |                 |              |
                         Existing action flows
```

Keep the authenticated progress JSON endpoint as read data. Reuse one browser workflow component in the Session sidebar
and Plan home; remove the separate HTML page and its links. Keep the Plan's existing URL and live review query mode.
Proposed layout: document pane on the left; diagram, blocker, action and current Session link above metadata on the
right. Check it with the owner during Pair execution. Do not expand into owner Plan editing or reuse local-only
editor/lifecycle endpoints.

For live Plan Review or Code Review, use the current interaction's review URL. Answer agent focuses the existing
question/prompt; it does not make another form. Run/Resume/Recover enters existing Plan continuation in the selected
Session and retains its confirmations; it must do more than open an idle conversation. Recheck Plan/action and
interaction evidence at use time. If a wait ended, refresh instead of replaying it. The TUI uses its existing
interaction/browser-opening adapters and a visible keyboard action hint without taking Enter, Escape, or Ctrl+C away
from their current owners.

Exact committed associations and current workflow/activation identify the working Session. A unique current match gets
**Open Session**; multiple eligible matches get the existing selection flow, not an arbitrary latest Session. No match
uses child 01's deliberate Plan-only continuation when the owner selects an action; reads create nothing. Approval that
starts work still opens the returned owning Session.

Use existing completion dates where valid. Add the missing manual-closure date and retain proven publication time in the
existing controller record before cleanup removes the worktree registry entry. This is not a new history store.

The option set aside is keeping the Session-first sidebar and adding a separate Dashboard link. That is less code, but
it leaves the main continuity problem in place. Search remains a complete follow-on slice instead of a dead control.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/ui/workspace/server.js`, `layouts/WorkspaceLayout.astro`, and `static/workspace-shell.ts` under
  `src/ui/workspace/` — render the owner Dashboard, add its stable navigation action, stop home redirection, and render
  Plan-first Project navigation. Preserve local `pages/index.astro` Plan Board behavior.
- `src/ui/workspace/routes/owner-api.js` — return per-Project sidebar and Dashboard data without one damaged Project
  failing all healthy Projects.
- `src/ui/workspace/server/owner-plan-progress.ts` and `src/shared/workflow/` — share workflow interpretation for
  Dashboard summaries and the actionable diagram, including planning, live gates, and container-appropriate steps. Reuse
  `validation-progress.ts` and `validation-progress-presentation.ts` without losing human review/repair detail.
- `src/shared/session/session-sidebar.ts`, `session-runtime.js`, and runtime snapshots/events — expose the shared
  workflow view with validation progress and existing active interactions. No second interaction store or controller
  mutations during reads.
- `src/ui/tui/session-sidebar.ts`, `chat-view.ts`, `runtime-adapter.js`, and `runtime-interaction-adapter.js` — render
  the diagram, connect live progress, and make its next action keyboard-usable through existing prompts/review URLs.
  Expose Code Review URL availability like Plan Review, without starting another interaction.
- `src/cmd/load-plan/index.ts` and continuation/recovery helpers, where needed — connect explicit actions to the
  established Plan/Session selection and continuation path, not new raw lifecycle commands.
- `src/ui/workspace/server/owner-projects.js` and `src/ui/workspace/server/session-continuation.js` — compose Project
  health, Plan summaries, associated Sessions, standalone Sessions, and diagnostics.
- `src/ui/workspace/pages/`, `components/`, `islands/`, and `react/` — add the responsive Attention Dashboard and
  Plan-first navigation UI using RunWield design-system patterns.
- `src/ui/workspace/react/PlanProgressSurface.tsx` and
  `src/ui/workspace/pages/projects/[projectId]/plans/[planId]/progress.astro` — remove the standalone progress surface
  and its routes.
- `src/ui/workspace/islands/SessionSurface.jsx` and a shared browser workflow component — replace partial local stages
  and Open progress with the diagram. `islands/SessionTimeline.jsx` — make the existing question a focusable
  destination.
- `components/PlanDetail.jsx`, `pages/projects/[projectId]/plans/[planId].astro`, and `server/astro-owner-data.js` under
  `src/ui/workspace/` — add the Plan-home workflow, next action, and working-Session link beside the readable document.
  Preserve local Plan Board capabilities and embedded Plan Review mode.
- `src/ui/workspace/react/PlanReviewSurface.tsx` and `pages/dev/plan-progress.astro` — replace obsolete progress-page
  destinations/fixture. Add Plan-home and Session-workflow cases to the Surface Lab. `ArtifactConversationSidebar.tsx`
  is review chat and needs no planned change.
- `src/shared/workflow/plan-lifecycle.js`, `src/plan-front-matter.js`, `src/plan-store.js`, and
  `src/shared/workflow/execution-plan-file.js` — persist manual closure time as human lifecycle history; preserve it
  through Plan parsing, writes, and execution-Plan reconciliation. Preserve Epic completion time on repeat completion.
- `src/shared/workflow/publication-machine.ts`, `validation-publication.ts`, and existing controller records — preserve
  the verified publication date before registry cleanup, including retry/restart paths. No new publication protocol.
- Workspace navigation, owner-server, progress integration, lifecycle, Plan serialization, and publication tests — prove
  the new home while keeping the existing Session, delivery, and local Plan Board behavior.
- `docs/design-system.md` — document the shared workflow diagram/action pattern, Plan-home layout, and new Dashboard or
  nested navigation patterns not already covered.
- `docs/domain-language.md` — align Dashboard categories and Workflow sidebar/Plan-home relationships with behavior; do
  not define a new lifecycle because a diagram was added.
- `docs/prd/runwield-workspace-prd.md` — record the Plan-home and Session Workflow sidebar outcomes from this feedback.
  Keep implementation details here and leave child 04's search work there.

When the implementation makes proposed domain language true, include the applicable domain-language file:
`docs/domain-language.md` for a single-context project, or the context-specific `domain-language.md` identified by
`docs/domain-language-map.md` for a multi-context project.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/server/owner-projects.js` — registered-root eligibility and browser-safe Project projection.
- `src/ui/workspace/server/session-continuation.js` — stable Session listing and activation state.
- `src/ui/workspace/server/owner-plan-progress.ts#loadOwnerPlanProgress` — joined Plan, controller, worktree,
  validation, delivery, and Session evidence.
- `src/shared/session/plan-session-lookup.ts` and `src/ui/workspace/server/owner-plan-sessions.ts` — child 01's proven
  Plan Association lookup. Check the current exports before wiring the navigation reader.
- `src/shared/session/session-transcript-projection.js#summarizeProjectedEntries` — workflow and Plan association data
  from committed Session evidence. Do not call `timeline()` to list Dashboard rows: it can initialize a generation.
- `src/shared/workflow/plan-lifecycle.js` — Plan status and lifecycle vocabulary.
- `src/shared/workflow/validation-progress.ts` and `validation-progress-presentation.ts` — live checks, human review,
  repair, and outcome labels. `HostedSession.getActiveInteractions()` owns current waits.
- `src/ui/workspace/server/session-continuation.js` — live review URLs and checked answers, including its existing
  forwarding for reachable TUI-owned interactions. This is distinct from Dashboard question scope.
- `src/ui/tui/runtime-interaction-adapter.js` — existing prompts and review opening, not duplicate interactions.
- `src/ui/design-system/` — existing Workspace cards, rows, badges, status labels, focus behavior, and responsive shell
  patterns.

## Implementation Steps

- Owner `/` renders the Attention Dashboard and no client code redirects it to the last Session or first Session.
  Dashboard is a stable top navigation link. The local Plan Board retains its own home. Empty Workspace and empty
  categories show clear empty states with links to existing Project/Session surfaces, not automatic navigation.
- Dashboard rows classify Plans once into the highest applicable category with precedence Needs You, Ready to Continue,
  In Progress, then Recently Finished.
- Needs You includes Plan review, Workspace-hosted Agent questions from this server, human review, recovery, failed
  validation, and damaged enabled Projects. Browser alerts do not create Dashboard items.
- Ready to Continue includes Plans whose current readiness evidence permits execution, approved Epics ready for
  decomposition, and interrupted workflows with safe continuation. Approval alone does not imply executable readiness.
  Sequence containers are navigation-only; their eligible child Plans receive ordinary Dashboard classification.
- In Progress includes active Agents, execution, tests and CI, AI code review, repair, and delivery. Status alone must
  not label a stopped execution as running. Current activation, checkpoint, and worktree/publication evidence decide
  whether work is active, can safely continue, or needs owner judgment. Use only this server's live local operations for
  Workspace questions; exclude remote operation mirrors and old completed interactions.
- Recently Finished includes eligible completed Plans from the last seven days, newest first, capped at ten across
  Workspace and five from any one Project. Apply eligibility and age before caps; use stable identity to break ties.
  Dates come from the applicable terminal outcome, not `updatedAt`, file modification time, or a Dashboard read:
  - `user_verified`: `userVerifiedAt`; manual closure: `closedWithoutVerificationAt`.
  - completed Epic: `epicDoneEnoughAt` and matching current completion mode/status.
  - verified delivered work: controller `verifiedAt` with matching completion evidence; non-Git completion can use
    `validatedAt` with the existing matching non-Git delivery evidence.
  - `validated` alone is insufficient: pending publication remains active or resumable; publication failure Needs You.
    Do not infer successful delivery from a missing registry entry.
- `manual_closed_without_verification` stamps `closedWithoutVerificationAt` through Plan Lifecycle. The field survives
  canonical document saves and execution-Plan reconciliation. Repeat completion of the same terminal outcome preserves
  its date, including `epic_done_enough`. Actual reopen and later completion use the new applicable outcome; an old
  retained timestamp cannot make an active Plan recent. Undated legacy records are not backfilled during reads.
- Verified publication retains its existing publication `verifiedAt` in the current Plan controller before registry
  pruning. Both normal cleanup and restart from `publication_verified` or `cleanup_complete` preserve the same date. The
  write uses existing publication proof and controller ownership; it neither changes Plan status nor rewrites the
  published Plan. Pending, failed, or stale attempts cannot produce current completion evidence.
- On-Hold Plans and ordinary idle Sessions stay out of the Dashboard and remain available in navigation (and child 04's
  search). Archived Plans and files without valid durable Plan identity do not supply rows. An unassociated Session
  appears only for a live local question or active Agent, linking to that Session rather than a guessed Plan.
- Sidebar Project navigation initially shows at most five nonterminal Plans before standalone Sessions, orders active
  work by the Dashboard category order and latest update, and places muted On-Hold Plans after active work.
- Each Plan initially shows at most two proven associated Sessions, ordered by latest committed activity. Uncertain
  name-only matches are not nested. Association is scoped by registered Project and durable Plan ID. Reuse the same
  stable Session URL when one Session belongs under several Plans; do not list it again as standalone. Standalone
  Sessions follow by latest committed activity. Do not loosen Project-root access checks to force a match.
- Show more expands additional Plans or Sessions in place, including the associated Session list. The Plan Board link is
  not used as sidebar overflow. Expanded lists, selected rows, and keyboard focus survive data refresh.
- Dashboard and sidebar isolate unreadable roots, invalid/missing Plan identity, and damaged Session projections per
  Project, including failures in Project health enumeration. Healthy Projects still render. A damaged enabled Project
  appears in Needs You based on registration lifecycle, even when its health-derived `enabled` flag is false. Disabled
  or removed Projects do not supply Dashboard work. Each diagnostic names the failed reader and gives browser-safe
  evidence and the existing Project repair destination. Listing never assigns Plan IDs or repairs Session files.
- A visible loaded Dashboard reflects canonical workflow changes and local question creation/resolution within five
  seconds, without reload or cache clearing. Use one bounded refresh loop for the mounted Dashboard, alongside existing
  shell events; stop it on navigation and refresh on visibility return. Prevent overlapping/out-of-order responses from
  replacing newer data. Other pages need no new sidebar polling loop. Failed refresh shows an error without silently
  presenting old data as current or discarding healthy Project results.
- `src/shared/workflow/workflow-presentation.ts` owns the evidence-to-diagram decisions and exports a typed builder used
  by runtime snapshots and owner reads. Its inputs are workflow facts, not steps/current-node/blocker/action already
  chosen by a host. The full diagram rules no longer live in owner `deriveStages`, Workspace
  `deriveWorkflowSidebarStages`, or a TUI status mapper. Host code loads facts, renders results, and executes semantic
  actions through its existing adapter. Re-exports or a pass-through shared wrapper do not satisfy this step.
- One shared workflow presentation derives connected steps, current step, blocker, and available next action from
  current evidence. It covers planning/Plan Review, execution readiness, execution, tests and CI, AI code review, human
  review when required, repair/return paths, delivery, and completion. Optional/skipped steps are not shown as pending
  blockers. An Agent question blocks the actual current step. Missing live facts are shown as unavailable, not as a
  fabricated review/question. Epics/Sequences use their own workflow; no container is presented as executable.
- Workspace and TUI Sessions attached to a Plan render that presentation in the right sidebar's Workflow tab. The
  diagram has visible connections and a distinct current node, completed/upcoming state, plain blocker text, and a
  labeled available action. It is not the existing status badges renamed as a diagram. Both receive live validation and
  interaction changes; a saved associated Session also shows known workflow evidence when no Agent is active.
- The existing Workspace Plan detail URL is the Plan home: readable Plan plus the same workflow diagram, next action,
  and current Session link/selection. The Plan document is still usable while workflow evidence loads or fails. Keep the
  embedded review query mode and local Plan Board's read/edit/action behavior. Do not build another progress route.
- **Review Plan** and **Review code** open the existing exact live review. **Answer agent** focuses the existing prompt
  or question, including an interaction anchor reached from Plan home. TUI actions reopen the existing review URL or
  focus the existing prompt. They never create a second pending interaction or accept a decision without the user.
- When no live interaction owns the next step, **Run**, **Resume**, or **Recover** enters the existing Core Plan
  continuation/recovery flow through the chosen Session. The flow performs current readiness, revision, worktree and
  Session checks and required choices. Clicking the action must reach that flow, not just navigate to an idle Session.
  Do not use the generic lifecycle `move_status` operation as a substitute for running or recovering work.
- Each action resolves current Project, Plan, Session, operation and interaction evidence as applicable before use.
  Stale/resolved waits refresh and explain the change without replay. Buttons cannot silently switch an unrelated
  Session, queue synthetic work into an active Session, or bypass existing writer/action checks. An active Session
  without a current owner action offers Open Session and explains that work is running.
- The TUI action has a visible keyboard hint, uses the established key/input system, and is operable without changing
  the composer draft. Key choice must avoid existing bindings and be checked at the Pair checkpoint. Preserve Ctrl+] tab
  cycling, Enter submission/prompt behavior, Escape cancellation, and Ctrl+C clear/exit. Repeated/released keys do not
  run the action again. Narrow terminals retain existing prompt/review access when the right sidebar is hidden.
- The standalone Plan Progress HTML route, `PlanProgressSurface`, its dev page, and Open/View progress links no longer
  serve a separate progress screen. Keep the authenticated JSON data endpoint. Detailed diagrams appear only on Plan
  home and Session Workflow sidebars; Dashboard/left navigation remain compact read-only summaries. Approve & Run opens
  its owning Session; Dashboard review/question rows open their existing owning interaction.
- Dashboard and sidebar APIs expose reads and destinations only; mutation still goes through existing Session Runtime
  and Plan action paths.
- The Dashboard uses compact shared rows/panels, `--rw-*` tokens, existing theme support, and the Workspace header and
  drawer. Status has text, not color alone. Links, expansion buttons, loading/error states, and long names remain usable
  by keyboard and phone. Child 04's Search control is absent until its real search experience exists.
- `docs/design-system.md` documents the reusable workflow diagram/actions and Plan-home layout alongside other new
  patterns. `docs/prd/runwield-workspace-prd.md` records that the owner sees current workflow, blockers and next actions
  on Plan home and in a Session Workflow sidebar.
- `docs/domain-language.md` describes implemented Dashboard category language, avoided aliases, and Plan/Session/live
  interaction relationships. Clarify that Plan home and Workflow sidebar display one workflow, not separate authority.

## Approval Confirmation

No Work Record supersession is proposed.

## Verification Plan

### Automated evidence

Add the Dashboard/navigation portion of `src/ui/workspace/personal-remote-workspace-v2.acceptance.test.ts` (not present
at planning time). Use real registered Projects, `defineGitFixture`/`makeValidationProjectRoot`, canonical
Plan/controller/worktree readers, and file-backed Sessions. Fake only external boundaries such as model turns and
clocks; do not inject replacement lifecycle, Plan-write, registry, or association readers.

- Through production owner endpoints, assert exact Plan IDs, categories, order, destinations, and one row per Plan.
  Cover Plan review, local question, human review, validation failure, safe paused continuation, active execution, tests
  and CI, AI code review, repair, publication, ready Epic, ready child of a Sequence, and terminal outcomes. Combine a
  live question with active execution to prove Needs You wins. An idle draft is not a pending Plan review. Assert
  Sequence containers are absent from Dashboard but available in navigation. Cover active and question-waiting
  unassociated Sessions as Session rows; idle, archived, and On-Hold cases are absent. A saved stop notification or a
  question owned by a separate terminal/ACP process must not create a Dashboard question.
- Advance real workflow evidence after the first read: ready → active → waiting for human review → completed. Also
  create and resolve a live question through the Workspace operation path. Assert category/destination changes, not just
  timestamps. A status-only mapper or cached first response must fail these tests.
- Exercise actual lifecycle/publication writers for completion dates, then save unrelated Plan content and restart
  readers. Assert dates and ordering do not change. Cover repeated Epic completion, reopen, undated legacy closure, a
  newly closed Plan, failed/pending publication, successful registry cleanup, and restart from both cleanup phases. Use
  dated fixtures around the seven-day boundary and enough Plans in two Projects to prove ten-total/five-per-Project
  limits. Changing `updatedAt` on an old Plan must not make it recent. Complete a second attempt after reopening: the
  first attempt's retained controller date must not finish the new attempt or determine its eventual completion date.
- Use same-named Plans in two Projects, committed associations for more than two Sessions, one shared Session for
  several Plans, and name-only legacy context. Assert stable, Project-correct URLs, initial limits, nested versus
  standalone membership, On-Hold placement, and in-place expansion beyond five Plans/two associated Sessions.
- Introduce real source failures separately: missing registered root, missing/duplicate Plan ID, malformed Plan, and
  corrupt Session transcript. The healthy Project remains usable in each case, with a source-specific diagnostic for the
  failed Project. A disabled Project does not create a Needs You row. Search-index failure belongs to child 04.
- Snapshot canonical Plan, Session, and controller state before and after repeated GETs, including legacy fixtures.
  Assert no identity assignment, Session initialization, or workflow mutation. POST attempts to the new read endpoints
  cannot execute lifecycle actions or submit messages. Existing owner authentication and root checks still apply.
- Mounted browser coverage proves that externally changed Plan/controller/worktree evidence and question resolution
  update the visible home within five seconds, without navigation/reload. Assert one refresh loop, no overlapping reads,
  no stale response overwrite, and cleanup after navigation. Endpoint-only freshness is insufficient.
- Drive production runtime snapshots and owner reads through planning, live Plan Review, execution, tests and CI, AI
  code review, human review, repair and return, delivery, and completion. Assert the shared semantic steps, connections,
  current node, blocker and action are equal across TUI, Workspace Session and Plan home for the same evidence. Test
  optional/skipped review, saved idle Session, Epic/Sequence, and missing live facts. Render assertions must check
  connections/current marker and real labels; a constant diagram or pass-through of Plan status must fail. Test the
  shared builder directly with raw evidence as well. During Semantic Review, trace production callers and inspect the
  builder inputs/implementation: the decisions must live in shared code, not identical host mappers hidden behind a
  pass-through. Cross-surface equality alone does not prove shared ownership.
- Open a live Plan Review and Code Review from each applicable Workflow action; assert the same operation/interaction is
  used. Answer agent must focus the real prompt and its answer must advance the waiting workflow once. Test from Plan
  home, Workspace sidebar, TUI, and a reachable TUI-owned interaction in Workspace. Preserve the narrower local question
  rule on the Dashboard. No test may replace the owned interaction/action dispatch with a success stub.
- Exercise Run/Resume/Recover through the production continuation path. Assert workflow progress or its existing
  required choice, not only navigation. Cover no Session, multiple matches, active match, stale revision/generation,
  ended interaction, repeated click, and worktree failure. No guessed Session, bypassed confirmation, duplicate review,
  synthetic queued resume, or direct status mutation is permitted.
- TUI input tests invoke the displayed action, reject key repeats/releases, preserve draft and focus, and protect
  Ctrl+], Enter, Escape and Ctrl+C. Verify the current node/blocker/action fit the supported sidebar width and short
  terminal layout. Keep prompt access intact when the sidebar is hidden.
- Request the old HTML progress route and assert it serves no separate progress screen. Render Plan home and a real
  Session through the retained JSON data endpoint and assert diagrams/actions update. Inspect route registration and
  page composition to exclude a replacement third progress page. Plan Markdown remains readable through workflow
  loading/failure, and local Plan editing/review modes remain covered. Deleting progress data must fail these tests.

Run through the sandboxed runner (never direct `deno test`):

```sh
deno run -A scripts/run-tests.js src/ui/workspace/personal-remote-workspace-v2.acceptance.test.ts src/ui/workspace/owner-workspace.test.js src/ui/workspace/workspace-shell-navigation.test.ts src/ui/workspace/workspace-session-ux.test.tsx src/ui/workspace/workspace-plan-review-ux.test.tsx src/ui/workspace/workspace-plan-progress.integration.test.ts src/ui/workspace/workspace-local-server.test.js
deno run -A scripts/run-tests.js src/shared/workflow/plan-lifecycle.test.js src/shared/workflow/publication-machine.test.ts src/shared/workflow/publication-machine.e2e.test.ts src/shared/workflow/publication-machine.failure-matrix.test.ts src/shared/workflow/validation-publication.test.ts
deno task workspace:check
deno task seams:check
```

Also run:

```sh
deno run -A scripts/run-tests.js src/shared/session/session-sidebar.test.ts src/ui/tui/session-sidebar.test.ts src/ui/tui/runtime-interaction-adapter.test.js src/ui/workspace/session-continuation.integration.test.ts src/cmd/load-plan/index.integration.test.ts src/cmd/load-plan/plan-recovery-flow.test.ts
```

Run new shared workflow-presentation tests and changed runtime, Plan detail/editor, parsing/serialization tests too; run
`deno task ci` at Epic integration. Wrap HOME/cwd mutation tests with `withProcessGlobalTestLock`; use
`getHomeDir()`/`getCwd()`.

**Protect existing behavior:** paired-device access, registered-root confinement, Session Writer Lock and committed
history, direct Plan/Session URLs, messages, Plan review and Feedback, Approve for Later, Approve & Run, recovery,
publication proof/retry/cleanup, live validation detail including human review/repair, TUI prompt/key behavior, and
local Plan Board editing/actions. Rewrite old-shape tests against these retained boundaries rather than deleting
coverage.

**Behavior that stops:** home auto-redirect; Session-only Project navigation; all-or-nothing cross-Project failure;
standalone progress HTML/links; label-only TUI workflow and the partial Workspace stage list; and the blanket
source-text ban on refresh timers where the mounted Dashboard now needs bounded refresh. Do not introduce left-sidebar
polling on unrelated pages.

### Headed-browser evidence and Pair checkpoint

Run `deno task workspace:dev`; add Dashboard and nested-navigation fixtures linked from `/dev` at
`http://127.0.0.1:5173`. Use `agent-browser --headed` with a worktree-specific session. At desktop (1440×900) and phone
(390×844), check the four category headings, long/same-named Plans with Project labels, compact rows,
empty/loading/error states, selected navigation, Show more, drawer open/close, keyboard focus and focus return. Check
light/dark themes and reduced motion. No horizontal page overflow, hidden destinations, or color-only state. Capture
screenshots and inspect browser console/network failures. At Pair checkpoints, show the Dashboard/navigation first, then
Plan home and the shared diagram in Workspace and TUI. Confirm current-step emphasis, blocker wording, diagram density
and next-action placement before polish. These checkpoints refine layout; they do not replace behavioral tests.

Then exercise the real paired owner server, not only fixtures, with at least two registered Projects containing review,
ready, active, finished, On-Hold, Sequence-child, standalone idle, and live-question cases plus one Project failure.
Seed a remembered Session, open `/`, and confirm it stays home. Follow each category's row to its owning surface, return
with browser Back, expand lists, and change evidence while home stays open. Verify the five-second visible update and
healthy Project access during failure. Verify a direct Session URL, Approve & Run landing in that Session, and its
workflow diagram. On Plan home, read the Plan, open the same Plan Review/Code Review, answer a question through its
Session destination, and jump to the proven working Session. Compare its step/blocker/action with the Session sidebar.
Exercise Run/Resume/Recover and confirm the existing flow starts or presents its required choice. Resolve an interaction
elsewhere before clicking its old action and confirm safe refresh. Open the local Plan Board separately and confirm its
home and editing still work.

Use a real TUI Session with a Plan at wide and narrow terminal widths. While a turn runs, review starts, a question
waits, and repair returns to a check, confirm the Workflow pane updates from runtime facts. Use its displayed keyboard
action to reopen the existing review or focus the existing question; answer it and observe workflow progress. Preserve
typed composer text and all existing cancellation/exit keys. When the pane is hidden, normal prompts still work.

Expected result: the owner sees what needs them, follows a working link to act, and does not inspect every Project.
Semantic Review must compare the category/evidence tests, real-server journey, and route changes with these outcomes,
and confirm that glossary and design-system updates describe only behavior delivered here.

## Edge Cases & Considerations

- A damaged Project must produce a source-specific diagnostic, not a generic degraded card with no reader evidence.
- Legacy closed Plans without immutable terminal-time evidence remain searchable but do not enter Recently Finished.
- A Session with no proven Plan association appears on the Dashboard only when it has a live Workspace question or is
  actively running. Notifications are independent of Dashboard classification.
- Dashboard questions remain limited to this server's local operations. A contextual Session/Plan-home action may use
  the existing live connection to a TUI-owned interaction. That does not make its wait durable or add remote questions
  to the Dashboard. If the owner process disappears, show the existing interrupted/unavailable state, not a replay CTA.
- Plan home is the existing Plan detail, not a new stored domain object. Workflow diagrams display existing lifecycle
  and live interaction facts; they cannot make an unavailable action safe.
- Preserve the Workspace-header notification permission control when present. Navigation can ship independently of
  browser notifications.
- Direct Plan and Session URLs must keep working.
- Local Plan Board behavior remains protected even though the owner Workspace home changes.
- Child 01's association lookup is a prerequisite, not permission to match execution-worktree Sessions by path prefix or
  Plan name. Test any worktree-root Session destination against proven registered-Project membership. If the current
  association reader cannot prove that membership, show the existing diagnostic/Plan destination; do not relax access.
- Legacy completed Plans without enough retained delivery/date evidence remain accessible in Plan Board and later
  search, but are absent from Recently Finished. The Dashboard must not manufacture that evidence.
