---
planId: "7d873089-5c41-4c43-95cd-e748fdc6b38a"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Complete the plain Project-to-Session Workspace: create Router-led Sessions, continue safe idle conversations, render aggregate history and live waits, and let the owner explicitly recover expired control from valid transcript files."
affectedPaths:
    - "docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md"
    - "docs/prd/runwield-workspace-prd.md"
    - "docs/domain-language.md"
    - "src/shared/owner-coordination/"
    - "src/shared/session/"
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/ui/workspace/routes/"
    - "src/ui/workspace/server/"
    - "src/ui/workspace/static/workspace.css"
    - "src/ui/workspace/owner-workspace.test.js"
    - "src/ui/workspace/workspace-session-ux.test.tsx"
    - "docs/design-system.md"
objectiveChecks:
    - id: "OC1"
      command: "test -f src/ui/workspace/session-navigation.integration.test.ts && grep -Fq \"Workspace creates one Router Session and resumes idle conversational Agents through one stable identity\" src/ui/workspace/session-navigation.integration.test.ts && grep -q \"async createSession\" src/ui/workspace/server/session-continuation.js && grep -Fq 'app.post(\"/api/owner/projects/:projectId/sessions\"' src/ui/workspace/server.js && ! grep -q \"WORKSPACE_IDEATOR_CONVERSATION_TOOLS\" src/ui/workspace/server/session-continuation.js && ! grep -q \"committedFacts.activeAgent !== AGENTS.IDEATOR\" src/ui/workspace/server/session-continuation.js && deno run -A scripts/run-tests.js src/ui/workspace/session-navigation.integration.test.ts src/ui/workspace/owner-workspace.test.js"
      rationale: "The browser has no Session creation route or service and still hard-codes Ideator-only continuation. This requires the production entry points plus a behavioral Router creation/shared-continuation integration suite."
    - id: "OC2"
      command: "test -f src/shared/session/expired-activation-takeover.integration.test.ts && grep -Fq \"expired control recovery trusts valid transcript evidence and fences the old owner\" src/shared/session/expired-activation-takeover.integration.test.ts && grep -q \"export function recoverExpiredSessionControl\" src/shared/owner-coordination/session-activations.js && grep -q \"recoverExpiredSessionControl:\" src/shared/owner-coordination/index.js && deno run -A scripts/run-tests.js src/shared/session/expired-activation-takeover.integration.test.ts src/shared/owner-coordination/session-activations.test.js"
      rationale: "No expired-control recovery authority exists today. This requires its shared production transaction and executes real-store coverage for deadline gating, transcript evidence adoption, and stale-owner fencing."
    - id: "OC3"
      command: "test -f src/ui/workspace/workspace-session-ux.test.tsx && grep -Fq \"Session surface preserves drafts and replaces a lost live wait with one interruption line\" src/ui/workspace/workspace-session-ux.test.tsx && grep -Fq \"Take control\" src/ui/workspace/islands/SessionSurface.jsx && grep -Fq \"The agent was interrupted. Ask it to continue.\" src/ui/workspace/components/SessionTimeline.jsx && grep -Fq 'app.post(\"/api/owner/session-operations/:operationId/interactions/:interactionId/answer\"' src/ui/workspace/server.js && deno run -A scripts/run-tests.js src/ui/workspace/workspace-session-ux.test.tsx"
      rationale: "The current Session surface has no force-control confirmation, interruption item, or live interaction-answer route. This requires those production paths and runs the UI state behavior suite."
