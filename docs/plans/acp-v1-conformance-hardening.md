---
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
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-09-02T13:47:43-04:00"
status: "draft"
planId: "28e93cd2-f201-4fd7-873c-c7ca4fbe9d5d"
---

# ACP v1 Conformance Hardening

## Context

RunWield has an ACP v1 stdio adapter, but six known gaps remain around current protocol behavior and dependency level:

- unsupported protocol versions are echoed instead of negotiated;
- non-empty required stdio MCP server definitions are rejected;
- cancellation can return before Runtime settlement and final updates;
- `usage_update.cost` is a number instead of an ACP cost object;
- `agentInfo.version` is the static placeholder `0.0.0-acp-mvp`; and
- RunWield is locked to ACP SDK `1.2.1` instead of the current stable ACP v1 SDK baseline.

This Plan has two hard execution prerequisites:

1. `acp-registry-terminal-auth.md` is implemented and verified. Its capability-gated Terminal Auth descriptor,
   login-only invocation, authentication-required behavior, and registry probe tests become protected behavior.
2. `core-mcp-tool-support.md` is implemented and verified. It owns Core MCP configuration, stdio MCP clients, tool
   naming, root Agent exposure, warning policy, process lifecycle, and ACP server-definition acceptance.

The prerequisite shape avoids two implementations of MCP. This Plan proves the resulting ACP behavior and closes the
remaining conformance gaps. If either prerequisite is not present in the execution baseline, stop instead of copying its
behavior into this Plan.

The user confirmed that the Core MCP Plan may progress alongside Terminal Auth. They are logically independent but both
edit `src/acp/server.js`, its tests, and ACP documentation. If they execute in separate worktrees, integrate and verify
both before this Plan starts.

Established harness behavior supports the Core MCP Plan's naming decision. Claude Code always exposes
`mcp__<server>__<tool>`, OpenCode uses server-qualified names, and Codex uses a qualified namespace with stable
collision suffixes. RunWield keeps the approved `mcp_<server>_<tool>` equivalent from `core-mcp-tool-support.md`; this
Plan does not reopen or duplicate that decision.

## Objective

On top of verified Terminal Auth and Core stdio MCP support, make every listed ACP response and lifecycle behavior match
the current ACP v1 contract. Strict Clients receive negotiated version `1`, schema-valid usage cost, the real RunWield
build version, working stdio MCP tools, and a cancellation response only after the Runtime turn and pending updates have
settled. The current stable ACP SDK is locked and all prerequisite auth behavior remains intact.

## Approach

Harden the existing ACP adapter rather than adding another protocol layer:

```text
initialize
  -> negotiate supported v1
  -> preserve Terminal Auth from prerequisite
  -> report generated RunWield VERSION

session/new or session/load
  -> preserve Core-owned stdio MCP setup from prerequisite
  -> SessionRuntime

session/prompt
  -> Runtime turn
  -> cancel marks turn + requests Runtime cancellation
  -> await Runtime settlement
  -> flush pending session/update notifications
  -> return cancelled

Runtime usage
  -> ACP usage_update { used, size, cost: { amount, currency: "USD" } }
```

First update `@agentclientprotocol/sdk` from the locked `1.2.1` baseline to stable `1.4.0`, the current release at Plan
creation. Keep ACP v1 as the production import and do not adopt experimental ACP v2. Run the complete Terminal Auth,
elicitation, Session, and Core MCP characterization suite immediately after the update. If the current release cannot
preserve those contracts, repair the adapter against public v1 APIs; do not retain two SDK versions or add a
compatibility wrapper that bypasses schema validation.

`createInitializeResponse()` supports only `PROTOCOL_VERSION`. It returns that value for both supported and unsupported
client requests. It retains the Plan 1 Terminal Auth capability logic and imports generated `VERSION` for `agentInfo`.

Cancellation keeps one owner. `session/cancel` marks the active ACP prompt and calls `SessionRuntime.cancelSession()`.
It does not resolve a second adapter-owned completion promise. The original `session/prompt` awaits the Runtime promise,
keeps its event subscription and interaction adapter active until that promise settles, waits for every queued
`session/update` notification, and only then returns `stopReason: "cancelled"`. `AcpSessionMap` stores cancellation
state and turn identity, not a competing settlement mechanism.

