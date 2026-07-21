---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Establish Frontend Engineer as a valid FEATURE execution owner and harden autonomous owner resolution, dispatch, Task Completion, recovery, and validation repair end-to-end."
affectedPaths:
    - "src/constants.js"
    - "src/agent-definitions/frontend-engineer.md"
    - "src/agent-definitions/engineer.md"
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/architect.md"
    - "src/agent-definitions/workflow-prompts/slicer-prompt.md"
    - "src/agent-definitions/document-formats/planner-plan-format.md"
    - "src/agent-definitions/document-formats/architect-plan-format.md"
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/shared/workflow/workflow-slicer.js"
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/orchestrator.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/agent-handler.js"
    - "src/shared/session/agent-switching.js"
    - "src/cmd/load-plan/index.js"
    - "src/tools/task-completed.js"
    - "src/plan-store.test.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/orchestrator.test.js"
    - "src/shared/workflow/validation.test.js"
    - "src/shared/workflow/pair-execution.test.js"
    - "src/shared/session/hosted-session.test.js"
    - "src/shared/session/agent-handler.test.js"
    - "src/shared/session/agent-switching.test.js"
    - "src/cmd/load-plan/index.test.js"
    - "src/tools/__tests__/task-completed.test.js"
frontend: false
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-07-18T11:02:23-04:00"
updatedAt: "2026-07-21T15:45:14-04:00"
status: "draft"
origin: "internal"
parentPlan: "frontend-engineer-pair-execution"
order: 1
dependencies: []
---

# Frontend Engineer Autonomous Execution Foundation

## Context

The approved Frontend Engineer and Pair Execution direction requires a first-class **Frontend Engineer** Agent for
materially visual or interactive browser UI work. An executable FEATURE Plan must never select an Agent that cannot run,
and the selected owner must remain stable through implementation, recovery, Task Completion, and Workflow Validation
repair.

The repository already contains a partial vertical slice: the Agent Name and definition exist, Plan parsing recognizes
some ownership fields, initial dispatch can select Frontend Engineer, and several validation paths consult active
workflow state. The foundation is not coherent yet. Unsupported owners can normalize away and silently become Engineer,
legacy `frontend` interpretation is not Plan Classification-aware, some orchestration and recovery paths still hard-code
Engineer, Task Completion authorization is split across layers, and prompt/format contracts still teach conflicting
metadata.

This Plan hardens the autonomous execution foundation rather than redesigning Pair Execution. Pair selection,
checkpoints, host capability behavior, metrics, active-Plan migration, Skills, and user documentation remain in sibling
Plans. Existing Pair plumbing may be preserved, but this Plan must prove that Frontend Engineer can execute successfully
in autonomous and non-Pair-capable contexts without relying on a checkpoint tool. TUI implementation and QUICK_FIX work
remain Engineer-owned.

## Objective

Make `frontend-engineer` a supported, independently configurable execution Agent and establish one validated execution
owner contract for executable FEATURE Plans. New Plan generators use canonical ownership fields; legacy FEATURE Plans
remain readable without opportunistic migration; unsupported ownership fails before execution begins; and every valid
execution, continuation, Task Completion, recovery, validation repair, and user-facing transition uses the same owner.

## Approach

Keep stored Plan metadata separate from effective execution policy. `src/plan-store.js` should parse and validate
explicit `executionAgent` and `collaborationRecommendation` values while retaining the legacy `frontend` field only when
it exists in source. A shared workflow resolver should then derive effective ownership with this precedence:

1. a valid explicit `executionAgent`;
2. `frontend: true` on an executable FEATURE Plan, interpreted as Frontend Engineer with an autonomous recommendation;
3. Engineer as the compatibility default for FEATURE Plans with no owner.

PROJECT Epics remain non-executable: legacy `frontend: true` is only decomposition context and must not synthesize an
execution owner. Explicit unsupported values or invalid combinations must produce a clear readiness/execution error
instead of being normalized to absence. Canonical fields take precedence over a stale legacy flag.

