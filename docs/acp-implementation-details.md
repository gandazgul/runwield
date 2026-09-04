# ACP Implementation Details and Gaps

**Audit date:** 2026-07-19\
**Verdict:** RunWield ships an **ACP v1 stdio adapter** for the implemented Session path. The hardening work closed the
listed wire-shape and lifecycle gaps for initialize, generated version, cumulative cost, cancellation ordering, stdio
MCP setup, and reloadable mapped Sessions. RunWield still must not claim support for optional ACP features it does not
advertise.

## Audit baseline

This document compares the current repository implementation against:

- ACP v1 overview, initialization, session setup, prompt turn, schema, transport, content, tool call, and extensibility
  documentation: <https://agentclientprotocol.com/protocol/v1/overview>
- ACP v1 stdio transport rules: <https://agentclientprotocol.com/protocol/v1/transports>
- ACP v1 initialization rules: <https://agentclientprotocol.com/protocol/v1/initialization>
- ACP v1 session setup rules: <https://agentclientprotocol.com/protocol/v1/session-setup>
- ACP v1 prompt-turn and cancellation rules: <https://agentclientprotocol.com/protocol/v1/prompt-turn>
- ACP v1 schema reference: <https://agentclientprotocol.com/protocol/v1/schema>
- ACP v1 content and tool-call references: <https://agentclientprotocol.com/protocol/v1/content> and
  <https://agentclientprotocol.com/protocol/v1/tool-calls>
- ACP v1 extension rules: <https://agentclientprotocol.com/protocol/v1/extensibility>
- ACP elicitation RFD used by the current SDK and adapter: <https://agentclientprotocol.com/rfds/elicitation>
- RunWield's pinned `@agentclientprotocol/sdk` dependency in `deno.json` (`^1.4.0`, resolved to 1.4.0 in `deno.lock`).

The implementation evidence comes from these source files:

- `src/cli.ts`
- `src/cmd/registry.js`
- `src/cmd/acp/index.js`
- `src/acp/server.js`
- `src/acp/session-map.js`
- `src/acp/event-mapper.js`
- `src/acp/interaction-mapper.js`
- `src/shared/session/session-runtime.js`
- `src/shared/session/session-runtime-events.js`
- `src/shared/session/session-runtime-interactions.js`
- `src/acp/protocol-smoke.test.js`
- `src/acp/session-map.test.js`
- `src/acp/server.test.js`

## Short answer: is RunWield up to ACP v1?

RunWield now satisfies the ACP v1 behavior it advertises for initialize and the core Session path. The hardened adapter:

1. returns supported `protocolVersion: 1` even when a Client requests an unsupported version;
2. returns ACP Session ids based on the persisted RunWield Session id for new Sessions;
3. accepts stdio `mcpServers` in `session/new` and `session/load`, starts them through Core MCP support, and rejects
   HTTP, SSE, and ACP transports;
4. waits for Runtime settlement and queued updates before `session/prompt` returns `stopReason: "cancelled"`;
5. sends `usage_update.cost` as `{ amount, currency: "USD" }`, where `amount` is the cumulative ACP Session cost; and
6. reports the generated RunWield version from `src/shared/version.js`.

The adapter still has feature limits outside this hardening scope.

Important limitations that are not necessarily baseline v1 violations because they are optional or unadvertised:

- no `session/list`, `session/resume`, or `session/delete` support;
- no session config options or mode switching over ACP;
- no additional workspace roots;
- no embedded resource, image, or audio prompt content;
- no client filesystem or terminal delegation;
- no standard `plan`, `available_commands_update`, `config_option_update`, `current_mode_update`, or
  `session_info_update` notifications;
- no rich ACP-native RunWield Plan review, Feedback, or approval flow.

## Architecture and transport

RunWield exposes ACP through two CLI entry points:

```bash
wld acp
wld --mode acp
```

`src/cli.ts` routes `--mode acp` before normal command/TUI dispatch so stdout can remain protocol-pure. The command
registry describes the ACP command as CLI-only and notes that stdout is reserved for ACP JSON-RPC frames. The command
implementation in `src/cmd/acp/index.js` starts `startRunWieldAcpServer(Deno.stdin.readable, Deno.stdout.writable)` and
writes diagnostics to stderr with a `[RunWield ACP]` prefix.

