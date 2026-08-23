---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Expose RunWield lifecycle completion tools to Antigravity through a narrow MCP bridge and prove accepted tool results, not assistant prose, are the only workflow authority. This slice also proves the Antigravity MCP and permission policy needed for parity."
affectedPaths:
    - "src/shared/session/backends/agy-cli/"
    - "src/shared/session/session.js"
    - "src/tools/plan-written.js"
    - "src/tools/task-completed.js"
    - "src/tools/review-complete.js"
    - "src/shared/workflow/validation.ts"
    - "src/shared/workflow/validation-helpers.ts"
    - "src/shared/session/agy-cli-execution.test.ts"
    - "src/shared/workflow/validation-loop-review.test.js"
executionAgent: "engineer"
createdAt: "2026-08-23T20:02:05.471Z"
updatedAt: "2026-08-23T20:02:05.471Z"
status: "draft"
origin: "internal"
parentPlan: "agy-cli-execution-backend"
order: 4
dependencies:
    - "03-add-agy-cli-backend-transcript-tracer-bullet"
---

# Bridge Agy Workflow Signals Through MCP

## Context

The transcript tracer bullet can run Antigravity-backed turns and persist assistant text, but RunWield workflow truth
cannot come from prose. Planner, Engineer, and Reviewer completion must cross a structured tool boundary that delegates
to existing RunWield authorities.

Antigravity MCP setup is not the same as Claude's additive `--mcp-config`. The Epic notes global and workspace
`.agents/mcp_config.json` plus `agy mcp` commands, and the permission model must be proven rather than guessed.

## Objective

Expose eligible RunWield lifecycle tools to `agy-cli` turns through a narrow MCP bridge: `runwield_plan_written`,
`runwield_task_completed`, and `runwield_review_complete`. Each accepted call must delegate to the existing Custom Tool
implementation and become the only terminal workflow signal. Rejected calls, assistant text, and sentinel-like prose
must not advance lifecycle state.

## Approach

Add an Antigravity-owned MCP integration under `src/shared/session/backends/agy-cli/`. It should reuse the existing
RunWield workflow tool definitions, schemas, owner checks, and result handling. The bridge should be per-turn or
otherwise bounded so it does not leave stale configuration or tokens behind.

First prove the actual Antigravity MCP load path and permission behavior with fixtures and, where needed, a live manual
check. Prefer workspace-local or per-run configuration if Antigravity loads it reliably; if global config mutation is
required, require explicit user approval and namespaced ownership.

The option set aside is parsing final text for markers such as `RUNWIELD_SIGNAL`. That would be easier but would make
lifecycle state depend on prose.

## Files to Modify

- `src/shared/session/backends/agy-cli/` — add the MCP bridge, config materialization, permission policy, prompt
  appendix, bridge result recording, and tests.
- `src/shared/session/session.js` — pass only Agent-eligible lifecycle tool definitions to the Antigravity backend.
- `src/tools/plan-written.js`, `src/tools/task-completed.js`, and `src/tools/review-complete.js` — reuse or factor
  existing tool execution only if needed; do not duplicate lifecycle mutation logic.
- `src/shared/workflow/validation.ts` and `src/shared/workflow/validation-helpers.ts` — add only the backend-specific
  validation policy that is truly needed, such as trusted opaque review inspection.
- `src/shared/session/agy-cli-execution.test.ts` — cover the end-to-end MCP lifecycle path.
- `src/shared/workflow/validation-loop-review.test.js` — protect Reviewer semantics if Antigravity internal inspection
  cannot be projected as native `review_diff` evidence.

## Reuse Opportunities

- `src/shared/session/backends/claude-cli/workflow-mcp-bridge.ts` — reuse the bridge ownership model and test ideas, but
  do not assume Claude command/config flags.
- `src/tools/plan-written.js` — delegate Plan writing and review to the existing tool authority.
- `src/tools/task-completed.js` — delegate execution completion to existing owner checks and outbox behavior.
- `src/tools/review-complete.js` — delegate Semantic Review result validation to existing logic.
- `@modelcontextprotocol/sdk` usage from the Claude bridge — reuse if it fits Antigravity's MCP transport.

## Implementation Steps

- [ ] `agy-cli` turns expose only the lifecycle tools eligible for the active Agent role, with RunWield-owned aliases
      and schemas.
- [ ] Accepted MCP calls delegate to existing RunWield tool definitions and record canonical tool-call/tool-result
      transcript entries.
- [ ] The first accepted terminal result closes or gates the lifecycle bridge so later calls cannot advance workflow
      again.
- [ ] Rejected calls, unauthorized calls, unknown tools, assistant prose, and sentinel-like text do not change Plan
      lifecycle or active workflow state.
- [ ] The chosen Antigravity MCP config/load path is proven by tests or live evidence and does not silently mutate
      global user configuration.
- [ ] Normal `agy-cli` execution avoids `--dangerously-skip-permissions`; any required permission config is explicit,
      least surprising, and covered by tests or setup evidence.

## Verification Plan

- Automated: focused MCP bridge tests through
  `deno run -A scripts/run-tests.js src/shared/session/backends/agy-cli/agy-cli-backend.test.ts src/shared/session/agy-cli-execution.test.ts`.
- Automated: workflow tool and validation tests affected by the bridge.
- Automated: grep or unit checks that production code has no prose/sentinel lifecycle parser for `agy-cli`.
- Automated: `deno task seams:check`.
- Manual: with authenticated `agy`, run a controlled planning or execution turn that calls one RunWield lifecycle tool
  and confirm the Plan state changes only through the accepted MCP result.
- Expected result: Antigravity can complete RunWield workflows through MCP, not prose.

## Edge Cases & Considerations

- Antigravity may require global or workspace config that differs by version; the child must prove the actual load path.
- User MCP servers and RunWield MCP config must not leak secrets or override each other silently.
- Reviewer opaque-inspection policy must be narrow and must not weaken structured findings validation.
- Bridge teardown must happen on success, failure, and cancellation.
