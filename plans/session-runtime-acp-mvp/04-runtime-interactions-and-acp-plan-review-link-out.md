---
planId: "85b9ba1e-533a-49d9-8466-31cce5d49f6e"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add adapter-neutral interaction handling for structured prompts and implement ACP-specific plan_written behavior that shares plans and returns a review URL instead of attempting rich ACP-native review UI."
affectedPaths:
    - "src/shared/session/session-runtime-interactions.js"
    - "src/shared/session/session-runtime-events.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/ui/api.js"
    - "src/tools/user-interview.js"
    - "src/tools/plan-written.js"
    - "src/shared/workflow/submit-plan.js"
    - "src/cmd/plans/share.js"
    - "src/acp/interaction-mapper.js"
    - "src/acp/event-mapper.js"
    - "src/acp/server.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/acp/server.test.js"
    - "src/cmd/plans/share.test.js"
frontend: false
createdAt: "2026-07-07T02:13:46.229Z"
updatedAt: "2026-07-08T03:32:59.422Z"
status: "implemented"
origin: "internal"
parentPlan: "session-runtime-acp-mvp"
order: 4
dependencies:
    - "03-runtime-event-contract-and-acp-prompt-streaming"
failureReason: "Semantic validation did not approve after 3 cycles."
worktreeId: "61abb47e"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-harns--/harns-runwield-session-runtime-acp-mvp-04-runtime-interactions--61abb47e"
worktreeBranch: "runwield/worktree/session-runtime-acp-mvp-04-runtime-interactions--61abb47e"
worktreeBaseBranch: "main"
worktreeStatus: "validation_failed"
---

# Runtime Interactions and ACP Plan Review Link-Out

## Context

This is child FEATURE 04 under the approved `session-runtime-acp-mvp` Epic. Product intent is sourced from ADR-010, the
parent Epic, and the request for this slice: ACP is a sibling adapter over `SessionRuntime`; structured prompts should
not depend on TUI prompt widgets; ACP plan review should share/link out to Shared Plan/Plannotator instead of trying to
recreate the rich local browser review UI inside ACP.

Slice 03 is now verified and the current code has real ACP `session/new`, `session/prompt`, `session/cancel`, runtime
event emission, and ACP `session/update` mapping. What is still missing is the interaction half of the runtime boundary:
`src/tools/user-interview.js` still asks through `uiAPI.promptSelect`/`promptText`, the ACP runtime UI deliberately
rejects those prompts, and `src/tools/plan-written.js` always calls the blocking local `submitPlanForReview()` path.
Also note that the TUI UI API lives in `src/ui/tui/api.js`/`types.js`; the older `src/shared/ui/api.js` path does not
exist in the current tree.

## Objective

Build the adapter-neutral interaction broker promised by ADR-010 and use it for structured prompts. Preserve TUI prompt
behavior, add ACP mappings for supported structured prompts, and implement ACP-specific `plan_written` link-out
behavior.

The completed slice should provide:

- A pure-JavaScript/JSDoc `SessionRuntime` interaction contract for select, text, approval/permission-like decisions,
  canceled, unsupported, and blocked outcomes.
- HostedSession-scoped active interaction tracking so cancellations and unsupported clients settle deterministically
  instead of hanging an agent turn.
- TUI prompt compatibility: existing `promptSelect`/`promptText` rendering and result shapes still work.
- ACP structured prompt support for `user_interview` via ACP `client/elicitation/create` form requests when the client
  advertises form elicitation support.
- Clear unsupported/canceled `user_interview` tool results when an ACP client cannot answer a required prompt.
- ACP `plan_written` behavior that creates or reuses a Shared Plan review link, emits a runtime/ACP update containing
  the reviewer URL, returns a terminating `saved` tool result with review URL metadata, and does **not** call the local
  browser review or save-vs-execute prompts.
- Existing TUI `plan_written` behavior unchanged: local Plannotator browser review, approval/feedback handling, and
  save-vs-execute flow remain the TUI path.

## Approach

Add `src/shared/session/session-runtime-interactions.js` as the canonical broker and typedef module. Keep the contract
small and adapter-neutral: requests carry a kind, prompt/message, options/schema fields, optional defaults, session/tool
metadata, and a stable interaction id; responses normalize to accepted/selected/text/canceled/unsupported/blocked with
safe metadata. `HostedSession` should own the current interaction adapter, adapter metadata such as
`{ kind: "tui" | "acp" }`, and active interaction ids so state stays session-scoped.