The server in `src/acp/server.js` uses the ACP SDK's `ndJsonStream`, so the wire transport is newline-delimited UTF-8
JSON-RPC over stdio. That matches the ACP v1 stdio transport requirement that stdout contain only valid ACP messages and
that diagnostics go to stderr.

ACP is not a wrapper around the TUI. It is a sibling adapter over `SessionRuntime`, following
`docs/adr/010-session-runtime-sibling-adapters-and-acp.md`:

```text
ACP JSON-RPC stdio
    -> src/acp/server.js
    -> SessionRuntime
    -> SessionHost / HostedSession / Agent Session state
```

When the ACP connection closes, `startRunWieldAcpServer` calls `closeAllMappedSessions()`. Each mapped session is closed
through `closeMappedSession()`, which uses `runtime.closeSessionWhenIdle()` when available so active work is cancelled
and settled before the Hosted Session is disposed.

## Initialization and advertised capabilities

`createInitializeResponse()` in `src/acp/server.js` builds the initialize result.

| Capability or field                                                        | Current wire behavior                                                                                                                                                                                                    | Standard or extension                                                                                    | Evidence            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------- |
| `protocolVersion`                                                          | Always returns the SDK `PROTOCOL_VERSION` value, currently `1`.                                                                                                                                                          | Standard ACP v1 negotiation.                                                                             | `src/acp/server.js` |
| `agentCapabilities.loadSession`                                            | `true`.                                                                                                                                                                                                                  | Standard stable v1 capability.                                                                           | `src/acp/server.js` |
| `agentCapabilities.promptCapabilities`                                     | Only `_meta.runwield.contentTypes: ["text", "resource_link"]`; no `image`, `audio`, or `embeddedContext`.                                                                                                                | Baseline text/resource-link support is standard; the explicit content-type list is a RunWield extension. | `src/acp/server.js` |
| `agentCapabilities.sessionCapabilities.close`                              | `{}`.                                                                                                                                                                                                                    | Standard stable v1 capability.                                                                           | `src/acp/server.js` |
| `agentCapabilities.sessionCapabilities._meta.runwield.implementedMethods`  | Lists `session/new`, `session/load`, `session/prompt`, `session/cancel`, `session/close`.                                                                                                                                | RunWield extension.                                                                                      | `src/acp/server.js` |
| `agentCapabilities.sessionCapabilities._meta.runwield.updateNotifications` | Lists `session/update`.                                                                                                                                                                                                  | RunWield extension.                                                                                      | `src/acp/server.js` |
| `authMethods`                                                              | `[]` by default. When the Client declares `clientCapabilities.auth.terminal === true`, or the registry probe declares `_meta["terminal-auth"] === true`, RunWield advertises one terminal method with `args: ["login"]`. | Standard stable v1 field plus narrow registry compatibility.                                             | `src/acp/server.js` |
| `agentInfo`                                                                | `{ name: "RunWield", version: VERSION }`, where `VERSION` is the generated build version used by `wld --version`.                                                                                                        | Standard stable v1 field.                                                                                | `src/acp/server.js` |

The adapter stores `clientCapabilities` from `initialize` for later interaction mapping. Current production use covers
Terminal Auth capability detection during `initialize` and `clientCapabilities.elicitation.form` in
`src/acp/interaction-mapper.js`.

Terminal Auth is out of band. The ACP Client starts RunWield, reads the terminal auth method, launches the configured
command with `login` appended, waits for that terminal process to finish, and reconnects to `wld acp`. `wld login` uses
the same Login command handler as `/login`, but the setup-only TUI exits instead of creating a Session. The process
succeeds only after credentials and a usable default model are configured. Credentials remain in `~/.wld/auth.json` and
are not sent through ACP.

### Initialization behavior

ACP v1 version negotiation says the Agent must respond with the requested protocol version if it supports it; otherwise
it must respond with the latest version it supports. RunWield imports `PROTOCOL_VERSION` from the SDK. That constant is
`1`, so RunWield answers `1` for supported request `1` and unsupported request `99`.

## Implemented stable methods

