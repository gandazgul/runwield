---
planId: "28e93cd2-f201-4fd7-873c-c7ca4fbe9d5d"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "HIGH"
affectedPaths:
    - "deno.json"
    - "deno.lock"
    - "src/acp/server.js"
    - "src/acp/session-map.js"
    - "src/acp/event-mapper.js"
    - "src/acp/interaction-mapper.js"
    - "src/acp/protocol-smoke.test.js"
    - "src/acp/server.test.js"
    - "src/acp/session-map.test.js"
    - "src/acp/managed-session.integration.test.ts"
    - "docs/acp-implementation-details.md"
    - "docs/research/acp-registry-gap-report.md"
    - "docs/prd/runwield-acp-protocol-prd.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-09-02T13:47:43-04:00"
status: "ready_for_work"
origin: "internal"
userVerifiedAt: null
---

# ACP v1 Conformance Hardening

## Context

RunWield has an ACP v1 stdio adapter. The ACP audit (`docs/acp-implementation-details.md`) listed six conformance gaps.
One is already closed on `main`: the Core MCP Plan (`core-mcp-tool-support.md`, validated, merged in `4aaf022c`) made
`session/new` and `session/load` accept and validate stdio `mcpServers` (`src/acp/server.js:202-232`). Five gaps remain,
and each was confirmed in the current source:

- `initialize` echoes any requested `protocolVersion`, including unsupported ones (`server.js:86`);
- `session/cancel` resolves an adapter-owned promise that races the Runtime turn, so `session/prompt` can return
  `stopReason: "cancelled"` before the Runtime settles and before the last updates are sent (`server.js:582-588`,
  `session-map.js:106-113`);
- `usage_update.cost` is a bare number (`event-mapper.js:111`); the SDK schema, even at the locked `1.2.1`, requires
  `{ amount, currency }` and defines `amount` as the cumulative Session cost, while the Runtime emits per-message cost;
- `agentInfo.version` is the static placeholder `0.0.0-acp-mvp` (`server.js:109`); and
- RunWield locks `@agentclientprotocol/sdk` at `1.2.1` while `1.4.0` is the current stable v1 release.

Two earlier Plans are the execution baseline, not open prerequisites:

1. `acp-registry-terminal-auth.md` (validated, `ec4d68d2`) — capability-gated Terminal Auth descriptor, login-only
   invocation, authentication-required behavior, and the registry initialize probe test. Protected behavior.
2. `core-mcp-tool-support.md` (validated, `871ef4df`) — Core-owned MCP configuration, stdio MCP clients, the
   `mcp_<server>_<tool>` naming rule, root Agent exposure, warning policy, process lifecycle, the real fixture server in
   `src/shared/mcp/fixture-server.ts`, and ACP server-definition acceptance. Protected behavior; this Plan adds no MCP
   code and does not reopen the naming decision.

Both Plans landed their glossary entries (`docs/domain-language.md`: Terminal Auth, MCP Server Configuration, MCP Tool).

Decisions from the planning conversation: `cost.amount` reports the Session-cumulative USD total (schema semantics,
mirroring the TUI footer), and the version proof runs `wld --version` and ACP `initialize` as subprocesses from the same
source tree instead of compiling a binary.

## Objective

Close the five remaining gaps so every listed ACP response and lifecycle behavior matches the current ACP v1 contract.
Strict Clients receive negotiated version `1`, a schema-valid cumulative Session cost, the same RunWield build version
that `wld --version` prints, and a cancellation response only after the Runtime turn and every pending update have
settled. The current stable ACP SDK (`1.4.0`) is locked, and Terminal Auth, stdio MCP tools, elicitation, replay, and
managed-Session behavior from the baseline remain intact on the new SDK.

## Approach

Harden the existing ACP adapter rather than adding another protocol layer:

```text
initialize
  -> return PROTOCOL_VERSION (never the requested value)
  -> keep baseline Terminal Auth capability gate
  -> agentInfo.version = generated VERSION

session/new or session/load
  -> keep baseline Core-owned stdio MCP setup
  -> SessionRuntime
  -> replayed usage events add to the ACP Session's cost total

session/prompt
  -> Runtime turn (await the Runtime promise only; no race)
  -> session/cancel marks the prompt + calls runtime.cancelSession()
  -> Runtime settles (its cancellation event is the last mapped update)
  -> await every queued session/update send
  -> return { stopReason: "cancelled" }

Runtime usage event
  -> AcpSessionMap adds costUsd to the Session total
  -> usage_update { used, size, cost: { amount: <Session total>, currency: "USD" } }
```