Resolve the owner once before worktree creation or `execution_started`, store it in
`HostedSession.activeExecutionWorkflow`, and consume that state in both workflow entry paths, recovery, continuation,
Task Completion, and Workflow Validation. Do not migrate active Plans during execution and do not write a runtime
Pair/autonomous choice into Plan Front Matter; repository-wide migration belongs to child Plan 04.

## Files to Modify

- `src/constants.js` — retain the canonical `AGENTS.FRONTEND_ENGINEER` Agent Name and update any bundled-Agent
  enumerations that must recognize it.
- `src/agent-definitions/frontend-engineer.md` — ensure the independently configurable Agent definition supports
  autonomous browser-first FEATURE execution, validation repair, real-browser evidence, and normal Task Completion.
  Pair-only tool exposure and checkpoint semantics must not be required for autonomous execution.
- `src/agent-definitions/engineer.md` — keep general implementation, QUICK_FIX, validation-repair, and TUI ownership
  guidance while removing the legacy assumption that Engineer owns every browser UI FEATURE.
- `src/agent-definitions/planner.md` — require ownership decisions based on the primary product outcome and separate the
  collaboration recommendation from browser verification details.
- `src/agent-definitions/architect.md` — keep PROJECT Plans as non-executable Epics and describe browser-oriented child
  areas without assigning an execution Agent or new legacy flag to the Epic.
- `src/agent-definitions/workflow-prompts/slicer-prompt.md` — require canonical child FEATURE ownership and
  recommendation fields instead of `frontend`, with Frontend Engineer reserved for materially visual or interactive
  browser UI outcomes.
- `src/agent-definitions/document-formats/planner-plan-format.md` — define the canonical executable FEATURE fields and
  browser verification guidance without teaching new `frontend` writes.
- `src/agent-definitions/document-formats/architect-plan-format.md` — remove Epic-level `frontend` instructions and keep
  execution ownership on child FEATURE Plans.
- `src/plan-front-matter.js` — retain explicit canonical key ordering for `executionAgent` and
  `collaborationRecommendation`; mark `frontend` as legacy read/write compatibility rather than a new-plan field.
- `src/plan-store.js` — validate, parse, serialize, and round-trip canonical ownership fields; distinguish absent values
  from explicit unsupported values; apply FEATURE-only legacy interpretation through execution policy rather than
  generic parsing; preserve existing legacy Front Matter during ordinary lifecycle writes; and carry valid canonical
  fields through Slicer child descriptors.
- `src/shared/workflow/workflow-slicer.js` — align the child descriptor schema with the supported owner/recommendation
  contract and reject invalid combinations before child Plans are materialized.
- `src/shared/workflow/workflow.js` — centralize effective owner resolution, reject invalid ownership before worktree or
  lifecycle mutation, dispatch the resolved owner through the existing worktree path, and initialize active workflow
  state with that owner. Remove execute-time legacy Plan migration.
- `src/shared/workflow/orchestrator.js` — use the resolved/active execution owner for post-execution decisions, metrics,
  recovery messages, and valid-owner handoffs rather than unconditionally selecting Engineer.
- `src/shared/workflow/validation.js` — route CI, Semantic Code Review, User Code Review, merge, and post-merge repair
  to the active execution owner; preserve that owner when validation pauses and resumes; align repair metrics and
  display names with the actual owner.
- `src/shared/session/hosted-session.js` — make the execution owner a required invariant of active FEATURE workflow
  state, with the existing Engineer fallback confined to legacy recovery boundaries.
- `src/shared/session/agent-handler.js` — authorize workflow advancement only for Task Completion from the active owner
  and keep exception/halt/continuation transitions with that owner when it is valid.
- `src/shared/session/agent-switching.js` — verify the existing generic root-Agent switching transaction works for
  Frontend Engineer without a frontend-specific session path.
- `src/cmd/load-plan/index.js` — rehydrate the execution owner for In-Progress/Implemented Plan recovery and validation
  retry using the same canonical/legacy resolver, rejecting unknown owners instead of changing ownership.
- `src/tools/task-completed.js` — recognize Frontend Engineer as an execution Agent for report guidance and reject a
  mismatched Agent's completion before emitting the semantic completion message, metric, or terminal tool result.
