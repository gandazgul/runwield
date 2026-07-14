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
status: "verified"
origin: "internal"
parentPlan: "session-runtime-acp-mvp"
order: 3
dependencies:
    - "02-sessionruntime-core-for-tui-preserved-prompting"
verifiedAt: "2026-07-08T01:24:51.540Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
updatedAt: "2026-07-14T12:18:20.337Z"
archivedAt: "2026-07-14T12:18:20.337Z"
archiveReason: "Epic verified and archived"
archivedFromStatus: "verified"
archivedFromPath: "plans/session-runtime-acp-mvp/03-runtime-event-contract-and-acp-prompt-streaming.md"
---

# Runtime Event Contract and ACP Prompt Streaming

## Context

This is child FEATURE 03 under the approved `session-runtime-acp-mvp` Epic. Product intent is sourced from ADR-010, the
parent Epic, and slices 01/02: ACP is a sibling adapter over `SessionRuntime`, not a wrapper around
`src/shared/interactive/chat-session.js`; stdout in ACP mode is protocol-only; `SessionRuntime` already owns the shared
prompt/handoff loop used by the TUI.

The current code has the ACP SDK skeleton (`initialize`, stdio entrypoint, structured unimplemented errors) and a
`SessionRuntime` seam (`create/adopt/list/close`, `promptSession`, `cancelSession`). What is still missing is the event
contract and the real ACP path for creating a prompt-ready HostedSession, submitting prompt turns, streaming
`session/update` notifications, rejecting overlapping same-session prompts, and resolving cancellation as ACP
`stopReason: "cancelled"`.

## Objective

Add adapter-neutral runtime events and implement ACP `session/new`, `session/prompt`, and `session/cancel` over
`SessionRuntime`.

The completed slice should provide:

- A documented pure-JavaScript/JSDoc runtime event contract reusable by ACP, future Workspace/Takopi adapters, and later
  load/replay work.
- Runtime event subscription/emission scoped to a specific HostedSession without writing directly to stdout.
- ACP `session/new` that creates a prompt-ready Router-backed RunWield session for an absolute cwd and returns a stable
  ACP session id.
- ACP `session/prompt` that accepts baseline text/resource-link prompt content, emits a user-message update, runs the
  shared `SessionRuntime.promptSession()` path, streams assistant/thinking/tool/status/usage/error updates, and returns
  `stopReason: "end_turn"` on normal completion.
- ACP `session/cancel` as a notification that cancels active runtime work and makes the in-flight prompt settle with
  `stopReason: "cancelled"`.
- Deterministic same-session overlap rejection for the MVP; different ACP sessions may prompt independently if the
  underlying runtime can support it.

## Approach

Introduce `src/shared/session/session-runtime-events.js` as the canonical event vocabulary. Keep event payloads
adapter-neutral and small, with `_raw`/metadata escape hatches only where they are safe and useful. Use typedefs rather
than TypeScript syntax.

Extend `SessionRuntime` with a per-session event subscription/emission surface plus a prompt-ready session creation
helper. The helper should create a root SessionManager with `createRootSessionManager("new", cwd)`, create/adopt the
HostedSession, install the Router `createAgentHandler(AGENTS.ROUTER, { hostedSession })`, and eagerly build the root
AgentSession via `ensureRootAgentSession()` without requiring a TUI `UiAPI`.

Generalize `attachUiSubscribers()` in `session.js` so the existing pi-agent stream subscriber can both preserve current
TUI rendering and emit runtime events through `hostedSession.getEventSink()`/runtime hooks. When an event sink is
present and no TUI `UiAPI` is present, do not fall back to `console.log()` or `Deno.stdout.writeSync()`; ACP stdout must
remain protocol JSON only.

Add ACP-local `session-map.js` to map ACP ids to HostedSession ids, cwd, active prompt records, and cancellation state.
Add `event-mapper.js` to convert runtime events into standard ACP `session/update` payloads using:

- `user_message_chunk` for echoed user prompts;
- `agent_message_chunk` for assistant text deltas;
- `agent_thought_chunk` for thinking deltas;
- `tool_call` and `tool_call_update` for tool lifecycle;
- `usage_update` when context/cost data is available;
- text chunks with RunWield `_meta` for status/system/error/cancellation events that have no better ACP standard shape.

Leave `session/load`, replay hardening, close/dispose, rich interactions, and plan-review link-out behavior to later
child slices. `initialize` should advertise only capabilities implemented in this slice: baseline session
new/prompt/cancel/update and prompt capabilities that are actually handled. Do not advertise `loadSession`, MCP
capabilities, `session.close`, images, embedded context, additional directories, modes, or config options yet.

## Files to Modify

- `src/shared/session/session-runtime.js` — add runtime event subscription/emission APIs, emit session/user/turn/system/
  error/cancellation events, add a prompt-ready `session/new` helper, and keep existing TUI prompt semantics intact.
