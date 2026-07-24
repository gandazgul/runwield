---
planId: "b0e98f29-33de-44bf-a785-dbda322d2533"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Build the first phone-friendly owner Workspace Session surface with an authenticated timeline, continuation composer, activation-aware availability, and a basic Ideator continuation flow over the slice 4 APIs."
affectedPaths:
    - "src/ui/workspace/pages/projects/[projectId]/sessions/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/static/workspace.css"
    - "src/ui/workspace/owner-workspace.test.js"
    - "src/ui/workspace/workspace.test.js"
    - "docs/design-system.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-21T23:56:51-04:00"
updatedAt: "2026-07-24T16:05:28.598Z"
status: "verified"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 5
dependencies:
    - "04-activation-gated-workspace-session-continuation-apis"
implementedAt: "2026-07-24T15:37:47.217Z"
verifiedAt: "2026-07-24T16:05:28.598Z"
executionReport: "- Blocked before implementation: approved Plan requires slice 4 APIs to be present and says to stop rather than recreate them if absent.\n- Missing required slice 4 files in this execution worktree: `src/ui/workspace/routes/owner-session-api.js`, `src/ui/workspace/server/session-continuation.js`, and `src/shared/session/session-transcript-projection.js`.\n- Verified absence: `find src/ui/workspace '*session*'` and `find src/shared/session '*projection*'` returned no required files; grep found no `ownerProjectSessionsApi`, `WorkspaceSessionContinuationService`, `projectCommittedTranscript`, or `inspectSessionActivation` refs.\n- Dev-server preflight: `deno task workspace:dev` started, but recorded port `5173` was occupied so Astro served `http://127.0.0.1:5175/`.\n- Headed browser preflight: `agent-browser --headed --session runwield-phone-ideation-cde1c963 open http://127.0.0.1:5175` loaded title `RunWield Workspace` at `http://127.0.0.1:5175/`; original `5173` displayed an error because a different process owned that port.\n- Automated check run before blocker: `deno task workspace:check` passed with 0 errors/warnings/hints.\n- Remaining unverified: Session UI implementation, owner Session routes, phone layout, prompt submission, ownership rejection, draft preservation, reconnect, and full CI; all require the slice 4 API base to land first."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Phone Ideation Session UI Tracer Bullet

## Context

Slice 4 establishes the narrow activation-gated backend needed to resume an idle Ideator Session from a paired owner
Workspace: authenticated Session listing, committed semantic timeline projection, explicit legacy bootstrap, idempotent
continuation start, and operation-status polling. This slice turns that contract into the first useful phone experience
without waiting for the complete Session navigation, Attention Dashboard, Durable Workflow Checkpoints, or Plan review
surfaces.

The current Workspace is Astro SSR with React islands and Tailwind-backed RunWield styling. Owner mode remains a
separate authenticated composition in `src/ui/workspace/server.js`; owner routes must be registered there because an
Astro page file alone is not reachable through the production owner server. The existing Project home, Plan Board, React
components, local-draft behavior, semantic `--rw-*` tokens, and responsive owner styles provide the implementation
baseline.

This Plan depends on the slice 4 implementation being present in the execution base. At planning time, its verified
implementation remains in the slice 4 worktree rather than `main`. Execution must inspect the landed slice 4 DTOs and
route names before changing UI code, consume that contract, and stop rather than duplicate activation, transcript
projection, idempotency, or Runtime policy in the frontend.

## Objective

Create a paired-owner, phone-friendly Session continuation flow that lets the owner:

- open a registered Project's cataloged Sessions and select a continuation candidate;
- inspect the current committed semantic timeline and Session/Agent summary;
- explicitly prepare a legacy Session whose committed generation has not been bootstrapped;
- understand whether continuation is available, active in another surface, disabled, stale, or recovery-blocked;
- submit one ordinary text User Request to an eligible idle Ideator Session;
- observe bounded live progress while the server owns the continuation operation;
- reconcile to the next committed timeline generation when the operation settles; and
- retain unsent text through refresh, network errors, ownership rejection, and stale-generation rejection.