- Focused tests listed in Front Matter — cover metadata, owner resolution, dispatch, active state, recovery,
  authorization, owner-preserving repair, and unchanged Engineer/QUICK_FIX behavior.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/agents.js#loadAgentDef` — layered Agent Definition discovery already provides independent model,
  tool, and prompt configuration for Frontend Engineer.
- `src/shared/session/agent-switching.js#runActiveAgentTurn` — use the generic atomic switch/root-session transaction
  for implementation and repair rather than adding a frontend-specific session runner.
- `src/shared/workflow/workflow.js#startActiveExecutionWorkflow` — keep worktree preparation and `execution_started` as
  the single execution boundary, after ownership validation succeeds.
- `src/shared/session/hosted-session.js#setActiveExecutionWorkflow` — keep the resolved owner beside Plan/worktree
  context so continuation and validation share one source of truth.
- `src/shared/workflow/decisions.js#decidePostExecution` — pass the resolved owner into the existing decision contract
  instead of duplicating post-execution branching.
- `src/shared/workflow/validation.js#runCompletionGatedRepair` — parameterize the existing Task-Completion-gated repair
  loop rather than creating a Frontend Engineer validation workflow.
- `src/plan-store.js#injectFrontMatter` and `updatePlanFrontMatter` — preserve existing legacy fields during ordinary
  updates while ensuring newly generated Plans receive canonical fields from their generators.
- `src/tools/task-completed.js#createTaskCompletedTool` — enforce active-owner authorization at the existing completion
  boundary while retaining Operator and QUICK_FIX behavior when no FEATURE workflow is active.

## Implementation Steps

- [ ] Confirm `frontend-engineer` is a canonical bundled Agent Name and that its Agent Definition can load, switch,
      execute autonomously, perform browser-first verification, and complete validation repair independently of Engineer
      settings.
- [ ] Align Engineer, Planner, Architect, Slicer, and Plan format prompts on canonical terms: materially visual or
      interactive browser FEATUREs are Frontend Engineer-owned; TUI/general work is Engineer-owned; PROJECT Epics do not
      have execution owners; collaboration recommendation and browser verification are separate concerns.
- [ ] Define strict Plan-store validation for `executionAgent: engineer | frontend-engineer` and
      `collaborationRecommendation: autonomous | pair`. Reject explicit unknown values and reject Pair recommendations
      for non-Frontend-Engineer ownership rather than converting them to defaults.
- [ ] Keep legacy source metadata distinguishable from effective policy: only executable FEATURE `frontend: true` maps
      to Frontend Engineer/autonomous; `frontend: false` has no effect; PROJECT legacy values remain decomposition
      context; explicit canonical ownership wins over stale legacy metadata.
- [ ] Ensure newly generated Planner/Slicer FEATURE Plans serialize canonical ownership fields and do not introduce
      `frontend`, while ordinary updates to an existing legacy Plan preserve its source Front Matter until the dedicated
      migration slice.
- [ ] Add one shared effective-owner resolver and use it before worktree creation, `execution_started`, or Agent
      dispatch. Missing ownership defaults to Engineer; explicit unsupported ownership returns a clear error without
      dispatching any execution Agent or changing Plan lifecycle/worktree state.
- [ ] Thread the resolved owner through `executePlan()`, `startActiveExecutionWorkflow()`, the Workflow Orchestrator,
      the Agent Handler, and `runActiveAgentTurn()` so both approved-plan entry paths dispatch and pause with the same
      owner.
- [ ] Store the owner in active execution workflow state and restore it through `load-plan` recovery and Implemented
      Plan validation retry; never reconstruct a Frontend Engineer Plan as Engineer after Session/runtime context loss.
- [ ] Enforce Task Completion at both tool and workflow-consumer boundaries: the active owner can complete; a different
      Agent cannot emit/record a valid completion or terminate the active execution turn; Operator and QUICK_FIX flows
      without a FEATURE active workflow remain unchanged.
- [ ] Replace remaining FEATURE-specific hard-coded Engineer repair calls, metrics, display text, and manual recovery
      transitions with the recorded owner across CI, semantic-review, human-review, merge, and post-merge verification
      paths. Keep QUICK_FIX Mechanical Validation Engineer-owned.
