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
updatedAt: "2026-06-19T14:41:31.000Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-06-19T14:41:31.000Z"
---

# Routing Intent and Guide Agent

## Context

Harns currently routes informational questions through `QUICK_FIX -> Operator`. That makes non-materializing work look
like execution work and pressures direct answers toward `task_completed`.

The target model uses one broadened Triage enum named **Routing Intent**:
`INQUIRY | IDEATION | QUICK_FIX | FEATURE | PROJECT`. Plan Front Matter keeps `classification` for Plan-producing work
(`FEATURE | PROJECT`), but routing itself should not use the old user-facing “classification” language.

`CONTEXT.md` already contains the desired glossary terms for Routing Intent, Guide, Ideator, Return-to-Router, and Plan
Classification; implementation should verify those entries remain accurate rather than rewrite them unnecessarily.

## Objective

Add a read-mostly **Guide** Agent and update routing so non-materializing conversations go to Guide or Ideator instead
of Operator:

- `INQUIRY` -> Guide
- `IDEATION` -> Ideator
- `QUICK_FIX` -> Operator
- `FEATURE` -> Planner
- `PROJECT` -> Architect

Keep `QUICK_FIX`, `FEATURE`, and `PROJECT` behavior unchanged except for consuming `routingIntent` instead of routing by
`classification`.

## Approach

Make `routingIntent` the canonical field emitted by `triage_report` and consumed by `dispatchPostTriage`. Keep low-risk
backward compatibility by normalizing legacy `classification` details from older tests/sessions into a `routingIntent`
at read time.

For Plan-producing intents, preserve enough Plan Classification metadata for existing plan lifecycle code: when
`routingIntent` is `FEATURE` or `PROJECT`, the normalized triage metadata may also carry
`classification: "FEATURE" | "PROJECT"` so `plan_written`, validation, and plan front matter continue to work. Do not
ever write `INQUIRY`, `IDEATION`, or `QUICK_FIX` as Plan Front Matter classification.

Guide should be a user-facing, read-mostly Agent. It can explore code, docs, and memory; answer direct questions;
discuss ideas casually; and call `return_to_router` when the conversation becomes actionable or better suited to
Operator, Planner, Architect, or Ideator. It must not have edit/write/materialization tools. Guide should be a
user-facing, read-mostly Agent. It can explore code, docs, and memory; answer direct questions; discuss ideas casually;
and call `return_to_router` when the conversation becomes actionable or better suited to Operator, Planner, Architect,
or Ideator. It must not have edit/write/materialization tools.

## Files to Modify

- `CONTEXT.md` — verify existing glossary entries for Routing Intent, Guide, Ideator, Return-to-Router, and Plan
  Classification; only adjust if they drift from the implementation.
- `src/constants.js` — replace the unused `CLASSIFICATIONS` export with
  `ROUTING_INTENTS = ["INQUIRY", "IDEATION", "QUICK_FIX", "FEATURE", "PROJECT"]`; keep `COMPLEXITIES` unchanged and add
  `AGENTS.GUIDE = "guide"` to the JSDoc shape and frozen object.
- `src/tools/triage-report.js` — change tool params to accept `routingIntent`; update descriptions/UI labels; normalize
  legacy direct calls that still pass `classification`; return details with canonical `routingIntent` and
  plan-compatible `classification` only for `FEATURE`/`PROJECT`.
- `src/tools/__tests__/triage-report.test.js` — update tests for `routingIntent`, add coverage for `INQUIRY`, and
  add/keep legacy `classification` normalization coverage.
- `src/agent-definitions/router.md` — rename classification instructions to Routing Intent, describe all five intents,
  route fallback non-materializing requests to `INQUIRY`, and reserve `IDEATION` for explicit
  ideation/interview/research/PRD signals.
- `src/agent-definitions/guide.md` — add the new read-mostly Guide definition with exploration/memory tools and
  `return_to_router`; exclude edit/write/multi_file_edit/task_completed/plan_written.
