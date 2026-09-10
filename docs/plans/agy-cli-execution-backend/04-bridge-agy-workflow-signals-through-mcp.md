---
planId: "4438b6ba-99e2-4b49-8848-7593a03a66a1"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
affectedPaths:
    - "src/cli.ts"
    - "src/cmd/registry.js"
    - "src/cmd/mcp/"
    - "src/shared/session/bridged-tools/"
    - "src/shared/session/backends/agy-cli/"
    - "src/shared/session/backends/claude-cli/"
    - "src/shared/session/session.js"
    - "src/shared/session/model-selection.ts"
    - "src/shared/session/task-completion-session.ts"
    - "src/shared/workflow/workflow-tool-events.ts"
    - "src/shared/workflow/validation-helpers.ts"
    - "src/shared/workflow/validation-ports.ts"
    - "src/shared/workflow/validation-session-adapter.ts"
    - "src/shared/workflow/validation-semantic.ts"
    - "src/shared/session/agy-cli-execution.test.ts"
    - "src/shared/workflow/validation-loop-review.test.js"
    - "docs/domain-language.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-23T20:02:05.471Z"
status: "validated"
origin: "internal"
parentPlan: "agy-cli-execution-backend"
order: 4
dependencies:
    - "03-add-agy-cli-backend-transcript-tracer-bullet"
userVerifiedAt: null
targetBranch: "feature/agy-cli-execution-backend"
---

# Bridge Agy Workflow Signals Through MCP

## Context

Child 03 makes `agy-cli` a real Execution Backend with a RunWield-owned Session Transcript, but it deliberately gives
Antigravity no workflow tools. Planner, execution Agent, and Semantic Reviewer prose cannot approve a Plan, complete
execution, or finish Semantic Agent Review. Those decisions must arrive as accepted Workflow Tool Events from existing
RunWield Custom Tools.

Antigravity 1.1.26 has no per-command MCP configuration flag. Its current documentation says the CLI loads global
`~/.gemini/config/mcp_config.json` and workspace `.agents/mcp_config.json`. A repeated local sandbox probe with the
selected `~/.local/bin/agy` found that `agy mcp list` loaded the global file but reported no servers from the workspace
file. The binary's own changelog identifies it as 1.1.26 and lists no MCP load-path change from 1.1.25. This repeats the
earlier workspace-local custom-agent mismatch. The implementation must therefore prove real behavior and must not depend
on the workspace path.

The user chose a one-time, explicitly approved global setup. The durable global configuration contains no turn URL,
bearer token, or other Session secret. It registers the stable `runwield` stdio transport through `wld mcp agy-cli` and
grants only `mcp(runwield/*)`. Each `agy` process receives its own private parent-bridge URL and token through its child
environment, so concurrent RunWield Sessions cannot call each other's workflow tools.

The working tree has unrelated edits in `src/shared/session/session-runtime.js` and
`src/shared/session/session-runtime.test.js`. They do not overlap this Plan's expected surface and must remain
untouched.

## Objective

Give eligible `agy-cli` Planner, execution Agent, and Semantic Reviewer turns the existing `plan_written`,
`task_completed`, and `review_complete` Custom Tools through authenticated MCP. Like Claude CLI, Antigravity sees the
established external aliases `runwield_plan_written`, `runwield_task_completed`, and `runwield_review_complete`; its
prompt names those actual MCP tools. The bridge delegates accepted calls to the existing tool definitions and publishes
the same Workflow Tool Events used by Pi and Claude CLI.

The first accepted terminal result is the only terminal workflow signal for the turn. Rejected or unauthorized calls,
unknown tools, Antigravity `tool_info`, assistant text, and sentinel-like prose must not change Plan Lifecycle,
validation, or active workflow state.

## Approach

Use the shared bridge's stdio transport for Antigravity discovery and keep its authenticated loopback owner per turn:

```text
first Agy use
  -> inspect global Antigravity MCP config and permissions
  -> ask once through the current Runtime interaction
  -> atomically register absolute wld mcp agy-cli as the runwield stdio server
  -> atomically allow mcp(runwield/*)

eligible Agy turn
  -> compose only the role-eligible lifecycle Tool Definitions
  -> start authenticated RunWield loopback bridge
  -> pass bridge URL/token in this agy child environment
  -> Antigravity starts wld mcp agy-cli
  -> shared stdio transport forwards tools/list and tools/call to this turn's bridge
  -> existing tool publishes accepted Workflow Tool Event
```