Use the broker from tools, not direct ACP code. Update tool wiring in `src/shared/session/session.js` so
`createUserInterviewTool()` receives the `HostedSession` as well as `uiAPI`, while retaining backwards-compatible tests
that instantiate it with only a UI. In TUI sessions, install an interaction adapter that delegates to the existing
`src/ui/tui/api.js` prompt widgets. In ACP sessions, install an adapter from `src/acp/interaction-mapper.js` during
`session/prompt`; it should call `methods.client.elicitation.create` with `mode: "form"` only when the initialized ACP
client advertises `clientCapabilities.elicitation.form`. If form elicitation is absent, return an unsupported outcome
that `user_interview` translates into a deterministic tool result instead of throwing an unhandled prompt error.

For `plan_written`, branch before `submitPlanForReview()` when the HostedSession adapter metadata indicates ACP. Extract
the reusable Shared Plan publishing logic from `src/cmd/plans/share.js` into a helper that returns URL data without
printing. The helper should support both first-time sharing and safe reuse of an already remote-canonical Plan when
local secret material can reconstruct the reviewer URL. The ACP branch should emit a new `plan_review_link` runtime
event and return `details.outcome: "saved"` so existing workflow decision logic saves/stops rather than dispatching
execution. Do not record `review_approved`, `readiness_passed`, or `epic_readiness_passed` in this async link-out path;
actual approval/feedback ingestion is intentionally a later collaboration workflow.

Map `plan_review_link` to ACP as a `session/update` notification with readable text and `_meta.runwield` fields
including `type: "plan_review_link"`, `planName`, `reviewerUrl`, `spaceId`, and non-secret metadata. Emit the reviewer
URL intentionally because the user needs it; do not emit the maintainer URL through ACP. The CLI share command may keep
printing both reviewer and maintainer URLs as it does today.

## Files to Modify

- `src/shared/session/session-runtime-interactions.js` — new module defining JSDoc typedefs, constants, helpers, and the
  HostedSession-scoped broker for interaction request/response lifecycle.
- `src/shared/session/session-runtime-events.js` — add interaction lifecycle events if useful and add a dedicated
  `plan_review_link` event type/payload.
- `src/shared/session/session-runtime.js` — expose broker methods such as `requestInteraction()`, adapter installation,
  cancellation, and unsupported handling; ensure prompt/session cancellation settles active interactions.
- `src/shared/session/hosted-session.js` — store active interaction adapter, adapter metadata, and active interaction
  state with disposal cleanup.
- `src/shared/session/session.js` — pass `targetHostedSession` into `createUserInterviewTool`, install/update the
  broker-backed interaction adapter for active TUI prompts, and preserve existing plan_written HostedSession wiring.
- `src/ui/tui/api.js` — keep current prompt widgets as the TUI adapter implementation; add only minimal adapter helper
  code if needed.
- `src/ui/tui/types.js` — update JSDoc typedefs for any new prompt/adapter fields; no TypeScript syntax.
- `src/tools/user-interview.js` — accept `{ uiAPI, hostedSession }` options while preserving old construction; route
  yes/no, multiple-choice, text, and “Other” follow-up prompts through the broker when available; preserve existing
  result JSON for completed/canceled/validation cases.
- `src/tools/plan-written.js` — add the ACP link-out branch before `submitPlanForReview()`, return a terminating saved
  outcome with reviewer URL metadata, and keep TUI behavior unchanged.
- `src/shared/workflow/submit-plan.js` — no ACP flow should call this path; adjust only if a small shared preparation
  helper is needed without changing TUI browser review behavior.
- `src/cmd/plans/share.js` — extract `sharePlanForReview()`/similar helper that returns reviewer URL, maintainer URL,
  space id, server URL, revision, and created/reused metadata without console output; keep `runPlansShareCommand()` as a
  thin CLI wrapper that prints existing messages.
- `src/acp/interaction-mapper.js` — new ACP adapter mapping select/text interactions to `client/elicitation/create` form
  requests, converting accept/decline/cancel to broker outcomes, and returning unsupported when capabilities are absent.
- `src/acp/event-mapper.js` — map `plan_review_link` and any interaction status events to ACP `session/update`
  notifications without leaking maintainer secrets.
- `src/acp/server.js` — capture initialize client capabilities, install ACP interaction adapters on HostedSessions,
  route adapter notifications/requests through the ACP context, and include plan review URL updates in prompt streaming.
