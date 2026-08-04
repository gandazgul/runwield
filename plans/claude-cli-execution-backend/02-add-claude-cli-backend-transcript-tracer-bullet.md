---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Introduce the first Claude CLI execution backend path: selected `claude-cli/*` turns reach a fakeable subprocess runner, do not instantiate Pi `AgentSession`, and persist/replay RunWield-owned transcript entries. This slice intentionally excludes lifecycle terminal signal handling."
affectedPaths:
    - "src/shared/session/session.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/root-session.js"
    - "src/shared/session/session-transcript-projection.js"
    - "src/shared/session/backends/claude-cli/"
    - "src/shared/session/session-prompt.test.js"
    - "src/shared/session/session-transcript-projection.test.js"
    - "src/shared/session/root-session.test.js"
executionAgent: "engineer"
createdAt: "2026-08-03T18:20:03.227Z"
updatedAt: "2026-08-03T18:20:03.227Z"
origin: "internal"
parentPlan: "claude-cli-execution-backend"
order: 2
dependencies:
    - "01-register-claude-cli-backend-models"
status: "ready_for_work"
---

# Add Claude CLI Backend Transcript Tracer Bullet

## Context

After `claude-cli/*` model references are selectable, RunWield needs a vertical runtime path that proves a Claude-backed
turn can execute outside Pi while RunWield still owns the durable Session Transcript. The Epic's architectural seam is
around agent-session construction and prompt execution: Claude CLI should replace only the model/tool-loop execution
path for selected turns, not SessionManager, lifecycle tools, or replay authority.

This child is the runtime tracer bullet. It should persist visible user/assistant output and backend metadata, but it
should not yet treat workflow terminal signals as authoritative.

## Objective

Add a Claude CLI execution backend path that shells out to `claude -p` for selected `claude-cli/*` turns through a
narrow, fakeable subprocess boundary, avoids Pi `AgentSession` instantiation for those turns, appends RunWield-owned
transcript entries under the normal Session JSONL location, and replays the same user-visible output through existing
projection.

## Approach

Introduce a small execution-backend abstraction around the point where `session.js` currently resolves the model and
builds a Pi `AgentSession`. The Pi-backed path should remain the default and continue using existing session
construction, event subscribers, compaction, image handling, temperature, and tool behavior.

For Claude CLI, reuse agent definition loading and final system prompt assembly, then call a narrow backend module under
`src/shared/session/backends/claude-cli/`. The backend should construct sanitized `claude -p` command metadata, append
RunWield role instructions to Claude Code's default system prompt behavior, persist only RunWield-owned
user/assistant/workflow-visible entries, and treat Claude Code's own transcript/session id as metadata at most.

## Files to Modify

- `src/shared/session/session.js` — introduce or consume execution-backend selection while preserving the existing
  Pi-backed build/run path.
- `src/shared/session/session-runtime.js` — route root and supported isolated turns through the selected backend without
  breaking active-agent and steering semantics.
- `src/shared/session/root-session.js` — provide any helper needed to append Claude-backed RunWield transcript entries
  while retaining SessionManager ownership.
- `src/shared/session/session-transcript-projection.js` — project Claude-backed persisted user/assistant entries into
  the same replay model as existing transcripts.
- `src/shared/session/backends/claude-cli/` — new narrow backend modules for subprocess command construction,
  stream/final-result parsing, and sanitized metadata.
- `src/shared/session/session-prompt.test.js` — prove backend selection reaches Claude for `claude-cli/*` and Pi for
  existing provider models.
- `src/shared/session/session-transcript-projection.test.js` — prove Claude-backed entries replay as normal user-visible
  messages.
- `src/shared/session/root-session.test.js` — prove RunWield Session JSONL remains the persistence authority.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session.js` — reuse agent definition loading, configured model/thinking resolution, final prompt
  assembly, and debug/status conventions.
- `src/shared/session/root-session.js` — reuse SessionManager-backed JSONL location and append-only behavior.
- `src/shared/session/session-transcript-projection.js` — reuse ordinary assistant message replay and custom workflow
  display projections.
- `src/shared/session/session-runtime-events.js` — reuse normalized runtime event types for visible assistant text,
  status, and errors.
- `src/shared/models/model-registry.js` — use the backend metadata introduced by the first child to select Claude CLI
  execution.

## Implementation Steps

- [ ] Runtime backend selection is based on resolved model/backend metadata, not agent name, so `claude-cli/*` reaches a
      Claude backend and existing Pi/provider selections still reach `createAgentSession`.
- [ ] Claude CLI command construction uses `claude -p`, selected model/alias, append-system-prompt behavior, sanitized
      metadata, and no RunWield reliance on Claude `--resume` for MVP.
- [ ] The Claude subprocess boundary is narrow and fixture-friendly; automated tests do not require a real Claude
      installation.
- [ ] A Claude-backed root turn appends RunWield-owned Session JSONL entries under the existing session directory and
      does not read Claude Code transcript files for replay or lifecycle truth.
- [ ] `loadSession` / transcript projection replays Claude-backed user-visible messages as ordinary RunWield session
      output.
- [ ] Existing Pi-backed behavior remains the default and still uses Pi `AgentSession`, Pi event subscriptions, RunWield
      custom tools, image fallback, compaction, temperature handling, and existing SessionManager persistence.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/shared/session/session-prompt.test.js src/shared/session/session-transcript-projection.test.js src/shared/session/root-session.test.js`
- Automated:
  `deno run -A scripts/run-tests.js src/shared/session/session-runtime.test.js src/shared/session/session-subscribers.test.js src/shared/session/image-attachments.test.js src/shared/session/session-temperature.test.js`
- Manual: with Claude Code installed and authenticated, configure a non-terminal Claude CLI Planner turn that returns
  final text, then reload the RunWield session and confirm the same visible messages replay without reading Claude
  Code's transcript.
- Expected: `claude-cli/*` execution reaches the Claude backend fixture and Pi-backed models still instantiate Pi
  `AgentSession`.
- Expected: Claude internal file/Bash/tool activity is not projected as native RunWield tool events in this MVP slice.
- Behavior protected afterwards: Pi-backed agent turns, compaction, image fallback, subscribers, and SessionManager
  persistence continue to work.
- Behavior expected to stop existing: selected `claude-cli/*` turns no longer try to execute through Pi's
  `createAgentSession` path.

### Objective-Failing Checks

- `OC1` — `deno run -A scripts/run-tests.js src/shared/session/session-prompt.test.js` — proves backend selection
  branches Claude CLI away from Pi execution while preserving Pi behavior.
- `OC2` —
  `deno run -A scripts/run-tests.js src/shared/session/session-transcript-projection.test.js src/shared/session/root-session.test.js`
  — proves Claude-backed turns persist and replay through RunWield-owned transcript entries.

## Execution Policy

This child is Engineer-owned and can run autonomously. It has no browser-rendered UI outcome.

## Edge Cases & Considerations

- Missing workflow terminal signals are not completion in this child; they are recorded as assistant text and handled by
  later signal/failure-hardening work.
- Do not map Claude internal file/Bash/edit activity into RunWield native tool events for MVP.
- Do not persist secrets, full environment variables, API tokens, or raw Claude settings payloads in Session JSONL.
- Avoid adding seams to RunWield-owned lifecycle/session modules; the subprocess boundary is the legitimate fakeable
  boundary.
