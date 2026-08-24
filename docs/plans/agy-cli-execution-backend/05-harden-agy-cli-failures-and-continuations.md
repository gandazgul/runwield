---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Make Antigravity-backed execution deterministic across missing executable/auth, custom-agent drift, malformed output, non-zero exits, timeout, cancellation, missing terminal signals, and post-terminal output. This slice protects active workflow and transcript replay under failure."
affectedPaths:
    - "src/shared/session/backends/agy-cli/"
    - "src/shared/session/session.js"
    - "src/shared/session/session-transcript-projection.js"
    - "src/shared/session/abort-active-session.test.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/session/session-transcript-projection.test.js"
    - "src/shared/session/agy-cli-execution.test.ts"
executionAgent: "engineer"
createdAt: "2026-08-23T20:02:05.478Z"
updatedAt: "2026-08-23T20:02:05.478Z"
status: "draft"
origin: "internal"
parentPlan: "agy-cli-execution-backend"
order: 5
dependencies:
    - "04-bridge-agy-workflow-signals-through-mcp"
planId: "2ca9527d-ed5c-4a04-b0d3-cc667eb7aa12"
---

# Harden Agy CLI Failures and Continuations

## Context

After execution and MCP parity land, Antigravity-backed turns must survive the normal external-process failure modes.
The Epic calls out missing `agy`, unauthenticated headless mode, invalid or drifted custom agents, malformed stream
JSON, non-zero exits, permission problems, timeout defaults, cancellation, and transcript mismatch.

This child makes those paths deterministic and visible. It should not change RunWield lifecycle authority: accepted MCP
tool results remain authoritative, and failures remain status evidence unless an existing RunWield tool moved lifecycle
state.

## Objective

Harden `agy-cli` execution so every failure and continuation path records sanitized, replayable RunWield status, tears
down subprocess and MCP resources, preserves active workflow truth, and keeps Plan lifecycle state under existing
RunWield authorities.

## Approach

Add an Antigravity backend failure model similar in spirit to the Claude backend, but with Antigravity-specific causes:
missing executable, auth/setup failure, custom-agent missing or drifted, MCP config/load failure, permission denial,
non-zero exit, malformed stream, timeout, cancellation, and unexpected empty result.

Define continuation policy explicitly:

```text
accepted MCP terminal result -> lifecycle decided; later output is display-only
no terminal result required but absent -> persist assistant text and wait for user/continuation
backend/setup failure -> persist sanitized status; do not mutate lifecycle
abort -> kill subprocess and close bridge; preserve active workflow
```

The option set aside is auto-reprompting Antigravity when a terminal signal is missing. Waiting is simpler and safer
because it does not create hidden loops or duplicate lifecycle attempts.

## Files to Modify

- `src/shared/session/backends/agy-cli/` — add failure classification, subprocess teardown, timeout handling,
  cancellation, parser policy, backend status entries, and tests.
- `src/shared/session/session.js` — pass abort signals and preserve active-session behavior for `agy-cli` root turns.
- `src/shared/session/session-transcript-projection.js` — replay Antigravity backend status entries as display-only
  runtime events.
- `src/shared/session/abort-active-session.test.js` — cover cancellation preserving active workflow truth.
- `src/shared/session/session-runtime.test.js` — cover runtime error/status behavior where needed.
- `src/shared/session/session-transcript-projection.test.js` — cover replay of failure/status entries.
- `src/shared/session/agy-cli-execution.test.ts` — cover vertical missing-terminal and post-terminal behavior.

## Reuse Opportunities

- `src/shared/session/backends/claude-cli/failure.ts` — reuse failure taxonomy style and sanitation rules where
  backend-neutral.
- `src/shared/session/backends/claude-cli/execution-session.ts` — reuse abort and finally-cleanup patterns.
- `src/shared/session/session-transcript-projection.js` — reuse display-only status projection conventions.
- Existing active workflow and abort tests — extend behavior through real fixtures rather than adding lifecycle seams.

## Implementation Steps

- [ ] `agy-cli` has a closed, typed failure/status model with sanitized messages for setup, auth, process, parser,
      timeout, permission, MCP, and cancellation failures.
- [ ] Aborting an active `agy-cli` turn kills the subprocess, closes MCP resources, records cancellation status, and
      preserves active workflow truth.
- [ ] Non-zero exits, malformed streams, missing results, and auth/setup failures produce deterministic status entries
      without corrupting Session Transcript or lifecycle state.
- [ ] A missing terminal signal persists assistant text and leaves the Session waiting; it does not complete planning,
      execution, or review.
- [ ] Post-terminal output after an accepted MCP result is display-only and cannot re-open lifecycle.
- [ ] Replay projects `agy-cli` backend status entries as display-only information and never as lifecycle authority.

## Verification Plan

- Automated: focused backend failure tests through
  `deno run -A scripts/run-tests.js src/shared/session/backends/agy-cli/agy-cli-backend.test.ts`.
- Automated: vertical execution, abort, runtime, and transcript projection tests changed by this slice.
- Automated: `deno task check` and `deno task seams:check`.
- Automated: before full backend exposure, run `deno task test` or a broad targeted suite that covers model selection,
  session runtime, workflow, and transcript projection.
- Expected result: external Antigravity failures are visible and recoverable, while RunWield-owned workflow state
  remains correct.

## Edge Cases & Considerations

- Antigravity's default print timeout is short for long implementation turns; this child must set or map a safe explicit
  timeout policy.
- Error messages must not persist secrets, tokens, command environment, or full config payloads.
- Custom-agent repair guidance must avoid silent overwrite of user-owned global files.
- Process cleanup must be reliable even when parsing fails before the child process exits.
