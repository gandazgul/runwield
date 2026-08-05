---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Make Claude-backed execution recoverable and deterministic across missing executable/auth, non-zero exits, malformed output, cancellation, missing terminal signals, and plain-text questions. This slice protects active workflow truth and Plan lifecycle state under backend failure."
affectedPaths:
    - "src/shared/session/backends/claude-cli/failure.ts"
    - "src/shared/session/backends/claude-cli/process.ts"
    - "src/shared/session/backends/claude-cli/stream-parser.ts"
    - "src/shared/session/backends/claude-cli/execution-session.ts"
    - "src/shared/session/backends/claude-cli/workflow-mcp-bridge.ts"
    - "src/shared/session/backends/claude-cli/testing/fake-claude-mcp-client.ts"
    - "src/shared/session/backends/claude-cli/claude-cli-backend.test.ts"
    - "src/shared/session/session.js"
    - "src/shared/session/session-transcript-projection.js"
    - "src/shared/session/claude-cli-execution.test.ts"
    - "src/shared/session/session-transcript-projection.test.js"
    - "src/shared/session/abort-active-session.test.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/session/active-agent-session.test.js"
objectiveChecks:
    - id: "OC1"
      command: "bash -lc 'set -euo pipefail; grep -q \"runwield.backend_status\" src/shared/session/backends/claude-cli/execution-session.ts; out=$(deno run -A scripts/run-tests.js --filter \"^Claude CLI missing executable fails before workflow mutation$\" src/shared/session/backends/claude-cli/claude-cli-backend.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"'"
      rationale: "The turn code persists the status entry and the named test proves a missing `claude` produces a typed, visible, pre-transcript failure while workflow is untouched."
    - id: "OC2"
      command: "bash -lc 'set -euo pipefail; grep -q \"AbortSignal.any\" src/shared/session/backends/claude-cli/execution-session.ts; out=$(deno run -A scripts/run-tests.js --filter \"^Claude CLI abort cancels the subprocess and preserves active workflow$\" src/shared/session/backends/claude-cli/claude-cli-backend.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"'"
      rationale: "The abort controller is actually combined with the spawn signal and the named test proves cancellation kills the subprocess, records `canceled`, and preserves active workflow."
    - id: "OC3"
      command: "bash -lc 'set -euo pipefail; grep -q \"isTerminalAccepted\" src/shared/session/backends/claude-cli/stream-parser.ts; out=$(deno run -A scripts/run-tests.js --filter \"^Claude CLI post-terminal output stays display-only after accepted signal$\" src/shared/session/claude-cli-execution.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"'"
      rationale: "The parser consumes the terminal-authority gate and the named vertical test proves extra prose after an accepted terminal signal is display-only, not an error."
    - id: "OC4"
      command: "bash -lc 'set -euo pipefail; grep -q \"runwield.backend_status\" src/shared/session/session-transcript-projection.js; out=$(deno run -A scripts/run-tests.js --filter \"^projection replays Claude backend failure entries as display-only status$\" src/shared/session/session-transcript-projection.test.js 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"'"
      rationale: "The projection references the persisted status entry type and the named test proves replay is display-only and never becomes lifecycle authority."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-05T09:32:26-04:00"
updatedAt: "2026-08-05T13:59:11.968Z"
status: "ready_for_work"
origin: "internal"
parentPlan: "claude-cli-execution-backend"
order: 4
dependencies:
    - "03-bridge-claude-workflow-signals-through-mcp"
userVerifiedAt: null
---

# Harden Claude CLI Backend Failures and Continuations

## Context

Child 03 is verified: eligible Claude CLI turns execute through `ClaudeCliExecutionSession`, persist RunWield-owned
transcript entries, and drive Plan Written / Task Completion / Semantic Review through the authenticated loopback MCP
bridge. What remains is failure behavior. Claude Code may be missing, unauthenticated, outdated, canceled, produce
malformed stream JSON, exit non-zero, ask a question without a terminal signal, disconnect the bridge, or continue
output after an accepted terminal signal. Today every one of those collapses into a raw thrown `Error` that surfaces as
a generic `TERMINAL_ERROR`, persists nothing, and — in the cancellation and malformed-stream cases — can leave the
`claude` subprocess running.