| Method           | Advertised?                                     | Current behavior                                                                                                                                                                                                                                                                            | Important gaps                                                                                                                   |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `initialize`     | Required baseline.                              | Stores client capabilities and returns `protocolVersion: 1`, Terminal Auth only for capable Clients, and generated `agentInfo.version`.                                                                                                                                                     | No known gap in the advertised initialize shape.                                                                                 |
| `session/new`    | Required baseline.                              | Validates absolute `cwd`, accepts stdio `mcpServers`, rejects other MCP transports and `additionalDirectories`, requires login plus a usable default model, creates a prompt-ready Runtime session, maps it to an ACP session id, and returns `sessionId` plus `_meta.runwield`.            | Returned ACP id is not reliably reloadable through standard `session/load`; MCP prompts/resources are not supported.             |
| `session/load`   | Advertised through `loadSession: true`.         | Validates like `session/new`, requires `sessionId`, optionally accepts `_meta.runwield.sessionPath`, accepts stdio `mcpServers`, loads a persisted Runtime session, replays mapped Runtime events as `session/update`, and returns `_meta.runwield` after replay.                           | Relies on nonstandard id normalization for `acp-*`; supports no additional roots; MCP prompts/resources are not supported.       |
| `session/prompt` | Required baseline.                              | Requires a mapped `sessionId`, converts prompt blocks to one text string, installs a per-prompt interaction adapter, subscribes to Runtime events, streams mapped `session/update` notifications, waits for Runtime settlement, waits for pending update sends, and returns a `stopReason`. | Only text and lossy resource links are accepted; most Runtime success/failure states collapse to `end_turn` or `refusal`.        |
| `session/cancel` | Required baseline notification.                 | Looks up the mapped Runtime session, marks the active ACP prompt cancelled, and calls `runtime.cancelSession()`. Unknown sessions are ignored because this is a notification. The notification does not complete the prompt by itself.                                                      | No known ordering gap in the advertised cancel path.                                                                             |
| `session/close`  | Advertised through `sessionCapabilities.close`. | Requires a mapped `sessionId`, marks active prompt cancelled, calls `closeSessionWhenIdle()` when available, removes the ACP mapping, and returns `_meta.runwield.closed`.                                                                                                                  | Response shape is acceptable because `_meta` is allowed, but standard clients will ignore the RunWield-specific closure details. |

## Unsupported agent methods

`src/acp/server.js` registers structured `-32004` errors for these methods:

- `authenticate`
- `logout`
- `providers/list`
- `providers/set`
- `providers/disable`
- `session/list`
- `session/delete`
- `session/fork`
- `session/resume`
- `session/set_mode`
- `session/set_config_option`
- `nes/start`
- `nes/suggest`
- `nes/close`

For stable optional methods such as `logout`, `session/list`, `session/delete`, `session/resume`, `session/set_mode`,
and `session/set_config_option`, this is an optional coverage gap when the method is not advertised. It is not itself a
baseline conformance failure. Provider, NES, fork, and elicitation-related SDK surfaces include unstable protocol areas
and should be assessed separately from stable ACP v1 conformance.

## Session identity model

RunWield currently has three relevant session identities:

| Identity                    | Owner                                       | Purpose                                                               | Current example                                                                                             |
| --------------------------- | ------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| ACP session id              | `AcpSessionMap` in `src/acp/session-map.js` | Transport-facing id used by ACP clients for prompt/cancel/close/load. | `acp-<runtimeSessionId>` for fresh sessions; the caller's `sessionId` for loaded sessions.                  |
| Runtime session id          | `SessionRuntime` / `HostedSession`          | Opaque live in-process Hosted Session id.                             | A `crypto.randomUUID()` from `SessionRuntime.createInteractiveSession()` or `SessionRuntime.loadSession()`. |
| Persisted SessionManager id | Pi/RunWield SessionManager                  | Durable conversation id used to reopen prior chat history.            | `snapshot.sessionManagerId` or `result.sessionManagerId`.                                                   |

The separation is intentional at the architecture level: ADR-010 says Hosted Session ids are in-process identities and
are distinct from persisted SessionManager ids and transport-facing ACP ids.