**SDK first.** Move `@agentclientprotocol/sdk` from `^1.2.1` to `^1.4.0`, lock `1.4.0`, and run the whole ACP suite
before any behavior change. The delta is small for RunWield: `1.3.0` added an experimental v2 API and moved the schema
to 1.20.0; `1.4.0` stabilized elicitation (removed the "UNSTABLE" labels and the `unstable_*` class helpers) and moved
the schema to 1.21.0. RunWield imports only `agent`, `methods`, `ndJsonStream`, `PROTOCOL_VERSION`, and `RequestError`;
the elicitation wire method stays `elicitation/create`; the `AuthMethodTerminal` and `Cost` schemas are unchanged. Keep
ACP v1 as the production import and do not adopt `experimental/v2`. If something does break, repair the adapter against
public v1 APIs; do not keep two SDK versions or add a wrapper that bypasses schema validation.

**Negotiation and version.** `createInitializeResponse()` returns `PROTOCOL_VERSION` for every request. ACP negotiation
puts the decision on the Client: it receives the Agent's supported version and accepts or closes. `agentInfo.version`
imports `VERSION` from `src/shared/version.js`, the same generated file `src/cmd/version/index.js` prints, so an ACP
Client and `wld --version` cannot disagree.

**Cancellation keeps one owner.** Today (`server.js:580-588`):

```js
const result = await Promise.race([runtimePrompt, startedPrompt.cancellation]); // adapter promise can win
await Promise.allSettled(pendingNotifications);
if (getActivePrompt()?.cancelled) {
    deferCleanupUntilRuntimeSettles = true;
    void runtimePrompt.then(cleanupPrompt, cleanupPrompt); // Runtime still running
    return { stopReason: "cancelled" }; // response leaves early
}
```

After:

```js
const result = await runtimePrompt; // Runtime settlement is the only completion
await Promise.allSettled(pendingNotifications); // includes the mapped Runtime cancellation event
if (activePrompt?.cancelled) return { stopReason: "cancelled" };
// ... existing ok / queued / error handling; finally { cleanupPrompt(); }
```

`session/cancel` still marks the prompt and calls `SessionRuntime.cancelSession()`, which aborts the agent run, clears
queued messages, and emits the `cancellation` Runtime event (mapped to an `agent_message_chunk`). `AcpPromptRecord`
keeps `cancelled`, `turnId`, and `requestId`; the `cancellation` promise and `resolveCancellation` go away.
`deferCleanupUntilRuntimeSettles` goes away because cleanup always runs after settlement. The `catch` path keeps
returning `cancelled` when the Runtime rejects on a cancelled prompt.

**Cumulative cost.** The Runtime emits one `usage` event per assistant message with that message's `costUsd`
(`session.js:3045-3049`, normalized from `usage.cost.total`). ACP defines `cost.amount` as the cumulative Session cost,
so the adapter sums like the TUI footer does (`src/ui/tui/chat-footer.ts:281-296`). `AcpSessionMap` owns a
per-ACP-Session `usageCostUsd` total; each of the three places `server.js` maps Runtime events — `replaySetupEvents()`
(`:355`), `session/load` replay (`:433`), and the live prompt subscription (`:544`) — adds a usage event's `costUsd` to
the total before mapping. `mapRuntimeEventToAcpSessionNotification()` stays a pure function and receives the total as an
argument. The total survives Runtime Session replacement because the ACP Session identity does not change. `cost` is
omitted while the total is `0` (unknown pricing) and present on every later `usage_update`.

**MCP.** No MCP change. The existing black-box test "ACP session/new and session/prompt can invoke a real MCP fixture
tool" (`server.test.js:376`) is the regression proof that the SDK update did not break the baseline.

Options set aside: per-message `cost.amount` (simplest, but a strict Client shows a fluctuating number under a "session
cost" label); compiling a real binary to prove the version path (no test in the repository compiles one, release tests
fake `compile.js`, and GitHub Actions owns compile proof — a subprocess proof from the same tree shows the same fact).

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `deno.json` and `deno.lock` — `^1.4.0` and the `1.4.0` lock entry; no unrelated dependency refresh, MCP SDK untouched.
- `src/acp/server.js` — `protocolVersion: PROTOCOL_VERSION` unconditionally; `agentInfo.version` from `VERSION`;
  `session/prompt` awaits the Runtime promise alone and returns after all sends; the three event-mapping sites feed the
  cost total. Terminal Auth and MCP validation/forwarding stay as they are.
- `src/acp/session-map.js` — `AcpPromptRecord` loses `cancellation`/`resolveCancellation`; the Session record gains the
  `usageCostUsd` total and a method to add to it. Stable ID maps, prompt identity, and Runtime replacement stay.
