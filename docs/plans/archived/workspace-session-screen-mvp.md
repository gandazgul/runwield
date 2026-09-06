---
planId: "4e027c8b-e973-4157-bc9b-b9e2d7d29315"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
affectedPaths:
    - "docs/design-system.md"
    - "src/ui/workspace/pages/projects/[projectId]/sessions/"
    - "src/ui/workspace/islands/SessionSurface.jsx"
    - "src/ui/workspace/components/SessionList.jsx"
    - "src/ui/workspace/components/SessionTimeline.jsx"
    - "src/ui/workspace/components/SessionActivationStatus.jsx"
    - "src/ui/workspace/server/session-continuation.js"
    - "src/ui/workspace/routes/owner-session-api.js"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/static/workspace.css"
    - "src/ui/workspace/workspace-session-ux.test.tsx"
    - "src/ui/workspace/session-navigation.integration.test.ts"
    - "src/ui/workspace/session-continuation.integration.test.ts"
    - "src/ui/workspace/owner-workspace.test.js"
executionAgent: "frontend-engineer"
collaborationRecommendation: "pair"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-08-26"
status: "validated"
origin: "internal"
userVerifiedAt: null
workRecord:
    status: "generated"
    recordId: "45854a6d-ab07-4fd5-9efc-fa2be4b9f31e"
    path: "docs/work-records/2026-08-28-workspace-session-chat-mvp-verified.md"
    lastAttemptAt: "2026-08-28T20:50:30.479Z"
archivedAt: "2026-09-05T04:21:54.347Z"
archivedFromStatus: "validated"
archivedFromPath: "docs/plans/workspace-session-screen-mvp.md"
targetBranch: "main"
---

# Workspace Session Screen MVP

## Context

`docs/prd/runwield-workspace-session-screen.md` defines a complete browser sibling for the terminal user interface
(TUI), but that full product is too large for one executable Plan. A later Epic will cover intent cards, slash and `@`
completion, queue and Steer controls, the full Workflow Rail, recovery flows, sharing, export, and complete TUI
capability parity.

This Plan delivers the smaller product that must exist first: a reliable browser chat surface for starting and
continuing a Session. The current `SessionSurface.jsx` already calls the canonical `SessionRuntime` path, preserves
committed Session history, polls Workspace operations, retains existing-Session drafts and images, and respects
single-writer Session Control. The UI is still not usable as a primary chat surface:

- New Session is a form above the Session catalog and does not reliably follow creation to the minted Session.
- The detail screen leads with a large technical summary instead of the conversation.
- generic Pending Structured Interactions use `globalThis.prompt()` and omit required answer identity fields;
- timeline updates always force the viewport to the bottom;
- tool calls are noisy individual cards;
- Busy state does not refresh into an available composer without a page reload;
- active work has no browser Stop action or Escape cancellation;
- Agent, model, and thinking level are disclosures rather than controls.

The user selected a reliable conversation MVP plus Agent, model, and thinking controls in New and Existing Session
states. Router is the New Session default. An explicit Agent selection sends the first User Request directly to that
selectable Agent. Browser configuration is Session-specific and must not change Project defaults. Runtime semantics are
the baseline, but the browser can use better controls and must respect cross-surface Session Control constraints.

OpenChamber at <https://github.com/openchamber/openchamber> (reference checkout commit
`926ae48b603135633f0e3c6aec057cf978c6388c`) supplies interaction-design precedent, not code or architecture. Its useful
patterns are one chat shell before and after Session creation, composer-level model controls, inline question cards,
compact activity groups, complete failed-send restoration, and user-owned scroll following. RunWield keeps its own
React/Astro architecture, semantic `--rw-*` tokens, domain language, Runtime authority, and security boundaries.

## Objective

- Make `/projects/:projectId/sessions/new` and `/projects/:projectId/sessions/:runwieldSessionId` two states of one
  responsive Session chat shell.
- Mint a Session from the first User Request, show honest creation progress, and replace the New Session URL with the
  stable Session URL as soon as the operation reports the committed RunWield Session ID.
- Let users select a Session Agent, model, and supported thinking level from accessible browser controls in both states.
- Make the timeline readable by prioritizing User Requests and Agent responses, grouping technical activity, preserving
  user scroll control, and distinguishing committed history from temporary live Workspace events.
- Replace generic browser prompts with inline text, choice, approval, and **Other** controls for Workspace-owned live
  interactions while preserving the dedicated Plan review flow.