objectiveCheckWaivers:
    - id: "OC3"
      command: "test -f src/ui/workspace/workspace-session-ux.test.tsx && grep -Fq \"Session surface preserves drafts and replaces a lost live wait with one interruption line\" src/ui/workspace/workspace-session-ux.test.tsx && grep -Fq \"Take control\" src/ui/workspace/islands/SessionSurface.jsx && grep -Fq \"The agent was interrupted. Ask it to continue.\" src/ui/workspace/components/SessionTimeline.jsx && grep -Fq 'app.post(\"/api/owner/session-operations/:operationId/interactions/:interactionId/answer\"' src/ui/workspace/server.js && deno run -A scripts/run-tests.js src/ui/workspace/workspace-session-ux.test.tsx"
      source: "engineer_report"
      explanation: "The check is defective. It proves the wrong route shape: it requires an unproject-bound interaction-answer route in server.js. The approved Plan requires Project-bound owner APIs. The implementation registers `app.post(\"/api/owner/projects/:projectId/session-operations/:operationId/interactions/:interactionId/answer\", ownerSessionInteractionAnswerApi)` in `src/ui/workspace/server.js`, `SessionSurface.jsx` posts to the same Project-bound route, and `owner-workspace.test.js` covers wrong-project rejection plus successful same-project answer. The rest of OC3 passes: the UX test file and named test exist, `Take control` exists in `SessionSurface.jsx`, the interruption line exists in `SessionTimeline.jsx`, and `deno run -A scripts/run-tests.js src/ui/workspace/workspace-session-ux.test.tsx` passes."
      userNote: "OC3 diagnosed as a defective check, not an implementation defect: it greps for an unproject-bound interaction-answer route, but the Plan requires Project-bound APIs and    the implementation uses the Project-bound route"
      waivedAt: "2026-08-13T20:34:34.025Z"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-26T20:48:25.378Z"
status: "verified"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 15
dependencies:
    - "14-cross-surface-workflow-invariant-hardening"
implementedAt: "2026-08-13T19:47:58.477Z"
verifiedAt: "2026-08-13T20:36:04.202Z"
userVerifiedAt: null
executionReport: "- Implemented Workspace Session slice: Router-led Session creation service path, shared Runtime continuation policy, live Workspace interaction answering/lost-wait interruption handling, forced expired-control recovery, sanitized owner APIs, list/detail Session UI, responsive timeline/composer/status styling, and ADR/PRD/domain/design-system docs.\n- Fixed the observed `workspace:dev` 404: added dev-only Astro owner API fallback at `/api/owner/...` so hot-module visual work now shows a clear 503 message instead of Astro’s 404; updated Session list copy to remove old Ideator-only wording.\n- Tests changed: added new behavioral coverage in `expired-activation-takeover.integration.test.ts`, `session-navigation.integration.test.ts`, and `workspace-session-ux.test.tsx`; expanded owner-coordination/workspace tests; no tests were deleted.\n- Verification passed: focused suite `deno run -A scripts/run-tests.js src/shared/owner-coordination/session-activations.test.js src/shared/session/expired-activation-takeover.integration.test.ts src/ui/workspace/session-navigation.integration.test.ts src/ui/workspace/owner-workspace.test.js src/ui/workspace/workspace-session-ux.test.tsx`; `deno task workspace:check`; `deno task workspace:test`; `deno task workspace:build`; `deno task seams:check`; `deno task ci`.\n- Browser check passed for Astro dev at `http://127.0.0.1:5173/projects/test-project/sessions`, mobile viewport 390×844: page renders, copy is updated, no Astro 404; visible evidence shows clear owner API unavailable message for dev-only API access.\n- Browser check passed for real paired owner server at `http://127.0.0.1:8789/projects/11ed4e56-2514-467e-8cee-a70f2feb3f9b/sessions`, desktop and 390×844: paired browser, registered sandbox Project, opened Sessions route, saw New Session form and empty state; no failed fetches captured.\n- Manual live Router creation/interaction, TUI cross-surface takeover, and damaged-transcript corruption drills were not exercised in the headed browser because that would require live model/API execution and disposable transcript side effects; automated integration coverage covers these paths."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "493aeea395cc642bf842f0ee64fee4acab67e775"
    targetBranch: "main"
    targetHeadBeforeMerge: "9063575348b3c14e3a005e6bda0c761ad2cc6c98"
validationCiAttempts: 0
validationSemanticRounds: 2
updatedAt: "2026-08-24T21:23:47.295Z"
archivedAt: "2026-08-24T21:23:47.295Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/personal-remote-workspace-v1/15-complete-workspace-session-navigation-and-timeline-ux.md"
---

# Complete Workspace Session Navigation and Timeline UX

## Context

The verified phone tracer bullet already provides paired-owner routes for listing cataloged Sessions, reading committed
history, preparing legacy Sessions, and continuing one idle Ideator Session. This slice turns that narrow path into the
smallest complete Workspace Session product. The entry path is a plain **Projects → Sessions → Session** list; the
Attention Dashboard remains in the v2 Epic.

