---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Make Claude-backed execution recoverable and deterministic across missing executable/auth, non-zero exits, malformed output, cancellation, missing terminal signals, and plain-text questions. This slice protects active workflow truth and Plan lifecycle state under backend failure."
affectedPaths:
    - "src/shared/session/backends/claude-cli/"
    - "src/shared/session/session.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-runtime-events.js"
    - "src/shared/session/session-transcript-projection.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/session/abort-active-session.test.js"
    - "src/shared/session/active-agent-session.test.js"
executionAgent: "engineer"
createdAt: "2026-08-03T18:20:03.241Z"
updatedAt: "2026-08-03T18:20:03.241Z"
status: "draft"
origin: "internal"
parentPlan: "claude-cli-execution-backend"
order: 4
dependencies:
    - "03-bridge-claude-workflow-signals-through-mcp"
---

# Harden Claude CLI Backend Failures and Continuations

## Context

Once Claude CLI execution and MCP workflow signals exist, the backend must fail safely. Claude Code may be missing,
unauthenticated, outdated, canceled, produce malformed stream JSON, exit non-zero, ask a question without a terminal
signal, or continue output after a terminal signal. RunWield must make these states visible and recoverable without
corrupting Plan lifecycle or clearing active workflow truth incorrectly.

## Objective

Harden the Claude CLI backend so failure, cancellation, malformed output, missing terminal signals, and plain-text
question paths produce deterministic RunWield runtime status/error entries and safe continuation behavior while
preserving existing Pi-backed runtime semantics.

## Approach

Add explicit backend result states and runtime event handling around the Claude subprocess/MCP bridge. Treat health
checks and command startup failures as pre-lifecycle failures. Treat accepted terminal workflow signals as
authoritative, and treat no-signal Claude responses as non-terminal assistant output that leaves the session/workflow
waiting for the appropriate continuation. Ensure abort tears down the Claude subprocess and bridge without clearing
active execution workflow truth.

Keep automated coverage on fake subprocess/MCP fixtures so the normal suite does not require Claude Code.

## Files to Modify

- `src/shared/session/backends/claude-cli/` — add health checks, process cleanup, stream parsing errors, terminal-signal
  policy, missing-signal handling, and sanitized failure metadata.
- `src/shared/session/session.js` — propagate Claude backend result/error states without disrupting Pi runPrompt
  behavior.
- `src/shared/session/session-runtime.js` — preserve active-agent/workflow continuation and cancellation semantics for
  Claude-backed turns.
- `src/shared/session/session-runtime-events.js` — reuse or add normalized status/error event shapes needed for visible
  Claude backend failures.
- `src/shared/session/session-transcript-projection.js` — replay persisted Claude failure/status entries as display-only
  projection, not lifecycle authority.
- `src/shared/session/session-runtime.test.js` — cover continuation behavior, missing terminal signals, and safe
  workflow state after failures.
- `src/shared/session/abort-active-session.test.js` — cover Claude subprocess and MCP bridge cleanup on cancellation.
- `src/shared/session/active-agent-session.test.js` — protect active workflow ownership across Claude backend pauses and
  failures.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-runtime-events.js` — reuse normalized status/error/runtime event patterns.
- `src/shared/session/session-runtime.js` — reuse active execution workflow preservation and owner realignment
  semantics.
- `src/shared/session/session-transcript-projection.js` — reuse projection-only behavior for committed transcript
  entries.
- `src/shared/session/abort-active-session.test.js` — reuse cancellation coverage patterns from Pi-backed sessions.
- `src/shared/workflow/metrics.js` — reuse workflow/model/backend metrics conventions where they already exist.

## Implementation Steps

- [ ] Missing `claude`, failed Claude CLI health/auth, non-zero subprocess exit, malformed stream JSON, MCP bridge
      startup failure, and unexpected bridge disconnection each produce deterministic visible RunWield status/error
      entries without moving Plan lifecycle state.
- [ ] Aborting a Claude-backed turn terminates the Claude subprocess and MCP bridge and does not clear active execution
      workflow truth unless the normal workflow cancellation path explicitly does so.
- [ ] A Claude-backed Planner response that asks a plain-text question and calls no MCP workflow tool persists as an
      assistant message and leaves the Session waiting for user input without invoking `plan_written`, `task_completed`,
      or `review_complete`.
- [ ] A Claude-backed Engineer or Reviewer response that exits without the required terminal MCP signal is not treated
      as completion; RunWield records the output and follows a deterministic reminder/wait/continuation policy without
      corrupting lifecycle state.
- [ ] Accepted terminal signal handling is deterministic when Claude emits additional post-terminal output; the backend
      either ignores, aborts, or marks the extra output according to a tested policy.
- [ ] Persisted command metadata is sanitized and excludes environment variables, API keys, auth tokens, and Claude
      settings payloads.
- [ ] Existing Pi cancellation, steering, active workflow preservation, and validation continuation behavior remain
      protected by tests.

## Verification Plan

- Automated: targeted Claude backend tests under `src/shared/session/backends/claude-cli/` using fake subprocess and MCP
  fixtures for missing executable, auth failure, non-zero exit, malformed JSON, missing signal, and post-terminal
  output.
- Automated:
  `deno run -A scripts/run-tests.js src/shared/session/session-runtime.test.js src/shared/session/abort-active-session.test.js src/shared/session/active-agent-session.test.js src/shared/session/session-transcript-projection.test.js`
- Manual: with Claude Code installed, cancel a Claude-backed turn and confirm the process exits, RunWield remains
  responsive, and active workflow state is not lost.
- Manual: run a Claude-backed Planner question path and confirm RunWield waits for user reply without terminal workflow
  movement.
- Expected: all named failure modes are visible and recoverable, and none mutate Plan lifecycle unless an accepted
  workflow signal already did so.
- Behavior protected afterwards: existing Pi-backed abort, steering, workflow validation, and active execution workflow
  invariants continue to pass.
- Behavior expected to stop existing: Claude backend failures no longer collapse into ambiguous generic errors or
  accidental lifecycle completion.

### Objective-Failing Checks

- `OC1` —
  `deno run -A scripts/run-tests.js src/shared/session/session-runtime.test.js src/shared/session/abort-active-session.test.js src/shared/session/active-agent-session.test.js`
  — proves Claude failure/cancellation paths preserve runtime and workflow invariants.
- `OC2` — `deno run -A scripts/run-tests.js src/shared/session/session-transcript-projection.test.js` — proves Claude
  status/error entries replay as projection rather than lifecycle authority.

## Execution Policy

This child is Engineer-owned and can run autonomously. It has no browser-rendered UI outcome.

## Edge Cases & Considerations

- Health/auth checks should fail before workflow mutation wherever possible.
- A missing terminal signal after implementation/review is not success; avoid turning absence into completion.
- Do not persist secrets or raw command environment details.
- Keep all fakeability at external boundaries: subprocess, MCP server, clocks if needed. Do not add seams to
  RunWield-owned lifecycle machinery.