- `src/agent-definitions/ideator.md` — add `return_to_router` and scope-boundary wording for actionable
  implementation/planning requests; keep the existing no-implementation and Router-return policy after PRD/synthesis.
- `src/agent-definitions/planner.md` — add `return_to_router` and scope-boundary wording for non-planning or unrelated
  follow-up requests while preserving `plan_written` workflow instructions.
- `src/agent-definitions/architect.md` — add `return_to_router` and scope-boundary wording for non-architecture or
  non-PROJECT follow-up requests while preserving PROJECT/Epic workflow instructions.
- `src/shared/workflow/orchestrator.js` — update `TriageOutcome`, `readLatestTriageOutcome`, `buildTriageBlock`, and
  `dispatchPostTriage` to use normalized Routing Intent; dispatch `INQUIRY` and `IDEATION` as direct root Agent turns
  without `task_completed`, Plan creation, execution, or validation.
- `src/shared/workflow/orchestrator.test.js` — migrate test fixtures to `routingIntent`, keep a legacy `classification`
  read test, add `INQUIRY -> guide` and `IDEATION -> ideator` dispatch tests, and keep QUICK_FIX/FEATURE/PROJECT
  regression tests.
- `src/shared/session/agents.js` — add a Guide attention nudge so long-lived Guide sessions stay read-only and return to
  Router when work becomes actionable.
- `src/shared/session/session-prompt.test.js` — update attention-nudge tests for Guide if a Guide nudge is added.
- `src/shared/session/__tests__/session-tools-policy.test.js` — add coverage that Guide loads with read-only tools plus
  `return_to_router`, and does not expose materialization/completion tools.

## Reuse Opportunities

- `src/shared/workflow/orchestrator.js::dispatchPostTriage` — existing dispatch point for Router tool results.
- `src/tools/triage-report.js` — existing Custom Tool should evolve instead of adding another tool.
- `src/shared/session/session.js::resolveEffectiveSessionToolNames` — already gates `return_to_router` by runtime
  option.
- Existing read-mostly tool sets in `router.md`/`ideator.md` — useful basis for Guide tools. Existing functions,
  modules, or patterns to reuse:

- `src/shared/workflow/orchestrator.js::dispatchPostTriage` — existing dispatch point for Router tool results; extend
  instead of adding a second router path.
- `src/shared/workflow/orchestrator.js::readLatestTriageOutcome` — best place to normalize legacy `classification` tool
  details to canonical `routingIntent`.
- `src/tools/triage-report.js::createTriageReportTool` — evolve the existing custom tool instead of adding a new routing
  tool.
- `src/shared/session/session.js::resolveEffectiveSessionToolNames` — already gates `return_to_router` by runtime
  option; no new tool-gating mechanism is needed.
- Existing read/code/memory tool sets in `router.md` and `ideator.md` — useful basis for Guide’s tool list.
- Existing `return_to_router` wording in `operator.md`, `engineer.md`, `tester.md`, and `doc-writer.md` — copy the
  scope-boundary pattern for Planner/Architect/Ideator/Guide.

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
- [ ] Update constants: add `AGENTS.GUIDE = "guide"`; replace `CLASSIFICATIONS` with `ROUTING_INTENTS`; keep all changes
      in pure JavaScript/JSDoc.
- [ ] Update `createTriageReportTool` to define `routingIntent` with the five Routing Intent values, revise the tool
      description to say Routing Intent, and normalize direct legacy `classification` params inside `execute`.
- [ ] Ensure triage tool details are canonical: always include `routingIntent`; include `classification` only when the
      routing intent is `FEATURE` or `PROJECT` (or when preserving a legacy `QUICK_FIX` test fixture is explicitly
      necessary), so non-plan intents cannot leak into Plan Front Matter.
- [ ] Update Router prompt instructions and examples so the Router calls
      `triage_report({ routingIntent, complexity, summary, affectedPaths })` and never answers the user directly.
- [ ] Add `src/agent-definitions/guide.md` with front matter name/description/tools and body instructions for
      read-mostly answers, code/doc exploration, concise responses, no edits/materialization, and `return_to_router` on
      actionable scope changes.
