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
updatedAt: "2026-07-07T02:13:46.229Z"
status: "draft"
origin: "internal"
parentPlan: "session-runtime-acp-mvp"
order: 4
dependencies:
    - "03-runtime-event-contract-and-acp-prompt-streaming"
---

# Runtime Interactions and ACP Plan Review Link-Out

## Context

RunWield tools currently ask the user through a TUI-shaped `UiAPI`, especially `user_interview` select/text prompts and
`plan_written` plan review flows. ACP can support simple structured interactions, but it should not attempt to become a
rich Plannotator UI. For remote control, plan review should lean into existing Shared Plan/Plannotator link-out: when
`plan_written` runs under ACP, RunWield should share the plan, emit a reviewer URL, return a saved/waiting-for-review
tool result immediately, and stop the agent turn.

## Objective

Create an adapter-neutral runtime interaction broker for select/text/approval-like requests, preserve TUI prompt
behavior through that broker, and add ACP mappings for supported interactions. Implement ACP-specific `plan_written`
behavior that creates or reuses a Shared Plan review link and returns immediately instead of opening a local browser or
blocking for Plannotator approval.

## Approach

Add `session-runtime-interactions.js` with JSDoc typedefs for interaction requests, responses,
unsupported/canceled/blocked outcomes, and broker lifecycle. The TUI adapter should answer interactions using existing
prompt widgets. The ACP adapter should map simple structured prompts to standard ACP primitives where semantically
valid, use RunWield extension metadata/methods where needed, and fail deterministically when a generic ACP client cannot
answer.

For `plan_written` under ACP, avoid the existing blocking browser review path. Extract reusable Shared Plan creation
logic from `src/cmd/plans/share.js` into a helper that returns reviewer/maintainer URL data instead of printing to
stdout. `plan_written` can detect an ACP/runtime external mode through the HostedSession/runtime interaction context,
share the plan, emit a runtime event containing the review URL and metadata, and return a tool result indicating that
the plan was saved/shared and the agent should stop generating. Approval/feedback ingestion remains a later
collaboration workflow unless an existing safe pull/push flow can be reused without expanding scope.

## Files to Modify

- `src/shared/session/session-runtime-interactions.js` — new adapter-neutral interaction typedefs and broker
  implementation for select, text, approval/permission-like, unsupported, canceled, and blocked outcomes.
- `src/shared/session/session-runtime-events.js` — add events for interaction lifecycle and plan review URL
  availability.
- `src/shared/session/session-runtime.js` — attach the interaction broker to sessions and expose adapter hooks for
  answering/canceling interactions.
- `src/shared/session/hosted-session.js` — store active interaction state and adapter/runtime mode metadata if needed.
- `src/shared/ui/api.js` — adapt TUI `promptSelect`/`promptText` behavior to the broker or provide a broker-backed UI
  adapter while preserving existing UI behavior.
- `src/tools/user-interview.js` — route structured questions through the adapter-neutral interaction surface while
  preserving result format and validation.
- `src/tools/plan-written.js` — detect ACP/runtime link-out mode and return saved/waiting-for-review after emitting a
  Shared Plan URL instead of blocking for browser review.
- `src/shared/workflow/submit-plan.js` — keep existing TUI browser review behavior; factor shared preparation only if
  needed by ACP link-out.
- `src/cmd/plans/share.js` — extract reusable Shared Plan creation logic that can return URLs without console output.
- `src/acp/interaction-mapper.js` — map runtime interaction requests/responses to ACP standard primitives or RunWield
  extension messages.
- `src/acp/event-mapper.js` — map plan review URL events and interaction lifecycle events to ACP `session/update`
  notifications.
- `src/acp/server.js` — wire ACP interaction handling into session prompt execution.
- `src/shared/session/session-runtime.test.js` — cover broker scoping, answer/cancel/unsupported behavior, and plan
  review link events.