- Preserve drafts and image previews through Busy periods, refreshes, failed sends, stale-generation conflicts, and
  creation failures.
- Let the owner cancel a Workspace-owned active operation with Escape or a visible **Stop** action through
  `SessionRuntime.cancelSession()`.
- Keep the current canonical Plan progress view as a limited secondary surface. Do not claim that it is the complete
  Workflow Rail from the PRD.

## Approach

The Session catalog becomes navigation only. Its **New Session** action opens the unminted state of the same chat shell
used for committed Sessions. Do not create a second composer implementation.

```text
/projects/:projectId/sessions/new
  SessionSurface mode="new"
  project-scoped draft + Session option catalog
  first User Request
    POST /api/owner/projects/:projectId/sessions
    WorkspaceSessionContinuationService.createSession
    SessionRuntime.createInteractiveSession (deferred managed activation)
    apply selected model and thinking to the pending Session
    promptUserTurn(selected Agent; Router by default)
  poll creation operation
  committed runwieldSessionId
  history.replaceState(.../sessions/:id)
  load committed timeline in the same chat shell
```

New Session Agent, model, and thinking choices are launch configuration for that Session. They initialize from Router
and the current Project defaults, but browser selection does not persist a new Project default. The creation request
hash includes all launch configuration so retrying one `requestId` cannot silently create a differently configured
Session. Workflow-only Agents are never selectable.

Existing Session configuration stays behind Runtime and generation authority:

```text
select Agent | model | thinking
  Project-bound owner API
  verify complete projection + exact generation + Session Control
  adopt managed Session
  call SessionRuntime switch/reconfigure/thinking operation
  commit transcript event and generation
  refresh snapshot
```

A successful manual Agent change uses the established user-switch behavior, including release of active workflow
ownership. A failed change preserves the current Agent, model, thinking level, and workflow. Model and thinking changes
remain Session-specific even though the TUI can also persist Project defaults.

For a Workspace-owned active operation, thinking can change immediately when the active model supports it. Agent and
model choices can be staged for the next safe idle boundary and must display **Applies after this response** until
committed. The service, not component-local presentation state, owns the pending change for the life of that operation.
When another surface owns the Session, all configuration controls are disabled with the Busy explanation; Workspace must
not create a cross-surface queue. Normal queued User Requests and Steer remain deferred.

The timeline follows a simple browser chat model rather than the current card stack:

- User Requests receive restrained visual emphasis.
- Agent Markdown is the primary reading surface and does not sit inside a heavy card.
- live thinking and tool calls remain visible as compact lines;
- contiguous completed technical activity becomes one collapsed **Activity** group with original tool names, useful
  arguments, output, and errors available on expansion;
- inline interactions sit at the live end of the conversation, immediately above the composer;
- scroll follows only while the user remains at the live edge. A real upward scroll gives control to the user and shows
  a **Latest activity** action instead of moving the viewport.