The Core MCP prerequisite remains the sole owner of MCP configuration, tool names, processes, and calls. This Plan adds
or reuses one black-box conformance scenario that sends a valid stdio definition through `session/new` and
`session/load`, calls the real namespaced tool, and validates cleanup. It must not add MCP code under `src/acp/` beyond
protocol validation and forwarding already established by the prerequisite.

The main option set aside is implementing the five small wire fixes now while leaving the SDK and MCP work independent.
That is less integration work, but it cannot prove the final public wire contract and can let the later SDK/MCP merge
break Terminal Auth or cancellation ordering without a failing conformance gate.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `deno.json` and `deno.lock` — select and lock ACP SDK `1.4.0` without changing unrelated dependencies or the MCP SDK.
- `src/acp/server.js` — negotiate protocol v1, report `VERSION`, preserve prerequisite Terminal Auth and MCP behavior,
  and make cancellation completion follow Runtime settlement.
- `src/acp/session-map.js` — remove the adapter-owned cancellation promise/resolver while retaining stable Session maps,
  prompt identity, cancellation state, and Runtime Session replacement.
- `src/acp/event-mapper.js` — emit the ACP cost object with USD currency while preserving usage omission when no cost is
  known.
- `src/acp/interaction-mapper.js` — change only as required by the public stable v1 SDK; preserve form elicitation,
  cancellation, option validation, and Plan-review fallback behavior.
- `src/acp/protocol-smoke.test.js` — characterize the selected SDK's v1 constants, Terminal Auth schema, MCP stdio
  request shape, cost object, and stable elicitation API used by RunWield.
- `src/acp/server.test.js`, `src/acp/session-map.test.js`, and `src/acp/managed-session.integration.test.ts` — prove
  wire shapes and settlement order through real Runtime, managed Session, and prerequisite MCP paths.
- The focused MCP fixture/tests delivered by `core-mcp-tool-support.md` — reuse them as the non-counterfeit stdio proof;
  do not create a second MCP fixture protocol.
- `docs/acp-implementation-details.md` and `docs/research/acp-registry-gap-report.md` — replace stale findings with the
  exact implemented behavior and retain any limitation not proved by this Plan.
- `docs/prd/runwield-acp-protocol-prd.md` — mark the covered ACP v1 compliance stage implemented only if every required
  behavioral and schema check passes.

`docs/domain-language.md` is not expected to change in this Plan. Terminal Auth terminology belongs to Plan 1 and MCP
Server Configuration terminology belongs to the Core MCP Plan. If either prerequisite did not land its required glossary
update, stop and repair that prerequisite rather than redefining the terms here.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `PROTOCOL_VERSION` and the public schema/types from `@agentclientprotocol/sdk` — keep one supported ACP v1 authority.
- `src/shared/version.js` — use the generated `VERSION` written by `scripts/write-version.js`; do not derive a version
  from Git or package metadata at runtime.
- `SessionRuntime.cancelSession()`, Runtime turn settlement, and `closeSessionWhenIdle()` — use the existing owner of
  model/tool cancellation and turn release.
- `AcpSessionMap` prompt and Runtime replacement identity — retain one active prompt record while removing only its
  premature completion promise.
- `mapRuntimeEventToAcpSessionNotification()` and `pendingNotifications` — keep ordered event mapping active until the
  Runtime and all outbound updates settle.
- The stdio MCP pool, namespaced tools, real fixture, and cleanup proof from `core-mcp-tool-support.md` — verify rather
  than reimplement them.
- The exact ACP Registry initialize request and login behavior from `acp-registry-terminal-auth.md` — run them unchanged
  after the SDK update.

## Implementation Steps

- Execution begins only after the canonical `acp-registry-terminal-auth` and `core-mcp-tool-support` Plans are verified
  or user-verified and their changes are present in this worktree. Missing, in-progress, or conflict-damaged
  prerequisite behavior blocks this Plan.
- `deno.json` requires `@agentclientprotocol/sdk@^1.4.0`, and `deno.lock` resolves the intended `1.4.0` release without
  an unrelated dependency refresh. Production continues to import stable ACP v1 APIs; no `experimental/v2` import
  exists.
