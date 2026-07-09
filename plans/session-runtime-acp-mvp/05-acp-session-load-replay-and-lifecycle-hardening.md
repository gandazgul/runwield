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
updatedAt: "2026-07-09T01:21:47.521Z"
status: "in_progress"
origin: "internal"
parentPlan: "session-runtime-acp-mvp"
order: 5
dependencies:
    - "04-runtime-interactions-and-acp-plan-review-link-out"
humanReviewMode: null
humanReviewDecision: null
executionBaselineTree: "d89d2d69f0842beb4a9248bd7eaa14689ab05faf"
worktreeId: "fc4ad473"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-harns--/harns-runwield-session-runtime-acp-mvp-05-acp-session-load-repl-fc4ad473"
worktreeBranch: "runwield/worktree/session-runtime-acp-mvp-05-acp-session-load-repl-fc4ad473"
worktreeBaseBranch: "main"
worktreeStatus: "active"
---

# ACP Session Load Replay and Lifecycle Hardening

## Context

This is child FEATURE 05 under the approved `session-runtime-acp-mvp` Epic. Product intent is sourced from ADR-010, the
parent Epic, and the current verified slices: ACP is a sibling adapter over `SessionRuntime`, stdout is reserved for ACP
JSON-RPC, and `session/new`, `session/prompt`, `session/cancel`, runtime events, ACP update mapping, and ACP interaction
handling already exist.

The remaining ACP MVP gap is lifecycle completeness. ACP clients can start after a RunWield Agent Session already
exists, so `session/load` must open a persisted RunWield session, hydrate a `HostedSession`, replay the visible
transcript to the ACP client as `session/update` notifications, and then allow future prompts to continue from the
loaded context. Replay means re-sending stored conversation history and tool/status artifacts for display; it must not
re-run the LLM, tools, Plan lifecycle, Workflow Validation, Plannotator, or any other workflow side effects.

Current code findings:

- `src/acp/server.js` advertises only `session/new`, `session/prompt`, and `session/cancel`; `session/load` and
  `session/close` are registered as unimplemented.
- `SessionRuntime` already owns create/prompt/cancel/close and interaction cleanup, but it has no load/open/replay
  operation and no close-all shutdown helper.
- `src/shared/session/root-session.js` only exposes `createRootSessionManager("new" | "continue", cwd)`, while `/resume`
  demonstrates the missing persisted path via `SessionManager.list(cwd, sessionDir)` and
  `SessionManager.open(path, sessionDir, cwd)`.
- `resolveResumeAgentName()` in `src/shared/session/active-agent-session.js` already restores the last valid persisted
  root Agent marker and should be reused for loaded sessions.
- The ACP SDK supports top-level `agentCapabilities.loadSession` and `sessionCapabilities.close`; `session/load` accepts
  `cwd`, `sessionId`, optional `additionalDirectories`, and `mcpServers`; `session/close` must cancel ongoing work and
  free session resources.

## Objective

Implement ACP `session/load` with deterministic persisted-history replay, then harden lifecycle behavior around session
id/cwd mapping, close/dispose, shutdown cleanup, cancellation races, protocol errors, and regression coverage.

The completed slice should provide:

- `SessionRuntime.loadSession()` or equivalent adapter-neutral load operation that opens a persisted RunWield root
  session by persisted id or guarded session path, creates/adopts a `HostedSession`, restores the active root Agent, and
  returns deterministic replay events.
- ACP `session/load` advertised via `agentCapabilities.loadSession: true` and listed in RunWield `_meta` implemented
  methods.
- ACP `session/load` sends replay `session/update` notifications and awaits them before resolving the load response.
- ACP session ids remain stable and traceable to the underlying `HostedSession`, persisted SessionManager id, and
  session file path without exposing cross-project sessions.
- ACP `session/close` is implemented and advertised through `sessionCapabilities.close: {}` because the current runtime
  has enough close/dispose support. Closing an active session cancels ongoing work first, frees resources, removes ACP
  mapping, and makes later prompts fail cleanly.
- ACP process/connection shutdown cancels active prompts/interactions and disposes all active `HostedSession`s without
  writing non-protocol diagnostics to stdout.
- Focused automated tests cover load replay ordering/mapping, invalid ids/paths, cwd mismatch, close/dispose,
  cancellation races, invalid params, stdout/stderr purity, and the repository guard against ACP importing TUI
  `chat-session` internals.