The current browser service cannot create a Session, answer a live structured interaction, continue Agents other than
Ideator, or recover an expired Session Activation. The owner wants Workspace creation to start the normal Router path,
and wants ordinary continuation to follow shared Runtime policy for idle conversational Agents. A Session with an active
workflow remains read-only until slice 16 supplies its Plan actions.

The owner also chooses an explicit forced-control policy. Workspace must not take control while a live owner renews its
Session Activation. After the stored heartbeat deadline passes, the owner can accept the risk and force recovery. The
recovery trusts an unambiguous, structurally valid current transcript even when coordination metadata is behind it. It
must adopt valid transcript-ahead entries instead of blocking only because RunWield's metadata disagrees. Corrupt JSONL,
changed sealed segments, ambiguous lineage, or an invalid current transcript still block because no safe history exists
to resume. A superseded owner cannot publish coordination state after the force action.

A completed Pi tool or interaction result is committed history. A still-pending interaction belongs to the live process.
Workspace can display and answer that wait only when its own process owns the operation. If that process is lost, the
wait is not recreated; the same browser replaces it with one plain line: **The agent was interrupted. Ask it to
continue.**

Deferred to slice 17: attachments, filters, recent-activity views, segment/recovery-event chrome, recovery for damaged
transcripts, and richer execution/degraded-state presentation.

## Objective

- Provide phone- and desktop-ready Project, Session-list, and Session-detail navigation without a dashboard dependency.
- Create a managed Session from Workspace and run its first User Request through Router with normal Agent handoffs.
- Continue an idle conversational Agent through shared Runtime policy when no active workflow owns the Session; keep
  active workflows read-only until slice 16.
- Render aggregate committed messages, thinking, completed tools/interactions, and workflow events with stable keys.
- Render and answer a Workspace-owned live Pending Structured Interaction without treating it as committed history.
- After Workspace owner-process loss, remove the stale wait and show one interruption line that invites a normal retry.
- Keep a renewing TUI, Workspace, or Agent Client Protocol (ACP) owner in control. After its heartbeat deadline, offer
  an explicit owner-confirmed force action that resumes from valid transcript truth and fences the old owner.
- Preserve unsent message and interaction drafts across refresh/reconnect. Reject races without automatic replay.

## Approach

Keep `WorkspaceSessionContinuationService` as the browser-facing application service, but remove its Ideator-only
policy. It must delegate Session creation, Agent selection, handoffs, managed prompting, and interaction lifecycle to
`SessionRuntime`. The service may shape safe browser data; it must not build another Agent allowlist or workflow engine.

```text
New Session + first User Request
  POST /api/owner/projects/:projectId/sessions
  WorkspaceSessionContinuationService.createSession
  SessionRuntime.createInteractiveSession (managed, deferred until Agent-ready)
  SessionRuntime.promptUserTurn (Router)
  operation polling / live interaction answer
  committed generation → stable Session detail URL

Existing idle Session
  committed projection → shared continuation eligibility
  POST .../continue with exact generation
  SessionRuntime.adoptManagedSession → promptUserTurn
  operation polling → committed projection replaces transient events
```

Add one shared, explicit expired-control recovery operation. The application service first validates the complete
segment manifest and current transcript. The owner-coordination transaction then compares the stale fence and heartbeat
deadline, bumps the fence, and makes the validated transcript evidence current. An exact committed file returns the
Session to idle without inventing history. A valid transcript-ahead file publishes the next committed generation before
idle. The subsequent message uses the normal acquire-and-prompt path.

```text
active + heartbeat before deadline  → wait; force action disabled
active/uncertain + deadline passed  → owner confirms risk
valid exact or valid transcript-ahead history
                                   → fence old owner; publish evidence; idle
corrupt/ambiguous history           → block and send user to transcript recovery
```

This is not automatic replay. The confirmation must say that an old process or external command can still finish and
cause side effects. The option set aside is cooperative handoff: it would be safer for a healthy owner but would not
recover a blocked or dead process, so this slice uses deadline-gated explicit force instead.

## Files to Modify

- `docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md` — replace the absolute
  heartbeat-timeout prohibition with the owner-confirmed, transcript-validated expired-control rule; retain fencing and
  the ban on automatic replay.
- `docs/prd/runwield-workspace-prd.md` — align first-version Session creation, continuation, and explicit
  expired-control recovery acceptance criteria with the chosen product behavior.
- `docs/domain-language.md` — define the proposed **Forced Session Control Recovery** term, its deadline and transcript
  preconditions, and its relationship to Session Control, Session Activation, and Pending Structured Interaction.
