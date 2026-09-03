---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/session/execution-backend.ts"
    - "src/shared/session/session.js"
    - "src/shared/session/agent-handler.ts"
    - "src/shared/session/backends/agy-cli/"
    - "src/shared/session/agy-cli-execution.test.ts"
    - "src/shared/session/session-transcript-projection.test.js"
    - "src/shared/session/root-session.test.js"
    - "docs/domain-language.md"
executionAgent: "engineer"
createdAt: "2026-08-23T20:02:05.462Z"
status: "draft"
origin: "internal"
parentPlan: "agy-cli-execution-backend"
order: 3
dependencies:
    - "02-register-agy-cli-backend-models"
planId: "595d0348-5882-4ee2-b2a4-d0b7a12d0128"
targetBranch: "feature/agy-cli-execution-backend"
---

# Add Agy CLI Backend Transcript Tracer Bullet

## Context

The model registry can now identify `agy-cli/*` as an Execution Backend reference. The next useful slice is a true
runtime tracer bullet: selected Antigravity-backed root and HostedSession-backed isolated turns execute through
`agy -p`, not Pi, while RunWield still owns Session Transcript and workflow truth.

This child deliberately does not add lifecycle completion tools. Without MCP parity, Antigravity output can be stored as
assistant text, but it cannot approve Plans, complete execution, or finish Semantic Review.

## Objective

Make selected `agy-cli/*` Agent turns execute through an `AgyCliExecutionSession` instead of Pi. The backend must select
a RunWield-controlled global custom agent, call `agy -p --agent <agent> --output-format stream-json` without a shell,
stream assistant text through existing runtime events, and persist one RunWield-owned final assistant message plus
sanitized backend metadata in the normal Session Transcript.

## Approach

Extend the existing backend-dispatch boundary used by Pi and Claude. Keep Pi sessions as Pi sessions. Add an Antigravity
execution-session object with only the capabilities RunWield callers need: run one turn, expose accumulated RunWield
messages, emit runtime events, abort or dispose, and write transcript entries through the supplied SessionManager.

The command path should look like this:

```text
resolved agy-cli model
  -> build AgyCliExecutionSession
  -> verify/materialize RunWield custom agent
  -> agy -p --agent <name> --output-format stream-json
  -> stream text deltas
  -> append RunWield user/final-assistant/backend metadata
```

The option set aside is reusing the Claude parser or prompt-file mechanism directly. Antigravity has different events
and a different instruction boundary, so separate modules are clearer and safer.

## Files to Modify

- `src/shared/session/execution-backend.ts` — include `AgyCliExecutionSession` in the backend abstraction.
- `src/shared/session/session.js` — route selected `agy-cli/*` models through the new backend and preserve Pi/Claude
  paths.
- `src/shared/session/agent-handler.ts` — use backend-neutral message access where needed.
- `src/shared/session/backends/agy-cli/` — add command, process, stream parser, execution session, custom-agent use, and
  test fixtures.
- `src/shared/session/agy-cli-execution.test.ts` — cover root and isolated vertical turns.
- `src/shared/session/session-transcript-projection.test.js` and `src/shared/session/root-session.test.js` — prove
  persisted Antigravity entries replay from RunWield transcript data.
- `docs/domain-language.md` — update only if Execution Backend wording needs Antigravity in the examples now that normal
  execution exists.

## Reuse Opportunities

- `src/shared/session/backends/claude-cli/execution-session.ts` — reuse the lifecycle shape of a backend-owned turn.
- `src/shared/session/backends/claude-cli/process.ts` — reuse subprocess fixture patterns at the real external boundary.
- `src/shared/session/session-transcript-projection.js` — reuse normal user/assistant/model/backend projection behavior.
- `src/shared/session/session.js` — reuse Agent Definition loading, model resolution, steering metadata, and prompt
  assembly where backend-neutral.

## Implementation Steps

- [ ] `buildExecutionSession` or the equivalent composition point routes only resolved `agy-cli/*` models to
      `AgyCliExecutionSession`; Pi and Claude behavior remain unchanged.
- [ ] `AgyCliExecutionSession` invokes `agy` directly, never through a shell command string, and does not use
      `--dangerously-skip-permissions`.
- [ ] Antigravity stream parsing produces live assistant text and a final assistant message from `stream-json` events.
- [ ] Durable root turns append RunWield-owned user, assistant, model/backend metadata, and safe status entries under
      the normal Session directory; Antigravity conversation IDs are metadata only.
- [ ] In this child, no assistant prose or text marker can move Plan lifecycle or workflow state.
- [ ] The glossary update, if needed, lands with the runtime behavior that makes it true.

## Verification Plan

- Automated: focused backend and vertical tests through
  `deno run -A scripts/run-tests.js src/shared/session/backends/agy-cli/agy-cli-backend.test.ts src/shared/session/agy-cli-execution.test.ts`.
- Automated: transcript projection and root-session tests touched by this slice.
- Automated: `deno task seams:check` and `deno task check`.
- Manual: with authenticated `agy`, run one controlled non-terminal Agent turn and confirm RunWield replays the final
  assistant text without reading Antigravity logs.
- Expected result: `agy-cli/*` can execute a normal non-terminal Agent turn through Antigravity, but lifecycle
  completion still waits for the MCP child.

## Edge Cases & Considerations

- Missing or drifted custom-agent definitions should fail before workflow mutation.
- Antigravity internal logs and conversation IDs are metadata only.
- Image delivery, subagents, and internal tool transcript parity remain out of scope unless needed for the tracer
  bullet.
- Tests must not require a real `agy` install in the normal suite.