- `src/shared/session/session-runtime-events.js` — new JSDoc typedefs/constants/helpers for runtime events: session
  lifecycle, replay placeholder, user message, assistant text/thinking chunks, tool start/update/end, system/status,
  turn start/end, usage, cancellation, and terminal errors.
- `src/shared/session/session.js` — route pi-agent subscriber events to the runtime event sink while preserving TUI
  rendering; remove stdout/stdout-like fallbacks when a non-TUI runtime sink is active.
- `src/shared/session/hosted-session.js` — extend event sink/subscriber storage only if the existing `eventSink` field
  is insufficient for per-session runtime event routing or unsubscribe cleanup.
- `src/shared/session/session-subscribers.test.js` — preserve current TUI subscriber behavior and add coverage that a
  runtime sink receives stream events without stdout writes.
- `src/acp/server.js` — replace unimplemented `session/new` and `session/prompt` handlers with real runtime-backed
  handlers; register `session/cancel` as a notification; send `session/update` notifications via
  `context.notify(methods.client.session.update, ...)`; keep unsupported methods structured.
- `src/acp/session-map.js` — new ACP-to-HostedSession mapping, absolute-cwd validation, active prompt tracking,
  cancellation flags, and deterministic same-session overlap rejection.
- `src/acp/event-mapper.js` — map runtime events to ACP update objects with standard shapes where possible and safe
  RunWield metadata where necessary.
- `src/acp/protocol-smoke.test.js` — expand smoke coverage to initialize/new/prompt/cancel framing without importing TUI
  internals.
- `src/acp/server.test.js` — cover capabilities, session creation, prompt update streaming, cancellation stop reason,
  invalid session errors, unsupported request params, same-session overlap rejection, and stdout/stderr separation.