Concrete gaps verified in the current source:

- `runRootTurn` calls `session.session.runTurn({ userRequest, images })` with no abort signal, and
  `ClaudeCliExecutionSession.abort()` is a no-op, so Esc on a Claude root turn never kills the subprocess.
- `parseClaudeCliStream` is awaited before `process.completed`; an auth-failure exit (which emits no `result` line)
  surfaces as the misleading "stream ended without a terminal result" and stderr is never consulted.
- A parser throw (malformed JSON) abandons the stdout reader without awaiting or killing the child, so a blocked pipe
  can wedge the process.
- After the MCP bridge accepts `task_completed`, extra Claude prose can make the final `result` differ from the visible
  stream; the parser then throws, turning an accepted completion into a terminal error.
- No persisted, re-playable failure entry exists; `session-transcript-projection.js` skips unknown custom entries, so
  after resume the failure is invisible.
- The draft's Objective-Failing Checks ran pre-existing test files that already pass, so they were green before any work
  and could not prove the objective.

Two continuation policies were settled with the user:

- **Missing terminal signal = wait-only.** A Claude Planner/Engineer/Reviewer response that ends without the required
  MCP completion call persists as an ordinary assistant message and leaves the Session waiting for the user like a
  normal Pi-backed turn. No automatic re-prompt loop is added.
- **Post-terminal output = absorb as display-only.** The first accepted terminal MCP signal decides workflow; any later
  Claude text streams and persists as normal assistant text but never re-opens lifecycle, and the
  result-vs-visible-stream mismatch check is disabled after acceptance.

## Objective

Harden the Claude CLI backend so failure, cancellation, malformed output, missing terminal signals, and plain-text
question paths produce deterministic, sanitized RunWield status/error entries, tear down the subprocess and bridge in
every path, and preserve active workflow truth and Plan lifecycle state. Pi-backed runtime semantics remain unchanged.

## Approach

Introduce a typed backend failure model under the Claude backend, rework `runTurn` around an internal `AbortController`
with robust subprocess lifecycle, teach the stream parser a terminal-authority policy, persist a sanitized
`runwield.backend_status` transcript entry for every failure, project that entry as display-only on replay, and wire
root-turn abort through `ClaudeCliExecutionSession.abort()`. All fakeability stays at the real external boundaries: the
`claude` subprocess and the MCP loopback server. No seams are added to RunWield-owned lifecycle machinery.

### Failure model

New `src/shared/session/backends/claude-cli/failure.ts` owns:

- `ClaudeCliBackendErrorKind` — a closed union:
  `"missing_executable" | "auth_failed" | "non_zero_exit" |
  "malformed_stream" | "bridge_startup_failed" | "bridge_disconnected" | "canceled"`.
- `ClaudeCliBackendError` extends `Error` with `kind`, `exitCode: number | null`, and a sanitized `message`.
- `buildBackendStatusEntry(kind, options)` — returns the persisted custom-entry payload
  `{ version: 1, backend: "claude-cli", kind, exitCode: number | null, message: string }`; the message is a bounded
  guidance string with no environment, argv, prompt text, token, URL, or raw stderr content.
- `sanitizeStderrForDisplay(stderr)` — a line filter (drop lines matching env/API-key/token/settings markers, cap at ~1
  KiB) used only for the live error message, never for persisted metadata.
- `emitBackendStatus(hostedSession, entry)` — emits a live `SYSTEM_STATUS` runtime event (level `error` for failure
  kinds, `warning` for `canceled`/`bridge_disconnected`) and appends the `runwield.backend_status` custom entry to the
  supplied `SessionManager`.

### Subprocess lifecycle

`process.ts`:

- Spawn errors (`NotFound`) are mapped to `ClaudeCliBackendError("missing_executable")` before any transcript mutation.
- `completed` resolves from `child.status` directly, not chained on stdin close, so a broken stdin pipe cannot mask the
  real exit status; stdin write rejection is swallowed (the child has already moved on).
- The process handle exposes `kill()` (best-effort `child.kill("SIGKILL")`) so the execution session can tear down a
  child that errored mid-stream instead of waiting on a blocked pipe.

### Terminal-authority stream policy

`stream-parser.ts` accepts an optional `isTerminalAccepted: () => boolean` callback:

- While `isTerminalAccepted()` is false, current invariants hold: malformed JSON throws, a missing `result` line throws,
  and a result that differs from the visible stream throws.
- Once `isTerminalAccepted()` returns true: malformed JSON still throws, but the "no terminal result" and "result !=
  visible" checks are disabled; the returned text is the collected visible stream (post-terminal prose is preserved as
  the user saw it) and usage defaults to zero when no result line follows.

### Turn rework in `execution-session.ts`

`runTurn` becomes:

1. Image guard (unchanged).
2. Build conversation and user message.
3. Start the MCP bridge when eligible tools exist; startup failure → `bridge_startup_failed`, persisted and visible,
   before transcript mutation.