- `src/acp/event-mapper.js` — `usage_update.cost` becomes `{ amount, currency: "USD" }` from the passed total, omitted
  at `0`. `used`/`size` unchanged.
- `src/acp/interaction-mapper.js` — expected unchanged; touch only if the `1.4.0` public API forces it, and keep form
  elicitation, cancel/decline outcomes, option validation, and the Plan-review fallback.
- `src/acp/protocol-smoke.test.js` — characterize the `1.4.0` SDK constants and schemas RunWield relies on.
- `src/acp/server.test.js`, `src/acp/session-map.test.js` — new negotiation, version, cumulative-cost, replay-cost, and
  cancellation-ordering tests; the cancel test at `:533` is extended, not replaced.
- `src/acp/managed-session.integration.test.ts` — expected unchanged; it is part of the SDK regression run.
- `docs/acp-implementation-details.md`, `docs/research/acp-registry-gap-report.md` — findings updated to the implemented
  behavior; limitations this Plan does not remove stay listed.
- `docs/prd/runwield-acp-protocol-prd.md` — Stage 2 items covered here marked implemented only where the suite proves
  them.

Not expected to change: `src/shared/mcp/*` (Core MCP owner), `src/shared/session/*` (Runtime owner — cancellation and
usage semantics are already what this Plan needs), `scripts/write-version.js`, and `docs/domain-language.md` (Terminal
Auth, MCP Server Configuration, and MCP Tool are already defined; this Plan introduces no new term).

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `PROTOCOL_VERSION`, `methods`, and the public v1 zod schemas (`zUsageUpdate`, `zCost`, `zInitializeResponse`, ...)
  from `@agentclientprotocol/sdk` — one supported ACP v1 authority; validate serialized frames against them in tests.
- `src/shared/version.js` — the generated `VERSION` written by `scripts/write-version.js`; `src/cmd/version/index.js`
  already prints it. Do not derive a version from Git or package metadata at runtime.
- `SessionRuntime.cancelSession()` and `promptUserTurn()` (`src/shared/session/session-runtime.js:4721`, `:3638`) — the
  existing owner of abort, queued-message clearing, the `cancellation` Runtime event, and turn settlement.
- `AcpSessionMap` (`src/acp/session-map.js`) — already owns per-ACP-Session state (Runtime id, cwd, active prompt); the
  cost total belongs beside it.
- `src/ui/tui/chat-footer.ts:281-296` — the established per-Session usage accumulation pattern to mirror.
- `mapRuntimeEventToAcpSessionNotification()` and the `pendingNotifications` arrays in `server.js` — keep ordered
  mapping active until the Runtime and all outbound updates settle.
- `withRuntimeCommandFixture` (`src/cmd/testing/runtime-command-fixture.ts`) and `fauxAssistantMessage` from
  `@earendil-works/pi-ai` — a response factory can return a message with a custom `usage.cost.total`; the faux provider
  preserves provided usage (`cloneMessage` keeps `cloned.usage`).
- Existing ACP tests: registry Terminal Auth probe (`server.test.js:251`), real MCP fixture call (`:376`), overlap and
  cancel (`:533`), `--mode acp` subprocess (`:281`), load replay (`:456`) — extend rather than duplicate.

## Implementation Steps

- `deno.json` requires `@agentclientprotocol/sdk@^1.4.0` and `deno.lock` resolves `1.4.0` with no unrelated dependency
  refresh (MCP SDK and zod entries otherwise unchanged). No production file imports `experimental/v2`.
- The complete existing ACP suite passes on `1.4.0` before any behavior change: Terminal Auth probe and capability gate,
  MCP fixture call, setup warnings, named invocation, load replay, overlap/cancel, close, validation, interaction
  adapter, and the managed-Session queue test. Any repair is against public v1 APIs; no test is deleted or weakened.
- `createInitializeResponse()` returns `protocolVersion: PROTOCOL_VERSION` for every request: `initialize` with `1`
  returns `1`; `initialize` with `99` also returns `1`. The Terminal Auth capability gate and descriptor are unchanged.
- `agentInfo.version` is the `VERSION` import from `src/shared/version.js`. The string `0.0.0-acp-mvp` no longer exists
  under `src/acp/`. `agentInfo.name` remains `RunWield`.
- `AcpSessionMap` records own a `usageCostUsd` total per ACP Session, starting at `0`, with a method that adds a usage
  event's `costUsd` and returns the new total. The total persists across `replaceRuntimeSession()` and is dropped with
  the record on close.
