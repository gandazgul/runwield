---
planId: "42255481-0492-4fa1-a83b-db7e419c607b"
classification: "PROJECT"
complexity: "HIGH"
summary: "Introduce a shared SessionRuntime sibling-adapter boundary and implement RunWield ACP v1 stdio MVP over it, leaving Takopi/WebUI for later adapters."
affectedPaths:
    - "docs/prd/runwield-acp-session-host-PRD.md"
    - "docs/adr/010-session-runtime-sibling-adapters-and-acp.md"
    - "deno.json"
    - "src/cli.js"
    - "src/cmd/registry.js"
    - "src/cmd/acp/index.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-runtime-events.js"
    - "src/shared/session/session-runtime-interactions.js"
    - "src/shared/session/session-host.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/session.js"
    - "src/shared/session/root-session.js"
    - "src/shared/session/agent-handler.js"
    - "src/shared/interactive/chat-session.js"
    - "src/shared/interactive/slash-dispatch.js"
    - "src/acp/server.js"
    - "src/acp/session-map.js"
    - "src/acp/event-mapper.js"
    - "src/acp/interaction-mapper.js"
    - "src/acp/protocol-smoke.test.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/acp/server.test.js"
frontend: false
createdAt: "2026-07-06T13:31:28-04:00"
updatedAt: "2026-07-17T04:50:38.786Z"
status: "verified"
origin: "internal"
type: "epic"
verifiedAt: "2026-07-14T12:15:15.000Z"
workRecord:
    status: "generated"
    recordId: "7709289b-9d53-4ae7-9c5e-0659eed411bf"
    path: "docs/work-records/2026-07-17-sessionruntime-and-acp-v1-stdio-mvp.md"
    lastAttemptAt: "2026-07-17T04:50:26.531Z"
archivedAt: "2026-07-14T12:18:21.606Z"
archiveReason: "All child FEATURE plans verified"
archivedFromStatus: "verified"
archivedFromPath: "plans/session-runtime-acp-mvp.md"
---

# SessionRuntime ACP MVP

## Context

Slice 1 of the ACP roadmap refactored RunWield so the existing TUI runs through `SessionHost` and `HostedSession`
instead of process-global session state. The next roadmap step is not a Telegram/Takopi bridge yet. It is to make
RunWield machine-controllable through a core runtime surface and expose that surface through Agent Client Protocol (ACP)
over stdio.

The architectural target is that TUI and ACP are sibling adapters at the same level. Both should use the same common
core where session-scoped features attach to a specific `HostedSession`. Future siblings such as Workspace WebUI,
Takopi/Telegram, Slack/Discord, or IDE integrations should plug into the same layer rather than wrapping TUI internals
or duplicating prompt/workflow behavior.

ADR-010 records this decision: introduce `SessionRuntime` above `SessionHost`/`HostedSession` and below all adapters.
`SessionRuntime` owns adapter-neutral create/load/prompt/cancel/close behavior, event emission, and user interaction
requests. TUI remains the current terminal adapter; ACP becomes a new stdio adapter.

ACP v1 documentation confirms the MVP wire contract: JSON-RPC 2.0 over newline-delimited stdio, `initialize`,
`session/new`, `session/prompt`, `session/cancel`, `session/update`, and optional `session/load` advertised via
`loadSession`. The current stable ACP protocol version is `1`. The official TypeScript SDK package
`@agentclientprotocol/sdk` provides agent-side helpers such as `agent(...)`, `ndJsonStream(...)`, protocol constants,
and request/notification registration. A Deno discovery probe successfully imported `npm:@agentclientprotocol/sdk` and
constructed an `ndJsonStream` with Web streams, so the plan should prefer the official SDK while proving project-level
Deno check/compile compatibility early.

Takopi, Telegram behavior, Workspace UI integration, Slack/Discord, and rich external workflow UX polish are
intentionally out of scope for this Epic. This Epic should nevertheless create the interaction/event contracts those
future adapters will reuse.

## Objective

Create a reusable `SessionRuntime` core surface and implement RunWield ACP v1 stdio MVP as a sibling adapter to the TUI.

The completed system should provide:

- A `SessionRuntime` module that owns session create/load/prompt/cancel/close/list operations over `SessionHost` and
  `HostedSession`.
- Adapter-neutral session events for user messages, assistant text chunks, thinking chunks, tool start/update/end,
  system/status messages, busy/turn lifecycle, usage where available, session replay, cancellation, and terminal errors.
- Adapter-neutral interaction requests for select/text prompts, permission-like decisions, model selection, and clear
  unsupported/blocked handling for Plan review flows that are intentionally not solved in ACP yet.