- `src/shared/session/session-runtime.test.js` — cover event subscription/unsubscribe, prompt-ready session setup,
  runtime event ordering, prompt error events, and cancellation semantics at the runtime boundary.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/root-session.js` `createRootSessionManager("new", cwd)` — create persisted root SessionManagers
  for ACP-created sessions rather than inventing a session store.
- `src/shared/session/agent-handler.js` `createAgentHandler(AGENTS.ROUTER, { hostedSession })` — install the same
  workflow-aware Router handler used by the TUI.
- `src/shared/session/session.js` `ensureRootAgentSession()` and `runRootTurn()` — build and run the real root agent
  through existing HostedSession-aware machinery.
- `src/shared/session/session.js` `attachUiSubscribers()` — reuse the existing mapping from pi-agent stream events to
  user-visible assistant/thinking/tool/status concepts as the source for runtime event names and titles.
- `src/shared/session/session.js` `abortActiveSession()` — use for runtime and ACP cancellation.
- `src/shared/session/session-runtime.js` from slice 02 — keep this as the only ACP path into RunWield prompting.
- `@agentclientprotocol/sdk` `methods`, `RequestError`, and handler `context.notify()` — use official protocol constants
  and structured JSON-RPC errors.

## Implementation Steps

- [ ] Step 1: Add `session-runtime-events.js` with constants/helpers and JSDoc typedefs for the runtime event union.
      Include `sessionId`, `turnId` where relevant, timestamp, and safe metadata fields; avoid TypeScript syntax.
- [ ] Step 2: Extend `SessionRuntime` with HostedSession-scoped `subscribeSessionEvents(sessionOrId, listener)`,
      `emitSessionEvent(sessionOrId, event)`, and deterministic unsubscribe behavior. Listener errors should not crash
      prompt execution; report them through diagnostics or a terminal runtime error only when safe.
- [ ] Step 3: Add a prompt-ready session creation helper in `SessionRuntime` for ACP `session/new`: validate absolute
      cwd, create a new root SessionManager, create/adopt the HostedSession, attach the runtime event sink, install the
      Router handler, and eagerly call `ensureRootAgentSession()`.
- [ ] Step 4: Emit runtime session/turn events from `SessionRuntime.promptSession()` and `cancelSession()`: session
      created, user message, turn start/end, system messages for handoff-limit/missing-handler cases, cancellation, and
      terminal errors. Preserve the existing return shape used by TUI tests or update tests intentionally.
- [ ] Step 5: Modify `attachUiSubscribers()` so assistant text, thinking, tool start/update/end, retry, compaction,
      message error, and usage/context data emit runtime events when a runtime sink exists. TUI rendering must remain
      unchanged when `uiAPI` is present.
- [ ] Step 6: Remove ACP-dangerous stream fallbacks: when the HostedSession has a runtime sink but no TUI `UiAPI`, do
      not call `console.log()` or write assistant/tool output to `Deno.stdout` from subscriber code.
- [ ] Step 7: Implement `src/acp/session-map.js` with records `{ acpSessionId, hostedSessionId, cwd, activePrompt }`,
      helper methods to begin/end a prompt, mark cancellation, find the HostedSession, and reject same-session overlap
      with a stable `RequestError` invalid-state code/message.
- [ ] Step 8: Implement `src/acp/event-mapper.js` to convert runtime events to ACP `SessionNotification` params. Assign
      stable `messageId`s per user/assistant/thinking stream where possible, map tool statuses to `pending`/
      `in_progress`/`completed`/`failed`, and keep raw RunWield details in `_meta.runwield` only when they are safe.
- [ ] Step 9: Update `createInitializeResponse()` to advertise only implemented safe capabilities for this slice:
      baseline prompt support plus any actually supported prompt capabilities. Keep `loadSession`, MCP, close, modes,
      config, images, embedded context, and additional directories unadvertised.
- [ ] Step 10: Implement ACP `session/new`: require an absolute `cwd`, reject non-empty `mcpServers` and
      `additionalDirectories` with a clear unsupported/invalid-params error for the MVP, create a prompt-ready runtime
      session, map ids, emit/return the ACP `sessionId`.
- [ ] Step 11: Implement ACP `session/prompt`: validate session id, convert supported `TextContent` blocks into the
      prompt string, render `ResourceLink` blocks as textual references, reject unsupported image/audio/embedded
      resource blocks until advertised, subscribe to runtime events for the prompt, notify mapped updates, await
      `runtime.promptSession()`, and return `{ stopReason: "end_turn" }` unless canceled.
- [ ] Step 12: Implement ACP `session/cancel` as `app.onNotification(methods.agent.session.cancel, ...)`: mark the
      active prompt canceled in `session-map`, call `runtime.cancelSession(hostedSession)`, emit cancellation status,
      and ensure the pending prompt response resolves as `{ stopReason: "cancelled" }` even if the underlying abort
      throws.
- [ ] Step 13: Keep unimplemented optional ACP methods registered as structured unsupported errors and add guard tests
      proving ACP code does not import `src/shared/interactive/chat-session.js`.
- [ ] Step 14: Add focused tests around runtime events, event mapping, prompt streaming order, cancellation races,
      overlap rejection, invalid params, unsupported content, and stdout purity.

## Verification Plan

- Automated: run `deno test -A src/shared/session/session-runtime.test.js`.
- Automated: run `deno test -A src/shared/session/session-subscribers.test.js`.
- Automated: run `deno test -A src/acp/server.test.js src/acp/protocol-smoke.test.js`.
- Automated: run `deno task check`.
- Automated: run a repository guard such as `grep -R "shared/interactive/chat-session" src/acp src/shared/session` and
  confirm ACP/runtime modules do not depend on TUI internals.
- Automated: run `deno task ci` and fix all issues.
- Manual: run `wld acp`, send `initialize`, `session/new` with an absolute cwd and empty `mcpServers`, then a simple
  text `session/prompt`; verify valid `session/update` notifications stream on stdout before the prompt response.
- Manual: start a long-running prompt, send `session/cancel`, and verify the original `session/prompt` response returns
  `stopReason: "cancelled"` and the same session can accept another prompt afterward.
- Manual: send a second `session/prompt` for the same ACP session while one is active and verify a deterministic
  invalid-state error; repeat with another session to ensure session-local isolation.
- Manual: send non-empty `mcpServers`, non-empty `additionalDirectories`, relative cwd, image/audio/embedded-resource
  content, and an unknown session id; verify clear protocol errors and no non-protocol stdout output.
- Expected result: ACP can drive a live RunWield prompt through `SessionRuntime` and receive protocol-safe streaming
  updates without TUI dependencies or stdout pollution.

## Edge Cases & Considerations

- Existing TUI stream rendering must not regress. Treat `session-subscribers.test.js` as the regression suite for the
  old visual behavior.
- ACP stdout must contain only JSON-RPC frames. Subscriber fallbacks that write assistant/tool output to stdout are
  acceptable for legacy non-TUI debugging only when no runtime sink is active.
- Same-session overlap is rejected in this MVP. Do not add implicit queues unless a later design explicitly chooses
  queuing.
- Cancellation can race before root prompt start, during model streaming, during tool execution, or after completion;
  every path should settle exactly once and clear `activePrompt`.
- `session/cancel` is an ACP notification, not a request; tests should send it without expecting a direct response and
  should assert the original prompt response carries `stopReason: "cancelled"`.
- Tool result payloads may be large or structured. Map concise standard ACP fields and preserve raw/debug metadata only
  under safe `_meta.runwield` fields; avoid leaking secrets from tool arguments/results.
- `session/load`, replay, close/dispose, rich interaction requests, and plan review link-out are intentionally deferred
  to later child plans. Leave those capabilities unadvertised and return structured unsupported errors.
- Product/API assumption from the Epic and slice 01 safety posture: because RunWield does not yet advertise MCP,
  additional directories, image, audio, or embedded-context support, this slice rejects those inputs rather than
  silently ignoring them.