- `src/shared/session/session-runtime.test.js` — cover broker scoping, adapter install/remove, cancellation,
  unsupported, blocked, and plan review link events.
- `src/acp/server.test.js` — cover ACP form elicitation success/cancel/unsupported behavior and ACP `plan_written`
  review-link update/result behavior with no local review call.
- `src/cmd/plans/share.test.js` — cover stdout-free helper output, CLI wrapper output preservation, cleanup on partial
  failure, and already-shared URL reconstruction from local secrets.
- `src/tools/__tests__/user-interview.test.js` — preserve existing tool result tests and add broker-backed prompt
  coverage.
- `src/tools/__tests__/user-interview-combinations.test.js` — preserve the existing batch/Other combinations through the
  broker path.
- `src/tools/__tests__/plan-written.test.js` — add ACP link-out branch tests and assert TUI review lifecycle tests still
  pass.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/tools/user-interview.js` validation and result builders — keep the public tool result shape stable.
- `src/ui/tui/api.js` `promptSelect` and `promptText` — delegate the TUI interaction adapter to the existing widgets.
- `src/tools/plan-written.js` `textResult()` and triage-meta resolution — reuse for the ACP saved/terminating result.
- `src/cmd/plans/share.js` encryption, capability, client, URL, secret-store, cleanup, and collaboration metadata logic
  — extract rather than reimplement.
- `src/shared/collaboration/*` — use existing Shared Plan protocol, crypto, URLs, lock bypass, and secret helpers.
- `src/acp/event-mapper.js` and `methods.client.session.update` — reuse the slice 03 event streaming path for review
  link notifications.
- ACP SDK `methods.client.elicitation.create` — use standard form elicitation for structured user input when advertised
  by the client.

## Implementation Steps

- [ ] Step 1: Create `src/shared/session/session-runtime-interactions.js` with constants and JSDoc typedefs for select,
      text, permission/approval, link/blocking, response outcomes, adapter interface, and broker helpers.
- [ ] Step 2: Extend `HostedSession` with interaction adapter metadata, active interaction tracking, and disposal
      cleanup methods; keep all mutable interaction state session-scoped.
- [ ] Step 3: Add `SessionRuntime.requestInteraction(sessionOrId, request)` and cancellation helpers that emit lifecycle
      events, delegate to the installed adapter, normalize errors to unsupported/blocked/canceled outcomes, and never
      leave a pending interaction active after settlement.
- [ ] Step 4: Add `RuntimeEventTypes.PLAN_REVIEW_LINK` and, if useful, interaction requested/resolved/canceled events in
      `session-runtime-events.js` with safe payload typedefs.
- [ ] Step 5: Wire TUI sessions by installing a broker adapter that calls the existing `uiAPI.promptSelect()` and
      `uiAPI.promptText()` methods. Keep `src/ui/tui/api.js` prompt rendering and cancellation behavior unchanged.
- [ ] Step 6: Update tool auto-wiring in `src/shared/session/session.js` so `createUserInterviewTool()` receives both
      `uiAPI` and `targetHostedSession`; maintain backwards-compatible construction for direct unit tests.
- [ ] Step 7: Update `user_interview` to ask questions through the runtime broker when a HostedSession/broker is
      available. Preserve serial question behavior, “Other” follow-up prompts, validation error codes, canceled result
      shape, and completed answer details.
- [ ] Step 8: Implement `src/acp/interaction-mapper.js` to map broker select/text requests to ACP form elicitation: a
      single `answer` field, enum/oneOf values for select choices where possible, string field for text, and
      `action: "accept" | "decline" | "cancel"` conversion to broker outcomes.
- [ ] Step 9: Capture ACP initialize client capabilities in `src/acp/server.js` and pass `context.notify/request` hooks,
      ACP session id, and capability data into the ACP interaction adapter installed for each prompt-ready
      HostedSession.
- [ ] Step 10: Ensure ACP clients without form elicitation support receive a clear unsupported result for
      `user_interview` rather than the current rejected `promptSelect`/`promptText` error or a hanging prompt.
- [ ] Step 11: Extract the pure Shared Plan helper from `src/cmd/plans/share.js`. It should return URL metadata without
      printing, support cleanup on partial failures, and reconstruct an existing reviewer URL from local secret records
      when the Plan is already `remote_canonical`.
- [ ] Step 12: Update `runPlansShareCommand()` to call the extracted helper and retain current CLI stdout wording,
      including the maintainer URL warning.
- [ ] Step 13: Add an ACP branch in `plan_written`: detect `hostedSession` adapter metadata kind `"acp"`, call the share
      helper, emit `plan_review_link`, append a concise system message if safe, return `details.outcome: "saved"` with
      `planName`, `reviewerUrl`, `spaceId`, and `remoteReview: true`, set `terminate: true`, and skip local review,
      lifecycle readiness events, and save-vs-execute prompts.
- [ ] Step 14: Keep the non-ACP `plan_written` path byte-for-byte behaviorally equivalent: local review cancellation,
      feedback, PROJECT slicer/decomposition, and save/proceed outcomes should continue to pass existing tests.
- [ ] Step 15: Map `plan_review_link` in `src/acp/event-mapper.js` to a `session/update` notification with readable text
      plus `_meta.runwield`; assert maintainer URL/capability/content key do not appear in the mapped payload.
- [ ] Step 16: Add focused tests for broker lifecycle, ACP elicitation success/cancel/unsupported, `user_interview`
      result compatibility, Share helper return data/reuse, ACP `plan_written` link-out, and TUI `plan_written`
      regression coverage.

## Verification Plan

- Automated: run `deno test -A src/shared/session/session-runtime.test.js`.
- Automated: run `deno test -A src/acp/server.test.js src/acp/protocol-smoke.test.js`.
- Automated: run `deno test -A src/cmd/plans/share.test.js`.
- Automated: run
  `deno test -A src/tools/__tests__/user-interview.test.js src/tools/__tests__/user-interview-combinations.test.js src/tools/__tests__/plan-written.test.js`.
- Automated: run `deno test -A src/shared/workflow/submit-plan.test.js src/shared/session/session-subscribers.test.js`
  to guard TUI review/subscriber behavior.
- Automated: run `deno task check`.
- Automated: run `deno task ci` and fix all issues.
- Manual: in TUI mode, trigger `user_interview` with yes/no, multiple choice + Other, and text prompts; verify the same
  terminal prompt UI renders and the returned JSON shape matches existing behavior.
- Manual: in ACP mode with a client advertising `elicitation.form`, trigger `user_interview`; verify RunWield sends
  `client/elicitation/create`, accepts the response, continues the agent turn, and emits no non-protocol stdout.
- Manual: in ACP mode with a client that does not advertise form elicitation, trigger `user_interview`; verify the tool
  returns a deterministic unsupported/validation-style result and the prompt response settles without hanging.
- Manual: in TUI mode, call `plan_written` and verify the local Plannotator browser review, feedback revision loop,
  approval, and save-vs-execute prompt still work.
- Manual: in ACP mode, call `plan_written` from a planning agent and verify RunWield shares or reuses the Plan, emits a
  `session/update` containing the reviewer URL, returns a terminating `saved` result, does not launch a local browser,
  and does not start execution.
- Expected result: ACP remote planning no longer blocks on TUI-only prompts or local review UI; it either handles
  structured prompts via ACP elicitation or fails them deterministically, and it hands the user a Shared Plan review URL
  for plan review while TUI retains full local behavior.

## Edge Cases & Considerations

- Do not build rich ACP-native Plannotator annotation UI in this slice. The approved remote-control model is link-out to
  Shared Plan/Plannotator.
- ACP form elicitation is marked experimental in the SDK schema. Gate usage on advertised client capabilities and keep a
  deterministic unsupported fallback.
- Reviewer URLs contain secret capability material. Emit the reviewer URL intentionally to the ACP client, but never
  emit maintainer URL, content key, raw capabilities other than the reviewer URL, or secret-store paths through ACP
  updates or routine logs.
- If a Plan is already remote-canonical and local secrets are missing, fail with a clear repair/unsupported message
  rather than creating a second remote copy or pretending review was started.
- ACP link-out does not mean the Plan is approved. Do not record `review_approved`, readiness events, or dispatch
  execution from this path. Approval/feedback ingestion from the remote review is out of scope for this slice.
- Existing Shared Plan locking makes the shared Plan remote-canonical; after link-out, the agent should stop editing the
  local file. The terminating saved result enforces that workflow boundary.
- Generic ACP clients may not support custom RunWield metadata, but they should still display the human-readable URL in
  the `session/update` text.
- Same-session prompt cancellation should cancel or settle active interactions as well as model/tool execution.
- All code must remain pure `.js` with JSDoc typedefs; do not introduce TypeScript syntax.