- TUI behavior preserved by consuming the shared runtime surface for core turn submission/handoff behavior instead of
  keeping that behavior exclusively in `chat-session.js`.
- ACP stdio entry points available as both `wld acp` and `wld --mode acp`.
- ACP `initialize`, `session/new`, `session/load` with replay, `session/prompt`, `session/cancel`, and close/dispose
  support if the selected SDK/API makes it straightforward to advertise safely.
- ACP `session/update` notifications mapped from `SessionRuntime` events, using standard ACP update shapes where
  possible.
- MVP interaction handling over ACP: use standard ACP primitives where semantically valid, expose RunWield-specific
  extension metadata/methods where ACP has no exact primitive, and provide clear unsupported/blocked behavior for
  generic clients that cannot answer a required interaction.
- No Takopi-specific code or Telegram assumptions.

This plan references ADR-010: `docs/adr/010-session-runtime-sibling-adapters-and-acp.md`.

## Vertical Slice Findings

The Slice 1 codebase already has a solid HostedSession foundation but not yet a full adapter-neutral runtime.

Key findings:

- `src/shared/session/session-host.js` is currently a registry/lifecycle owner with `createSession`, `adoptSession`,
  `getSession`, `requireSession`, `listSessions`, and `disposeSession`. It does not yet expose prompt/cancel/load/replay
  or event/interaction orchestration.
- `src/shared/session/hosted-session.js` owns per-session state: cwd, root session manager, root AgentSession/name,
  sub-AgentSessions, pending root swap, pending switch handoff, active model/thinking state, project context, active
  execution workflow, active UI API, and event sink. This is the right state anchor for all adapters.
- `src/shared/session/session.js` already accepts `hostedSession` for core root runtime primitives such as
  `ensureRootAgentSession`, `runRootTurn`, `runAgentSession`, `abortActiveSession`, steering, reload, model resolution,
  tool auto-wiring, and UI subscribers. The core agent runtime is close to adapter-neutral, but `attachUiSubscribers`
  still speaks a TUI-shaped `UiAPI` surface.
- `src/shared/session/agent-handler.js` is HostedSession-bound and already dispatches triage, planning, execution,
  validation, and return-to-router handoffs against a supplied HostedSession. This should be reused by `SessionRuntime`
  rather than duplicated by ACP.
- `src/shared/interactive/chat-session.js` still owns the highest-level submit loop through
  `runScopedSubmitHandoffLoop()` and `submitToActiveRoot()`: append user message, apply pending root swap, run active
  handler, consume `return_to_router` handoffs, enforce handoff limit, and apply final root swap. This is session
  behavior and should move behind `SessionRuntime` or be wrapped by it so TUI and ACP share the same semantics.
- `src/tools/user-interview.js` uses `uiAPI.promptSelect` and `uiAPI.promptText`; `src/tools/plan-written.js` requires a
  UI-like object for plan review, approval prompts, and status messages. These are not inherently TUI features; they are
  session-bound interaction requests that need an adapter-neutral broker.
- `src/shared/session/root-session.js` provides `createRootSessionManager("new" | "continue", cwd)`, session directory
  helpers, and export/hydration primitives. `src/cmd/resume/index.js` demonstrates concrete persisted-session
  listing/opening via `SessionManager.list(cwd, sessionDir)` and `SessionManager.open(path, sessionDir, cwd)`. ACP
  `session/load` should reuse this persistence path and replay persisted branch entries as ACP `session/update`
  notifications before responding.
- `src/cli.js` is command-oriented and currently treats unknown leading flags as errors. Supporting `wld --mode acp`
  requires explicit global-mode parsing in addition to a normal `wld acp` command registered in `src/cmd/registry.js`.
- The official ACP SDK can be imported in Deno via `npm:@agentclientprotocol/sdk`; a quick probe printed agent-side
  exports including `agent`, `ndJsonStream`, `PROTOCOL_VERSION`, `methods`, `AgentSideConnection`, and `RequestError`. A
  project-level implementation slice must still prove `deno check`, `deno test`, and compile/package behavior before
  committing fully to the direct npm import. If that fails, the fallback is a small compiled wrapper package analogous
  to the existing Plannotator compiled package pattern.

## Files to Modify

- `docs/prd/runwield-acp-session-host-PRD.md` — update the roadmap terminology so Slice 2 is explicitly
  `SessionRuntime + ACP MVP`, not ACP as a TUI wrapper. Keep Takopi as a later slice.
- `docs/adr/010-session-runtime-sibling-adapters-and-acp.md` — new ADR recording that TUI, ACP, WebUI, and Takopi are
  sibling adapters over `SessionRuntime`.