- [ ] Add regression coverage for canonical round-trip/generation, class-aware legacy behavior, invalid owners and
      invalid owner/recommendation combinations, Engineer and Frontend Engineer dispatch, active owner state, recovery,
      wrong-owner Task Completion, and every owner-preserving validation repair path.
- [ ] Run focused tests, then run `deno task ci` and fix all failures.

## Verification Plan

- Automated: run `deno test -A src/plan-store.test.js src/shared/workflow/pair-execution.test.js` and verify canonical
  fields round-trip, new FEATURE generation omits `frontend`, generic updates preserve legacy source metadata, legacy
  mapping is FEATURE-only, explicit canonical ownership wins, and unsupported values/combinations fail clearly.
- Automated: run `deno test -A src/shared/workflow/workflow.test.js src/shared/workflow/orchestrator.test.js` and verify
  default Engineer dispatch, explicit Frontend Engineer autonomous dispatch, legacy frontend FEATURE dispatch, no
  dispatch or lifecycle/worktree mutation for unknown owners, and owner-aware halt/continuation decisions.
- Automated: run
  `deno test -A src/shared/session/hosted-session.test.js src/shared/session/agent-handler.test.js src/shared/session/agent-switching.test.js`
  and verify active owner persistence, Frontend Engineer root switching, valid-owner continuation, and rejection of
  wrong-owner completion outcomes.
- Automated: run `deno test -A src/cmd/load-plan/index.test.js` and verify In-Progress recovery and Implemented Plan
  validation retry preserve explicit and legacy Frontend Engineer ownership.
- Automated: run `deno test -A src/tools/__tests__/task-completed.test.js` and verify Frontend Engineer receives the
  execution-report contract, can complete its own active workflow, and a mismatched Agent emits no completion message or
  metric and does not terminate the workflow turn.
- Automated: run `deno test -A src/shared/workflow/validation.test.js` and verify CI, Semantic Code Review, User Code
  Review, merge-conflict, and post-merge verification repairs dispatch to the recorded execution owner and preserve it
  across paused validation.
- Automated: run `deno task ci` after implementation and fix all failures.
- Manual: load a Ready For Work FEATURE with `executionAgent: frontend-engineer` in a host without Pair capability and
  confirm Frontend Engineer runs autonomously in the normal execution worktree and reaches Task Completion.
- Manual: load a legacy FEATURE with `frontend: true` and confirm Frontend Engineer autonomous behavior without
  rewriting its Front Matter; load a legacy PROJECT Epic with the same field and confirm it remains non-executable.
- Manual: load an explicit unsupported owner and confirm RunWield reports the invalid value before worktree creation,
  Agent switching, or `execution_started`.
- Expected results: one validated owner governs the full FEATURE execution/repair lifecycle; no Plan silently runs under
  a different Agent; missing legacy ownership remains compatible; QUICK_FIX and TUI implementation remain
  Engineer-owned.

## Edge Cases & Considerations

- `executionAgent` validation must distinguish an absent field from an explicit typo; only absence may use the Engineer
  compatibility default.
- Canonical ownership takes precedence when a legacy Plan contains conflicting `executionAgent` and `frontend` values.
  Preserve the legacy field for the later migration slice, but do not let it override explicit intent.
- A Pair recommendation is advisory runtime guidance only for Frontend Engineer. This Plan verifies autonomous fallback
  but does not implement checkpoint selection, Pair tool behavior, or host capability UX.
- Runtime collaboration style must not become durable Plan Front Matter in this foundation. Recovery derives ownership
  from the Plan; sibling Pair plans define when collaboration style is re-asked.
- Do not migrate active nonterminal Plans, rewrite verified/archived history, update Skills/docs, or add Pair metrics in
  this slice.
- Keep browser verification requirements in the Plan body/dev-server hints rather than adding a redundant
  `browserVerification` field.
- Keep executable code in pure JavaScript with JSDoc types. Do not add TypeScript outside `src/ui/workspace/`.