- Each of the three places `server.js` maps Runtime events — the live prompt subscription, `session/load` replay, and
  `replaySetupEvents()` — adds a `usage` event's `costUsd` to the Session total first and passes the total to the
  mapper.
- `mapRuntimeEventToAcpSessionNotification()` emits `cost: { amount: <Session total>, currency: "USD" }` when the total
  is greater than `0` and omits `cost` otherwise. It stays a pure function with no module-level state. `used` and `size`
  behavior are unchanged.
- `AcpPromptRecord` has `cancelled`, `turnId`, and optional `requestId`; the `cancellation` promise and
  `resolveCancellation` are gone. `markCancelled()` only sets `cancelled = true` and is idempotent.
- `session/prompt` awaits the Runtime promise alone (no `Promise.race`), then awaits every pending `session/update`
  send, then cleans up the prompt once, and returns `{ stopReason: "cancelled" }` only when the prompt was marked
  cancelled. `deferCleanupUntilRuntimeSettles` no longer exists. A Runtime rejection or `ok: false` result on a
  cancelled prompt still returns `cancelled`, never a generic JSON-RPC error.
- `session/cancel` still marks the prompt and calls `runtime.cancelSession()`; it cannot complete the prompt by itself.
- A second `session/prompt` for the same ACP Session is rejected with `-32002` while the cancelled turn is settling and
  is accepted immediately after the `cancelled` response. Session close and connection close still wait for Runtime and
  child-process cleanup.
- `src/acp/protocol-smoke.test.js` characterizes the `1.4.0` SDK: `PROTOCOL_VERSION === 1`,
  `methods.client.elicitation.create === "elicitation/create"`, `zCost` requires `amount` and `currency`, and the
  terminal auth method schema accepts RunWield's descriptor.
- Stable ACP response and notification samples for initialize, auth, new/load, usage, and cancellation are validated
  against the `1.4.0` v1 schemas as serialized NDJSON frames, not only as JavaScript objects.
- `docs/acp-implementation-details.md` and `docs/research/acp-registry-gap-report.md` describe the implemented behavior:
  negotiated version, cumulative USD cost, settlement-ordered cancellation, generated version, SDK `1.4.0`. They keep
  the limitations this Plan does not remove (HTTP/SSE MCP, prompts/resources, optional Session methods, context-capacity
  fallback). `docs/prd/runwield-acp-protocol-prd.md` marks Stage 2 items covered here as implemented only where the
  final suite proves them.

## Approval Confirmation

No Work Record is proposed for supersession. The existing ACP audit remains the historical baseline; this Plan updates
its current findings after implementation.

## Verification Plan

- Automated focused suite:
  `deno run -A scripts/run-tests.js src/acp/protocol-smoke.test.js src/acp/session-map.test.js src/acp/server.test.js src/acp/managed-session.integration.test.ts src/acp/interaction-mapper.test.js src/shared/mcp/pool.test.ts src/shared/mcp/config.test.ts`
- Negotiation proof (`server.test.js`): through the real NDJSON server, send `initialize` with `protocolVersion: 99` and
  assert the response's `protocolVersion === 1`; repeat with `1`. Fails today because the server echoes `99`.
- Version proof (`server.test.js`): spawn `deno run -A src/cli.ts --version` and parse the version token from
  `runwield <version> (<target>)`; spawn `deno run -A src/cli.ts --mode acp`, send `initialize`, read
  `agentInfo.version`; read `VERSION` from `src/shared/version.js`. All three are equal and none is `0.0.0-acp-mvp`. The
  generated file changes with every commit, so a hard-coded string in either surface cannot pass. Do not compile a
  binary and do not rewrite `src/shared/version.js`; GitHub Actions owns compile proof.
- Cost proof (`server.test.js`): `withRuntimeCommandFixture` with two response factories whose messages carry
  `usage.cost.total = 0.25` each (spread `fauxAssistantMessage()` and override `usage`). Over one Session, the first
  `usage_update` has `cost.amount === 0.25`, the second has `0.5`, both have `currency === "USD"`, and each serialized
  notification frame parses under the SDK's `zUsageUpdate` schema. Fails today (bare number) and fails for a per-message
  implementation (the second frame would be `0.25`).
- Cost omission (`event-mapper` unit test in `server.test.js`): a usage event with `costUsd = 0` and a Session total of
  `0` produces no `cost` key.
- Load-replay cost (`server.test.js`, extend the load test at `:456`): after `session/load` of a Session whose
  transcript has two costed assistant messages, the replayed `usage_update` frames report cumulative amounts, and a new
  prompt continues from that total rather than restarting at `0`.