- `deno.json` — add an import alias for the official ACP SDK if the compatibility slice proves direct npm import works.
  If not, document and wire the compiled wrapper package instead.
- `src/cli.js` — recognize `--mode acp` before normal command dispatch and route it to the ACP command without starting
  TUI.
- `src/cmd/registry.js` — add an `acp` CLI command definition and help metadata; do not expose it as a slash command.
- `src/cmd/acp/index.js` — new command entry point that starts the ACP stdio server, ensures stdout is reserved for
  protocol messages, sends diagnostics to stderr, and owns shutdown cleanup.
- `src/shared/session/session-runtime.js` — new adapter-neutral runtime facade over `SessionHost`/`HostedSession`. It
  should create sessions, load sessions, prompt sessions, cancel active turns, close/dispose sessions, list active
  sessions, apply pending root swaps, run the handoff loop, and create the correct HostedSession-bound agent handler.
- `src/shared/session/session-runtime-events.js` — define JSDoc typedefs and helpers for adapter-neutral events emitted
  by `SessionRuntime`: session created/loaded/closed, replay entries, user message, assistant text/thinking chunks, tool
  call lifecycle, system/status messages, usage, turn start/end, cancellation, errors, and interaction lifecycle.
- `src/shared/session/session-runtime-interactions.js` — define JSDoc typedefs and broker behavior for adapter-neutral
  interaction requests: select, text, approval/permission-like choices, unsupported/canceled outcomes, and explicit
  blocked outcomes for Plan review flows that this Epic does not solve over ACP. Existing
  `UiAPI.promptSelect`/`promptText` behavior should be implementable as one adapter over this broker.
- `src/shared/session/session-host.js` — keep host-level lifecycle APIs but add or align helper methods needed by
  `SessionRuntime` only if they belong at host level. Avoid placing prompt orchestration directly into `SessionHost` if
  it would mix registry and runtime responsibilities.
- `src/shared/session/hosted-session.js` — add per-session fields only if needed for active prompt cancellation, event
  subscribers, active interaction state, or loaded/replayed metadata. Preserve the invariant that all mutable
  conversation state is HostedSession-scoped.
- `src/shared/session/session.js` — decouple subscriber output from TUI-specific `UiAPI` by allowing an adapter-neutral
  event sink/interaction adapter to receive the same stream currently rendered through `attachUiSubscribers`. Preserve
  existing TUI behavior.
- `src/shared/session/root-session.js` — expose reusable helpers for opening a specific persisted session by id/path if
  needed by ACP `session/load`; reuse existing session directory and SessionManager behavior rather than inventing a new
  persistence format.
- `src/shared/session/agent-handler.js` — keep using HostedSession-bound workflow logic, but ensure it can be invoked by
  `SessionRuntime` without TUI imports or TUI-only assumptions.
- `src/shared/interactive/chat-session.js` — keep the terminal UI adapter, but move or delegate shared prompt/handoff
  behavior to `SessionRuntime`. TUI-specific responsibilities should remain rendering, keybindings, editor state,
  terminal title, image paste, slash input, and visual prompts.
- `src/shared/interactive/slash-dispatch.js` — ensure slash commands remain TUI concerns unless a command is
  intentionally exposed through `SessionRuntime` or ACP later. Do not make ACP depend on slash-dispatch for ordinary
  prompt turns.
- `src/acp/server.js` — new ACP adapter using the official SDK when feasible. It should register
  initialize/new/load/prompt/cancel handlers, map requests to `SessionRuntime`, and map runtime events/interactions back
  to ACP notifications/requests.
- `src/acp/session-map.js` — map ACP session ids to HostedSession ids/root SessionManager ids, enforce cwd matching for
  load, track pending prompt controllers, and prevent concurrent prompt turns in the same session unless explicitly
  supported.
- `src/acp/event-mapper.js` — map `SessionRuntime` events to ACP `session/update` notifications. Use ACP standard fields
  such as `sessionUpdate: "agent_message_chunk"`, `"agent_thought_chunk"`, `"tool_call"`, `"tool_call_update"`,
  `"plan"`, and `"usage_update"` when possible.
- `src/acp/interaction-mapper.js` — map runtime interaction requests to ACP standard permission requests where
  semantically valid and to RunWield-specific ACP extension metadata/methods where needed. Provide deterministic
  unsupported/canceled behavior for clients that cannot answer.
- `src/acp/protocol-smoke.test.js` — prove the official SDK imports, the selected stream construction works under Deno,
  and a minimal initialize/new/prompt flow can be driven without a TUI.