- `src/shared/owner-coordination/session-activations.js` and `index.js` — add the shared
  `recoverExpiredSessionControl()` fenced transaction. It accepts a specific expired activation/uncertain state plus
  validated transcript evidence, advances the fence, adopts a valid transcript-ahead generation when needed, and returns
  the Session to idle.
- `src/shared/owner-coordination/session-activations.test.js` — prove deadline gating, stale-fence rejection, exact-file
  recovery, transcript-ahead generation adoption, and superseded-owner publication rejection.
- `src/shared/session/session-runtime.js` and focused tests — expose shared eligibility/recovery outcomes needed by all
  adapters; use normal Router creation and persisted-Agent resume paths without a browser-owned Agent policy or new
  injection seam.
- `src/shared/session/session-transcript-projection.js` or a focused sibling module — validate the full current
  transcript and produce bounded evidence for expired-control recovery; do not put JSONL parsing in Workspace.
- `src/ui/workspace/routes/owner-session-api.js` and `src/ui/workspace/server.js` — register authenticated,
  Project-bound, CSRF-protected create, continue, live-interaction answer, and force-recovery endpoints with sanitized
  results.
- `src/ui/workspace/server/session-continuation.js` — own browser operations, Router-led creation, shared-policy
  continuation, live Workspace interaction routing, operation-loss detection, and calls to the shared forced-recovery
  boundary.
- `src/ui/workspace/pages/projects/[projectId]/sessions/index.astro` and `[runwieldSessionId].astro` — provide the final
  list/detail hierarchy and plain-language page copy.
- `src/ui/workspace/components/SessionList.jsx`, `SessionTimeline.jsx`, and `SessionActivationStatus.jsx` — add the New
  Session entry, complete event cards, live interaction/interruption items, active-owner countdown, force eligibility,
  and read-only workflow states.
- `src/ui/workspace/islands/SessionSurface.jsx` — manage create/continue operations, exact request envelopes, bounded
  polling, process-local interaction answers, force confirmation, committed reconciliation, and Project/Session-scoped
  local drafts.
- `src/ui/workspace/static/workspace.css` — complete responsive phone/desktop layout, touch targets, safe-area composer,
  live-wait and interruption distinction, confirmation treatment, focus, and long-content handling with `--rw-*` tokens.
- `src/ui/workspace/owner-workspace.test.js` and `workspace-session-ux.test.tsx` — cover route security, rendering,
  browser state decisions, force confirmation, draft persistence, and sanitized failures.
- `docs/design-system.md` — document Session timeline, mobile composer, and explicit high-risk confirmation only where
  the implementation creates reusable patterns.

## Reuse Opportunities

- `SessionRuntime.createInteractiveSession()`, `promptUserTurn()`, `adoptManagedSession()`, and persisted active-Agent
  resolution — use the same managed creation and Agent handoff behavior as other Runtime consumers.
- `projectAggregateTranscript()` and `captureTranscriptEvidence()` — validate and render canonical Session history; do
  not concatenate or parse JSONL in Workspace components.
- `acquireSessionActivation()` and fence checks — extend the existing owner, generation, segment, and proof transaction
  instead of deleting a lease row or adding a browser bypass.
- `WorkspaceSessionContinuationService` operation receipts and bounded event buffer — retain exact-request idempotency
  and transient-to-committed replacement.
- `SessionSurface`, `SessionTimeline`, `SessionList`, and `SessionActivationStatus` from slice 5 — deepen these existing
  components instead of creating a second Session frontend.
- `src/ui/design-system/components/react/RunWieldPrimitives.jsx`, `workspace.css`, and semantic `--rw-*` tokens —
  preserve the current Workspace visual system.

## Implementation Steps

- [ ] The shared Session policy returns a typed read/continue decision from committed authority facts. It permits idle
      conversational Agent resume through the persisted active Agent, rejects an active execution workflow, stale
      generation, incomplete projection, and active owner, and does not use `SessionSnapshot` display state as
      authority.
- [ ] `WorkspaceSessionContinuationService.createSession()` starts one managed Session in the selected registered
      Project, activates Router, submits the exact first User Request, follows normal Router handoffs, and returns one
      stable RunWield Session ID plus an opaque operation ID. Exact duplicate request IDs never create a second Session
      or turn.
