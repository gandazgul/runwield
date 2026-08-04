---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Expose the RunWield workflow terminal signals to Claude Code through a thin MCP bridge that delegates to existing `plan_written`, `task_completed`, and `review_complete` machinery. This makes lifecycle movement authoritative through tool calls rather than Claude prose parsing."
affectedPaths:
    - "src/shared/session/backends/claude-cli/"
    - "src/tools/plan-written.ts"
    - "src/tools/task-completed.js"
    - "src/tools/review-complete.js"
    - "src/shared/session/workflow-messages.js"
    - "src/shared/session/session-runtime.js"
    - "src/tools/__tests__/plan-written.test.js"
    - "src/tools/task-completed.test.js"
    - "src/tools/review-complete.test.js"
executionAgent: "engineer"
createdAt: "2026-08-03T18:20:03.232Z"
updatedAt: "2026-08-03T18:20:03.232Z"
origin: "internal"
parentPlan: "claude-cli-execution-backend"
order: 3
dependencies:
    - "02-add-claude-cli-backend-transcript-tracer-bullet"
status: "validated_reviewer"
---

# Bridge Claude Workflow Signals Through MCP

## Context

The Claude CLI backend can execute a selected turn and persist visible transcript output, but RunWield lifecycle truth
must not come from final prose or sentinel text. The Epic requires a small workflow bridge: Claude Code calls MCP tools
named for RunWield workflow signals, and those tools delegate to existing RunWield tool machinery that already validates
and records lifecycle outcomes.

## Objective

Add a Claude CLI MCP workflow bridge that exposes only the supported terminal workflow signal tools for MVP and
delegates calls to the existing `plan_written`, `task_completed`, and `review_complete` execution paths or shared
factored functions. The bridge must not directly edit Plan status, active workflow state, validation ledgers, or review
results.

## Approach

Factor existing tool execution only where necessary so Pi custom tools and MCP bridge tools share the same authoritative
logic. Keep the MCP layer thin: adapt MCP parameters to the existing tool definitions, pass the same hosted
session/workflow context, return tool results to Claude Code, and let existing RunWield machinery emit visible workflow
messages and lifecycle outcomes.

The Claude CLI backend should pass an MCP config that exposes only these workflow signal tools for MVP. Production code
should not parse prose markers such as `RUNWIELD_SIGNAL` as lifecycle authority.

## Files to Modify

- `src/shared/session/backends/claude-cli/` — add MCP config generation, bridge startup/integration, and terminal signal
  handling policy for Claude CLI runs.
- `src/tools/plan-written.ts` — expose or factor shared execution behavior so MCP delegation uses the same validation
  and review/approval path as the Pi tool.
- `src/tools/task-completed.js` — expose or factor shared execution behavior so MCP delegation preserves active workflow
  owner checks and completion recording.
- `src/tools/review-complete.js` — expose or factor shared execution behavior so MCP delegation preserves structured
  review validation.
- `src/shared/session/workflow-messages.js` — preserve existing user-visible workflow display entries emitted by
  delegated tools.
- `src/shared/session/session-runtime.js` — consume terminal MCP outcomes in the same workflow continuation path used by
  Pi tool results.
- `src/tools/__tests__/plan-written.test.js` — prove MCP delegation preserves Plan validation behavior.
- `src/tools/task-completed.test.js` — prove MCP delegation preserves active workflow owner and execution-start checks.
- `src/tools/review-complete.test.js` — prove MCP delegation preserves rejection of approval with unresolved findings.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/tools/plan-written.ts` — reuse `createPlanWrittenTool` behavior or shared factored execution so Plan
  review/approval logic stays centralized.
- `src/tools/task-completed.js` — reuse `createTaskCompletedTool` behavior or shared factored execution so active
  workflow checks stay centralized.
- `src/tools/review-complete.js` — reuse `createReviewCompletedTool` behavior or shared factored execution so structured
  review semantics stay centralized.
- `src/shared/session/workflow-messages.js` — reuse workflow projection messages instead of creating backend-specific
  display state.
- `src/shared/session/session-runtime-events.js` — reuse normalized workflow/runtime events for tool-call display and
  completion.

## Implementation Steps

- [ ] The Claude CLI backend passes an MCP configuration that exposes only RunWield workflow-signal tools needed for
      MVP: planning completion, task completion, and review completion.
- [ ] MCP implementations delegate to existing `plan_written`, `task_completed`, and `review_complete` machinery or
      shared factored functions; no MCP implementation directly edits Plan front matter, active workflow state,
      validation evidence, review ledgers, or Work Records.
- [ ] The first accepted terminal MCP workflow signal is treated as authoritative for the turn, and its result is
      recorded through normal RunWield workflow/session mechanisms.
- [ ] Rejected MCP tool calls return structured feedback to Claude without moving lifecycle state, matching existing Pi
      custom tool behavior.
- [ ] Production code contains no prose/sentinel parser that treats final Claude text such as `RUNWIELD_SIGNAL` as
      lifecycle authority when the MCP bridge is available.
- [ ] Existing Pi custom tools still behave the same because they share the same execution logic or retain their
      existing implementation path.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/tools/__tests__/plan-written.test.js src/tools/task-completed.test.js src/tools/review-complete.test.js`
- Automated: targeted Claude backend MCP bridge tests under `src/shared/session/backends/claude-cli/` using an
  in-process or stdio fixture rather than real Claude Code.
- Automated: targeted workflow/session-runtime tests proving a Claude MCP `task_completed` result advances through the
  same continuation semantics as Pi-backed completion.
- Manual: with Claude Code installed, run a Planner turn that writes a small Plan through the MCP `plan_written` bridge
  and confirm normal review/approval behavior follows.
- Manual: run a Reviewer turn that calls `review_complete` with unresolved findings and confirm approval is rejected
  until findings are resolved.
- Expected: lifecycle movement happens only through accepted MCP tool calls that reused existing RunWield tool
  machinery.
- Behavior protected afterwards: `task_completed` still rejects wrong workflow owners and pre-execution completion;
  `review_complete` still rejects approval with unresolved findings; `plan_written` still validates Plan requirements.
- Behavior expected to stop existing: Claude-backed workflow completion is no longer limited to non-terminal final
  assistant text.

### Objective-Failing Checks

- `OC1` —
  `deno run -A scripts/run-tests.js src/tools/__tests__/plan-written.test.js src/tools/task-completed.test.js src/tools/review-complete.test.js`
  — proves shared/delegated workflow tool behavior remains authoritative.
- `OC2` —
  `test -d src/shared/session/backends/claude-cli && ! grep -R "RUNWIELD_SIGNAL" -n src/shared/session/backends/claude-cli src/shared/session/session.js src/shared/session/session-runtime.js`
  — proves the production Claude backend is not using sentinel prose as lifecycle authority.

## Execution Policy

This child is Engineer-owned and can run autonomously. It has no browser-rendered UI outcome.

## Edge Cases & Considerations

- `plan_written` can return review feedback requiring revision; the bridge should return that feedback to Claude where
  the Claude CLI/MCP protocol allows it.
- Claude may emit extra output after a terminal signal; the backend must have a deterministic policy, with deeper
  hardening in the next child.
- Do not bridge `user_interview` or `delegate_agent` into Claude for MVP; questions remain plain text and delegation
  remains Claude-owned.
- Lifecycle transitions remain RunWield-owned protected state and must be tested through real fixtures and existing tool
  entry points.
