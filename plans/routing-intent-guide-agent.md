---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add Guide/Ideator routing intents and route non-materializing conversations away from Operator."
affectedPaths:
    - "CONTEXT.md"
    - "src/constants.js"
    - "src/tools/triage-report.js"
    - "src/agent-definitions/router.md"
    - "src/agent-definitions/guide.md"
    - "src/shared/workflow/orchestrator.js"
    - "src/shared/session/agents.js"
    - "src/agent-definitions/*.md"
    - "src/shared/workflow/orchestrator.test.js"
    - "src/shared/session/__tests__/session-tools-policy.test.js"
createdAt: "2026-06-18T00:00:00.000Z"
status: "draft"
---

# Routing Intent and Guide Agent

## Context

Harns currently routes informational questions through `QUICK_FIX -> Operator`, which makes non-materializing work look
like execution work and pressures the conversation toward `task_completed`. The new model uses one broadened Triage enum
named **Routing Intent**: `INQUIRY | IDEATION | QUICK_FIX | FEATURE | PROJECT`.

## Objective

Add a read-mostly **Guide** Agent and route non-materializing conversations to Guide or Ideator instead of Operator:

- `INQUIRY` -> Guide
- `IDEATION` -> Ideator
- `QUICK_FIX` -> Operator
- `FEATURE` -> Planner
- `PROJECT` -> Architect

Keep Plan Front Matter `classification` for Plan-producing work (`FEATURE | PROJECT`) and avoid introducing a separate
routing/classification map.

## Approach

Update triage around `routingIntent` as the single routing field. Preserve compatibility where useful by reading legacy
`classification` values from older tests/tool results, but new Router output and internal names should prefer
`routingIntent`.

Guide should be a user-facing, read-mostly Agent. It can explore code, docs, and memory; answer direct questions;
discuss ideas casually; and call `return_to_router` when the conversation becomes actionable or better suited to
Operator, Planner, Architect, or Ideator. It must not have edit/write/materialization tools.

## Files to Modify

- `CONTEXT.md` — already updated with Routing Intent, Guide, Ideator, Return-to-Router, and Plan Classification
  terminology.
- `src/constants.js` — replace/extend triage constants with
  `ROUTING_INTENTS = ["INQUIRY", "IDEATION", "QUICK_FIX", "FEATURE", "PROJECT"]`; keep Plan classification compatibility
  where needed.
- `src/tools/triage-report.js` — accept `routingIntent`; update labels/descriptions; optionally tolerate legacy
  `classification` when reading results.
- `src/agent-definitions/router.md` — describe the five Routing Intents and route explicit
  ideation/interview/research/PRD requests to Ideator, fallback non-materializing requests to Guide.
- `src/agent-definitions/guide.md` — new read-mostly Agent Definition.
- `src/shared/workflow/orchestrator.js` — dispatch by Routing Intent to Guide, Ideator, Operator, Planner, or Architect.
- `src/shared/session/agents.js` — add Guide attention nudge if useful.
- `src/agent-definitions/*.md` — expose `return_to_router` and out-of-scope verbiage for user-facing Agents only;
  exclude Init, Slicer, and Reviewer workflow prompts.
- Tests near workflow/session/tool policy — update expected Routing Intent behavior and add Guide/Ideator dispatch
  coverage.

## Reuse Opportunities

- `src/shared/workflow/orchestrator.js::dispatchPostTriage` — existing dispatch point for Router tool results.
- `src/tools/triage-report.js` — existing Custom Tool should evolve instead of adding another tool.
- `src/shared/session/session.js::resolveEffectiveSessionToolNames` — already gates `return_to_router` by runtime
  option.
- Existing read-mostly tool sets in `router.md`/`ideator.md` — useful basis for Guide tools.

## Implementation Steps

- [ ] Add `AGENTS.GUIDE = "guide"` and a bundled `src/agent-definitions/guide.md` with read/code/doc/memory tools plus
      `return_to_router`; no edit/write/multi_file_edit/task_completed/plan_written.
- [ ] Change triage constants/tool schema to use `routingIntent` with the five values; keep compatibility for existing
      `classification` reads where low-risk.
- [ ] Update Router prompt: `INQUIRY` for direct questions/general help, `IDEATION` only for explicit ideation signals,
      `QUICK_FIX` for small materializing work, `FEATURE`/`PROJECT` for Plan-producing work.
- [ ] Update `dispatchPostTriage` to route `INQUIRY -> Guide` and `IDEATION -> Ideator` without expecting
      `task_completed`, Plan creation, execution, or validation.
- [ ] Keep `QUICK_FIX -> Operator` behavior unchanged, including `task_completed` expectation and no workflow
      validation.
- [ ] Keep `FEATURE -> Planner` and `PROJECT -> Architect` behavior unchanged except for consuming `routingIntent`
      instead of `classification` in triage metadata.
- [ ] Add/normalize `return_to_router` in user-facing Agent Definitions with concise scope-boundary instructions; do not
      add it to Init, Slicer, or Reviewer workflow prompts.
- [ ] Update tests for triage schema, dispatch routing, Guide tool policy, and backward-compatible legacy
      `classification` handling if retained.

## Verification Plan

- Automated: run `deno run ci` and fix all issues.
- Manual: ask Router “where is model routing configured?” and confirm it routes to Guide, answers directly, and does not
  call `task_completed`.
- Manual: ask Router “grill me on adding a new provider” and confirm it routes to Ideator.
- Manual: ask Router for a small edit and confirm `QUICK_FIX -> Operator` still works.
- Manual: ask Router for a plan-sized feature and confirm `FEATURE -> Planner` still writes Plan Front Matter with
  `classification: FEATURE`.

## Edge Cases & Considerations

- Avoid letting `INQUIRY` or `IDEATION` leak into Plan Front Matter `classification`.
- Guide should not silently implement when a conversation becomes actionable; it should call `return_to_router` with a
  self-contained handoff.
- Router should prefer Guide over Ideator unless the user explicitly asks for ideation, grilling, research, option
  analysis, or PRD synthesis.
- Existing tests and code may still refer to `classification`; either migrate carefully or support legacy reads during
  transition.