Use OpenChamber only as a design reference. Do not import it, add it as a dependency, copy its stores, or attempt its
virtualized timeline. The option set aside is full TUI parity in this Plan; it would mix several new command, file,
workflow, sharing, and history APIs into the foundation before the basic conversation surface is trustworthy.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/ui/workspace/pages/projects/[projectId]/sessions/index.astro` — keep the Session catalog and provide a clear New
  Session navigation action instead of embedding the first-User-Request form.
- `src/ui/workspace/pages/projects/[projectId]/sessions/new.astro` — add the unminted route over the shared React
  Session shell.
- `src/ui/workspace/pages/projects/[projectId]/sessions/[runwieldSessionId].astro` — reduce technical page chrome so the
  shared Session shell owns the conversation hierarchy.
- `src/ui/workspace/islands/SessionSurface.jsx` — remain the browser orchestration boundary for catalog/timeline loads,
  drafts, operation reconciliation, availability refresh, configuration, cancellation, and New-to-Existing transition.
  Extract new cohesive visual components instead of adding every control to this already broad file.
- `src/ui/workspace/components/SessionList.jsx` — remove the embedded creation form and retain loading, error, empty,
  catalog, pagination, and New Session navigation states.
- New focused `.tsx` components under `src/ui/workspace/components/` — own the shared Session composer,
  Agent/model/thinking pickers, inline interaction controls, and compact activity presentation. New production files use
  TypeScript and named property types; do not introduce `any`, `unknown`, or complex inline types.
- `src/ui/workspace/components/SessionTimeline.jsx` — deepen the event projection so live activity stays distinct and
  completed contiguous tools/thinking can render as chronological expandable groups without losing original evidence.
- `src/ui/workspace/components/SessionActivationStatus.jsx` — expose browser-ready Busy/available/configuration
  decisions and automatic unlock behavior without a takeover action.
- `src/ui/workspace/server/session-continuation.js` — own launch configuration, live Runtime Session identity,
  configuration operations, staged active-operation configuration, cancellation, creation results, and operation-safe
  interaction answers. It must not implement Agent switching or model policy itself.
- `src/ui/workspace/routes/owner-session-api.js` and `src/ui/workspace/server.js` — register authenticated,
  Project-bound, cross-site request forgery (CSRF)-protected Session option, configuration, interaction, and
  cancellation routes with bounded inputs and sanitized outputs.
- `src/ui/workspace/static/workspace.css` — implement the conversation-first desktop and mobile shell, compact composer
  controls, picker/panel states, Activity groups, inline interactions, Busy overlay, and latest-activity affordance with
  existing `--rw-*` tokens.
- `docs/design-system.md` — replace obsolete **Take control** guidance with the current Busy/read-only automatic-unlock
  rule and document only reusable Session composer, interaction, activity, and responsive patterns that this MVP makes
  real.
- Workspace Session component, route, service, and integration tests — prove selected launch configuration, stable
  minting, generation-fenced configuration, cancellation, interaction answers, scroll-state decisions, activity
  grouping, draft recovery, authorization, and sanitized responses.

The shared `SessionRuntime`, Agent switching, model registry, model execution, thinking-level, transcript, Plan, and
owner-coordination modules are intended reuse boundaries. Change them only if implementation discovery proves that a
consumer-neutral capability is missing; do not add a Workspace-specific seam to shared Core.

## Reuse Opportunities

- `SessionRuntime.createInteractiveSession()`, `promptUserTurn()`, `switchAgent()`, `reconfigureSessionModel()`,
  `setSessionThinkingLevel()`, `cycleSessionThinkingLevel()`, and `cancelSession()` — preserve Core authority and
  established success/failure behavior.
- `listAvailableAgents()` in `src/shared/session/agents.js` — build the Project-aware selectable Agent catalog and keep
  workflow-only Agents out of manual controls.
- `RunWieldModelRegistry.getSelectable()` and model metadata in `src/shared/models/model-registry.ts` — supply
  selectable Pi and Claude CLI model entries, provider labels, capabilities, and authentication-safe availability
  without exposing credentials.
- `setActiveSessionModel()` semantics in `src/shared/session/model-selection.ts` — reuse validation and unsupported
  Execution Backend language, but do not call the helper if its Project-default side effect conflicts with the settled
  Session-only browser behavior.
- `WorkspaceSessionContinuationService` operation receipts and event buffers — retain exact-request idempotency,
  temporary-to-committed reconciliation, and process-local live interaction ownership.
- `sessionDraftKey()`, `sessionAttachmentsKey()`, and the existing exact request envelope — extend them to an unminted
  Project-scoped draft identity and complete failed-send restoration.
- `RunWieldButton`, shared dialogs/forms, `MarkdownView`, semantic tokens, and theme bridge — keep the implementation in
  the RunWield Design System.
- OpenChamber references `ChatContainer.tsx`, `ChatInput.tsx`, `ComposerFooter.tsx`, `ModelControls.tsx`,
  `QuestionCard.tsx`, `ProgressiveGroup.tsx`, and `useChatTimelineScroll.ts` — use only to validate standard browser
  interaction shape; write RunWield-owned components against RunWield contracts.

## Implementation Steps

- [ ] `/projects/:projectId/sessions` renders catalog navigation with a **New Session** link, and
      `/projects/:projectId/sessions/new` renders the shared Session shell with an empty timeline, visible **User
      Request** label, Project-scoped retained draft, Router selected by default, and current Project model/thinking
      defaults shown as initial launch values. The embedded creation textarea no longer exists in `SessionList`.
- [ ] One shared composer component serves New and Existing Sessions. Desktop places compact Agent, model, and thinking
      controls in its footer near Send; narrow screens keep the editor and primary action reachable and open searchable
      Agent/model controls in accessible full-width panels or sheets. Pointer, touch, Tab, arrow keys, Enter, and Escape
      work according to each control type, with visible focus and focus return.
- [ ] The Session options owner API returns only selectable Project-aware Agents, selectable models with
      provider/backend and capability metadata, supported thinking choices, and safe current defaults. Workflow-only
      Agents and provider credentials are absent. Search matches Agent display/internal names and descriptions, and
      model name, stable ID, provider, and Execution Backend label.
- [ ] New Session creation accepts and validates one Agent, model/provider, and thinking selection. Router remains the
      default; an explicit selectable Agent receives the first User Request directly. Model and thinking are applied to
      the pending Runtime Session before the first turn. The request idempotency hash includes text and launch
      configuration, and invalid, unavailable, workflow-only, or unsupported selections fail without minting a second
      Session or changing Project defaults.
- [ ] The browser polls the accepted creation operation until completion, failure, or the existing bounded observation
      limit. A committed `runwieldSessionId` replaces the URL with the stable Existing Session route and reconciles the
      committed timeline without a second catalog race. Refresh reconnects to the same accepted operation and never
      replays the first User Request under a new request ID.
- [ ] Existing Session configuration is Project-bound, CSRF-protected, exact-generation fenced, idempotent, and routed
      through managed `SessionRuntime` operations. Successful Agent changes use `releaseActiveWorkflow: true`; model and
      thinking changes preserve workflow ownership. Every success commits the semantic transcript event and new
      generation. Every failure preserves the prior Agent, model, thinking, workflow, and Project defaults.
- [ ] During a Workspace-owned active operation, supported thinking changes apply through the live Runtime Session.
      Agent/model changes are retained server-side for that operation and apply once at the next safe idle boundary,
      with visible **Applies after this response** state. Staged changes disappear only after commitment, explicit
      replacement, cancellation, or an honest interruption result. A Session Busy in TUI, Agent Client Protocol (ACP),
      or another Workspace process disables all controls and creates no cross-surface pending mutation.
- [ ] A Project-bound cancellation route maps only the matching live Workspace operation to its internal Runtime Session
      and calls `SessionRuntime.cancelSession()`. **Stop** and Escape use that route while work is active. Cancellation
      settles through normal Runtime events, cancels pending interactions and Runtime queues according to Core rules,
      reconciles committed history, and never claims to cancel work owned by another surface or an already-lost process.
- [ ] `SessionSurface` periodically refreshes Session availability while it is Busy or observing a local operation.
      Draft text and image previews remain editable or retained according to the displayed control state, and the
      composer becomes available automatically when the committed Session becomes idle. No **Take control** action or
      writer-lock bypass exists.
- [ ] Text, select, and approval Pending Structured Interactions render as inline semantic forms rather than
      `globalThis.prompt()`. Choice forms support pointer and keyboard selection, Enter submission, and **Other** with a
      typed value. Answer requests include the exact Project, operation, Session, interaction, and request identity;
      duplicate, stale, wrong-Project, wrong-Session, lost-process, and post-cancellation answers do not resolve a wait.
      Submission errors remain on the card with the user's answer intact. The existing dedicated Plan review navigation
      and return path remains protected.
- [ ] The timeline projection preserves original ordered User Requests, Agent Markdown, thinking, tool names/arguments,
      output, errors, system events, and committed/transient source. Active tool/thinking rows stay visible. Contiguous
      completed technical activity collapses into one chronological **Activity** group only after subsequent Agent
      content starts, and expansion restores every original row. A fake generic “Edited files” summary cannot replace
      the RunWield tool evidence.
- [ ] Scroll behavior opens at the latest committed content, follows new live content only while the viewport remains at
      the live edge, and stops immediately after a real user scroll away. New activity then updates a non-stealing
      **Latest activity** affordance; selecting it returns to the live edge and resumes following. This MVP retains the
      current bounded timeline load rather than claiming upward infinite history.
- [ ] Before submission, New and Existing drafts and image previews persist under the correct Project/Session identity.
      On any unaccepted or failed send, the exact text and images return to their original draft. If the user typed new
      text while the request was in flight, recovery does not overwrite it. Accepted operations clear visible input but
      retain the exact recovery envelope until committed reconciliation proves completion.
- [ ] The Session visual hierarchy follows the established browser-chat pattern: slim Session heading/status,
      conversation-first center column, restrained User Request treatment, unboxed Agent responses, persistent composer,
      and progressive technical detail. The existing model/Execution Backend caveat remains available through disclosure
      rather than occupying the default reading path.
- [ ] Canonical Plan progress remains a secondary desktop panel only when a Plan is active. It is labeled as Plan
      progress, not the complete Workflow Rail. On narrow screens it opens from a compact summary/control instead of
      preceding the timeline and composer. The panel never becomes Plan, validation, worktree, or Session Control
      authority.
- [ ] `docs/design-system.md` describes the implemented shared Session shell, composer controls, inline interaction,
      Activity group, user-owned scrolling, mobile progress panel, and Busy automatic-unlock patterns. It removes the
      stale heartbeat-based **Take control** guidance and does not document deferred intent cards or full Workflow Rail
      behavior as implemented.
- [ ] Existing security, Plan review, aggregate transcript, image transport, operation idempotency, lost-live-wait,
      Session Control, and Plan progress behavior remains covered after component extraction. Tests that asserted the
      embedded creation form, `globalThis.prompt()`, unconditional bottom scrolling, or **Take control** are expected to
      stop existing and are replaced with tests of the new behavior rather than deleted without coverage.

## Approval Confirmation

No Work Record is superseded by this Plan. The Plan builds on the verified SessionRuntime sibling-adapter and atomic
Agent-switching boundaries without replacing their planning guidance.

### Semantic Review Scope Clarification

Objective-Failing Checks were removed from RunWield before this Plan entered execution. They are not part of this Plan's
readiness, implementation, or verification contract and must not be reintroduced. The current verification contract is
repository validation, Semantic Review approval, and delivery proof.

The execution worktree merged newer `main` changes after its execution baseline was recorded. Consequently, a diff
against that older baseline can contain unrelated upstream changes, including `direct-load-plan-review` Plan and source
files. Those files are outside this Plan's Expected Change Surface and are not requirements or implementation evidence
for this Plan. Semantic Review must evaluate this Plan and its Workspace Session changes only; findings about direct
Plan review belong to separate triage.

## Verification Plan

- Automated: run the focused Workspace Session suites with
  `deno run -A scripts/run-tests.js src/ui/workspace/workspace-session-ux.test.tsx
  src/ui/workspace/workspace-session-backend-disclosure.test.ts
  src/ui/workspace/session-navigation.integration.test.ts
  src/ui/workspace/session-continuation.integration.test.ts
  src/ui/workspace/workspace-plan-review.integration.test.ts src/ui/workspace/owner-workspace.test.js`.
- Automated: run `deno task workspace:check`, `deno task workspace:test`, `deno task workspace:build`,
  `deno task seams:check`, and `deno task ci`.
- Automated: creation integration uses the real Workspace service plus Runtime command fixtures. It proves default
  Router and explicit non-Router first turns, selected model/thinking activation, one stable Session ID, committed first
  User Request, automatic creation result, exact duplicate idempotency, rejected mismatched reuse, and unchanged Project
  defaults. This test must fail if the server ignores the selected configuration or still routes every request through
  Router.
- Automated: existing configuration integration proves exact-generation Agent/model/thinking changes against a real
  managed Session, user Agent-switch workflow release, model/thinking workflow preservation, active-operation staging,
  supported immediate thinking changes, stale/Busy/wrong-Project rejection, and full rollback on activation failure.
  This test must fail if the endpoint is a display-only stub or writes settings without changing the Session.
- Automated: cancellation integration starts a long-running fixture turn, cancels through the owner route, observes a
  Runtime cancellation event and settled operation, and proves later duplicate cancellation is harmless. Wrong-Project,
  wrong-operation, lost-process, and other-surface attempts cannot cancel work.
- Automated: interaction integration presents text, choice, approval, and **Other** waits through the real Workspace
  interaction adapter. Each matching answer resolves once; missing request/Session identity, duplicate answers, wrong
  Project, cancellation, and lost process fail while preserving the visible response for retry.
- Automated: pure reducer/component tests prove active technical rows, completed chronological Activity grouping,
  expansion evidence, committed/transient distinction, follow-versus-reader scroll decisions, Latest activity state,
  Busy automatic unlock, New/Existing draft keys, and failed-send merge behavior. Source-text greps are not substitutes
  for these behavioral tests.
- Manual headed browser, desktop: run `deno task workspace:dev` for hot-module visual work at `http://127.0.0.1:5173`,
  and use the normal paired owner server for real authenticated APIs. Open a registered Project's Sessions catalog,
  select **New Session**, verify the unminted shared shell, search and select an Agent/model, choose thinking, submit,
  watch creation progress, and confirm the URL becomes the minted Session without losing or duplicating the first User
  Request.