The tracer bullet does not add Workspace Planner continuation, Plan approval or execution, Session creation, automatic
TUI synchronization, Durable Workflow Checkpoints, recovery/takeover actions, attachments, rich Session search, or the
complete Session timeline/navigation UX reserved for later slices.

## Approach

Add Project-scoped Session list and detail Astro routes backed by React islands. Register those routes through the owner
server's existing authentication and Project-containment middleware, and add an **Open Sessions** entry point beside the
Project's Plan Board action. Keep the browser on stable `projectId` and RunWield Session ID routes; never accept a
client root, transcript locator, activation proof, or owner instance as authority.

Use the slice 4 owner APIs as the only Session data and mutation boundary:

- list Project Sessions and activation protocol health;
- read committed timeline pages and snapshot data;
- explicitly bootstrap generation zero when required;
- start an idempotent continuation with a browser-generated request ID and exact expected generation; and
- poll the returned opaque operation ID until it reaches a terminal state.

Render committed events through a pure React-side reducer that groups semantic Runtime events into user messages,
Ideator responses, compact thinking details, tool activity summaries, and status rows. The UI must not parse Session
Transcript JSONL, infer state from display text, expose removed event internals, or import TUI rendering code. During a
running operation, incrementally reduce the operation buffer by observed array position and stable message/tool
identities. Treat those items as transient: after completion or failure, re-read the committed timeline and replace the
transient turn instead of trying to merge live events permanently with stable committed `eventId` values.

Make mutation availability explicit but user-oriented. Map backend states to labels such as **Available**, **In use in
TUI**, **Running in Workspace**, **Preparation needed**, **Continuation disabled**, and **Recovery needed**. Enable the
composer only when committed evidence identifies an idle Ideator Session with no workflow context and the page has
loaded through the current generation. Other Sessions may remain readable, but the UI must explain why this tracer
bullet cannot continue them.

Persist unsent text under a Project-and-Session-scoped local-storage key. Before sending, also persist the generated
request ID and exact request envelope so a lost HTTP response can retry the same idempotency key and body. Once a `202`
is recovered, clear the text from the composer and retain only the operation recovery metadata. A `409` or `503` keeps
the unsent draft and requires explicit resubmission after refresh; an accepted or uncertain operation is never silently
replayed with a new request ID.

Use a single-column phone layout, a sticky in-flow composer with safe-area padding, touch-sized actions, visible labels,
and an `aria-live` status region. Preserve the current dark Workspace aesthetic and existing cards, notices, action
variants, focus treatments, and semantic tokens. Keep the desktop presentation useful, but defer full split-pane
navigation and timeline polish to slice 11.

## Files to Modify

- `src/ui/workspace/pages/projects/[projectId]/sessions/index.astro` — add the Project Session list route and mount the
  authenticated React list surface.
- `src/ui/workspace/pages/projects/[projectId]/sessions/[runwieldSessionId].astro` — add the stable Session detail
  route, page hierarchy, back navigation, and continuation island mount.
- `src/ui/workspace/components/SessionList.jsx` — render cataloged Session cards, activation state, generation, empty
  state, diagnostics, and links without exposing private locators or proofs.
- `src/ui/workspace/components/SessionTimeline.jsx` — render normalized committed and transient timeline items with
  semantic list/message/tool/status markup and stable keys.
- `src/ui/workspace/components/SessionActivationStatus.jsx` — centralize user-facing availability labels, explanations,
  and action eligibility for protocol, activation, Agent, workflow, and recovery states.
- `src/ui/workspace/islands/SessionSurface.jsx` — own API loading, cursor paging, bootstrap, local drafts, idempotent
  submission, bounded operation polling, transient-event reduction, reconnect recovery, and accessible announcements.
- `src/ui/workspace/server.js` — add **Open Sessions** Project navigation and register authenticated, Project-contained
  owner page routes that delegate to the built Astro application while preserving pairing redirects and security
  headers.