- Cancellation ordering proof (`server.test.js`, extend `:533`): with a long streaming fake response, send
  `session/cancel` and record every frame until the `prompt-1` response. Assert: (a) the `agent_message_chunk` carrying
  the Runtime `cancellation` message ("Agent run canceled.") arrives **before** the `prompt-1` response; (b) the
  response is `stopReason: "cancelled"`; (c) no `session/update` for that Session arrives after the response; (d) a
  `prompt-2` sent immediately after succeeds with `end_turn`. Fails today because the adapter promise can win the race
  and updates can trail the response.
- Session-map unit tests (`session-map.test.js`): `beginPrompt()` returns a record without `cancellation` or
  `resolveCancellation`; `markCancelled()` twice leaves one `cancelled: true`; the cost total accumulates, survives
  `replaceRuntimeSession()`, and is gone after the record is removed.
- SDK regression: the Terminal Auth probe (`:251`), capability gate (`:230`), real MCP fixture call (`:376`), setup
  warnings (`:321`), named invocation (`:420`), load replay (`:456`), close (`:574`), validation (`:600`, `:652`),
  interaction adapter (`:743`-`:827`), and the managed-Session queue test pass unchanged on `1.4.0`.
- Protected behavior after reshaping the cancel test (`:533`): overlap rejection `-32002` and the eventual `cancelled`
  response still hold; only the timing assumption changes (the response now arrives after settlement, so the 1 s read
  timeout may need to grow). No behavior in the current suite is expected to stop existing.
- Full gates: `deno task seams:check`, `deno task check`, `deno task test`, `deno task ci`. Never run `deno test`
  directly.
- Manual strict Client: start RunWield from an ACP Client that supports Terminal Auth, complete login if prompted,
  create a Session with one stdio MCP server, call its tool, cancel a live turn, and immediately send another prompt.
  Confirm: no schema error, the Client's cost display only grows, the Agent version equals `wld --version`, no duplicate
  response, and no orphan MCP process after close.
- Manual negotiation: with a protocol inspector or hand-written NDJSON, send `initialize` with `protocolVersion: 99` and
  confirm RunWield answers `1`.
- Documentation: the audit, gap report, and PRD list no closed gap as open and claim no HTTP/SSE MCP, ACP v2, exact
  context capacity, or optional Session methods. `docs/domain-language.md` is unchanged and still describes Terminal
  Auth and MCP Server Configuration as implemented.

## Edge Cases & Considerations

- **Cancellation during a Plan Review interaction:** `cancelSession()` cancels the interaction but does not abort the
  agent when only a Plan Review interaction is active. The Runtime turn then continues under Runtime policy, and the ACP
  `cancelled` response follows its settlement. That is the Runtime owner's decision; the adapter adds no timeout and no
  second completion path.
- **Runtime Session replacement mid-turn:** the subscription already follows `session_replaced`. The cancellation flag,
  the pending-notification list, and the cost total belong to the ACP Session, so they persist across replacement and
  there is still exactly one final response.
- **Notification send failures:** `Promise.allSettled` keeps a rejected send from releasing the prompt early. Error
  policy after settlement is unchanged.
- **MCP cancellation:** the Core MCP owner propagates abort to `Client.callTool()` and shuts down children. ACP
  cancellation now waits for that owner through Runtime settlement; no second process controller is added.
- **Cost accumulation:** replayed `usage` events on `session/load` count toward the total, so a loaded Session reports
  its full history. If no message has a price, `cost` stays omitted until one does. Floating-point sums are acceptable;
  do not round on the wire.
- **`used`/`size` accuracy:** unchanged. `size` still falls back to `used` when the Runtime lacks a context window; this
  Plan does not claim exact capacity.
- **SDK drift:** `1.4.0` is the target. A newer stable v1 SDK is not an automatic upgrade; changing the target means
  re-running the characterization tests. ACP v2 stays out.
- **Terminal Auth on the new SDK:** the `AuthMethodTerminal` schema still has `id`, `name`, `description`, `args`,
  `env`. The update must not turn the method into Agent Auth, advertise it to incapable Clients, or require
  `authenticate`.
- **Version file:** `src/shared/version.js` is generated and untracked (`.gitignore:29`); `deno task check` regenerates
  it. Tests read it and must not rewrite it.
- **Scope boundary:** optional session list/resume/delete/fork, additional directories, rich prompt media, HTTP/SSE MCP,
  prompts/resources, client filesystem/terminal delegation, richer Plan updates, ACP v2, registry metadata, and the
  upstream registry pull request remain out of scope.