- `src/shared/session/session-runtime.test.js` — prove create/load/prompt/cancel/handoff behavior is
  HostedSession-scoped and adapter-neutral.
- `src/acp/server.test.js` — prove ACP initialize capabilities, session/new, session/load replay, session/prompt update
  streaming, cancel stopReason, invalid session errors, and stdout/stderr separation.

## Reuse Opportunities

Existing modules and patterns to reuse:

- `src/shared/session/session-host.js` — keep as the process-local owner of HostedSessions; `SessionRuntime` should
  compose it rather than replace it.
- `src/shared/session/hosted-session.js` — keep as the sole owner of conversation-scoped mutable state.
- `src/shared/session/session.js` — reuse `ensureRootAgentSession`, `runRootTurn`, `runAgentSession`,
  `abortActiveSession`, `reloadRootAgentSession`, subscriber behavior, model resolution, tool auto-wiring, and
  HostedSession-aware root metadata.
- `src/shared/session/agent-handler.js` — reuse the workflow-aware handler so ACP gets the same Router, planning,
  execution, validation, and return-to-router semantics as TUI.
- `src/shared/interactive/chat-session.js` — reuse `runScopedSubmitHandoffLoop()` semantics by moving them into
  `SessionRuntime` or wrapping them temporarily without importing TUI-specific code into ACP.
- `src/shared/session/root-session.js` and `src/cmd/resume/index.js` — reuse session directory, `SessionManager.list`,
  `SessionManager.open`, active-agent marker restoration, and persisted-message hydration concepts for ACP
  `session/load` replay.
- `src/shared/ui/api.js` and `src/shared/ui/types.js` — use the current `UiAPI` method names as a migration guide for
  adapter-neutral event/interaction contracts, but do not preserve `UiAPI` as the core abstraction name.
- `src/tools/user-interview.js` — reuse the existing structured question validation and result format. Route its
  `promptSelect`/`promptText` through the interaction broker in non-TUI adapters.
- `src/tools/plan-written.js` and `src/shared/workflow/workflow-prompts.js` — preserve existing TUI behavior. For ACP,
  surface Plan review/approval needs as clear blocked/unsupported runtime interactions rather than attempting to build
  rich Plan review UX in this Epic.
- `@agentclientprotocol/sdk` — prefer the official SDK for protocol constants, method registration, NDJSON stream
  handling, and agent-side connection behavior. If Deno check/compile fails, use a compiled wrapper package rather than
  hand-rolling protocol semantics unless the wrapper also proves impractical.
- Existing tests under `src/shared/session/`, `src/shared/interactive/`, `src/shared/workflow/`, and `src/tools/` —
  preserve behavior while adding ACP/runtime coverage.

## Verification Plan

- Automated: prove SDK compatibility with a project test that imports the selected ACP SDK path, constructs a stream,
  registers minimal handlers, and passes `deno check` under this repo's pure JavaScript/JSDoc conventions.
- Automated: run focused `SessionRuntime` tests proving two HostedSessions can be created, prompted, canceled, and
  closed without state leakage.
- Automated: run focused interaction-broker tests proving select/text/approval requests resolve, cancel, timeout or
  unsupported outcomes are deterministic, and all pending interactions are scoped to the correct HostedSession.
- Automated: run ACP adapter tests with in-memory streams for `initialize`, `session/new`, `session/load`,
  `session/prompt`, `session/cancel`, invalid method/params, invalid session id, and concurrent prompt rejection or
  queuing behavior.
- Automated: test `session/load` replay by opening a persisted SessionManager fixture or stub and verifying prior
  user/assistant/system/tool entries are emitted as `session/update` notifications before the load response resolves.
- Automated: test cancellation semantics: `session/cancel` aborts active root/sub-agent sessions through
  `abortActiveSession`, pending updates are flushed as practical, and the original `session/prompt` resolves with
  `stopReason: "cancelled"` rather than an unhandled error.
- Automated: test stdout purity for ACP mode: protocol messages go to stdout; logs, diagnostics, extension warnings, and
  fatal startup errors go to stderr or structured ACP errors.
- Automated: repository search guard that ACP modules do not import `src/shared/interactive/chat-session.js` except for
  explicitly temporary tests or migration shims approved by the slice plan. Long-term ACP must depend on
  `SessionRuntime`, not TUI internals.
- Automated: run existing TUI/session/workflow command tests to confirm TUI behavior is preserved after moving shared
  turn orchestration.
- Automated: run `deno run ci` and fix all issues.
- Manual: run `wld` normally and verify the TUI still starts at Router, handles specialist handoff, `/new`,
  `/agent router`, `/model`, thinking controls, `/resume`, planning review, and simple execution/validation as before.