- Manual headed browser, desktop: continue the Session, expand/collapse Activity, answer each interaction type, change
  Session configuration, start a long turn, stage an Agent/model change, change thinking when supported, cancel with
  **Stop**, then repeat with Escape. Verify labels explain delayed and unsupported outcomes without changing Project
  defaults.
- Manual headed browser, scroll and recovery: stream a long fixture response while at the live edge, scroll upward, and
  verify the viewport stays still while **Latest activity** updates. Return to the live edge. Cause a rejected send and
  a stale-generation response after typing more text; verify original text/images are restored without overwriting newer
  input or replaying a request.
- Manual headed browser, cross-surface: keep one disposable Session active in the TUI, open it in Workspace, and verify
  read-only history, retained draft, disabled configuration, no takeover action, and automatic composer availability
  after the TUI becomes idle.
- Manual headed browser, mobile at approximately 390×844: verify timeline and composer remain primary, the software
  keyboard does not cover the primary action, Agent/model controls use compact accessible panels, thinking and Stop stay
  reachable, interactions fit one column, long tool output does not create page-wide overflow, and Plan progress opens
  without permanently reducing conversation width.
- Expected result: a user can start and continue a RunWield Session entirely in the browser, deliberately choose the
  Session's Agent/model/thinking behavior, read live and committed work without losing scroll position, answer Runtime
  questions, cancel Workspace-owned work, and recover every unsent draft without Workspace becoming a second Runtime or
  workflow authority.

