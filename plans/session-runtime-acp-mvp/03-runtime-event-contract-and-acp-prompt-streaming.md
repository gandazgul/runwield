---
planId: "e5da8864-40d4-4e5d-aac6-7710a90e8c22"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Define adapter-neutral SessionRuntime events and implement real ACP session/new, session/prompt streaming, same-session concurrency rejection, and cancellation over the runtime."
affectedPaths:
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-runtime-events.js"
    - "src/shared/session/session.js"
    - "src/shared/session/hosted-session.js"
    - "src/acp/server.js"
    - "src/acp/session-map.js"
    - "src/acp/event-mapper.js"
    - "src/acp/protocol-smoke.test.js"
    - "src/acp/server.test.js"
    - "src/shared/session/session-runtime.test.js"
frontend: false
createdAt: "2026-07-07T02:13:46.228Z"
updatedAt: "2026-07-07T02:13:46.228Z"
status: "draft"
origin: "internal"
parentPlan: "session-runtime-acp-mvp"
order: 3
dependencies:
    - "02-sessionruntime-core-for-tui-preserved-prompting"
---

# Runtime Event Contract and ACP Prompt Streaming

## Context

After `SessionRuntime` exists, ACP can become a real sibling adapter by creating sessions and sending prompt turns
through the same runtime path as TUI. To make that useful, runtime-level events need to decouple agent stream/subscriber
output from TUI rendering and map those events to ACP `session/update` notifications.

## Objective

Add adapter-neutral `SessionRuntime` event definitions and implement ACP `session/new`, `session/prompt`, and
`session/cancel` over the runtime. ACP clients should receive session updates for user messages, assistant text chunks,
thinking chunks, tool lifecycle, system/status messages, turn lifecycle, cancellations, usage where available, and
errors. Same-session overlapping prompts should be rejected deterministically for the MVP.

## Approach

Introduce `session-runtime-events.js` with documented JSDoc event typedefs and helper emitters. Adapt the existing
session subscriber path in `session.js` so it can emit runtime events without assuming a TUI-shaped `UiAPI` or falling
back to `console.log`. The TUI adapter can still render via its UI API, but ACP should subscribe to runtime events and
map them to ACP `session/update` messages. Implement a per-ACP-session map that binds ACP ids to HostedSession ids, cwd,
active prompt state, and cancellation state.

## Files to Modify

- `src/shared/session/session-runtime.js` — add event subscription/emission support and emit
  turn/session/user/system/error/cancellation events from runtime operations.
- `src/shared/session/session-runtime-events.js` — new JSDoc event typedefs and helper functions for adapter-neutral
  runtime event payloads.
- `src/shared/session/session.js` — decouple stream subscriber output from TUI-only rendering and route
  assistant/thinking/tool/usage/status events to the runtime event sink when present.
- `src/shared/session/hosted-session.js` — add event sink/subscriber storage only if needed for per-session runtime
  event routing.
- `src/acp/server.js` — implement real `session/new`, `session/prompt`, and `session/cancel` handlers over
  `SessionRuntime`.
- `src/acp/session-map.js` — new ACP-to-HostedSession mapping, cwd guard, active prompt tracking, cancellation tracking,
  and same-session overlap rejection.
- `src/acp/event-mapper.js` — map runtime events to ACP `session/update` notifications using standard ACP update shapes
  where possible.
- `src/acp/protocol-smoke.test.js` — expand smoke coverage to a minimal initialize/new/prompt flow without TUI.
- `src/acp/server.test.js` — cover capabilities, new, prompt update streaming, cancel stopReason, invalid session, and
  overlap rejection.
- `src/shared/session/session-runtime.test.js` — cover event emission and cancellation semantics at runtime level.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session.js` `attachUiSubscribers()` — reuse its current mapping from pi-agent stream events to
  human-visible concepts as the source for runtime event names.
- `src/shared/session/session.js` `abortActiveSession()` — use for ACP cancellation.
- `src/shared/session/session-runtime.js` from the previous slice — use as the only ACP path into RunWield prompting.
- `src/shared/session/hosted-session.js` — keep event/cancellation state scoped to the HostedSession.
- ACP SDK request/notification helpers — use official protocol registration and notification sending where feasible.

## Implementation Steps

- [ ] Step 1: Define runtime event typedefs for session lifecycle, replay placeholder, user message, assistant
      text/thinking chunks, tool start/update/end, system/status, turn start/end, usage, cancellation, and terminal
      errors.
- [ ] Step 2: Add event subscription/emission to `SessionRuntime` with HostedSession-scoped event routing and
      deterministic unsubscribe behavior.
- [ ] Step 3: Modify session subscriber attachment in `session.js` so the same pi-agent events can be routed to runtime
      events without writing to stdout or assuming a TUI.
- [ ] Step 4: Ensure TUI rendering still uses the existing UI API path while ACP uses runtime event subscriptions.
- [ ] Step 5: Implement `src/acp/session-map.js` to create and track ACP sessions backed by HostedSessions and reject
      same-session overlapping prompt turns.
- [ ] Step 6: Implement ACP `session/new` to create a runtime session for an absolute cwd and return a stable session
      id.
- [ ] Step 7: Implement ACP `session/prompt` to emit the user message, run `SessionRuntime.promptSession`, stream mapped
      updates, and resolve with a stop reason.
- [ ] Step 8: Implement ACP `session/cancel` to cancel active runtime work and cause the in-flight prompt to resolve as
      cancelled rather than throwing an unhandled error.
- [ ] Step 9: Add focused tests for event mapping, prompt streaming, cancellation races, overlap rejection, invalid
      session ids, and stdout/stderr separation.

## Verification Plan

- Automated: run `deno test -A src/shared/session/session-runtime.test.js`.
- Automated: run `deno test -A src/acp/server.test.js src/acp/protocol-smoke.test.js`.
- Automated: run existing `src/shared/session/session-subscribers.test.js` and related session tests to confirm TUI
  subscriber behavior remains intact.
- Automated: run a repository search guard or test assertion that ACP modules do not import
  `src/shared/interactive/chat-session.js`.
- Automated: run `deno run ci` and fix all issues.
- Manual: run `wld acp`, initialize, create a session, submit a simple prompt, and verify valid ACP `session/update`
  notifications stream on stdout.
- Manual: start a long-running prompt, send `session/cancel`, and verify the prompt resolves as cancelled and the same
  session can accept another prompt.
- Manual: send a second `session/prompt` for the same ACP session while one is active and verify a deterministic
  invalid-state error.
- Expected result: ACP can drive a live RunWield prompt through `SessionRuntime` and receive protocol-safe streaming
  updates without TUI dependencies.

## Edge Cases & Considerations

- Do not let runtime events write to stdout directly; ACP stdout must remain protocol-only.
- Same-session overlap is rejected in the MVP. Do not add implicit queues unless a later design explicitly chooses
  queuing.
- Cancellation can arrive before root session creation, during model streaming, during tool execution, or after
  completion; all cases should be safe.
- Tool result payloads may be large or structured; map concise standard ACP fields and preserve raw/debug metadata under
  extension metadata only where safe.
- Existing TUI stream rendering must not regress while subscriber output is generalized.