- `src/ui/workspace/static/workspace.css` — add Session list, timeline, availability banner, sticky composer,
  narrow-screen, safe-area, long-content, focus, disabled, loading, and error styles using existing `--rw-*` tokens.
- `src/ui/workspace/owner-workspace.test.js` — cover owner authentication, pairing redirect, registered Project
  containment, Session page routing, Session API availability, CSRF-protected bootstrap/continuation, and sanitized
  errors/DTOs with the slice 4 service composed.
- `src/ui/workspace/workspace.test.js` — test pure status mapping, event reduction/grouping, cursor accumulation,
  operation reconciliation, draft/request recovery decisions, and server-rendered React markup.
- `docs/design-system.md` — document a Session timeline, activation-status, or mobile composer pattern only if the
  implementation introduces a reusable RunWield browser pattern not already covered by cards, notices, actions, and
  forms.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/routes/owner-session-api.js` and `src/ui/workspace/server/session-continuation.js` from slice 4 —
  consume the authenticated list/timeline/bootstrap/continue/operation contract; do not create another browser-facing
  Runtime or activation service.
- `src/shared/session/session-runtime-events.js` and `session-transcript-projection.js` from slice 4 — use projected
  semantic event fields and stable committed `eventId` values as delivered by the API; never import transcript parsing
  into browser code.
- `src/ui/workspace/server.js` owner middleware and `server/owner-projects.js` — preserve paired-device authorization,
  exact-Origin/CSRF checks, Project containment, owner security headers, and the existing Astro delegation mechanism.
- `src/ui/workspace/layouts/WorkspaceLayout.astro` and the Project Plan route — reuse shell, Project back-navigation,
  and Astro/React hydration conventions.
- `src/ui/workspace/islands/PlanBodyEditor.jsx` — follow its scoped local-storage draft, dirty-state, and recovery
  helper patterns while using Session-specific keys and idempotent operation metadata.
- `src/ui/workspace/components/MarkdownView.jsx` — reuse the reviewed markdown renderer for assistant text when its
  sanitization and content behavior fit; render owner text and status metadata as plain React text.
- `src/ui/design-system/components/react/RunWieldPrimitives.jsx` — reuse `RunWieldButton` and `RunWieldCard` rather than
  introducing another primitive layer.
- `src/ui/workspace/static/workspace.css`, `src/ui/design-system/tokens.css`, and `components.css` — reuse owner cards,
  notices, badges, primary/secondary actions, responsive breakpoints, and semantic `--rw-*` variables.

## Implementation Steps

- [ ] Confirm the execution base contains slice 4's owner Session service/routes, stable committed projection, and
      operation API. Record the exact landed DTO fields in local JSDoc typedefs at the browser boundary; do not weaken
      or recreate the backend contract if it differs from the planning worktree.
- [ ] Add production owner Session page routing in `createOwnerWorkspaceApp()`. Run every route through existing device
      authentication and `requireOwnerProjectRoot()` before delegating to Astro, preserve security headers, and add an
      **Open Sessions** action only for available Projects.
- [ ] Add the Project Session list Astro route and React component. Fetch the slice 4 list endpoint, show protocol
      health and sanitized catalog diagnostics, prioritize idle/preparation candidates, retain visible unavailable
      states with explanations, and provide loading, empty, error, and retry states.
- [ ] Add the Session detail route and `SessionSurface`. Load Session status and committed timeline, verify that the
      route Project and Session relationship is accepted by the API, and derive one normalized view model for the
      timeline, snapshot, availability banner, and composer.
- [ ] Implement bounded committed-timeline cursor traversal. Continue through API pages until the committed end; enforce
      a named maximum page/event budget. If that budget is exceeded or a cursor is rejected, show a clear read-only
      truncation/reload state and do not enable continuation while presenting an incomplete timeline as current.
- [ ] Implement pure semantic event reduction. Accumulate assistant/thinking deltas by message ID, pair tool
      start/update/end by tool-call ID, retain timestamps and Agent names supplied by the API, represent usage/system
      events compactly, and ignore unknown event types safely without breaking later known events.
- [ ] Implement explicit generation-zero preparation. Show a **Prepare Session** action only for `bootstrapRequired`;
      POST with CSRF and one request ID, guard duplicate taps, poll/reload the resulting generation, and never trigger
      bootstrap from list or timeline GET requests.
- [ ] Implement one availability policy for UI copy and composer state. Require enabled protocol, complete current
      timeline, `idle` activation, committed `activeAgent` equal to Ideator, no workflow context, and no active local
      operation. Map TUI/Workspace/ACP activity and blocked states to text plus status intent rather than color alone.
- [ ] Implement the Session-scoped composer with a visible label, multiline text, explicit **Send** action, duplicate
      submission guard, and optional Command/Ctrl+Enter shortcut while plain Enter remains a newline. Trim only for
      empty-input validation; send and preserve the exact entered text.
- [ ] Implement local draft and ambiguous-response recovery. Persist draft text while dirty; persist request ID,
      expected generation, and exact body before POST; retry only that same envelope after a lost response; clear the
      visible draft after `202`; and retain opaque operation metadata so refresh can resume status polling without
      resubmitting the User Request.
- [ ] Poll operation status at a bounded interval while running. Consume only newly observed buffer positions, reduce
      transient semantic events, keep disconnection separate from cancellation, stop at terminal status, then refresh
      the committed generation and replace transient content. If the operation becomes unknown after server restart,
      refresh committed state and show an explicit unavailable/recovery message without inventing success or replaying.
- [ ] Handle rejection and failure conservatively. On `409`, keep the draft, refresh generation/availability, explain
      that explicit resubmission is required, and generate a new request ID only for the owner's next send. On `503`,
      preserve the draft and disable mutation. After an accepted operation fails, refresh committed state and show the
      failure; never automatically restore-and-submit text that may already appear in the transcript.
- [ ] Add phone-first styling and accessibility. Use semantic headings/lists/forms, touch-sized controls, visible focus,
      `aria-live` announcements, non-color status text, wrapping for long names/content, reduced layout shift, composer
      safe-area padding, and intentional scroll behavior that does not pull the owner away from content they are
      reading.
- [ ] Add focused route/API integration, pure state/reducer, and SSR markup tests. Do not introduce a new DOM/browser
      test framework solely for this slice; verify local-storage, focus, keyboard, responsive, and polling interaction
      in the required headed-browser pass.
- [ ] Update `docs/design-system.md` only for a genuinely reusable pattern, then run Workspace checks/build/tests and
      the full repository quality gate.

## Verification Plan

- Automated: run `deno task workspace:check`, `deno task workspace:test`, and `deno task workspace:build` while
  developing, then run `deno task ci` and fix all failures.
- Automated: owner route tests prove an unpaired browser redirects to `/pair`, a paired browser can open only Sessions
  under an enabled registered Project, mutations require exact Origin and CSRF, and responses/errors expose no root,
  transcript path, activation proof, owner instance, fence, or raw tool arguments.
- Automated: reducer tests cover user/Ideator messages, multiple assistant and thinking deltas, tool start/update/end,
  status/usage rows, unknown events, repeated operation polls, committed replacement, stable committed keys, and long
  content.
- Automated: state tests cover protocol disabled, bootstrap required, idle eligible Ideator, idle non-Ideator, workflow
  context present, active TUI/Workspace/ACP, stale generation, uncertain/reconcile-required, timeline truncation, and
  unknown operation after restart.
- Automated: draft/idempotency tests prove refresh preserves dirty text; `409`, `503`, and network failure retain the
  exact draft/request envelope; a recovered `202` clears the visible draft and resumes the same operation; and no
  accepted or uncertain operation is automatically submitted under a new request ID.
- Manual headed browser setup: merge/use the slice 4 execution base, run `deno task workspace:build`, stop incompatible
  RunWield processes, then start `deno task cli workspace serve --enable-session-activation --no-open` (plus the
  environment's normal bind/public-origin options). Pair a browser through the normal owner flow. Use
  `deno task workspace:dev` separately for HMR visual iteration, recognizing that direct port `5173` does not exercise
  owner authentication or the real owner APIs.
- Manual phone check: in a headed browser at approximately 390×844, open a registered Project, enter Sessions, prepare a
  legacy Ideator Session if needed, inspect its timeline, submit a multiline User Request, watch running progress, and
  confirm the committed response replaces transient content and the composer returns to Available.
- Manual interaction check: verify touch targets, textarea label, multiline Enter behavior, Command/Ctrl+Enter,
  keyboard/focus order, visible focus, `aria-live` status, safe-area spacing, long Session names, long messages, and no
  clipping or overlap in both dark/light RunWield themes.
- Manual resilience check: preserve an unsent draft across reload; cause a stale-generation or competing TUI ownership
  rejection and verify the exact draft remains; disconnect after `202`, reconnect, and verify the UI polls or reconciles
  without canceling or duplicating the continuation.
- Manual security check: open the same URL from an unpaired browser context and confirm it cannot view the Session;
  revoke the paired device during polling and confirm further owner requests are denied without implying that the
  server-owned turn was canceled.
- Expected result: a paired owner can safely continue one eligible idle Ideator Session from a phone, can understand
  every blocked state without backend internals, sees one coherent committed conversation after settlement, and never
  loses or silently replays a User Request during ownership or network races.

## Edge Cases & Considerations

- **Dependency availability:** slice 4 is a hard execution dependency. If its verified work has not landed in the
  execution base, stop and resolve sequencing rather than coding against the planning worktree or recreating its APIs.
- **Committed versus live truth:** timeline GETs expose only the last committed generation while a turn is active. Live
  operation events are temporary progress, not canonical Session history, and must disappear in favor of the next
  committed projection.
- **Live event cursors:** operation buffers may lack committed `eventId` values. Track the returned array position per
  opaque operation and semantic message/tool identities; do not synthesize committed cursors.
- **Ambiguous submission:** a lost continuation response must reuse the same request ID and exact body. Once acceptance
  is possible, automatic submission with a different ID could duplicate the User Request and is forbidden.
- **Browser/server restart:** browser refresh may resume an in-memory operation by opaque ID. If the Workspace process
  restarted and reports it unknown, only committed timeline/generation evidence may establish the outcome.
- **Bootstrap:** preparation updates coordination evidence but must not mutate Session Transcript bytes or happen as a
  GET side effect. Concurrent preparation has one idempotent outcome or a visible conflict.
- **Activation races:** do not queue a competing turn while TUI, ACP, or another Workspace operation is active. Refresh
  state, preserve unsent text, and require an explicit later send.
- **Eligibility:** this slice continues only an idle Ideator Session with no workflow context. Planner, Router, Guide,
  workflows, unresolved interactions, images, and materializing capabilities stay readable where safe but not
  continuable here.
- **Large timelines:** never enable continuation while showing an incomplete old prefix as though it were current. A
  transcript beyond the tracer bullet's bounded paging budget becomes visibly read-only until the complete Session UX
  provides scalable navigation.
- **Rendering safety:** render API strings through React/approved markdown paths only. Never use raw HTML, expose raw
  tool arguments, or turn user-controlled text into links or executable markup without the existing sanitizer.
- **Draft privacy:** Session drafts and pre-acceptance idempotency envelopes remain local to the paired browser and are
  scoped by Project and Session. They never enter cookies, URLs, logs, owner operation receipts, or repository files.
- **Disconnection and revocation:** neither browser disconnect nor device revocation cancels a server-owned operation.
  The UI reports loss of observation/control and reconciles from committed state when authorization returns.
- **Scope handoff:** slice 6 adds automatic idle TUI synchronization. Slice 11 adds complete Session creation,
  navigation, search/filtering, rich timelines, reconnect polish, and cross-surface handoff UX without replacing this
  tracer bullet's route, draft, or activation-state foundations.