## Approach

Add small root-session persistence helpers instead of duplicating `/resume` logic in ACP. Keep
`createRootSessionManager()` unchanged for new sessions, and add helpers that list sessions for a cwd, resolve a
specific persisted session by id or guarded path, open it with `SessionManager.open(path, sessionDir, cwd)`, and reject
anything outside `getRunWieldSessionDir(cwd)` or whose header/manager cwd does not match the requested absolute cwd.
`sessionId` should normally be the persisted SessionManager id; tests and local tooling may also pass a session file
path through RunWield `_meta` if it stays inside the requested cwd's RunWield session directory.

Implement load in `SessionRuntime`, not the ACP adapter. The runtime should open the root SessionManager, create a
`HostedSession` from that manager, attach the runtime event sink, restore the active root Agent using
`resolveResumeAgentName()`, install the active message handler, call `ensureRootAgentSession()` against the opened
manager, and emit/return a `session_loaded` lifecycle event. Unlike `/resume`, ACP load should not prompt to compact a
large session; it loads as-is and leaves any future compaction to normal agent behavior.

Build replay as a deterministic transformation from the opened SessionManager branch (`getBranch()` with fallback to
`getEntries()` where useful) into runtime replay/update events. Prefer concrete runtime event types already understood
by `src/acp/event-mapper.js` (`user_message`, `assistant_text_delta`, `assistant_thinking_delta` mapped to ACP
`agent_thought_chunk`, tool lifecycle, `system_status`, `usage`) and mark replayed events with safe `_meta.runwield`
fields such as `replay: true`, `entryId`, `entryType`, `role`, and `timestamp`. Preserve unmapped entries as readable
`system_status` or `replay_entry` events with sanitized metadata. Do not expose raw tool arguments, secrets, maintainer
URLs, or arbitrary raw session entries in ACP updates.

Have ACP `session/load` validate params with the same guardrails as `session/new` for cwd, MCP servers, and additional
directories. After `runtime.loadSession()` returns, create/update the `AcpSessionMap` record with loaded-session
metadata, send each replay event as a `session/update` notification for the new ACP id, await all notification promises,
then return an ACP `LoadSessionResponse` with `_meta.runwield` containing non-secret ids/path metadata. Leave
`session/list`, `session/delete`, `session/fork`, and `session/resume` unadvertised and unimplemented in this slice.

Harden lifecycle in one place: extend `AcpSessionMap` records with persisted id/path, loaded/new state, closed state if
needed, and helper methods for close/removal. `session/close` should reject unknown sessions with ACP not-found, mark
active prompts canceled, call `runtime.cancelSession()` when a prompt is active, call `runtime.closeSession()` to
dispose the HostedSession, delete the ACP record, and return an empty close response plus non-secret `_meta` if useful.
Shutdown cleanup should use the same close/cancel path for every mapped session.

## Files to Modify

- `src/shared/session/session-runtime.js` — add load/open operations, replay event construction, close-all cleanup, and
  lifecycle result shapes while preserving existing create/prompt/cancel behavior.
- `src/shared/session/session-runtime-events.js` — finalize replay/lifecycle typedefs and metadata fields used by load
  replay and close/cancellation events.
- `src/shared/session/root-session.js` — expose reusable helpers for listing sessions for a cwd, resolving a persisted
  session by id/path, safely opening a specific persisted session, reading branch entries, and enforcing cwd/session-dir
  boundaries.
- `src/acp/server.js` — implement `session/load`, advertise load and close capabilities, implement `session/close`, map
  protocol errors, await replay notifications before load response, and dispose mapped sessions on connection shutdown.
- `src/acp/session-map.js` — harden ACP id to HostedSession/persisted SessionManager id mapping, cwd guardrails,
  loaded-session metadata, active prompt cancellation state, and cleanup on close.
- `src/acp/event-mapper.js` — map replay events to ACP update shapes, sanitize replay metadata, and preserve useful
  non-secret RunWield metadata under `_meta.runwield`.
- `src/acp/protocol-smoke.test.js` — cover SDK constants for `session/load`/`session/close` and a smoke-level
  initialize/new/load/prompt capability path where practical.