- All Plan 1 Terminal Auth tests and Core MCP tests pass unchanged after the SDK update. The initialize handler still
  recognizes current and registry terminal-auth capabilities, and the descriptor still starts the login-only flow.
- `createInitializeResponse()` always returns RunWield's supported `PROTOCOL_VERSION`. A request for version `1` returns
  `1`; unsupported versions such as `99` also return `1` so the Client can accept or close according to ACP negotiation.
- `agentInfo.version` equals the generated `VERSION` exported by `src/shared/version.js` in source runs and release
  binaries. An explicit `WLD_BUILD_VERSION` remains the source of release identity through `scripts/write-version.js`;
  ACP and `wld --version` cannot agree on an unrelated fixed value. The ACP name remains RunWield, and the static
  `0.0.0-acp-mvp` value no longer exists.
- Runtime usage with a known nonzero USD cost maps to `cost: { amount: <costUsd>, currency: "USD" }`. Unknown or zero
  cost remains omitted as ACP permits. `used` and the existing `size` behavior remain otherwise unchanged; broader
  context-capacity accuracy is outside this six-gap scope.
- `AcpPromptRecord` contains cancellation state, turn ID, and optional request ID but no cancellation promise or
  resolver. `markCancelled()` is idempotent and cannot complete a prompt by itself.
- `session/cancel` requests Runtime cancellation and marks the current prompt. `session/prompt` keeps the current
  Runtime subscription and interaction adapter until the Runtime promise settles, awaits all update sends, cleans up the
  prompt record once, and returns `cancelled` only after those events. Runtime failure caused by cancellation cannot
  escape as a generic JSON-RPC error.
- A new prompt for the same ACP Session remains rejected while cancellation settlement is in progress and is accepted
  immediately after the canceled prompt response. Session close and connection close continue to wait for Runtime and
  child-process cleanup.
- Valid ACP stdio MCP definitions in `session/new` and `session/load` reach the Core MCP owner from the prerequisite,
  expose its deterministic `mcp_<server>_<tool>` name, execute a real fixture call, and close the process with the
  Session. The old rejection of all non-empty `mcpServers` arrays is absent. HTTP, SSE, prompts, and resources remain
  outside the prerequisite scope and are not advertised.
- Stable ACP response and notification samples for initialize, auth, new/load, usage, cancellation, and MCP are
  validated against the selected SDK's official v1 schemas or generated guards. These checks exercise serialized NDJSON
  frames, not only JavaScript object construction.
- Existing Session replay, stable ACP IDs, queued managed prompts, Runtime Session replacement, form elicitation, Plan
  review links, prompt overlap errors, and protocol-pure stdout remain protected. No failing test for these behaviors is
  deleted because the SDK changed.
- The ACP audit, registry gap report, and ACP PRD identify the Terminal Auth and stdio MCP prerequisite Plans, state the
  selected SDK baseline, and mark only behavior proved by the final suite as conformant. They remove `0.0.0-acp-mvp`,
  numeric cost, premature cancellation, unsupported-version echo, and stdio MCP rejection from active gaps.

## Approval Confirmation

No Work Record is proposed for supersession. The existing ACP audit remains the historical baseline; this Plan updates
its current findings after implementation.

## Verification Plan

- Prerequisite gate: load `docs/plans/acp-registry-terminal-auth.md` and `docs/plans/core-mcp-tool-support.md` through
  the Plan store, require a verified or user-verified status, and confirm their implementation is in the execution
  baseline. A body-text claim without delivered code is not sufficient.
- Automated focused tests:
  `deno run -A scripts/run-tests.js src/acp/protocol-smoke.test.js src/acp/session-map.test.js src/acp/server.test.js src/acp/managed-session.integration.test.ts src/acp/interaction-mapper.test.js`
  plus the final focused tests and real stdio fixture from `src/shared/mcp/`.
- Automated negotiation proof: through the real NDJSON server, initialize with versions `1` and `99`. Both responses
  report `1`, while Plan 1 Terminal Auth capability cases remain correct. This test must fail if the server echoes `99`.