4. Prepare the command, then **spawn** the subprocess before appending the user message; spawn `NotFound` →
   `missing_executable` with no transcript append (consistent with the existing image-turn "fail before transcript
   append" contract).
5. Append the user message and `runwield.execution_backend` entry.
6. Parse the stream with `isTerminalAccepted` wired to the bridge's accepted-terminal state; kill the child and classify
   `malformed_stream` if the parser throws.
7. Await the real exit status. Non-zero exit: classify `auth_failed` when stderr matches auth markers
   (`/authenticate|not signed in|oauth|api key|login|expired/i`), else `non_zero_exit`; persist a sanitized
   `runwield.backend_status` entry and surface a sanitized stderr excerpt only in the live error message.
8. Success path unchanged: append assistant message, usage, execution_backend entry.
9. Every failure path persists the status entry, emits live status, kills the child if still running, and throws
   `ClaudeCliBackendError` so the runtime emits `TERMINAL_ERROR` with the sanitized message.
10. `finally` unchanged in intent: remove prompt/config temp files, close the bridge, `isStreaming = false`.

Abort wiring:

- `ClaudeCliExecutionSession` owns a per-turn `AbortController`. `abort()` aborts it; `runTurn` combines an external
  `signal` (isolated turns) with the internal controller via `AbortSignal.any([...])` when both exist.
- When the controller is aborted, the child is killed by Deno's signal handling, the parser sees stream end, and the
  turn classifies `canceled` (persisted as a warning-level `runwield.backend_status`, no assistant message appended).
- `abortActiveSession` already unwraps the execution-session wrapper and calls inner `abort()`; the root turn therefore
  becomes cancellable through the existing Esc path without a `signal` parameter on `runRootTurn`.

### Bridge and replay

- `workflow-mcp-bridge.ts` exposes a readonly `acceptedTerminal: boolean` on the handle (the gate it already tracks). An
  unexpected bridge close mid-turn records a `bridge_disconnected` warning entry best-effort; it never fails the turn
  (Claude simply finishes without a terminal signal, which is the wait-only path).
- `session-transcript-projection.js` projects `runwield.backend_status` custom entries into `SYSTEM_STATUS` events
  (level `error` for failure kinds, `warning` for `canceled`/`bridge_disconnected`) with the sanitized message and the
  entry's id as `messageId`. Projection only; `getCommittedTranscriptAuthorityFacts` and all authority extracts are
  unchanged.

## Files to Modify

- `src/shared/session/backends/claude-cli/failure.ts` (new) — typed error kinds, sanitized status-entry builder, stderr
  display sanitizer, live status emission + persistence helper.
- `src/shared/session/backends/claude-cli/process.ts` — robust spawn/status (no stdin-chained `completed`), spawn
  `NotFound` mapping, `kill()` for mid-stream teardown.
- `src/shared/session/backends/claude-cli/stream-parser.ts` — `isTerminalAccepted` callback; post-acceptance relaxes
  only the no-result and result-vs-visible invariants; malformed JSON still throws.
- `src/shared/session/backends/claude-cli/execution-session.ts` — `runTurn` rework per Approach: internal
  `AbortController`, spawn-before-transcript-append, failure classification, `runwield.backend_status` persistence,
  child kill on error paths, `abort()`/`dispose()` implemented.
- `src/shared/session/backends/claude-cli/workflow-mcp-bridge.ts` — expose `acceptedTerminal`; best-effort
  `bridge_disconnected` warning on unexpected close.
- `src/shared/session/backends/claude-cli/testing/fake-claude-mcp-client.ts` — fixture failure modes: non-zero exit
  code + stderr text, malformed stream line, sleep-before-output (abort), SIGTERM log line, post-terminal text.
- `src/shared/session/session.js` — no signature change to `runRootTurn`; root-turn abort flows through
  `abortActiveSession` → inner `abort()`. Isolated-turn `signal` continues to be passed; Pi branch untouched.
- `src/shared/session/session-transcript-projection.js` — project `runwield.backend_status` as display-only
  `SYSTEM_STATUS`; no authority-facts change.
- `src/shared/session/backends/claude-cli/claude-cli-backend.test.ts` — named failure-mode tests (missing executable,
  auth failure, malformed stream, abort).
- `src/shared/session/claude-cli-execution.test.ts` — named vertical tests (root-turn abort reaches the subprocess,
  missing terminal signal waits, post-terminal absorb).
- `src/shared/session/session-transcript-projection.test.js` — named projection test for `runwield.backend_status`.
- `src/shared/session/abort-active-session.test.js` — named test proving `abortActiveSession` unwraps a claude-cli
  execution-session wrapper and aborts the inner session.
- `src/shared/session/session-runtime.test.js` and `src/shared/session/active-agent-session.test.js` — regression
  protection only; no new tests required here.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-runtime-events.js` — reuse `SYSTEM_STATUS` (level error/warning), `TERMINAL_ERROR`, and
  `emitSystemStatus`/`emitHostedSessionRuntimeEvent`; no new event types are added.
- `src/shared/session/backends/claude-cli/workflow-mcp-bridge.ts` — reuse the existing per-turn gate; expose it as
  `acceptedTerminal` instead of inventing a second completion journal.
- `src/shared/session/backends/claude-cli/command.ts` — reuse owner-only temp-file helpers and cleanup for prompt/MCP
  config files.
- `src/shared/session/execution-backend.ts` and `abortActiveSession` in `session.js` — reuse the existing
  execution-session wrapper unwrap and streaming gate so root-turn abort needs no new runtime wiring.
- `src/shared/session/agent-handler.ts` — reuse the existing no-outcome path (`requestAgentStoppedAttention`, return
  complete) as the wait-only missing-signal policy; the backend must not invent completion from prose.
- `src/shared/session/session-transcript-projection.js` — reuse `makeEventId`/`entryMessageId`/`common` replay meta for
  the new display-only status projection.
- `scripts/run-tests.js` / `deno task test` — use the repository's sandboxed runner; never invoke `deno test` directly.

## Implementation Steps

- [ ] `src/shared/session/backends/claude-cli/failure.ts` exports `ClaudeCliBackendErrorKind` (closed union of
      `missing_executable`, `auth_failed`, `non_zero_exit`, `malformed_stream`, `bridge_startup_failed`,
      `bridge_disconnected`, `canceled`), `ClaudeCliBackendError` (with `kind`, `exitCode`, sanitized `message`),
      `buildBackendStatusEntry`, `sanitizeStderrForDisplay`, and `emitBackendStatus`; the file contains no `any`,
      `unknown`, bare `object`, `@ts-ignore`, or `@ts-nocheck`.
- [ ] `process.ts` maps spawn-time `NotFound` to `ClaudeCliBackendError("missing_executable")`, resolves `completed`
      from `child.status` without chaining on stdin close, and exposes `kill()` that terminates a still-running child; a
      broken stdin pipe never replaces the real exit status.
- [ ] `stream-parser.ts` accepts `isTerminalAccepted`; while false, malformed JSON, missing terminal result, and
      result-vs-visible mismatch all throw; once true, only malformed JSON throws, missing result returns the visible
      text with zero usage, and a mismatched result is ignored in favor of the visible text.
- [ ] `ClaudeCliExecutionSession.runTurn` spawns the subprocess before appending the user message; `missing_executable`
      leaves the transcript with no new user/assistant message; every non-success or thrown path appends exactly one
      sanitized `runwield.backend_status` custom entry (`version`, `backend`, `kind`, `exitCode`, sanitized `message`)
      that contains no environment variables, argv, prompt text, auth tokens, URLs, or raw stderr.
- [ ] Non-zero subprocess exits classify `auth_failed` when stderr matches auth markers and `non_zero_exit` otherwise;
      the live error surfaces only a sanitized, bounded stderr excerpt and the persisted entry never contains raw
      stderr.
- [ ] `ClaudeCliExecutionSession.abort()` aborts the per-turn internal `AbortController`; `runTurn` combines an external
      signal with the internal controller via `AbortSignal.any`; an aborted turn kills the child, records
      `runwield.backend_status` kind `canceled` (warning level), appends no assistant message, and settles cleanup in
      `finally`.
- [ ] `runRootTurn`'s Claude branch remains cancellable through `abortActiveSession` → inner `abort()` with no new
      `signal` parameter; `abortActiveSession` unwraps the claude-cli execution-session wrapper exactly as it does today
      and aborts the inner session while clearing only its queue.
- [ ] `workflow-mcp-bridge.ts` handle exposes `acceptedTerminal` reflecting the closed lifecycle gate; an unexpected
      bridge close during the turn records `bridge_disconnected` best-effort and never fails the turn.
- [ ] `session-transcript-projection.js` replays `runwield.backend_status` entries as `SYSTEM_STATUS` events with level
      `error` for failure kinds and `warning` for `canceled`/`bridge_disconnected`; the replay carries the sanitized
      persisted message and does not alter `getCommittedTranscriptAuthorityFacts` or any authority extract.
- [ ] The fake `claude` fixture supports `RUNWIELD_CLAUDE_FIXTURE_EXIT_CODE`/`RUNWIELD_CLAUDE_FIXTURE_STDERR` (emit
      stderr then exit non-zero before stream lines), `RUNWIELD_CLAUDE_FIXTURE_MALFORMED` (emit a malformed line),
      `RUNWIELD_CLAUDE_FIXTURE_SLEEP_MS` (delay before output), a SIGTERM log line, and post-terminal text after MCP
      calls.
- [ ] Named tests exist and are behavioral (each exercises the real stack — the fixture `claude` shim, real
      `ClaudeCliExecutionSession`/`runRootTurn`, real `SessionManager` persistence, or real `createReplayEvents` — and
      asserts on persisted output or workflow state; empty bodies fail the objective):
      `^Claude CLI missing executable fails before workflow mutation$` (asserts typed `missing_executable` error, no new
      user/assistant transcript message, active workflow untouched),
      `^Claude CLI auth failure is a sanitized visible non-zero exit$` (asserts persisted `runwield.backend_status` with
      `auth_failed`, no raw stderr/secret in the transcript, live error surfaced via the hosted-session sink), and
      `^Claude CLI malformed stream is a typed failure with cleanup$` (asserts `malformed_stream` classification,
      persisted sanitized entry, prompt/MCP temp files removed, bridge closed) in `claude-cli-backend.test.ts`;
      `^Claude CLI root turn abort reaches the subprocess and preserves workflow$` (asserts the fixture logs SIGTERM,
      the turn settles with `canceled`, no assistant message appended, active execution workflow intact) and
      `^Claude CLI missing terminal signal leaves workflow waiting like Pi$` (asserts no terminal outcome, assistant
      message persisted, workflow still active) and
      `^Claude CLI post-terminal output stays display-only after accepted signal$` (asserts accepted completion outcome
      reads true, post-terminal prose is in the persisted assistant message, no mismatch error) in
      `claude-cli-execution.test.ts`; `^projection replays Claude backend failure entries as display-only status$`
      (asserts `createReplayEvents` yields a `SYSTEM_STATUS` event with level `error`/`warning` from the entry and
      `getCommittedTranscriptAuthorityFacts` is unchanged) in `session-transcript-projection.test.js`; and an
      abort-unwrap test in `abort-active-session.test.js`.
- [ ] Existing Pi abort, steering, active workflow preservation, validation continuation, and transcript projection
      behavior is protected: `session-runtime.test.js`, `abort-active-session.test.js`, `active-agent-session.test.js`,
      `session-transcript-projection.test.js`, and `workflow-mcp-bridge.test.ts` still pass with no new seams added to
      RunWield-owned machinery.

## Verification Plan

- Automated named failure tests:
  `deno run -A scripts/run-tests.js src/shared/session/backends/claude-cli/claude-cli-backend.test.ts`
- Automated vertical continuation tests:
  `deno run -A scripts/run-tests.js src/shared/session/claude-cli-execution.test.ts`
- Automated projection and regression:
  `deno run -A scripts/run-tests.js src/shared/session/session-transcript-projection.test.js src/shared/session/session-runtime.test.js src/shared/session/abort-active-session.test.js src/shared/session/active-agent-session.test.js`
- Automated bridge regression:
  `deno run -A scripts/run-tests.js src/shared/session/backends/claude-cli/workflow-mcp-bridge.test.ts src/shared/workflow/validation-loop-review.test.js`
- Type gate: `deno task check` must pass. `deno task ci` and `deno task seams:check` are currently failing on `main`
  from pre-existing unrelated drift in `src/cmd/*` and `src/shared/work-records/*` (commit `f96733bf`); this Plan must
  not add seams and must not re-baseline — report the pre-existing drift to the user rather than chasing it.
- Manual (with Claude Code installed): select `claude-cli/sonnet`, cancel a Claude-backed turn with Esc, and confirm the
  `claude` process exits, RunWield stays responsive, the session shows a warning, and the active execution workflow is
  not cleared. Run a Claude-backed Planner question path and confirm RunWield waits for the user reply with no terminal
  workflow movement.
- Expected: every named failure mode produces a sanitized visible status entry persisted to the Session JSONL, replays
  after reload as display-only, and never mutates Plan lifecycle; only an accepted MCP terminal result advances
  workflow; post-terminal prose after acceptance is display-only.
- Behavior protected afterwards: Pi-backed abort, steering, workflow validation, active execution workflow ownership,
  and transcript projection continue to pass; the MCP bridge's rejected-call and accepted-terminal semantics are
  unchanged.
- Behavior expected to stop existing: Claude backend failures no longer collapse into ambiguous generic errors or
  accidental lifecycle completion; a successful accepted `task_completed`/`review_complete` can no longer be followed by
  a result-mismatch terminal error; a root Claude turn is no longer un-cancellable.

### Objective-Failing Checks

Each check combines a production usage-site marker (absent today, requiring the real wiring to exist at the place that
matters) with a behavioral named test (which must exercise the real stack per the Implementation Steps; an empty body
cannot satisfy the step or pass review). Each command is red on the unmodified tree: the marker string does not exist
today and the named test does not exist today.

- `OC1` —
  `bash -lc 'set -euo pipefail; grep -q "runwield.backend_status" src/shared/session/backends/claude-cli/execution-session.ts; out=$(deno run -A scripts/run-tests.js --filter "^Claude CLI missing executable fails before workflow mutation$" src/shared/session/backends/claude-cli/claude-cli-backend.test.ts 2>&1); printf "%s\n" "$out"; printf "%s\n" "$out" | grep -Eq "1 passed \\| 0 failed"'`
  — the turn code persists the status entry and the named test proves a missing `claude` produces a typed, visible,
  pre-transcript failure while workflow is untouched.
- `OC2` —
  `bash -lc 'set -euo pipefail; grep -q "AbortSignal.any" src/shared/session/backends/claude-cli/execution-session.ts; out=$(deno run -A scripts/run-tests.js --filter "^Claude CLI abort cancels the subprocess and preserves active workflow$" src/shared/session/backends/claude-cli/claude-cli-backend.test.ts 2>&1); printf "%s\n" "$out"; printf "%s\n" "$out" | grep -Eq "1 passed \\| 0 failed"'`
  — the abort controller is actually combined with the spawn signal and the named test proves cancellation kills the
  subprocess, records `canceled`, and preserves active workflow.
- `OC3` —
  `bash -lc 'set -euo pipefail; grep -q "isTerminalAccepted" src/shared/session/backends/claude-cli/stream-parser.ts; out=$(deno run -A scripts/run-tests.js --filter "^Claude CLI post-terminal output stays display-only after accepted signal$" src/shared/session/claude-cli-execution.test.ts 2>&1); printf "%s\n" "$out"; printf "%s\n" "$out" | grep -Eq "1 passed \\| 0 failed"'`
  — the parser consumes the terminal-authority gate and the named vertical test proves extra prose after an accepted
  terminal signal is display-only, not an error.
- `OC4` —
  `bash -lc 'set -euo pipefail; grep -q "runwield.backend_status" src/shared/session/session-transcript-projection.js; out=$(deno run -A scripts/run-tests.js --filter "^projection replays Claude backend failure entries as display-only status$" src/shared/session/session-transcript-projection.test.js 2>&1); printf "%s\n" "$out"; printf "%s\n" "$out" | grep -Eq "1 passed \\| 0 failed"'`
  — the projection references the persisted status entry type and the named test proves replay is display-only and never
  becomes lifecycle authority.

## Edge Cases & Considerations

- **Stdin broken-pipe masking:** a child that exits before reading stdin must not hide the real exit code; `completed`
  resolves from `child.status` directly and stdin write rejection is swallowed.
- **No result after acceptance:** if the child is killed or exits right after an accepted terminal call, the parser must
  not throw "ended without a terminal result"; it returns the visible text with zero usage.
- **Malformed JSON after acceptance:** still a real `malformed_stream` error; only the terminal-result invariants relax
  after acceptance.
- **Cancellation is not a lifecycle move:** `runwield.backend_status` kind `canceled` is a warning-level display entry;
  the active execution workflow stays intact unless the normal workflow cancellation path clears it.
- **Missing terminal signal is not success:** the assistant message persists, the workflow stays active, and the
  existing agent-stopped attention lets the user respond exactly like a Pi turn; no prose or sentinel text ever advances
  workflow, and no auto-reminder loop is added.
- **Secrets:** persisted metadata and the live error message never contain environment variables, argv, prompt text,
  tokens, URLs, or raw stderr; the auth-failure message is fixed guidance and the non-zero-exit message is bounded and
  sanitized.
- **Pre-existing seams drift:** `deno task seams:check`/`ci` fail on `main` from unrelated `src/cmd/*` and
  `src/shared/work-records/*` modules; this Plan's gates are targeted test runs plus `deno task check`, and
  re-baselining is prohibited.
- **External-boundary seams only:** subprocess and MCP loopback are genuine boundaries; the existing process port and
  real MCP client fixture remain; no `__deps`/`__testDeps` seams are added to Session, Plan lifecycle, validation, or
  transcript authorities.