- `src/acp/server.test.js` — cover load replay, invalid load ids/paths, cwd mismatch, close/dispose, shutdown cleanup,
  cancellation races, invalid params, and stdout/stderr separation.
- `src/shared/session/session-runtime.test.js` — cover runtime load/replay and lifecycle cleanup without ACP framing.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/root-session.js` `getRunWieldSessionDir()` and `createRootSessionManager()` patterns — reuse the
  RunWield persistence location and keep new helper behavior beside existing root session helpers.
- `src/cmd/resume/index.js` — reuse its listing/opening shape and active-agent restoration concepts; do not import the
  TUI command path into ACP/runtime.
- `src/shared/session/active-agent-session.js` `resolveResumeAgentName()` — restore the last valid persisted root Agent
  for a loaded session.
- `@earendil-works/pi-coding-agent` `SessionManager.list()` and `SessionManager.open()` — use the existing persisted
  session APIs and branch entry format.
- `src/shared/session/session-runtime-events.js` — reuse event vocabulary from prior slices; avoid creating an ACP-only
  replay vocabulary.
- `src/acp/event-mapper.js` existing update mapping and redaction behavior — extend rather than bypassing it for replay.
- `src/acp/session-map.js` existing active prompt/cancellation handling — extend it for loaded-session metadata and
  close cleanup instead of adding parallel maps.
- `src/shared/session/hosted-session.js` disposal and active interaction cancellation — rely on existing session-scoped
  cleanup semantics.

## Implementation Steps

- [ ] Step 1: Add root-session helper typedefs and functions for `listPersistedRootSessions(cwd)`,
      `resolvePersistedRootSession({ cwd, sessionId, sessionPath })`, `openPersistedRootSession(...)`, and
      `getRootSessionBranchEntries(sessionManager)` using pure JavaScript/JSDoc.
- [ ] Step 2: Guard persisted session resolution: require absolute cwd, use `getRunWieldSessionDir(cwd)`, allow paths
      only inside that directory, match by persisted `SessionManager.list()` id/path, and reject header/manager cwd
      mismatches as not-found for that cwd.
- [ ] Step 3: Add `SessionRuntime.loadSession(options)` that opens the persisted manager, creates/adopts a
      `HostedSession`, attaches the runtime event sink, restores the active root Agent with `resolveResumeAgentName()`,
      sets the active message handler, calls `ensureRootAgentSession()`, and returns
      `{ hostedSession, replayEvents,
      sessionManagerId, sessionPath }`.
- [ ] Step 4: Implement replay event construction from branch entries: user/assistant text messages, assistant thinking
      if represented, tool use/result blocks, compaction/branch summaries, session info/name, model/thinking changes,
      RunWield custom status entries, and deterministic fallback status/replay entries for unknown data.
- [ ] Step 5: Add/adjust runtime event typedefs so replay metadata is explicit and safe. Include `replay: true`,
      `entryId`, `entryType`, `role`, and original timestamps where available; do not include arbitrary raw session
      payloads by default.
- [ ] Step 6: Extend `mapRuntimeEventToAcpUpdate()` so replayed entries map to standard ACP update shapes where possible
      and safe fallback message chunks where not; keep existing redaction guarantees for tool args/results and secret
      metadata.
- [ ] Step 7: Extend `AcpSessionMap.createRecord()` or add a loaded-record helper to store `acpSessionId`,
      `hostedSessionId`, `cwd`, persisted session id, session path, `loaded: true/false`, and active prompt state with
      deterministic deletion.
- [ ] Step 8: Implement ACP load param validation in `src/acp/server.js`: require string `sessionId` and absolute `cwd`,
      reject MCP servers and additional directories for this MVP, accept an optional guarded RunWield session path only
      through `_meta.runwield.sessionPath`, and map failures to JSON-RPC errors.
- [ ] Step 9: Implement ACP `session/load`: call runtime load, create the ACP record, send and await replay
      `session/update` notifications in branch order, then return `LoadSessionResponse` with `_meta.runwield` ids/path
      metadata.
- [ ] Step 10: Update `createInitializeResponse()` to advertise `loadSession: true`, add `session/load` to
      `_meta.runwield.implementedMethods`, and advertise `sessionCapabilities.close: {}` with `session/close` listed
      once close is implemented.
- [ ] Step 11: Implement ACP `session/close`: validate `sessionId`, mark/cancel active prompts if any, call
      `runtime.cancelSession()` best-effort, dispose via `runtime.closeSession()`, delete the ACP record, and make
      future prompt/cancel/close calls for that id return not-found or no-op according to existing cancel notification
      behavior.
- [ ] Step 12: Add `SessionRuntime.closeAllSessions()` or equivalent and wire ACP connection/server shutdown cleanup so
      active prompts/interactions are canceled and HostedSessions are disposed without writing diagnostics to stdout.
- [ ] Step 13: Harden prompt/cancel race handling around closed sessions: no double-settled prompt promises, no stale
      active prompt records after adapter setup/cleanup failures, and deterministic `stopReason: "cancelled"` when
      close/cancel wins the race.
- [ ] Step 14: Add focused runtime tests for successful load, active Agent restoration, replay event ordering, replay
      sanitization, invalid cwd/path/id errors, and close-all disposal.
- [ ] Step 15: Add focused ACP tests with fake runtime/root sessions for load response ordering, replay notifications
      before response, invalid params, unknown/cross-cwd sessions, close while idle, close while prompt is active,
      prompt after close, and shutdown cleanup.
- [ ] Step 16: Update smoke and guard tests for load/close method constants, advertised capabilities, stdout/stderr
      purity, and the no-`shared/interactive/chat-session` import boundary.

## Verification Plan

- Automated: run `deno test -A src/shared/session/session-runtime.test.js`.
- Automated: run `deno test -A src/acp/server.test.js src/acp/protocol-smoke.test.js`.
- Automated: run existing resume/root-session/active-agent tests affected by reusable load helpers, including
  `deno test -A src/shared/session/active-agent-session.test.js` and any root-session tests present after
  implementation.
- Automated: run the repository guard that ACP/runtime modules do not import `src/shared/interactive/chat-session.js`.
- Automated: run `deno task check`.
- Automated: run `deno task ci` and fix all issues.
- Manual: create a normal TUI session that contains at least one user message, assistant response, and tool/status
  artifact; then run `wld acp` and call `initialize` followed by `session/load` for that persisted session from the same
  cwd. Verify replay updates arrive before the load response.
- Manual: after loading, send a new ACP `session/prompt` and verify it continues from the loaded RunWield context and
  uses the restored active root Agent.
- Manual: attempt to load a session from the wrong cwd and verify a clear JSON-RPC error without exposing another
  project's transcript.
- Manual: close an idle loaded session and verify future prompts fail cleanly as unknown/not found.
- Manual: close or cancel during an active ACP prompt and verify the prompt resolves with `stopReason: "cancelled"`, the
  mapping is cleaned up, and there are no unhandled rejections.
- Manual: interrupt the ACP process during an active prompt and verify no partial non-protocol logs are written to
  stdout.
- Expected result: ACP clients can load and reconstruct prior conversation history, continue loaded sessions, close or
  cancel sessions predictably, and rely on protocol-clean stdout.

## Edge Cases & Considerations

- Replay must never re-run model calls, tools, validation, Plan lifecycle events, Plannotator review, or workflow side
  effects.
- Persisted branch entries may not map perfectly to ACP standard updates; use deterministic best-effort mappings and
  safe fallback text/status updates with non-secret `_meta.runwield` metadata.
- Do not leak raw tool args/results, maintainer URLs, content keys, secret-store paths, environment values, or arbitrary
  raw persisted entries through replay metadata.
- ACP `sessionId` for load should be traceable to the persisted SessionManager id; accepting a path is only a guarded
  local/debug convenience and must stay inside the requested cwd's RunWield session directory.
- Guard cwd boundaries so a client cannot load or operate on a session from another project. Prefer “not found for cwd”
  style errors over revealing cross-project metadata.
- Same-session prompt overlap remains rejected with ACP invalid-state; close/cancel are the only lifecycle actions that
  may interrupt an active prompt.
- Cancellation and close can race with prompt completion, adapter setup, interaction requests, and connection shutdown;
  all paths should settle promises exactly once and clear `AcpSessionMap` active prompt state.
- `session/list`, `session/delete`, `session/fork`, and `session/resume` remain out of scope and should not be
  advertised.
- No frontend browser verification is required because this slice changes ACP/runtime behavior only.