The current ACP mapping creates an interoperability problem for fresh sessions. `session/new` calls
`runtime.createPromptReadySession()`, receives a live Runtime id, and creates the ACP id as `acp-<runtimeSessionId>`. It
also exposes the persisted SessionManager id in `_meta.runwield.persistedSessionId`, but `_meta` is optional extension
data. Standard ACP clients are expected to use the returned `sessionId` when loading later. If they pass
`acp-<runtimeSessionId>` to `session/load`, RunWield strips the `acp-` prefix and tries to load `<runtimeSessionId>` as
a persisted id. Because Runtime ids are not the same as persisted SessionManager ids, that load is not reliable.

Loaded sessions behave differently: `session/load` maps the client-provided `sessionId` directly to a new Runtime id and
returns no standard `sessionId` field, matching the ACP load response schema. That means a loaded session can continue
to use the same ACP-facing id during the live connection.

## Prompt content handling

`convertAcpPromptToText()` accepts only these prompt content blocks:

| ACP prompt block | Current handling                                                        | Interop note                                                                                                        |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `text`           | Appends `block.text` to a newline-joined text prompt.                   | Baseline supported.                                                                                                 |
| `resource_link`  | Appends `[Resource: label <uri>]` text using `title`, `name`, or `uri`. | Baseline accepted, but support is lossy because metadata is flattened into text and no resource fetch is performed. |
| `resource`       | Rejected as unsupported.                                                | Optional, gated by `promptCapabilities.embeddedContext`; RunWield does not advertise it.                            |
| `image`          | Rejected as unsupported.                                                | Optional, gated by `promptCapabilities.image`; RunWield does not advertise it.                                      |
| `audio`          | Rejected as unsupported.                                                | Optional, gated by `promptCapabilities.audio`; RunWield does not advertise it.                                      |

The Runtime receives the converted text as `initialRequest` with `initialImages: []`. No ACP prompt metadata is
currently forwarded to the Runtime turn.

## `session/update` event mapping

`src/acp/event-mapper.js` maps adapter-neutral Runtime events into ACP `session/update` notifications.

| Runtime event                                     | ACP update                                      | Current details                                                                                                                                                                             |
| ------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_message`                                    | `user_message_chunk`                            | Sends text content and message id; replay metadata remains under `_meta.runwield`.                                                                                                          |
| `assistant_text_delta`                            | `agent_message_chunk`                           | Sends text content and message id; agent name, message kind, workflow marker, and approval marker are extension metadata.                                                                   |
| `assistant_thinking_delta`                        | `agent_thought_chunk`                           | Sends text content and agent-name metadata.                                                                                                                                                 |
| `tool_start`                                      | `tool_call`                                     | Sends id, title, kind, status `in_progress`, raw input, and tool-name metadata.                                                                                                             |
| `tool_update`                                     | `tool_call_update`                              | Sends id/title/kind/status `in_progress`, full content snapshot, and `rawOutput`.                                                                                                           |
| `tool_end`                                        | `tool_call_update`                              | Sends status `completed` or `failed`, full content snapshot, `rawOutput`, and duration metadata.                                                                                            |
| `usage`                                           | `usage_update`                                  | Sends `used`, `size`, and `cost: { amount, currency: "USD" }` when the cumulative Session cost is greater than zero. `amount` is cumulative for the ACP Session.                            |
| `plan_review_link`                                | `agent_message_chunk`                           | Sends the review-link message as text and includes Plan/review metadata under `_meta.runwield`.                                                                                             |
| `agent_changed`                                   | `agent_message_chunk`                           | Sends `Active agent: <name>` as text plus metadata.                                                                                                                                         |
| `system_status`, `cancellation`, `terminal_error` | `agent_message_chunk` when a message is present | Status and cancellation events without a message are dropped.                                                                                                                               |
| Other Runtime events                              | no ACP update                                   | Session, busy, model, thinking-level, workflow-context, input-state, running-task, queued-message, interaction-lifecycle, attention, and keyboard-help events are currently ignored by ACP. |

Runtime tool content is currently limited by `RuntimeToolContentBlock` to text and image blocks. ACP tool-call content
supports richer content, diffs, terminals, and locations; RunWield does not currently emit ACP diffs, terminal handles,
or file locations for tool calls.

### Usage update behavior

ACP v1 defines `usage_update.cost` as an optional object with `amount` and `currency`. RunWield keeps a cumulative USD
total on each ACP Session record. Live, setup, and replayed Runtime `usage` events add their per-message `costUsd` to
that total before mapping. The wire value is `cost: { amount: <Session total>, currency: "USD" }` when the total is
greater than zero. If no priced message exists, `cost` is omitted.

RunWield still sets `size` to `event.usage.contextWindow || used`; when no context window is known, this can make `size`
equal current used tokens rather than total context capacity. That fallback size behavior is still a semantic accuracy
issue.

## Prompt completion and stop reasons

ACP v1 stop reasons are `end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, and `cancelled`.