Move the host-neutral bridge behavior out of the Claude-specific module rather than copying it. The shared bridge owns
the existing `runwield_` lifecycle aliases, schema exposure, bearer authentication, serialized calls, canonical
transcript entries, runtime tool events, and the terminal gate. Claude and Agy use that same interface and differ only
where their hosts require different transport/configuration and provenance.

The setup owner mutates only `mcpServers.runwield` in `~/.gemini/config/mcp_config.json` and the exact `mcp(runwield/*)`
item in `permissions.allow` under `~/.gemini/antigravity-cli/settings.json`. It uses one persistent home-scoped
operating-system lock, safe JSON read-modify-write, atomic replacement, and compare-before-rollback. It preserves
unrelated entries and refuses malformed files, symbolic links, foreign `runwield` definitions, contradictory Ask/Deny
rules, and uninstalled source-run executables. A normal turn never repairs configuration without approval.

If an interactive Runtime adapter is available, the first Agy turn asks for setup approval and names both files and the
narrow permission. Decline or cancellation leaves the model selected but starts no `agy` process and writes no Session
or workflow result. Headless or other non-interactive use fails closed with the command `wld mcp agy-cli --setup`; that
command gives the same explanation and requires an explicit yes before writing.

Agy Semantic Review remains opaque because RunWield does not ingest Antigravity's native file and shell history. An
accepted `agy-cli-mcp` review result can waive only the Pi-specific `review_diff` prerequisite, like Claude CLI. It does
not waive structured finding validation, the open Review Issue ledger, or rejection of approval with unresolved
findings.