- [ ] Existing continuation calls `SessionRuntime.promptUserTurn()` with the persisted Agent and normal Agent-handler
      composition. The Ideator-only `AGENTS.IDEATOR` check and `WORKSPACE_IDEATOR_CONVERSATION_TOOLS` restriction no
      longer decide eligibility. A Session with active workflow context remains readable and its composer explains that
      slice 16 Plan actions are required.
- [ ] Workspace-owned operations expose at most one current Pending Structured Interaction with a bounded safe payload.
      An authenticated answer endpoint routes the exact answer only to the still-live matching Workspace operation and
      interaction ID. It cannot answer a TUI/ACP wait or recreate a lost Promise.
- [ ] A lost Workspace operation clears its transient wait. The Session surface uses retained local operation state to
      render exactly one plain interruption item, keeps any unsent draft, reloads committed history, and never submits a
      replacement User Request automatically.
- [ ] The shared forced-recovery boundary requires an explicit request, an activation whose heartbeat deadline has
      passed (or the matching heartbeat-expired uncertain state), the expected fence/current segment/generation, and a
      fully valid ordered manifest. It rejects a healthy renewing owner before any state change.
- [ ] Forced recovery accepts both an exact committed current transcript and an unambiguous structurally valid
      transcript-ahead extension. It bumps the fence, adopts transcript-ahead evidence as exactly the next committed
      generation when present, clears stale owner fields, and returns idle. It rejects malformed JSONL, a changed sealed
      segment, invalid lineage, truncation, or a non-prefix rewrite without changing canonical coordination facts.
- [ ] After forced recovery, the superseded owner cannot heartbeat, change phase, or publish a generation. The
      recovering owner is not blocked only because the old activation or operation metadata still exists; its next
      message goes through the ordinary fresh acquisition path. A later stale append is detected as transcript-ahead
      evidence rather than silently overwritten.
- [ ] Session list/detail APIs expose only user-safe state: active surface, whether control is still renewing, when
      force becomes available, and a stable recovery category. They expose no owner instance, operation receipt
      internals, fence, local path, transcript bytes, or raw database error.
- [ ] The Session list includes a labeled first-User-Request form and clear loading/empty/error states. Successful
      creation navigates to the stable Session detail route without waiting for a second catalog scan.
- [ ] The timeline reducer renders committed user/Agent messages, thinking, completed tool calls/results, completed
      interaction outcomes, and workflow/status events with aggregate `eventId` keys. Unknown events remain harmless.
      Transient operation items use operation-local keys and are wholly replaced after committed reconciliation.
- [ ] The detail surface shows a Workspace-owned live interaction, active-owner status/countdown, an explicit **Take
      control** confirmation only after expiry, a read-only active-workflow message, and a localStorage-backed composer.
      A stale generation or competing request preserves text and requires refresh plus explicit resubmission.
- [ ] Phone and desktop layouts use semantic headings, lists, forms, `aria-live`, non-color status text, visible focus,
      touch-sized controls, safe-area spacing, long-content wrapping, and existing RunWield primitives/tokens. No new
      visual pattern bypasses the shared design-system layer.
- [ ] The ADR, Workspace PRD, and domain glossary land with the code. They distinguish explicit Forced Session Control
      Recovery from automatic takeover, state the accepted external-side-effect risk, and keep corrupt or ambiguous
      transcript recovery out of this slice.
- [ ] Existing slice 5 continuation behavior and tests survive under the completed routes. Tests are rewritten against
      shared continuation policy where the old Ideator-only expectation intentionally stops existing; they are not
      deleted merely because component or route shapes changed.

## Approval Confirmation

No Work Record is superseded by this Plan.

## Verification Plan

- Automated: run focused behavioral suites with
  `deno run -A scripts/run-tests.js src/shared/owner-coordination/session-activations.test.js
  src/shared/session/expired-activation-takeover.integration.test.ts
  src/ui/workspace/session-navigation.integration.test.ts
  src/ui/workspace/owner-workspace.test.js src/ui/workspace/workspace-session-ux.test.tsx`.
- Automated: run `deno task workspace:check`, `deno task workspace:test`, `deno task workspace:build`,
  `deno task seams:check`, and `deno task ci`.
- Automated: Router creation coverage proves one request creates one stable managed Session, starts with Router, follows
  a fixture handoff, commits the first turn, and returns a detail URL; duplicate and ambiguous HTTP delivery cannot
  create a second Session or turn.