RunWield currently returns:

- `cancelled` when the ACP prompt record has been marked cancelled, or when the Runtime result already reports
  `stopReason: "cancelled"`;
- `refusal` when the Runtime result has `ok: false`;
- `end_turn` for other successful Runtime results.

The adapter does not currently preserve a Runtime distinction for `max_tokens` or `max_turn_requests`, and Runtime
handoff-limit outcomes are treated as successful `end_turn` responses after emitting a warning status. This is a
fidelity gap if those Runtime conditions need to map to standard ACP stop reasons.

## Cancellation behavior

`session/cancel` is a notification. RunWield handles it by:

1. finding the Runtime session id for the ACP session id;
2. calling `sessionMap.markCancelled(sessionId)`, which only sets the active prompt's `cancelled` flag; and
3. calling `runtime.cancelSession(runtimeSessionId)`.

`session/prompt` awaits the Runtime prompt promise. It then awaits all pending `session/update` sends. If the prompt
record was marked cancelled, it returns `{ stopReason: "cancelled" }`. The Runtime cancellation message, such as
`Agent run canceled.`, is sent before the prompt response.

A second `session/prompt` for the same ACP Session is still rejected with `-32002` while the cancelled turn is settling.
After the cancelled response is sent, the next prompt can start.

## Interactions and Plan review

RunWield's ACP interaction adapter maps Runtime interaction requests into client requests when possible.

| Runtime interaction     | ACP behavior                                                                                                                               | Stability                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `select`                | Sends `elicitation/create` with `mode: "form"`, one `answer` string field, and `oneOf` options.                                            | ACP elicitation surface in SDK 1.4.0.            |
| `text`                  | Sends `elicitation/create` with `mode: "form"`, one `answer` string field, default, and placeholder description.                           | ACP elicitation surface in SDK 1.4.0.            |
| `approval`              | Sends `elicitation/create` like select, then maps accepted approval values to Runtime acceptance and non-accepted choices to cancellation. | ACP elicitation surface in SDK 1.4.0.            |
| `plan_review`           | Calls `sharePlanForReview()` and returns an accepted Runtime interaction with a remote review URL in metadata.                             | RunWield product behavior outside stable ACP v1. |
| Other interaction types | Returns Runtime `unsupported`.                                                                                                             | Adapter limitation.                              |

The adapter only sends form elicitations when the client advertises `clientCapabilities.elicitation.form`. Without that
capability, select/text/approval interactions return unsupported. Plan review is special-cased and does not require form
elicitation support.

RunWield does not currently provide stable ACP-native Plan approval, returned Feedback, Plan body edits, or Workflow
Validation controls. It can surface a review link through a text message plus `_meta.runwield`, but the actual review UX
remains RunWield/Plannotator-specific.

## Error behavior

The adapter uses these RunWield-specific JSON-RPC error codes in `src/acp/server.js`:

| Code     | Name in source        | Current use                                                                                                                                                                       |
| -------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-32602` | `ACP_INVALID_PARAMS`  | Invalid or unsupported request parameters, such as relative `cwd`, missing `sessionId`, unsupported prompt content, non-empty `mcpServers`, or non-empty `additionalDirectories`. |
| `-32001` | `ACP_NOT_FOUND`       | Unknown ACP session or unable to load a persisted session.                                                                                                                        |
| `-32002` | `ACP_INVALID_STATE`   | Active prompt overlap or duplicate loaded-session mapping.                                                                                                                        |
| `-32004` | `ACP_NOT_IMPLEMENTED` | Registered-but-unimplemented methods.                                                                                                                                             |

Unexpected runtime failures propagate through the ACP SDK as internal errors.

## Required and high-priority gaps

| Priority | Gap                                                                                  | ACP basis                                                                                                             | Current evidence                                                                                                | Impact                                                                            | Likely remediation seam                                                                                           |
| -------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Closed   | Protocol version negotiation echoes unsupported versions.                            | ACP initialization requires returning requested version only when supported; otherwise latest supported version.      | `createInitializeResponse()` returns SDK `PROTOCOL_VERSION`, currently `1`.                                     | Clients receive the supported version and can accept or close.                    | Covered by `server.test.js`.                                                                                      |
| Closed   | `session/new` returns a live-runtime-derived ACP id that is not reliably reloadable. | ACP session ids identify conversations and are used for `session/load` when load is supported.                        | `AcpSessionMap.createRecord()` defaults to `acp-${persistedSessionId}` for new Sessions.                        | Standard clients can load the returned mapped id later.                           | Covered by `server.test.js`.                                                                                      |
| Closed   | Non-empty stdio `mcpServers` are rejected.                                           | ACP v1 says all Agents must support stdio MCP server configurations; HTTP/SSE are optional capabilities.              | `validateNewSessionParams()` accepts stdio `mcpServers` and rejects HTTP, SSE, and ACP transports.              | Clients can pass stdio MCP servers.                                               | Covered by the real MCP fixture test.                                                                             |
| Closed   | Cancellation may respond before final Runtime settlement and updates.                | ACP prompt cancellation requires pending updates to be sent before the original `session/prompt` returns `cancelled`. | `session/prompt` awaits the Runtime prompt and pending notification sends before returning `cancelled`.         | Clients see final cancellation updates before the response.                       | Covered by the cancel-ordering test.                                                                              |
| Closed   | `usage_update.cost` is a number instead of `{ amount, currency }`.                   | ACP v1 `UsageUpdate.cost` uses the `Cost` object.                                                                     | `event-mapper.js` sends `{ cost: { amount: sessionTotal, currency: "USD" } }` when cumulative cost is non-zero. | Strict clients receive a schema-valid cost.                                       | Covered by schema and cumulative-cost tests.                                                                      |
| High     | `usage_update.size` can fall back to used tokens.                                    | ACP `size` is total context window size.                                                                              | `event-mapper.js` uses `event.usage.contextWindow` when truthy, otherwise `used`.                               | Clients can display misleading capacity information.                              | Omit usage until capacity is known only if schema permits, or ensure Runtime always supplies real context window. |
| Medium   | Stop-reason fidelity is coarse.                                                      | ACP defines multiple semantic stop reasons.                                                                           | `session/prompt` collapses most successful Runtime outcomes to `end_turn` and failures to `refusal`.            | Clients cannot distinguish token, request-limit, and some workflow-stop outcomes. | Add Runtime result stop-reason vocabulary and map directly where possible.                                        |
| Closed   | `agentInfo.version` was static.                                                      | ACP says implementation info should provide name/version and future versions may require it.                          | `createInitializeResponse()` returns generated `VERSION` from `src/shared/version.js`.                          | Debugging and registry/client UX can identify the actual RunWield build.          | Covered by the CLI/ACP version proof.                                                                             |
| Medium   | Tool call start status is always `in_progress`.                                      | ACP examples distinguish initial `pending` from later `in_progress`, though status is flexible.                       | `TOOL_START` maps to `tool_call` with `status: "in_progress"`.                                                  | Some clients may not show approval/input-pending states correctly.                | Preserve Runtime pending/in-progress states if the Runtime can expose them.                                       |

## Optional stable v1 coverage gaps

These are useful interoperability targets, but they are not baseline violations while unadvertised.

| Area                                           | Current state                                                    | Notes                                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `session/list`                                 | Registered as unimplemented and not advertised.                  | Needed for richer IDE session pickers.                                                        |
| `session/resume`                               | Registered as unimplemented and not advertised.                  | Could reconnect without replaying history once stable id semantics are fixed.                 |
| `session/delete`                               | Registered as unimplemented and not advertised.                  | Would need careful mapping to RunWield/Pi persisted sessions.                                 |
| `session/set_mode`                             | Registered as unimplemented and not advertised.                  | ACP session modes are transitional; config options are preferred.                             |
| `session/set_config_option`                    | Registered as unimplemented and no `configOptions` are returned. | Natural future fit for active Agent, model, and thinking-level controls.                      |
| Additional directories                         | Explicitly rejected when non-empty and not advertised.           | Could map to future multi-root project context and tool boundaries.                           |
| Embedded resources                             | Rejected; `embeddedContext` is not advertised.                   | Would allow clients to pass file contents without relying on RunWield file access.            |
| Image/audio prompt blocks                      | Rejected; `image`/`audio` are not advertised.                    | Could eventually reuse RunWield vision fallback for images.                                   |
| Client filesystem methods                      | Not used by the Agent.                                           | RunWield currently uses its own tools and local process filesystem.                           |
| Client terminal methods                        | Not used by the Agent.                                           | RunWield currently runs tools locally and reports tool output through Runtime events.         |
| Standard `plan` update                         | Not emitted.                                                     | RunWield Plans are durable markdown artifacts and workflow-specific, not ACP PlanEntry lists. |
| `available_commands_update`                    | Not emitted.                                                     | Slash commands remain TUI/CLI behavior.                                                       |
| `current_mode_update` / `config_option_update` | Not emitted.                                                     | Related to missing mode/config methods.                                                       |
| `session_info_update`                          | Not emitted.                                                     | Could expose Session Name, cwd, and metadata to clients.                                      |
| Tool diffs, terminals, locations               | Not emitted.                                                     | Current tool updates contain content and raw output only.                                     |

## Experimental or RunWield-specific behavior

RunWield uses ACP extension points in two ways:

- `_meta.runwield` appears in initialize capabilities, session responses, message/tool metadata, replay events, and Plan
  review link notifications. This follows ACP's `_meta` extension mechanism and should be ignored by standard clients.
- `elicitation/create` is used for select/text/approval interactions when a client advertises form elicitation. SDK
  1.4.0 keeps the wire method as `elicitation/create`; RunWield still treats the interaction mapping as capability-gated
  ACP behavior, not as a promise that all ACP Clients can answer every RunWield interaction.

RunWield also surfaces Plan review through remote Plan sharing and Plannotator links. That behavior is valuable for
RunWield workflows, but it is not a stable ACP v1 Plan or approval protocol.

## Current automated coverage

Current ACP tests include schema and lifecycle conformance coverage for the implemented adapter path:

- `src/acp/protocol-smoke.test.js` verifies SDK 1.4.0 imports, `PROTOCOL_VERSION`, elicitation method names, `Cost`,
  `UsageUpdate`, and Terminal Auth schema behavior.
- `src/acp/session-map.test.js` verifies ACP/runtime id mapping, cancellation records, and cumulative Session cost
  state.
- `src/acp/server.test.js` covers initialize output, protocol-pure stdout, version proof, serialized schema checks,
  unimplemented-method errors, session load replay, prompt streaming, prompt overlap handling, close/cancel ordering,
  usage cost mapping, event mapping, interaction mapping, and the no-TUI-import boundary.
- `src/acp/interaction-mapper.test.js` covers form elicitation mapping and unsupported interaction behavior.

Future conformance work should add more black-box fixtures only when RunWield advertises more ACP features.

## Suggested next work

1. Tighten `usage_update.size` so it never suggests exact context capacity when the Runtime does not know it.
2. Add more exact ACP stop-reason mapping if the Runtime exposes `max_tokens` or `max_turn_requests` distinctly.
3. Add optional session/config/list/richer-update capabilities incrementally and only advertise them once implemented.
4. Add HTTP/SSE MCP, MCP prompts, or MCP resources only through a separate Core MCP design.

## Related documents

- [RunWield Session Host and ACP Integration PRD](prd/runwield-acp-protocol-prd.md)
- [ADR-010: SessionRuntime Sibling Adapter Boundary for ACP](adr/010-session-runtime-sibling-adapters-and-acp.md)
- [SessionRuntime and ACP v1 stdio MVP Work Record](work-records/2026-07-17-sessionruntime-and-acp-v1-stdio-mvp.md)