## Edge Cases & Considerations

- **Unminted identity:** `/sessions/new` has no durable Session ID. Its draft and accepted create operation are scoped
  to the Project and owner device. A second New Session tab must not overwrite or replay an accepted request; add a
  local draft-instance identifier if one Project-scoped key cannot distinguish concurrent tabs safely.
- **Launch ordering:** model and thinking preparation must finish before the selected Agent's first turn. If any launch
  selection cannot activate, creation fails honestly before a usable Session is claimed. Do not mint with silent
  fallback to Router or another model.
- **Session-only divergence:** unlike TUI `/model` and thinking selection, browser controls in this MVP do not update
  Project defaults. Copy and tests must call this a Session choice; no shared settings write is permitted.
- **Agent-switch consequence:** manual Agent selection can release active workflow ownership. Existing Session controls
  must state the consequence when workflow context is present, but must not add a browser-only confirmation that changes
  Runtime semantics.
- **Active-operation staging:** pending Agent/model changes are process-local because the active Runtime Session is
  process-local. If the Workspace process is lost, show interruption and current committed configuration; never infer
  that an uncommitted change succeeded.
- **Thinking support:** model metadata drives available thinking choices, but Runtime outcome is final. Unsupported
  models show the control as unavailable and an attempted stale choice must not commit a transcript change.