- [ ] Add `return_to_router` to user-facing agents that currently lack it (`ideator.md`, `planner.md`, `architect.md`)
      with concise “requests outside your scope” guidance. Do not add it to workflow-only Init, Slicer, or Reviewer
      prompts.
- [ ] Update `readLatestTriageOutcome` to return `null` only when neither `routingIntent` nor legacy `classification` is
      present; normalize legacy details to `routingIntent` for downstream code.
- [ ] Update `buildTriageBlock` to print `Routing Intent: ...`; for `FEATURE`/`PROJECT`, also print
      `Plan Classification: ...` or keep a clearly plan-scoped classification line for Planner/Architect compatibility.
- [ ] Update `dispatchPostTriage` to branch by normalized routing intent:
  - [ ] `INQUIRY`: set active Agent to Guide, apply pending root swap, run one root turn with the decorated request, and
        return without checking `task_completed` or validation.
  - [ ] `IDEATION`: set active Agent to Ideator, apply pending root swap, run one root turn with the decorated request,
        and return without checking `task_completed` or validation.
  - [ ] `QUICK_FIX`: keep Operator dispatch and `task_completed` warning behavior unchanged.
  - [ ] `FEATURE`/`PROJECT`: keep planning/approval/execution/validation behavior unchanged, passing plan-compatible
        triage metadata to `runPlanningAgent`, `executePlan`, and validation.
- [ ] Add a Guide attention nudge in `src/shared/session/agents.js` and update the scheduled nudge test if required.
- [ ] Update tests for triage schema/execution, orchestrator dispatch, legacy normalization, Guide tool policy, and
      attention nudges.

## Verification Plan

- Automated: run `deno run ci` and fix all issues.
- Manual: ask Router “where is model routing configured?” and confirm it routes to Guide, answers directly, and does not
  call `task_completed`.
- Manual: ask Router “where is model routing configured?” and confirm it routes to Guide, answers directly, and does not
  call `task_completed`.
- Manual: ask Router “grill me on adding a new provider” and confirm it routes to Ideator.
- Manual: ask Router for a small edit and confirm `QUICK_FIX -> Operator` still works.
- Manual: ask Router for a plan-sized feature and confirm `FEATURE -> Planner` still writes Plan Front Matter with
  `classification: FEATURE`.
- Manual: ask Router for a small edit and confirm `QUICK_FIX -> Operator` still works and still expects
  `task_completed`.
- Manual: ask Router for a plan-sized feature and confirm `FEATURE -> Planner` still writes Plan Front Matter with
  `classification: FEATURE`.
- Manual: from Guide, ask for an actual code change and confirm Guide uses `return_to_router` with a self-contained
  handoff rather than editing.

## Edge Cases & Considerations

- Avoid letting `INQUIRY` or `IDEATION` leak into Plan Front Matter `classification`.
- Guide should not silently implement when a conversation becomes actionable; it should call `return_to_router` with a
  self-contained handoff.
- Router should prefer Guide over Ideator unless the user explicitly asks for ideation, grilling, research, option
  analysis, or PRD synthesis.
- Existing tests and code may still refer to `classification`; either migrate carefully or support legacy reads during
  transition.
- Backward compatibility matters for existing tests/session tool results that still contain `classification`; normalize
  them at the boundary rather than keeping routing code on the old field.
- Avoid creating a second user-facing Classification concept. `routingIntent` is the route; Plan Front Matter
  `classification` is only plan metadata.
- Guide should prefer direct helpful answers for `INQUIRY`, but it should not silently implement or create docs/plans
  when a conversation becomes actionable.
- Router should prefer Guide over Ideator unless the user explicitly asks for ideation, grilling, research, option
  analysis, current external facts, or PRD synthesis.
- Ideator may update small durable docs such as `CONTEXT.md`/ADRs during its interview loop, but Router should not send
  ordinary “where/how does this work?” questions there.
- Adding `return_to_router` to agent front matter is safe because `resolveEffectiveSessionToolNames` already hides it
  unless the session allows Router returns.