- Automated version proof: set `WLD_BUILD_VERSION=v9.8.7`, run the production version writer and compile path into a
  temporary binary, then require both `wld --version` and `initialize.agentInfo.version` from that binary to report
  exactly `v9.8.7`. A test that imports the same constant twice, compares two public outputs without checking the
  requested build identity, or rewrites the tracked generated file without restoring it is insufficient.
- Automated usage proof: emit a real normalized Runtime usage event with known cost and validate the serialized
  `usage_update` against the pinned SDK v1 schema. It must fail for a number, missing currency, or a stubbed constant
  object unrelated to Runtime usage.
- Automated cancellation proof: start a real controllable Runtime turn with at least one final mapped update, cancel it,
  and record wire ordering. The final update and Runtime settlement marker must precede the prompt's `cancelled`
  response; a same-Session follow-up prompt must then succeed. This test must fail if a local cancellation promise wins
  a race while Runtime work continues.
- Automated MCP proof: use the Core MCP Plan's real stdio fixture through black-box `session/new` and `session/load`,
  call its namespaced tool, assert the fixture's argument/result marker enters the Agent turn, then prove process
  shutdown. A static tool list or pass-through result cannot satisfy this check.
- Automated SDK regression: run the complete Plan 1 auth suite, Core MCP suite, ACP interaction tests, Session replay,
  managed Session, queued prompt, close, and Session replacement tests against SDK `1.4.0`.
- Automated dependency and architecture gates: run `deno task seams:check`, `deno task check`, `deno task test`,
  `deno task ci`, and `deno task compile`. Never run `deno test` directly.
- Manual strict Client: start RunWield from an ACP Client with Terminal Auth support, complete login if required, create
  a Session with one stdio MCP server, invoke its identifiable tool, cancel a later live turn, and immediately send
  another prompt. Confirm no schema error, early completion, duplicate response, or orphan MCP process occurs.
- Manual diagnostics: inspect the ACP Client's Agent information and confirm it shows the same RunWield version as
  `wld --version`; request an unsupported protocol version with a protocol inspector and confirm RunWield answers v1.
- Documentation: confirm the audit, registry report, and PRD distinguish required v1 behavior from optional methods and
  do not claim HTTP/SSE MCP, ACP v2, full context-capacity accuracy, or optional Session capabilities.

## Edge Cases & Considerations

- **Hard prerequisites:** this standalone Plan records dependencies in its execution contract because automatic sibling
  dependency enforcement applies only to Epic children. Do not approve execution against an unintegrated prerequisite
  worktree.
- **Concurrent prerequisite work:** Terminal Auth and Core MCP can execute separately, but both edit ACP initialization,
  Session creation, tests, and docs. Integrate one onto the other and rerun both suites before starting this Plan.
- **SDK drift:** `1.4.0` is the target at Plan creation. A newer stable v1 SDK is not an automatic upgrade. Changing
  that target requires reviewing its changelog and proving the same schemas and behaviors; ACP v2 remains out of scope.
- **Terminal Auth stability:** the SDK update must not turn the terminal method into Agent Auth, advertise it to
  incapable Clients, or require `authenticate` for the out-of-band flow.
- **Cancellation replacement:** Runtime may replace the live Session during a turn. The ACP mapping and event
  subscription must follow the replacement while preserving one cancellation state and one final response.
- **Notification failures:** individual outbound update failures must not release the prompt early. Await all sends and
  preserve current error policy after settlement.
- **MCP cancellation:** the Core MCP prerequisite owns abort propagation to `Client.callTool()` and child shutdown. This
  Plan verifies that ACP cancellation waits for that owner; it does not add a second process controller.
- **MCP names:** keep the prerequisite's always-qualified `mcp_<server>_<tool>` names and stable collision suffix. Do
  not adopt Gemini's order-dependent first-registration naming during integration.
- **Cost and capacity:** this Plan fixes the required cost object. It does not claim that fallback context-window size
  is always exact when the Runtime lacks provider capacity data.
- **Scope boundary:** optional session list/resume/delete, additional directories, rich prompt media, HTTP/SSE MCP,
  prompts/resources, client filesystem/terminal delegation, richer Plan updates, ACP v2, registry metadata, and the
  upstream registry pull request remain out of scope.