- Manual: run `wld acp` and send NDJSON initialize/session/new/session/prompt messages; verify ACP responses and
  streaming updates are valid JSON-RPC and no TUI is started.
- Manual: run `wld --mode acp` and verify it behaves identically to `wld acp`.
- Manual: run ACP `session/load` for a prior session id/path and confirm replay updates are emitted before the load
  response.
- Manual: start a long-running ACP prompt, send `session/cancel`, and verify the prompt resolves with `cancelled` and
  the HostedSession can accept another prompt afterward.
- Manual: exercise a prompt that triggers `user_interview` or plan approval through ACP. Confirm supported clients
  receive interaction requests; unsupported clients receive clear blocked/unsupported events and the agent receives a
  deterministic canceled/unsupported result rather than hanging.
- Expected result: TUI and ACP are sibling adapters over `SessionRuntime`; ACP exposes RunWield through
  protocol-compliant stdio; future WebUI/Takopi can reuse the same runtime/events/interactions without another core
  refactor.

No frontend browser verification is required for this Epic because it does not change Workspace UI. Future WebUI child
Epics or features must set `frontend: true` and use headed browser verification.

## Edge Cases & Considerations

- **Sibling boundary erosion:** ACP must not call TUI submit loops, slash-dispatch, or terminal UI prompt
  implementations. If a helper in `chat-session.js` is actually shared behavior, move it to `SessionRuntime` or a
  lower-level shared module.
- **SDK compatibility:** The official SDK imports in Deno, but implementation must prove repo-level `deno check`, tests,
  and compile behavior. If direct import is unstable, prefer a compiled wrapper package analogous to the Plannotator
  compiled package before writing a bespoke protocol implementation.
- **Protocol version drift:** ACP wire compatibility is negotiated through `protocolVersion`; start with protocol
  version `1` and advertise only capabilities actually implemented.
- **Session id semantics:** ACP `sessionId` should be stable and traceable to the underlying persisted
  SessionManager/HostedSession. Avoid inventing ids that cannot be loaded later.
- **Session load replay:** ACP `session/load` requires replaying conversation history before responding. Existing
  persisted branch entries may not map perfectly to ACP updates; define deterministic mappings and preserve enough raw
  metadata in `_meta` for debuggability.
- **Prompt overlap within one ACP session:** This is about a client sending a second `session/prompt` for the same ACP
  `sessionId` before the first prompt response has completed. It is not about multiple ACP clients or multiple
  HostedSessions: separate clients/conversations should use separate ACP sessions backed by separate HostedSessions. MVP
  should reject same-session overlapping prompt turns with an ACP invalid-state error unless a later design introduces
  explicit queuing. Mid-turn user input/steering is a separate capability and should not be smuggled in as a second
  prompt turn.
- **Cancellation races:** `session/cancel` is a notification. The runtime must handle cancellation arriving before root
  session creation, during model streaming, during tool execution, during workflow validation, or after turn completion.
- **Interactive prompts:** Standard ACP has permission requests but not an exact equivalent for every RunWield
  structured interview. The MVP should build the core interaction broker now, map standard-compatible flows directly,
  expose RunWield-specific extension metadata/methods where needed, and fail clearly for generic clients that cannot
  answer.
- **Plan review and `plan_written`:** Rich Plan review/approval should be addressed later with a solution outside of
  ACP. It is acceptable for `plan_written` flows to be awkward, unsupported, or clearly blocked in this slice as long as
  they do not hang the ACP server or corrupt session state. This Epic should not replace Plannotator or build ACP-native
  Plan review UI.
- **Tool permissions vs local tools:** ACP clients can expose filesystem/terminal capabilities, but RunWield already
  executes local tools itself. The MVP should not attempt to outsource RunWield tool execution to ACP client fs/terminal
  methods unless a later ADR changes that model.
- **stdout contamination:** Because ACP uses stdout for JSON-RPC, any diagnostic `console.log` in ACP mode can break
  clients. The adapter must route diagnostics to stderr or structured notifications.
- **CWD boundaries:** ACP `session/new` and `session/load` require absolute cwd values. Runtime operations should bind
  cwd to the HostedSession and guard against accidental cross-project reuse.
- **TUI behavior regression:** Moving shared orchestration out of `chat-session.js` is risky because that file owns
  editor state, image paste, steering, slash commands, and footer rendering. Keep adapter-only behavior in the TUI and
  move only conversation/runtime behavior.
- **Takopi deferred:** Do not add Takopi project mapping, Telegram formatting, chat/topic binding, or branch semantics
  in this Epic. The success criterion is an ACP server that Takopi can later consume.