- Automated: continuation coverage proves an idle Ideator, Guide, Router, or Planner conversation resumes through its
  persisted Agent with no workflow context, while active workflow, active owner, stale generation, and incomplete
  projection remain read-only. Adjust the exact conversational-Agent matrix to the shared Runtime policy rather than a
  browser allowlist.
- Automated: forced-control coverage uses two independent owner stores/Runtimes. Before the deadline the force request
  changes nothing. After the deadline, exact-file and valid transcript-ahead cases become idle and resumable; the latter
  publishes one generation. The stale owner cannot publish. Corrupt, rewritten, truncated, sealed-segment, and ambiguous
  lineage cases remain blocked with unchanged coordination facts.
- Automated: interaction and local-state coverage proves a live Workspace wait accepts one matching answer; wrong,
  repeated, TUI/ACP, and post-process-loss answers fail. Reload removes the wait, shows one interruption line, retains
  the draft, and does not auto-replay. Force confirmation cannot be bypassed by component state alone.
- Automated: owner route tests prove paired-device, registered-Project, exact-Origin, and CSRF requirements and confirm
  that responses contain no root, transcript path/body, activation proof, owner instance, operation receipt internals,
  fence, raw tool arguments, or database errors.
- Manual production setup: run `deno task workspace:build`, then start the normal paired owner server with Session
  Activation enabled. Use `deno task workspace:dev` at `http://127.0.0.1:5173` only for hot-module visual work; verify
  authentication and real APIs against the production owner-server URL.
- Manual phone check at approximately 390×844: open Projects → Sessions, create a Session with a general User Request,
  watch Router hand off, answer one live interaction, reload with an unsent draft, and confirm timeline and composer
  have no overlap, clipping, or inaccessible controls.
- Manual cross-surface check: continue one idle Session Workspace → TUI → Workspace and verify one stable identity and
  linear committed history. While TUI renews control, confirm **Take control** is unavailable. Stop its process, wait
  for the displayed deadline, accept the warning, force control, and submit one message from the valid current
  transcript.
- Manual risk check: before confirming force, verify the dialog states that a prior command or process may still finish.
  Confirm that cancel changes nothing. Confirming must not claim to undo, replay, or know the outcome of external
  effects.
- Manual corruption check: damage a disposable current transcript and confirm force control remains blocked with plain
  recovery guidance rather than truncating or trusting malformed history.
- Expected result: a paired owner can create and continue ordinary Sessions from a phone, understand live versus
  committed state, deliberately recover expired control from valid transcript truth, and never get an automatic replay
  or a false claim that uncertain external effects were canceled.

## Edge Cases & Considerations

- **User-accepted side-effect risk:** an expired heartbeat does not prove that an old command, subprocess, or network
  request stopped. The explicit confirmation is the risk boundary. RunWield fences later coordination publication but
  cannot undo external effects.
- **Old process revival:** the old proof must fail immediately. Its Runtime must stop further managed mutation when it
  observes fencing. If it appended after the adopted prefix, the next writer detects transcript-ahead evidence again; it
  must not silently overwrite bytes.
- **Transcript truth:** “trust the file” means valid JSONL, one unambiguous lineage, unchanged sealed history, and a
  valid extension of the committed current prefix. It does not mean accepting malformed bytes or guessing between
  branches.
- **Interaction lifetime:** browser disconnect does not end a live wait while the Workspace process remains alive.
  Process loss ends answerability; local UI state can explain interruption but cannot recreate the Promise.
- **Creation failure:** no list card may claim a usable Session before the managed catalog record and generation exist.
  An accepted but unsettled create request uses its original request ID and operation status; it never starts over under
  a new ID automatically.
- **Authority:** Aggregate Transcript Projection and SessionSnapshot remain display projections. Creation, continuation,
  forced recovery, and interaction answers must pass through their shared Runtime/owner authorities.
- **Scope:** active-workflow Plan actions arrive in slice 16. Attachments, filters, recent activity, segment/recovery
  chrome, and damaged-transcript repair remain in slice 17 or later.
- **Compatibility:** keep paired-device authorization, Project containment, unmanaged Session behavior, stable Session
  IDs, aggregate cursors, TUI/ACP synchronization, operation idempotency, and the zero-seam baseline.