- **Cancellation:** Escape must not close a picker and cancel Runtime work in the same key event. The focused
  dialog/menu consumes Escape first; Runtime cancellation applies when no dismissible control owns it.
- **Interaction lifetime:** a browser reload can reconnect to the live operation while the Workspace process remains
  alive. Process loss ends the Pending Structured Interaction; local state can explain the interruption but cannot
  recreate its Promise.
- **Scroll scope:** true upward infinite history and virtualization are deferred. The UI must say when the existing page
  or event budget truncates history and must not imply that all older history is available.
- **Image scope:** preserve the existing image-only continuation behavior and improve restoration/presentation. New
  Session image parity, file-selection UI, model-capability preflight, and non-image attachments remain deferred unless
  implementation discovery shows the existing transport can support New Session images without widening the boundary.
- **Plan progress:** the current sidebar derives only coarse active-Plan stages. Keep that limitation explicit; do not
  synthesize Workflow Rail owner, reason, next action, or evidence facts that the server does not provide.
- **Security:** catalog and action responses expose no credentials, Project root, local paths, owner instance, fence,
  operation receipt internals, raw database errors, or unsafe tool data beyond already-sanitized Session events.
- **Working tree:** unrelated existing edits under `src/shared/workflow/` were present during planning. This Plan does
  not depend on or authorize overwriting them.