The option set aside is temporary global HTTP configuration per turn. It would either serialize every Agy turn or expose
multiple live Session bridges to each Antigravity process. Parsing completion markers from prose is also rejected
because it would bypass Workflow Tool Event authority.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/session/bridged-tools/` — own the host-neutral authenticated MCP bridge, shared lifecycle aliases,
  provenance contract, canonical transcript recording, call serialization, terminal gate, and stdio forwarding transport
  extracted from Claude CLI.
- `src/shared/session/backends/claude-cli/{mcp-bridge,execution-session}.ts` and focused tests — adapt Claude to the
  shared bridge without changing its command, temporary `--mcp-config`, capability-tool exposure, transcript, or
  workflow behavior.
- `src/shared/session/backends/agy-cli/` — own global setup inspection/install, per-process bridge environment, prompt
  appendix, bridge lifecycle, and fixture tests while using the shared alias policy.
- `src/cli.ts`, `src/cmd/registry.js`, and `src/cmd/mcp/` — register `mcp` as the CLI command, route `wld mcp agy-cli`
  to the shared protocol-only stdio transport before normal interactive startup, and support explicit setup through
  `wld mcp agy-cli --setup`. Command help and completion expose this shape; no `__internal` or proxy-named command is
  added.
- `src/shared/session/session.js` and `src/shared/session/model-selection.ts` — compose only eligible Agy lifecycle
  tools, request first-use setup approval, and construct Agy sessions only after setup is exact.
- `src/shared/workflow/workflow-tool-events.ts` and `src/shared/session/task-completion-session.ts` — recognize the Agy
  execution wrapper as the root owner so accepted planning and execution events keep normal durable outbox semantics.
- `src/shared/workflow/validation-{helpers,ports,session-adapter,semantic}.ts` — generalize the opaque MCP review flag
  from Claude-only naming and accept only the exact Claude and Agy bridge provenance values.
- `src/shared/session/agy-cli-execution.test.ts` and `src/shared/workflow/validation-loop-review.test.js` — prove the
  end-to-end lifecycle and narrow Reviewer policy through real repository boundaries.
- `docs/domain-language.md` — generalize **Bridged Tool** from Claude-only wording to eligible external CLI Execution
  Backends while keeping Workflow Tool Event authority explicit.

The existing lifecycle tool implementations under `src/tools/` are not expected to change. The bridge must call them,
not duplicate their lifecycle, review, owner, interaction, or validation logic.

## Reuse Opportunities

- `src/shared/session/backends/claude-cli/mcp-bridge.ts` — extract and preserve its lifecycle aliases, loopback
  authentication, validation, transcript entries, runtime events, serialized calls, and accepted-terminal gate for both
  external CLI backends.
- `src/shared/session/backends/claude-cli/testing/fake-claude-mcp-client.ts` — reuse the real MCP SDK client pattern for
  the shared stdio transport and end-to-end fixtures.
- `src/shared/mcp/pool.ts` — reuse its MCP client pagination, cancellation, result conversion, and deterministic close
  patterns where they apply to stdio forwarding.
- `src/shared/workflow/controller-registry.ts` and `src/shared/session/file-session-storage.ts` — reuse operating-system
  lock and durable atomic-write patterns; do not copy an unlocked settings writer.
- `src/shared/session/backends/agy-cli/custom-agent.ts` — reuse home resolution, link rejection, restrictive modes, and
  ownership checks for Antigravity files.
- `src/shared/session/session-runtime-interactions.js` — use the existing adapter-neutral approval interaction; do not
  add a TUI-only prompt path.
- `src/tools/plan-written.ts`, `src/tools/task-completed.ts`, and `src/tools/review-complete.ts` — delegate to the
  existing schemas and authorities without changing their public contracts.
- `src/shared/session/execution-backend.ts` — use its wrapper recognition/unwrapping after child 03 adds Agy instead of
  adding more Claude-or-Agy string checks.

## Implementation Steps

- [ ] A host-neutral Bridged Tool module starts an authenticated loopback MCP bridge for caller-supplied eligible Tool
      Definitions and maps lifecycle names to the existing `runwield_` aliases for both Claude and Agy. It validates
      arguments with the existing Pi validator, delegates to each definition's `execute`, serializes concurrent calls,
      records canonical internal tool names in assistant tool-call/tool-result Session Transcript entries, emits normal
      runtime tool events, and never examines assistant text.
- [ ] The shared bridge stamps a caller-supplied closed provenance value. Existing Claude calls remain `claude-cli-mcp`;
      Agy calls are `agy-cli-mcp`. Both values are bridge-owned and cannot be supplied in model arguments or overwritten
      by delegated result details.
- [ ] The first lifecycle result with `terminate: true` closes that turn's lifecycle gate. A later lifecycle call is
      recorded as a rejected error with no `outcome` and never invokes its Tool Definition. Invalid known calls are also
      recorded without an outcome; unknown external names and unauthorized HTTP requests invoke nothing.
- [ ] Claude CLI uses the extracted bridge through its existing temporary additive `--mcp-config` path. Its eligible
      capability and lifecycle tools, MCP aliases, prompt appendix, transcript order, backend status, cancellation,
      accepted-terminal behavior, and tests remain protected with no user-visible change.
- [ ] Agy global setup recognizes the current exact installed state only when `~/.gemini/config/mcp_config.json`
      contains `mcpServers.runwield` with the absolute standalone `wld` executable and exact arguments
      `["mcp", "agy-cli"]`, and `~/.gemini/antigravity-cli/settings.json` contains `mcp(runwield/*)` in
      `permissions.allow` with no matching Ask/Deny conflict. The persistent entry contains no URL, token, Project path,
      Session ID, or model data.
- [ ] Missing or safely repairable setup asks once through the existing Runtime approval interaction. The prompt names
      both global files, the stable command, the exact permission, and the fact that the change persists. Acceptance
      installs or repairs before backend construction; decline, cancellation, or an unsupported interaction starts no
      `agy` process and makes no Session Transcript or workflow mutation. `wld mcp agy-cli --setup` provides the same
      explicit terminal approval path for non-interactive callers.
- [ ] Setup mutation uses one persistent lock file under `~/.wld`, acquired before rereading either target. It rejects
      links, malformed/non-object JSON, foreign `runwield` entries, contradictory permission rules, and a source-run or
      missing executable. It preserves unrelated keys and server/rule entries, writes private temporary files, syncs and
      atomically renames them, and rolls back its first write only if current bytes still equal its own written bytes.
      Concurrent approved installers converge on one exact state without lost updates.
- [ ] `mcp` is a normal registered CLI command. `wld mcp --help` documents the `agy-cli` adapter and its `--setup`
      option; completion exposes the same shape. `wld mcp agy-cli` enters the shared stdio transport before browser/TUI
      initialization, while any unknown adapter or option fails with usage. No `__internal` or proxy-named command
      exists. The transport reserves stdout for MCP frames, writes only sanitized diagnostics to stderr, and refuses
      missing or malformed bridge URL/token environment. It validates plain HTTP on exact loopback, connects to the
      parent bridge with the inherited bearer token, forwards paginated `tools/list` and `tools/call` requests including
      cancellation, and closes both transports on EOF, signal, upstream failure, or normal exit without logging
      connection data.
- [ ] Each eligible Agy turn starts its own parent bridge and passes its URL and token only in that `agy` child process
      environment. The static Antigravity stdio entry inherits those values and reaches only that turn. Two concurrent
      Agy processes can list and call different bridge instances without cross-calling, shared mutable environment, or
      global config changes during either turn.
- [ ] Agy composition intersects the active Agent Definition and invocation tool ceiling with exactly `plan_written`,
      `task_completed`, and `review_complete`. Planner/Architect can receive `plan_written`; the current execution and
      validation-repair owners can receive `task_completed`; only the Semantic Reviewer can receive `review_complete`.
      MCP `tools/list` and prompt text use `runwield_plan_written`, `runwield_task_completed`, and
      `runwield_review_complete`, matching Claude CLI's bridge shape. Agy does not receive `triage_report`,
      `delegate_agent`, capability Bridged Tools, or caller tools through this child.
- [ ] Accepted Agy calls execute all three existing tool factories with the current HostedSession, Agent name, triage
      data, workflow attempt, validation generation, abort signal, and progress callback. A valid randomized Planner
      call reaches real Plan review and publishes `plan_written`; a valid randomized execution call records the real
      Task Completion and publishes `task_completed`; a valid randomized Reviewer call applies structured finding rules
      and publishes `review_complete`. Root Agy wrappers count as root owners for Workflow Tool Event and Task
      Completion outbox records; isolated review events remain scoped to their validation generation.
- [ ] Agy assistant text and native `tool_info` remain display-only. Text equal to tool aliases, JSON-RPC, sentinel
      markers, or completion claims cannot publish a Workflow Tool Event or change Plan Lifecycle. Missing accepted
      completion leaves the workflow waiting as it did in child 03.
- [ ] Semantic Review uses one backend-neutral `trustedOpaqueMcpReview` result derived only from the latest accepted
      `review_complete` transcript result with exact `claude-cli-mcp` or `agy-cli-mcp` provenance. It waives only the
      observable `review_diff` call; missing completion, invalid arguments, unaccounted/open Review Issues, and approval
      with unresolved findings retain existing correction and rejection behavior.
- [ ] `docs/domain-language.md` defines a Bridged Tool as a RunWield Tool exposed to an eligible external CLI Execution
      Backend turn, names Claude CLI and Antigravity CLI as current examples, preserves `runwield_` lifecycle aliases as
      the shared external CLI bridge names, and keeps the Session Transcript a display and audit record while Workflow
      Tool Events remain workflow authority.

## Approval Confirmation

No Work Records are proposed for supersession. The Claude CLI bridge and Workflow Tool Event Work Records are active
precedents, not work replaced by this Plan.

## Verification Plan

- Automated setup, command, and shared bridge transport behavior:
  `deno run -A scripts/run-tests.js src/shared/session/backends/agy-cli/agy-cli-backend.test.ts src/shared/session/backends/agy-cli/mcp-setup.test.ts src/cmd/mcp/index.test.ts src/shared/session/bridged-tools/stdio-transport.test.ts src/shared/session/backends/claude-cli/mcp-bridge.test.ts`.
- Automated end-to-end and CLI behavior:
  `deno run -A scripts/run-tests.js src/shared/session/agy-cli-execution.test.ts src/shared/session/claude-cli-execution.test.ts src/cmd/models/index.test.ts`.
- Automated workflow ownership and Semantic Review behavior:
  `deno run -A scripts/run-tests.js src/shared/workflow/workflow-tool-events.test.ts src/shared/session/task-completion-session.test.ts src/shared/workflow/validation-loop-review.test.js`.
- Automated project gates: `deno task check`, `deno task seams:check`, and `deno task test`. Run `deno task ci` before
  marking the child complete because this change adds the protocol-only `wld mcp agy-cli` command and changes
  Session/workflow boundaries.
- Objective-failing fixture: add and run
  `deno run -A scripts/run-tests.js --filter '^every eligible Agy role invokes its real lifecycle tool through configured stdio transport$' src/shared/session/agy-cli-execution.test.ts`.
  The generated fake `agy` must read the sandboxed global Antigravity config and permission, start the configured `wld`
  stdio process with inherited per-turn environment, and make three valid randomized calls through real Agent
  Definitions: Planner `plan_written`, execution-owner `task_completed`, and Semantic Reviewer `review_complete`.
  Assertions must observe each existing authority's distinct effect and matching accepted Workflow Tool Event: the
  Planner enters the real Plan review/decision path for its random Plan, execution records the random Task Completion in
  the active attempt, and review preserves the random structured verdict in the active validation generation. The test
  must fail if any eligible definition is replaced by a schema-only clone, rejecting stub, pass-through, hard-coded
  result, copied lifecycle implementation, or prose-driven state change.
- Setup tests: use sandboxed `HOME` and independent subprocesses to prove first-use approval, decline/cancel/no-adapter
  refusal, idempotence, preservation of unrelated config and stricter modes, malformed/link/foreign/conflicting-state
  refusal, partial-write rollback, changed-after-write protection, and two concurrent installers converging without a
  lost update. No test touches the developer's real Antigravity files.
- Isolation test: run two Agy fixtures concurrently against different HostedSessions and randomized tool arguments. Each
  stdio transport must list only its turn's eligible tools, each accepted result and Workflow Tool Event must land in
  the matching Session/workflow attempt, and neither process can call the other bridge after one terminal gate closes.
- Role tests: use real Agent Definition loading for Planner, Plan Engineer or Frontend Engineer, validation-repair
  Engineer, Semantic Reviewer, and an ineligible Agent. Assert the exact advertised tool names and schemas, then invoke
  each eligible role's valid tool and prove the same per-tool effects required by the objective-failing fixture. A
  reduced invocation tool ceiling must remove a lifecycle tool and no custom caller tool can widen it.
- Negative-authority test: make fake Agy emit prose, JSON, sentinel text, and `tool_info` that resemble all three tools
  without using MCP. Assert no Workflow Tool Event, Plan event/status change, Task Completion, or Semantic Review
  result. Then make invalid, unknown, unauthorized, and post-terminal MCP calls and assert the same while canonical
  rejected known calls contain no `outcome`.
- Semantic Review regression: an accepted `agy-cli-mcp` verdict without `review_diff` can proceed, but an untrusted
  provenance, missing `review_complete`, omitted open Review Issue ID, or approval with an unresolved finding cannot.
  Existing `claude-cli-mcp` behavior and Pi's successful-`review_diff` requirement remain protected.
- Existing behavior protected: Claude still uses its additive temporary config and all current Bridged Tools; Pi remains
  unchanged; child 03's Agy transcript, model, custom-agent, and prose-non-authority behavior remains intact. No
  existing supported behavior is expected to stop.
- Manual setup proof with installed authenticated Antigravity 1.1.26 or the minimum version selected by implementation:
  start with sandbox copies of both global JSON files, approve setup, and confirm `agy mcp list` shows the stable
  `runwield` stdio server. Confirm the workspace-only file is not treated as proof. Inspect the global files to verify
  no turn URL/token was persisted and unrelated entries remain.
- Manual workflow proof: run controlled Agy-backed Planner, execution-owner, and Semantic Reviewer turns so all three
  shared `runwield_` aliases are called. Confirm each reaches its real RunWield review/completion authority without
  `--dangerously-skip-permissions`; RunWield advances only after the accepted structured result; rejected/prose
  lookalikes do nothing; the global setup remains stable after each turn; and no stdio bridge process or loopback
  listener remains running.
- Glossary check: implemented bridge behavior, code names, prompts, and `docs/domain-language.md` use **Bridged Tool**,
  **Workflow Tool Event**, **Session Transcript**, **Execution Backend**, and **Plan Lifecycle** consistently.

## Edge Cases & Considerations

- Antigravity documentation and installed behavior have already disagreed. Global config load, permission acceptance,
  child-environment inheritance, and shared stdio transport use are release gates proved against a real supported `agy`;
  version text alone is not proof.
- A user-owned `mcpServers.runwield` entry or contradictory Ask/Deny rule is a conflict, not permission to overwrite.
  Report the exact path and expected shape. Do not silently rename the server because the stable name is also the narrow
  permission and concurrency boundary.
- Setup spans two user-owned files and cannot be one filesystem rename. The home-scoped lock, write ordering, and
  compare-before-rollback preserve recoverability. If rollback cannot prove ownership, stop and report both observed
  states rather than restoring an old snapshot over a user edit.
- The persistent stdio entry is inert outside a RunWield-started Agy process because bridge mode requires private
  per-process environment. A crash can leave the durable entry and permission, but no bearer token or live endpoint.
- Bearer values, full MCP config, command environment, prompts, and raw transport errors must not enter logs, backend
  status, Session Transcript, or user-visible diagnostics.
- Loopback and stdio transport teardown must run after success, failure, cancellation, terminal acceptance, malformed
  stream, and subprocess exit. Child 05 still owns the complete Agy failure taxonomy and replayable status policy.
- If the dependent child 03 implementation differs from its approved Plan in execution-session or config ownership,
  reconcile against the actual target-branch code before editing; do not force this Plan's stale expected symbol names.