- `src/acp/server.test.js` — cover ACP structured prompts, unsupported clients, and `plan_written` link-out behavior.
- `src/cmd/plans/share.test.js` — update or add tests for reusable Shared Plan helper output and stdout-free usage.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/tools/user-interview.js` — preserve validation, batch handling, answer result shape, and Other handling.
- `src/shared/ui/api.js` `promptSelect` and `promptText` — use as the TUI adapter implementation for brokered
  select/text interactions.
- `src/tools/plan-written.js` — preserve TUI behavior and branch only for ACP/runtime external adapter mode.
- `src/cmd/plans/share.js` — reuse encryption, capability, collaboration client, URL building, secret storage, and
  collaboration metadata update behavior.
- `src/shared/collaboration/*` — reuse Shared Plan protocol, crypto, URL, lock, and secret helpers.
- `src/shared/workflow/submit-plan.js` — reuse plan front matter preparation concepts while avoiding local browser
  launch in ACP mode.

## Implementation Steps

- [ ] Step 1: Define interaction request/response typedefs and broker lifecycle in
      `src/shared/session/session-runtime-interactions.js`.
- [ ] Step 2: Add HostedSession-scoped active interaction tracking, cancellation, and unsupported outcome handling.
- [ ] Step 3: Wire `SessionRuntime` so tools can access an adapter-neutral interaction surface through the active
      HostedSession/UI adapter.
- [ ] Step 4: Preserve TUI `promptSelect` and `promptText` behavior by implementing the TUI side of the broker with
      existing prompt blocks.
- [ ] Step 5: Update `user_interview` to use the brokered select/text interactions while preserving current tool result
      JSON exactly where possible.
- [ ] Step 6: Implement ACP interaction mapping for supported select/text/permission-like flows and deterministic
      unsupported/canceled responses for clients that cannot answer.
- [ ] Step 7: Extract reusable Shared Plan creation from `src/cmd/plans/share.js` into a function that returns reviewer
      URL, maintainer URL, space id, and metadata without printing.
- [ ] Step 8: Update `runPlansShareCommand` to call the extracted helper and retain existing CLI console output.
- [ ] Step 9: Add ACP/runtime branch in `plan_written` that prepares/shares the plan, emits a plan review URL runtime
      event, returns a saved/waiting-for-review tool result, and instructs the agent to stop generating.
- [ ] Step 10: Ensure TUI `plan_written` still uses the existing local Plannotator browser review and approval flow.
- [ ] Step 11: Add tests for broker resolution/cancel/unsupported, ACP user_interview handling, and ACP `plan_written`
      link-out.

## Verification Plan

- Automated: run `deno test -A src/shared/session/session-runtime.test.js` for broker scoping and outcomes.
- Automated: run `deno test -A src/acp/server.test.js` for ACP interaction and plan review URL mapping.
- Automated: run
  `deno test -A src/cmd/plans/share.test.js src/tools/user-interview.test.js src/tools/plan-written.test.js` if present,
  or the closest existing tests for those modules.
- Automated: run `deno run ci` and fix all issues.
- Manual: in TUI mode, trigger `user_interview` and verify select/text prompts still render and return answers as
  before.
- Manual: in ACP mode, trigger a `user_interview` prompt and verify supported clients can answer or unsupported clients
  receive deterministic unsupported/canceled behavior without hanging.
- Manual: in TUI mode, call `plan_written` and verify the existing local Plannotator browser review flow still works.
- Manual: in ACP mode, call `plan_written` from a planning agent and verify RunWield shares the plan, emits a reviewer
  URL as an ACP update, returns a saved/waiting-for-review tool result, and stops the agent turn.
- Expected result: ACP remote planning no longer blocks on rich local UI; it hands the user a review URL while TUI
  retains full browser review behavior.

## Edge Cases & Considerations

- Do not build rich ACP-native Plannotator annotation UI. Link-out via Shared Plan/Plannotator URL is the intended
  remote-control model.
- Reviewer and maintainer URLs contain secrets. Emit the reviewer URL to the ACP client intentionally, but avoid logging
  secret material to stderr/stdout outside protocol frames.
- Existing Shared Plan locking may prevent normal writes after sharing; ensure `plan_written` returns a clear result and
  does not continue editing the now remote-canonical plan.
- Generic ACP clients may not support custom interaction methods; unresolved interactions must fail deterministically
  rather than hang.
- TUI `plan_written` must not accidentally switch to the ACP asynchronous path.
- Approval/feedback ingestion after remote review is out of scope unless safely available through existing collaboration
  flows without expanding this slice.
