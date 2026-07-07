---
planId: "1d92fa2c-fbaf-450e-a823-760643db8724"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Implement ACP session/load with persisted-history replay and harden ACP lifecycle behavior, cwd/id mapping, close/dispose, cancellation races, protocol errors, and test coverage."
affectedPaths:
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-runtime-events.js"
    - "src/shared/session/root-session.js"
    - "src/acp/server.js"
    - "src/acp/session-map.js"
    - "src/acp/event-mapper.js"
    - "src/acp/protocol-smoke.test.js"
    - "src/acp/server.test.js"
    - "src/shared/session/session-runtime.test.js"
frontend: false
createdAt: "2026-07-07T02:13:46.229Z"
updatedAt: "2026-07-07T02:13:46.229Z"
status: "draft"
origin: "internal"
parentPlan: "session-runtime-acp-mvp"
order: 5
dependencies:
    - "04-runtime-interactions-and-acp-plan-review-link-out"
---

# ACP Session Load Replay and Lifecycle Hardening

## Context

ACP clients can start after a RunWield conversation already exists. Loading a persisted session over ACP must hydrate
RunWield's internal session state and replay the visible transcript to the client as `session/update` notifications.
Replay means re-sending stored conversation history and tool/status artifacts for display; it must not re-run the LLM,
tools, validation, or workflows.

## Objective

Implement ACP `session/load` with deterministic replay, harden session id/cwd mapping and lifecycle cleanup, add
close/dispose support if safe, and complete ACP MVP coverage for invalid sessions, cancellation races, stdout purity,
protocol errors, and repository guardrails.

## Approach

Reuse existing persisted session mechanics from `root-session.js` and `cmd/resume/index.js`: `SessionManager.list`,
`SessionManager.open`, RunWield session directory helpers, and active-agent restoration concepts. Add runtime load
helpers that create/adopt a HostedSession backed by an opened root SessionManager. Emit replay events before the load
response resolves so ACP clients can reconstruct the visible conversation timeline, then allow future prompts to
continue from the loaded context.

## Files to Modify

- `src/shared/session/session-runtime.js` — add load/open operations, replay event emission, close/dispose hardening,
  and lifecycle result shapes.
- `src/shared/session/session-runtime-events.js` — finalize replay event typedefs and any lifecycle/cancellation/error
  event refinements.
- `src/shared/session/root-session.js` — expose reusable helpers for listing/opening specific persisted sessions by
  id/path if needed; reuse existing session directory behavior.
- `src/acp/server.js` — implement `session/load`, lifecycle close/dispose if safely supported, final protocol error
  mapping, and graceful shutdown cleanup.
- `src/acp/session-map.js` — harden ACP session id to HostedSession/root SessionManager id mapping, cwd guardrails,
  loaded-session metadata, and cleanup on close.
- `src/acp/event-mapper.js` — map replay entries to ACP update shapes, preserving raw metadata under extension fields
  where useful.
- `src/acp/protocol-smoke.test.js` — cover initialize/new/load/prompt at smoke level.
- `src/acp/server.test.js` — cover load replay, invalid load ids/paths, cwd mismatch, close/dispose, cancellation races,
  invalid params, and stdout/stderr separation.
- `src/shared/session/session-runtime.test.js` — cover runtime load/replay and lifecycle cleanup without ACP framing.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/root-session.js` `createRootSessionManager()` and session directory helpers — reuse instead of
  inventing a persistence format.
- `src/cmd/resume/index.js` — reuse listing/opening and active-agent restoration concepts for persisted sessions.
- `@earendil-works/pi-coding-agent` `SessionManager.list` and `SessionManager.open` — use existing persisted session
  APIs.
- `src/shared/session/session-runtime-events.js` from prior slices — reuse event names and mapping helpers for replay
  entries.
- `src/acp/session-map.js` from prior slices — extend mapping rather than introducing separate load-state tracking.

## Implementation Steps

- [ ] Step 1: Inspect persisted SessionManager entries used by `resume` and identify deterministic mappings from stored
      messages/tool events to runtime replay events.
- [ ] Step 2: Add reusable root-session helpers for opening a specific persisted session by path/id if current exports
      are insufficient.
- [ ] Step 3: Implement `SessionRuntime.loadSession` to open the persisted session, create/adopt a HostedSession,
      restore active agent metadata where available, and bind cwd.
- [ ] Step 4: Emit replay events for prior user, assistant, thinking, tool, system/status, and usage entries where
      available; preserve unmapped/raw metadata under safe extension fields.
- [ ] Step 5: Implement ACP `session/load` so replay `session/update` notifications are sent before the load response
      resolves.
- [ ] Step 6: Harden session id semantics so ACP ids are stable, traceable to underlying HostedSession/root
      SessionManager ids, and guarded by cwd.
- [ ] Step 7: Add close/dispose support if the SDK/API and runtime lifecycle make it safe; otherwise advertise it as
      unsupported and return clear errors.
- [ ] Step 8: Add robust protocol error mapping for invalid params, unknown session ids, cwd mismatch, closed sessions,
      concurrent prompt attempts, and cancellation races.
- [ ] Step 9: Add shutdown cleanup so active prompts/interactions are canceled and HostedSessions are disposed without
      corrupting stdout.
- [ ] Step 10: Add tests for load replay ordering, replay mapping, lifecycle cleanup, error handling, cancellation
      races, and stdout/stderr purity.

## Verification Plan

- Automated: run `deno test -A src/shared/session/session-runtime.test.js`.
- Automated: run `deno test -A src/acp/server.test.js src/acp/protocol-smoke.test.js`.
- Automated: run existing resume/root-session tests affected by reusable load helpers.
- Automated: run a repository guard that ACP modules do not import `src/shared/interactive/chat-session.js`.
- Automated: run `deno run ci` and fix all issues.
- Manual: create a normal TUI session, then run `wld acp` and call `session/load` for that persisted session; verify
  replay updates arrive before the load response.
- Manual: after loading, send a new ACP prompt and verify it continues from the loaded RunWield context.
- Manual: attempt to load a session from the wrong cwd and verify a clear protocol error.
- Manual: close/dispose a session if supported and verify future prompts fail cleanly.
- Manual: interrupt the ACP process during an active prompt and verify no partial non-protocol logs are written to
  stdout.
- Expected result: ACP clients can reconstruct prior conversation history, continue loaded sessions, and handle
  lifecycle errors predictably.

## Edge Cases & Considerations

- Replay must not re-run model calls, tools, validation, or workflow side effects.
- Persisted branch entries may not map perfectly to ACP standard updates; use deterministic best-effort mappings and
  safe extension metadata.
- Session ids should be stable and traceable. Avoid opaque ids that cannot be related to persisted sessions later.
- Guard cwd boundaries so a client cannot accidentally load or operate on a session from another project.
- Cancellation and close can race with prompt completion; all paths should settle promises exactly once.
- If close/dispose cannot be safely represented with current ACP SDK/API support, do not advertise it as implemented.
