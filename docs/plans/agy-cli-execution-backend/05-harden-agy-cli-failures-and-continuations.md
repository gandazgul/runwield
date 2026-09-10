---
planId: "2ca9527d-ed5c-4a04-b0d3-cc667eb7aa12"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/foreground-process.ts"
    - "src/shared/foreground-process.test.ts"
    - "src/shared/session/backends/agy-cli/"
    - "src/shared/session/session-transcript-projection.js"
    - "src/shared/session/abort-active-session.test.js"
    - "src/shared/session/request-dispatch.test.ts"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/session/session-transcript-projection.test.js"
    - "src/shared/session/agy-cli-execution.test.ts"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-23T20:02:05.478Z"
status: "validated"
origin: "internal"
parentPlan: "agy-cli-execution-backend"
order: 5
dependencies:
    - "04-bridge-agy-workflow-signals-through-mcp"
userVerifiedAt: null
targetBranch: "feature/agy-cli-execution-backend"
---

# Harden Agy CLI Failures and Continuations

## Context

Children 03 and 04 now make `agy-cli` a real Execution Backend on the Epic integration branch. Each turn rebuilds its
input from the RunWield Session Transcript, starts a per-turn authenticated MCP bridge, and runs one `agy` process. An
accepted Bridged Tool result can publish a Workflow Tool Event before the external process exits.

The current Agy path still reports plain exceptions. It does not save Agy backend status, uses Antigravity's five-minute
print-mode default, kills only the direct process, removes the reusable temporary custom agent after any turn failure,
and treats missing, empty, malformed, or mismatched stream results alike. Replay also labels every
`runwield.backend_status` entry as Claude CLI status. These gaps can hide the recovery action, orphan Agy descendants or
the `wld mcp agy-cli` adapter, and let a late host failure obscure an already accepted workflow decision.

This child makes turn-time failures deterministic, sanitized, replayable, and safe to resume. It preserves the child-04
setup boundary: declining or canceling the one-time global MCP setup still starts no Agy backend and writes no Session
Transcript entry. Once a turn starts, Workflow Tool Events remain lifecycle authority; backend status remains display
and recovery evidence only.

## Objective

Harden `agy-cli` execution so every turn-time failure has a stable user-facing result, saves at most one sanitized
primary backend status, and terminates the complete Agy process tree and MCP resources. A valid Agy result without an
accepted lifecycle tool remains an ordinary assistant turn and leaves the active workflow waiting. If a lifecycle tool
was accepted first, any later Agy failure becomes a warning and cannot undo, retry, or duplicate that workflow decision.

## Approach

Give Agy a closed failure model that uses the existing `runwield.backend_status` transcript shape and the Claude CLI
sanitation pattern, but keeps Antigravity-specific classification and repair copy in the Agy module. The model covers
`missing_executable`, `auth_failed`, `custom_agent_invalid`, `permission_denied`, `mcp_unavailable`,
`bridge_startup_failed`, `bridge_disconnected`, `non_zero_exit`, `malformed_stream`, `empty_result`, `result_mismatch`,
`selection_mismatch`, `timeout`, `canceled`, and `cleanup_failed`.

The turn outcome depends on two independent facts: whether Antigravity produced a valid native `result` event and
whether a RunWield lifecycle Bridged Tool already produced an accepted terminal Workflow Tool Event.

| Agy/native result          | Accepted workflow result | Outcome                                                                                                 |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Valid                      | No                       | Save the assistant message, complete the request attempt, and leave the active workflow waiting.        |
| Invalid or process failure | No                       | Save a sanitized error status, fail the request attempt, and save no unverified partial assistant text. |
| Valid                      | Yes                      | Keep the accepted workflow result; any verified assistant text is display-only.                         |
| Invalid or process failure | Yes                      | Keep the accepted workflow result, save a warning, and complete rather than retry the request attempt.  |

The process path becomes:

```text
runRootTurn / request dispatch
  -> verify the owned temporary custom agent still matches and is listed
  -> start the per-turn RunWield MCP bridge
  -> spawn direct `agy` arguments through the shared process-tree owner
  -> parse stream and inspect process status/stderr
  -> classify one turn outcome and append trusted transcript entries
  -> close bridge, await process-tree death, and release turn state
```

Extend `src/shared/foreground-process.ts` with `spawnForegroundProcess`, a direct executable-and-arguments API. Keep
`spawnForegroundShell` compatible by making it an adapter over the same process-tree owner. This preserves direct
argument safety for Agy and reuses the existing Unix process-group and Windows `taskkill /T` cancellation behavior
instead of copying it.

Pass `--print-timeout 24h` on every normal Agy turn. This is a fixed compatibility ceiling chosen by the user because
Agy 1.1.26 imposes a five-minute default and documents no disabled-timeout value. Do not add a setting in this child.
The shared process owner supplies a matching fallback timeout and keeps user cancellation distinct from timeout.

Do not auto-reprompt when a valid Agy turn omits a lifecycle tool. Waiting for the user is safer than a hidden loop that
can repeat edits or lifecycle calls. Also do not auto-repair a changed temporary custom-agent file: preserve foreign or
changed content, report safe restart guidance, and require a fresh execution session.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/foreground-process.ts` and `src/shared/foreground-process.test.ts` — add `spawnForegroundProcess` as a
  direct-argument process-tree API with abort and timeout outcomes, then keep the current shell API and all of its
  cancellation behavior compatible.
- `src/shared/session/backends/agy-cli/failure.ts` and focused Agy tests — own the closed Agy status kinds, typed
  errors, default repair messages, severity, optional post-terminal evidence, and bounded sanitation.
- `src/shared/session/backends/agy-cli/{command,process,stream-parser,custom-agent,execution-session}.ts` — pass the
  fixed timeout, use the shared process-tree owner, validate the temporary agent before each turn, classify native
  stream and process outcomes, preserve transcript ordering, and serialize abort/dispose cleanup.
- `src/shared/session/session-transcript-projection.js` and `src/shared/session/session-transcript-projection.test.js` —
  replay Claude and Agy backend status with backend-neutral message IDs and display severity, without creating workflow
  authority.
- `src/shared/session/abort-active-session.test.js` and `src/shared/session/session-runtime.test.js` — prove Agy
  wrappers participate in existing Session cancellation and that Runtime releases busy state after the whole process
  tree dies.
- `src/shared/session/request-dispatch.test.ts` — protect original-versus-continuation prompt selection for failures
  before and after the Agy user message is committed, including a backend switch.
- `src/shared/session/agy-cli-execution.test.ts` — extend the real generated-executable fixture with failure,
  descendant, timeout, permission, terminal-signal, retry, transcript, and cleanup scenarios.

The Plan Lifecycle, Workflow Tool Event owners, global Antigravity MCP setup, and lifecycle Tool Definitions are not
expected to change. This child consumes their accepted results; it does not add a second lifecycle or setup authority.

## Reuse Opportunities

- `src/shared/foreground-process.ts` — reuse its proven process-group ownership, pre-spawn abort race handling, timeout
  distinction, and Windows descendant termination for direct Agy commands.
- `src/shared/session/backends/claude-cli/{failure,execution-session}.ts` — reuse the status wire shape,
  one-primary-status gate, sanitation principles, request ID/attempt ID correlation, append-after-spawn rule, and
  `finally` cleanup order. Keep Claude-specific auth text and usage URL exceptions out of Agy copy.
- `src/shared/session/request-dispatch.ts` — reuse its durable `requestRecorded` rule: retry the original request when
  no user message was committed and use the fixed continuation request after a committed failed turn.
- `src/shared/session/bridged-tools/mcp-bridge.ts` — use `acceptedTerminal`, idempotent `close`, abort propagation, and
  `onUnexpectedDisconnect`; do not infer workflow completion from Agy text or `tool_info`.
- `src/shared/session/backends/agy-cli/custom-agent.ts` — retain ownership and compare-before-delete checks; add
  validation without overwriting or claiming changed content.
- Existing generated executable, sandboxed `HOME`, real MCP stdio, and active-workflow fixtures — extend real boundaries
  rather than add dependency-injection seams.

## Implementation Steps

- [ ] `src/shared/foreground-process.ts` exports `spawnForegroundProcess`, which receives a command, literal argument
      array, working directory, optional environment, abort signal, and optional timeout; never uses a shell; reports
      `{ exitCode, terminatedBy: null | "abort" | "timeout" }`; closes startup races; and kills descendants on Unix and
      Windows. `spawnForegroundShell` delegates to the same owner and retains its current interface and tests.
- [ ] `prepareAgyCliStreamCommand` always emits `--print-timeout 24h` and still uses a direct argument array with the
      exact model and temporary Agent selector. It continues to omit `--continue`, `--conversation`, and
      `--dangerously-skip-permissions`.
- [ ] `DenoAgyCliProcessPort` uses the shared direct process-tree operation, drains stdout/stderr, awaits process death,
      distinguishes abort from timeout, and maps spawn `NotFound` to `missing_executable`. It does not expose a new
      testing seam or use a shell to make the shared operation fit.
- [ ] Agy owns a typed `runwield.backend_status` model with the approved closed kinds. Entries contain only version,
      `backend: "agy-cli"`, kind, exit code, sanitized message, optional request/attempt IDs, and optional
      `afterAcceptedTerminal: true` evidence when the failure occurred after an accepted terminal workflow result. One
      turn emits at most one primary status; a later cleanup problem can add one separate warning without replacing the
      primary cause.
- [ ] Agy sanitation removes bearer values, tokens, credentials, URLs, command environments, prompts, raw config
      payloads, home paths, and temporary Agent selectors; compacts whitespace; and bounds persisted text to 1,024
      characters. Empty sanitized detail falls back to stable install, sign-in, permission, restart, or retry guidance.
- [ ] Before every Agy process spawn, including each later root turn, the execution session verifies that its temporary
      `agent.md` is still a regular file with the exact owned bytes and that `/agents` lists the exact selector. This
      check finishes before the turn bridge starts or the user message is committed. Missing, linked, changed, unlisted,
      or invalid state becomes `custom_agent_invalid`; RunWield neither overwrites nor deletes changed content and tells
      the user to start a fresh Agy execution session without exposing the selector as product identity. This is a
      point-in- time preflight of the definition Agy loads at startup, not a false claim that RunWield can prove file
      stability throughout an already running external process.
- [ ] The stream parser returns typed evidence for `init`, visible text, native result status/error, denied actions,
      usage, and conversation ID. It distinguishes malformed JSON, no result, empty successful result, streamed/final
      text mismatch, requested model/Agent mismatch, explicit auth failure, permission denial, and other non-success
      results. Unknown additive event fields remain forward-compatible; raw `tool_info` and denied-action payloads are
      never persisted.
- [ ] `AgyCliExecutionSession.runTurn` appends the user message and initial execution-backend entry only after the real
      turn process starts. It always combines caller and local abort signals, observes bridge disconnects, awaits
      parser, process status, and sanitized stderr before selecting the primary cause, and closes the bridge and
      complete process tree before clearing streaming state.
- [ ] A hard failure before the user message is committed saves status without request content and leaves the request
      attempt retryable in `original` mode. A hard failure after that commit saves status, no partial assistant message
      or model change, and leaves the next same-request attempt in `continuation` mode. A later retry rebuilds only
      committed RunWield transcript content and does not depend on Antigravity conversation files.
- [ ] A valid native result without an accepted terminal Workflow Tool Event appends exactly one final assistant
      message, usage, model state, and final execution-backend metadata, then completes the request attempt. For
      Planner, execution, and Semantic Reviewer turns, missing `plan_written`, `task_completed`, or `review_complete`
      leaves the current workflow and Agent active; no automatic Agy turn is started.
- [ ] Once `bridge.acceptedTerminal` is true, its existing Workflow Tool Event and lifecycle effect remain
      authoritative. A later timeout, cancel, malformed or empty result, selection mismatch, bridge loss, permission
      problem, or non-zero exit records warning-level post-terminal status, saves no unverified partial text, resolves
      the turn so the request attempt completes, and cannot publish a second event, roll back lifecycle, or trigger
      backend continuation.
- [ ] Permission denial or MCP unavailability carried by an otherwise valid Agy result saves the verified assistant text
      and a sanitized status so the user can repair access. Without an accepted lifecycle result, the workflow remains
      waiting; with one, the status is warning-only. RunWield never enables `--dangerously-skip-permissions` as repair.
- [ ] `abort()` and asynchronous `dispose()` are idempotent. Abort records `canceled` only for a live non-terminal turn,
      kills Agy and descendants, aborts active Bridged Tools, closes the bridge, and preserves active workflow state.
      Dispose waits for turn teardown before ownership-checked custom-agent cleanup; a cleanup refusal cannot hide the
      original turn result or delete changed content.
- [ ] Transcript projection recognizes both `claude-cli` and `agy-cli` backend status, uses the entry's sanitized
      message, maps cancellation, bridge disconnect, cleanup, and post-terminal status to warnings, and maps unrecovered
      turn failures to errors. Projection emits only `SYSTEM_STATUS`; it never creates or claims a Workflow Tool Event.
- [ ] Existing Pi and Claude CLI execution, Claude status sanitation/replay, Agy MCP setup approval, Bridged Tool
      aliases, request dispatch, Agent Display Names, and root/isolated Session behavior remain unchanged.

## Approval Confirmation

No Work Records are proposed for supersession. The Claude CLI backend and process-tree cancellation Work Records are
active precedents, not work this Plan replaces.

## Verification Plan

- Automated process ownership:
  `deno run -A scripts/run-tests.js src/shared/foreground-process.test.ts src/shared/session/abort-active-session.test.js`.
  Cover literal direct arguments with shell metacharacters, natural non-zero exit, missing executable, pre-abort,
  startup abort race, timeout-versus-cancel, and descendant death. Re-run every existing shell test to prove the adapter
  kept its contract.
- Automated Agy parsing and status:
  `deno run -A scripts/run-tests.js src/shared/session/backends/agy-cli/agy-cli-backend.test.ts
  src/shared/session/session-transcript-projection.test.js`.
  Cover every closed status kind, 1,024-character sanitation, secret/path/URL/selector redaction, malformed and additive
  stream records, explicit non-success status, denied actions, empty result, text mismatch, selection mismatch, warning
  severity, and Claude replay compatibility.
- Automated continuation and Runtime behavior:
  `deno run -A scripts/run-tests.js src/shared/session/request-dispatch.test.ts
  src/shared/session/session-runtime.test.js src/shared/session/agy-cli-execution.test.ts`.
  Prove failure before user commit retries the original request; failure after commit sends the fixed continuation
  request; valid text without a lifecycle call is committed once and waits; Runtime cancellation releases busy state
  only after Agy descendants and the stdio adapter are dead. After one successful root turn, change or remove its
  temporary `agent.md`; the next turn must record `custom_agent_invalid` before bridge/process start or user commit,
  preserve changed bytes, and publish no Workflow Tool Event.
- Objective-failing vertical check:
  `deno run -A scripts/run-tests.js --filter '^Agy failures preserve workflow authority and terminate every owned process$'
  src/shared/session/agy-cli-execution.test.ts`.
  A generated direct `agy` executable must start a real descendant and the configured real `wld mcp agy-cli` stdio
  adapter, use randomized lifecycle arguments, and run two branches. Before an accepted terminal tool, malformed output
  or non-zero exit must leave Plan/task/review state unchanged, append one sanitized error, fail the request attempt,
  and kill all processes. After a real accepted lifecycle Tool Definition, the same host failure must preserve that
  authority's randomized effect and Workflow Tool Event, append only a warning, complete the request attempt, reject
  duplicate terminal calls, and leave no process or listener alive. This test fails for a pass-through lifecycle result,
  prose marker, direct-child-only kill, generic thrown error, or hard-coded status.
- Objective-failing continuation check:
  `deno run -A scripts/run-tests.js --filter '^Agy retry reconstructs only committed transcript after classified failure$'
  src/shared/session/agy-cli-execution.test.ts`.
  Remove the fake executable after session creation to prove `missing_executable` commits no user message and retries
  the original request. Then emit assistant deltas followed by a malformed or mismatched terminal record to prove
  partial text is not committed, the user request occurs once, and the next attempt receives the continuation prompt
  plus prior committed RunWield history. Delete all fake Antigravity conversation data before retry.
- Automated regression suites:
  `deno run -A scripts/run-tests.js src/shared/session/claude-cli-execution.test.ts
  src/shared/session/root-session.test.js src/shared/workflow/workflow-tool-events.test.ts
  src/shared/workflow/validation-loop-review.test.js`.
- Automated project gates: `deno task check`, `deno task seams:check`, `deno task test`, and `deno task ci`. The full CI
  run is required because this child changes the shared process owner and Session Transcript replay.
- Manual authenticated Agy check: with supported `agy` installed, run one ordinary Guide turn and one controlled active
  workflow turn. Confirm the process arguments include `--print-timeout 24h`; ordinary verified text remains after
  replay; a missing lifecycle call leaves the workflow waiting; an accepted `runwield_` lifecycle call advances exactly
  once; and Escape stops Agy, its tool descendants, the stdio adapter, and the loopback bridge without changing active
  workflow truth.
- Manual failure guidance: test an unauthenticated headless run and a denied file or command action without
  `--dangerously-skip-permissions`. Confirm RunWield shows bounded sign-in or permission guidance, never raw stderr,
  credentials, environment, home path, temporary Agent selector, bridge URL/token, or global config content.
- Existing behavior protected: Pi stays the default; Claude CLI keeps its command, failure statuses, bridge, and
  continuation behavior; child 04's setup decline/cancel path writes no transcript; valid Agy turns still reconstruct
  history and show Agent Display Names; accepted Workflow Tool Events remain the only workflow authority.
- Behavior expected to stop: Agy no longer uses the five-minute default, deletes its reusable custom agent after every
  failed turn, leaves descendant processes alive, throws unclassified turn errors, commits unverified partial text, or
  replays Agy status with Claude-specific fallback copy.

## Edge Cases & Considerations

- **Accepted event races external shutdown:** the Agent Handler can consume a Workflow Tool Event before `agy` exits.
  Teardown may therefore run while the workflow moves to another Agent. The request attempt must settle as completed
  once terminal acceptance is known, even if disposal supplies the abort that ends the old Agy process.
- **Primary-cause ordering:** malformed stdout can accompany an auth, permission, timeout, or non-zero process failure.
  Await process status and sanitized stderr before choosing the one primary status so a parser exception does not hide
  the actionable cause. Cleanup warnings remain secondary.
- **Permission denial is not permission escalation:** current and newer Agy versions can soft-deny headless actions
  while still returning a structured result. Preserve verified explanatory text and status, but never add
  `--dangerously-skip-permissions` or mutate broader Antigravity permissions.
- **Temporary custom-agent drift:** preflight closes create-time versus later-turn drift, not arbitrary writes after the
  external process has already loaded its definition. A missing file can be recreated only by a fresh execution session.
  A changed, linked, or foreign file is preserved. Cleanup and status copy must not turn the internal selector into the
  RunWield Agent name.
- **Timeout parity:** Claude CLI has no RunWield whole-turn limit. The user accepted 24 hours only because Agy requires
  a practical explicit duration. A future cross-backend timeout setting is outside this child.
- **Transcript truth:** live deltas can disappear after a failed turn because only verified final assistant text is
  committed. Backend status and request-attempt entries make that loss explicit and replayable; Antigravity logs and
  conversation IDs remain optional metadata, never recovery authority.
- **Test safety:** fixtures use sandboxed `HOME`, `PATH`, and real temporary executables under
  `withProcessGlobalTestLock`. No test touches the developer's Antigravity files, waits 24 hours, replaces
  RunWield-owned process/lifecycle machinery, or adds an injection seam.
