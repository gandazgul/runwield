---
planId: "cb1a9f91-2dd4-43fa-884a-21593f31a4ea"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Establish Frontend Engineer as a valid FEATURE execution owner and harden autonomous owner validation, dispatch, Task Completion, recovery, and validation repair end-to-end."
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
    - "src/shared/session/session.js"
    - "src/shared/session/agent-handler.js"
    - "src/shared/session/agent-switching.js"
    - "src/cmd/load-plan/index.js"
    - "src/tools/plan-written.js"
    - "src/tools/task-completed.js"
    - "src/ui/workspace/react/ReviewDevSurface.tsx"
    - "src/plan-store.test.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/orchestrator.test.js"
    - "src/shared/workflow/validation.test.js"
    - "src/shared/session/hosted-session.test.js"
    - "src/shared/session/agent-handler.test.js"
    - "src/shared/session/agent-switching.test.js"
    - "src/shared/session/__tests__/session-tools-policy.test.js"
    - "src/cmd/load-plan/index.test.js"
    - "src/tools/__tests__/plan-written.test.js"
    - "src/tools/__tests__/task-completed.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-18T11:02:23-04:00"
updatedAt: "2026-07-22T03:49:13.334Z"
status: "verified"
origin: "internal"
parentPlan: "frontend-engineer-pair-execution"
order: 1
dependencies:
    []
implementedAt: "2026-07-21T22:36:26.014Z"
verifiedAt: "2026-07-22T03:49:13.334Z"
executionReport: "- Implemented approved Plan 01: added centralized strict execution policy validation/resolution, canonical `frontend-engineer` ownership, legacy `frontend` compatibility, and invalid raw owner diagnostics.\n- Updated execution, load-plan recovery, validation repair, orchestration, and Task Completion paths to preserve/use the resolved active owner; QUICK_FIX remains Engineer-owned.\n- Removed durable/runtime `collaborationMode` behavior from this slice and kept `pair_checkpoint` out of the autonomous Frontend Engineer base toolset.\n- Updated agent prompts/formats, Workspace fixture surface, and regression coverage for policy matrix, owner dispatch, readiness validation, recovery/validation owner preservation, wrong-owner completion rejection, and tool policy.\n- Verification passed: focused `deno test -A ...` suite passed (362 tests); full `deno task ci` passed (1436 tests plus release compile/smoke)."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Frontend Engineer Autonomous Execution Foundation

## Context

The approved Frontend Engineer and Pair Execution direction requires a first-class **Frontend Engineer** Agent for
materially visual or interactive browser UI work. An executable FEATURE Plan must never select an Agent that cannot run,
and the selected owner must remain stable through the Readiness Gate, implementation, Plan Recovery, Task Completion,
and every Workflow Validation repair.

The repository already contains a partial vertical slice: the Agent Name and definition exist, Plan parsing recognizes
some ownership fields, initial dispatch can select Frontend Engineer, and several validation paths consult active
workflow state. The foundation is not coherent yet. Unsupported owners normalize away and silently become Engineer,
legacy `frontend` interpretation is not Plan Classification-aware, stale triage data can override the loaded Plan,
readiness paths do not validate ownership, recovery and orchestration still contain Engineer defaults, and Task
Completion authorization is split across layers.

The partial implementation also crosses into later Pair Execution scope: it serializes the user-selected
`collaborationMode`, asks for Pair/autonomous execution during dispatch, and exposes `pair_checkpoint` statically from
the base Frontend Engineer Agent Definition. This Plan restores a clean autonomous foundation. Pair selection,
checkpoints, host capability behavior, metrics, active-Plan migration, Skills, and user documentation remain in sibling
Plans. TUI implementation and QUICK_FIX work remain Engineer-owned.

## Objective

Make `frontend-engineer` a supported, independently configurable execution Agent and establish one strict execution
policy contract for executable FEATURE Plans. New Plan generators use canonical ownership fields; legacy FEATURE Plans
remain readable without opportunistic migration; unsupported metadata fails before readiness or execution mutation; and
every valid dispatch, continuation, Task Completion, recovery, validation repair, metric, and user-facing transition
uses the same resolved owner.

This foundation executes all Frontend Engineer Plans autonomously. It preserves `collaborationRecommendation` as future
Pair guidance but neither asks for nor durably records a runtime collaboration choice.

## Approach

Keep source Front Matter separate from effective execution policy. Plan parsing and listing must preserve explicit raw
ownership values so a typo remains diagnosable instead of becoming absence. A shared validator/resolver should return
either a typed policy or a clear error and apply this matrix:

| Plan shape                                                   | Valid canonical policy                                                                      | Effective behavior in this slice |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------- |
| FEATURE with `executionAgent: engineer`                      | recommendation absent or `autonomous`; `pair` is invalid                                    | Engineer autonomous              |
| FEATURE with `executionAgent: frontend-engineer`             | recommendation absent, `autonomous`, or `pair`; new generators must emit one                | Frontend Engineer autonomous     |
| FEATURE with no canonical owner                              | compatibility input only                                                                    | Engineer autonomous              |
| Legacy FEATURE with `frontend: true` and no canonical owner  | legacy input only                                                                           | Frontend Engineer autonomous     |
| Legacy FEATURE with `frontend: false` and no canonical owner | legacy input only                                                                           | Engineer autonomous              |
| PROJECT Epic                                                 | canonical owner/recommendation are invalid; legacy `frontend` remains decomposition context | non-executable                   |

A valid explicit canonical owner always takes precedence over legacy `frontend`. An explicit unsupported owner or
recommendation remains invalid even when legacy metadata could otherwise imply a valid default. Canonical generation
rejects invalid values; ordinary lifecycle writes preserve unchanged legacy/raw source fields; attempts to set invalid
policy fields fail. Slicer validates every proposed child and all owner/recommendation combinations before writing any
child file.

Use the same resolver at every workflow boundary. The loaded Plan—not transient triage metadata—is authoritative for
ownership and recommendation. Validate before the Readiness Gate records success and again at execution/recovery as a
defensive boundary. Resolve once, before worktree creation or `execution_started`, store the owner in
`HostedSession.activeExecutionWorkflow`, and consume that state through both execution entry paths, continuation, Task
Completion, recovery, and Workflow Validation. Remove execute-time legacy migration and durable `collaborationMode`;
repository migration and Pair runtime state belong to later child Plans.

## Files to Modify

- `src/constants.js` — retain the canonical `AGENTS.FRONTEND_ENGINEER` Agent Name and update bundled-Agent enumerations
  that must recognize it.
- `src/agent-definitions/frontend-engineer.md` — make the independently configurable Agent Definition support autonomous
  browser-first FEATURE execution, validation repair, real-browser evidence, and normal Task Completion. Remove static
  `pair_checkpoint` exposure and Pair-only behavior from the base definition.
- `src/agent-definitions/engineer.md` — preserve general FEATURE, QUICK_FIX, validation-repair, and TUI ownership while
  removing the assumption that Engineer owns every browser UI FEATURE.
- `src/agent-definitions/planner.md` — require ownership based on the primary product outcome and keep collaboration
  recommendation separate from browser verification details.
- `src/agent-definitions/architect.md` — keep PROJECT Plans as non-executable Epics and describe browser-oriented child
  areas without assigning an execution Agent or canonical recommendation to the Epic.
- `src/agent-definitions/workflow-prompts/slicer-prompt.md` — require canonical child FEATURE policy instead of
  `frontend`, with Frontend Engineer reserved for materially visual or interactive browser outcomes.
- `src/agent-definitions/document-formats/planner-plan-format.md` — define canonical FEATURE fields, document the
  validity/default matrix, and stop teaching new `frontend` writes.
- `src/agent-definitions/document-formats/architect-plan-format.md` — remove Epic-level `frontend` instructions and keep
  execution ownership on child FEATURE Plans.
- `src/plan-front-matter.js` — keep canonical key ordering for `executionAgent` and `collaborationRecommendation`,
  retain `frontend` only as legacy source compatibility, and remove durable `collaborationMode` from Plan Front Matter.
- `src/plan-store.js` — preserve explicit raw policy values for diagnostics; validate canonical generation and updates;
  apply FEATURE-only legacy interpretation in the shared execution-policy resolver rather than generic parsing; preserve
  existing legacy fields during unrelated lifecycle writes; and validate all Slicer child descriptors before
  materializing any file.
- `src/shared/workflow/workflow-slicer.js` — align the child descriptor schema with the validity matrix and reject the
  complete proposed child set before invoking Plan writes.
- `src/shared/workflow/workflow.js` — centralize strict policy resolution; make loaded Plan policy authoritative; remove
  execute-time legacy migration, Pair selection, and durable mode writes; reject invalid policy before
  worktree/lifecycle mutation; and initialize active workflow state with the resolved owner.
- `src/shared/workflow/orchestrator.js` — use the resolved/active owner for post-execution decisions, metrics, recovery
  messages, and valid-owner handoffs instead of selecting Engineer unconditionally.
- `src/shared/workflow/validation.js` — route CI, Semantic Code Review, User Code Review, merge-conflict, and post-merge
  repair to the active owner; preserve that owner across paused validation; and align metrics/display names with it.
- `src/shared/session/hosted-session.js` — make execution owner a required active FEATURE workflow invariant, remove
  durable Plan collaboration-mode assumptions, and confine Engineer fallback to explicitly identified legacy runtime
  recovery boundaries.
- `src/shared/session/session.js` — preserve generic protected-tool construction while ensuring the autonomous base
  Frontend Engineer configuration does not receive `pair_checkpoint`; later Pair workflow must inject it explicitly.
- `src/shared/session/agent-handler.js` — advance the workflow only for Task Completion from the active owner and keep
  exception, halt, and continuation transitions with that owner.
- `src/shared/session/agent-switching.js` — verify the existing generic root-Agent switching transaction works for
  Frontend Engineer without a frontend-specific Session path.
- `src/cmd/load-plan/index.js` — use shared policy validation in the Readiness Gate, both execution paths, In-Progress
  Plan Recovery, and Implemented Plan validation retry; establish owner state even for in-place/non-Git runs with no
  baseline or worktree record; reject unknown owners instead of changing ownership.
- `src/tools/plan-written.js` — validate the loaded Plan's execution policy before review/readiness progression and
  never record `readiness_passed` for invalid FEATURE policy; keep PROJECT validation Plan Classification-aware.
- `src/tools/task-completed.js` — give Frontend Engineer the generic execution-report contract and reject a mismatched
  Agent before emitting the Task Completion message, metric, terminal result, or workflow advancement. Pair-specific
  report wording remains Plan 04 scope.
- `src/ui/workspace/react/ReviewDevSurface.tsx` — replace the development fixture's legacy `frontend` example with
  canonical FEATURE ownership so current UI fixtures do not teach retired writes.
- Focused tests listed in Front Matter — cover metadata diagnostics and writes, readiness, all-before-write Slicer
  behavior, owner resolution/dispatch, active state, recovery, tool policy, authorization, owner-preserving repair, and
  unchanged Engineer/QUICK_FIX behavior.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/agents.js#loadAgentDef` — layered Agent Definition discovery already provides independent model,
  tool, and prompt configuration for Frontend Engineer.
- `src/shared/session/agent-switching.js#runActiveAgentTurn` — use the generic atomic switch/root-session transaction
  for implementation and repair rather than adding a frontend-specific Session runner.
- `src/shared/workflow/workflow.js#startActiveExecutionWorkflow` — retain worktree preparation and `execution_started`
  as the single execution boundary after policy validation succeeds.
- `src/shared/session/hosted-session.js#setActiveExecutionWorkflow` — keep the owner beside Plan/worktree context so
  continuation and validation share one source of truth.
- `src/shared/workflow/decisions.js#decidePostExecution` — pass the active owner into the existing Workflow Decision
  contract instead of duplicating post-execution branching.
- `src/shared/workflow/validation.js#runCompletionGatedRepair` — parameterize the Task-Completion-gated repair loop
  rather than creating a Frontend Engineer validation workflow.
- `src/plan-store.js#injectFrontMatter` and `updatePlanFrontMatter` — preserve unrelated/legacy source fields during
  lifecycle updates while applying strict validation to new policy writes.
- `src/tools/task-completed.js#createTaskCompletedTool` — enforce active-owner authorization at the existing completion
  boundary while retaining Operator and QUICK_FIX behavior when no FEATURE workflow is active.

## Implementation Steps

- [ ] Confirm `frontend-engineer` is a canonical bundled Agent Name and its layered Agent Definition can load, switch,
      run autonomously, perform browser-first verification/repair, and call Task Completion independently of Engineer
      settings.
- [ ] Remove `pair_checkpoint` and Pair checkpoint instructions from the base Frontend Engineer Agent Definition; prove
      autonomous Frontend Engineer retains `task_completed` and does not receive the Pair tool through protected-tool
      expansion.
- [ ] Align Engineer, Planner, Architect, Slicer, Plan formats, and the Workspace fixture on canonical language:
      materially visual or interactive browser FEATUREs are Frontend Engineer-owned; TUI/general work is Engineer-owned;
      PROJECT Epics have no execution policy; collaboration recommendation and browser verification are separate.
- [ ] Introduce a typed execution-policy result that distinguishes absent, legacy, valid canonical, and explicit invalid
      source values. Parsing/listing must preserve invalid explicit values for diagnostics; serializers must not emit
      diagnostic-only state.
- [ ] Enforce the full validity matrix: Engineer plus absent/`autonomous` recommendation; Frontend Engineer plus
      absent/`autonomous`/`pair` compatibility; no canonical policy on PROJECT Epics; canonical owner precedence; and
      explicit invalid values never falling through to legacy/default behavior.
- [ ] Ensure newly generated Planner/Slicer FEATURE Plans always emit `executionAgent`; Frontend Engineer children also
      emit a recommendation. Do not emit `frontend` or `collaborationMode` in new Plans.
- [ ] Preserve existing legacy Front Matter during unrelated lifecycle updates, but reject attempts to write invalid
      policy values. Remove execute-time rewriting of legacy Plans; active-Plan migration remains Plan 04 scope.
- [ ] Validate the entire Slicer child descriptor set, including cross-field combinations, before writing the first
      child Plan so one invalid later descriptor cannot leave partial output.
- [ ] Run shared policy validation before `readiness_passed`/`epic_readiness_passed` in `plan_written` and `load-plan`.
      Invalid policy produces a clear repair/recovery message and no readiness success event or execution dispatch.
- [ ] Make loaded Plan policy authoritative over stale transient triage metadata. Resolve the owner once at each
      execution/recovery boundary before worktree creation, `execution_started`, metrics, or Agent switching.
- [ ] Remove Pair/autonomous interaction and persisted `collaborationMode` handling from this slice. A `pair`
      recommendation remains advisory data, but both Frontend Engineer recommendations execute autonomously until Plan
      02 adds runtime Pair state.
- [ ] Thread the resolved owner through `executePlan()`, `startActiveExecutionWorkflow()`, the Workflow Orchestrator,
      Agent Handler, and `runActiveAgentTurn()` so approved-plan and `load-plan` entry paths dispatch/pause
      consistently.
- [ ] Restore owner state for In-Progress Plan Recovery and Implemented Plan validation retry, including
      in-place/non-Git executions with no baseline tree or worktree registry entry; never reconstruct a Frontend
      Engineer Plan as Engineer after Session/runtime loss.
- [ ] Enforce Task Completion at tool and workflow-consumer boundaries: only the active owner can complete; a mismatch
      emits no semantic completion message/metric/terminal result and does not terminate the turn. Preserve Operator and
      QUICK_FIX behavior when no FEATURE workflow is active.
- [ ] Replace remaining FEATURE-specific Engineer repair calls, post-execution decisions, metrics, display text, and
      manual recovery transitions with the active owner across CI, semantic review, User Code Review, merge, and
      post-merge verification. Keep QUICK_FIX Mechanical Validation Engineer-owned.
- [ ] Add regression tests for every policy-matrix row, raw invalid diagnostics, canonical generation/round-trip,
      lifecycle preservation, all-before-write Slicer rejection, both owner dispatches, no pre-dispatch mutation,
      active-state invariants, non-Git recovery, tool policy, wrong-owner Task Completion, and every validation repair.
- [ ] Run focused tests, then run `deno task ci` and fix all failures.

## Verification Plan

- Automated: run `deno test -A src/plan-store.test.js` and verify raw invalid values remain diagnosable, canonical
  fields round-trip, new FEATURE generation omits `frontend`/`collaborationMode`, unrelated updates preserve legacy
  source fields, legacy interpretation is FEATURE-only, canonical ownership wins, every invalid matrix combination
  fails, and Slicer rejects all children before writing any when one descriptor is invalid.
- Automated: run `deno test -A src/tools/__tests__/plan-written.test.js src/cmd/load-plan/index.test.js` and verify both
  Readiness Gate paths reject invalid FEATURE/PROJECT policy without readiness events; explicit and legacy Frontend
  Engineer ownership survive In-Progress and Implemented recovery, including no-baseline/non-Git recovery.
- Automated: run `deno test -A src/shared/workflow/workflow.test.js src/shared/workflow/orchestrator.test.js` and verify
  default Engineer dispatch, explicit/legacy Frontend Engineer autonomous dispatch, loaded Plan precedence over stale
  triage metadata, no Pair interaction or durable mode write, no worktree/lifecycle/Agent mutation for invalid policy,
  and owner-aware halt/continuation decisions.
- Automated: run
  `deno test -A src/shared/session/hosted-session.test.js src/shared/session/agent-handler.test.js src/shared/session/agent-switching.test.js src/shared/session/__tests__/session-tools-policy.test.js`
  and verify required active owner state, Frontend Engineer root switching, valid-owner continuation, base autonomous
  tool policy, and defensive rejection of wrong-owner completion outcomes.
- Automated: run `deno test -A src/tools/__tests__/task-completed.test.js` and verify Frontend Engineer receives the
  execution report schema, can complete its own active workflow, and a mismatched Agent emits no completion message or
  metric, returns no terminating Task Completion outcome, and leaves the workflow active.
- Automated: run `deno test -A src/shared/workflow/validation.test.js` and verify CI, Semantic Code Review, User Code
  Review, merge-conflict, and post-merge verification repairs dispatch to the active owner and preserve it across paused
  validation.
- Automated: run `deno task ci` after implementation and fix all failures.
- Manual: load a Ready For Work FEATURE with `executionAgent: frontend-engineer` and either recommendation in a host
  with or without Pair capability; confirm no collaboration prompt/checkpoint occurs, Frontend Engineer runs
  autonomously in the normal execution worktree, performs browser verification, and reaches Task Completion.
- Manual: load a legacy FEATURE with `frontend: true` and confirm autonomous Frontend Engineer behavior without
  rewriting Front Matter; load a legacy PROJECT Epic with the same field and confirm it remains non-executable.
- Manual: load explicit unsupported owner/recommendation combinations through review and `load-plan`; confirm RunWield
  reports the original invalid value before readiness success, worktree creation, Agent switching, or
  `execution_started`.
- Expected results: one validated owner governs the full FEATURE execution/repair lifecycle; no Plan silently runs under
  a different Agent; missing/legacy ownership remains compatible; Pair runtime behavior is absent until Plan 02; and
  QUICK_FIX/TUI implementation remains Engineer-owned.

## Edge Cases & Considerations

- Parsing and Plan Board listing should remain available for an invalid Plan so the user can inspect and repair it;
  strict failure belongs at canonical writes, readiness, execution, and recovery boundaries.
- A canonical owner takes precedence when legacy `frontend` conflicts, but an explicit invalid canonical value must not
  be rescued by legacy metadata or the Engineer default.
- The current canonical Plan template requires a collaboration recommendation. The target validator accepts `autonomous`
  for Engineer Plans as a harmless no-Pair signal and permits absence for backward compatibility; `pair` remains
  Frontend Engineer-only.
- A Frontend Engineer `pair` recommendation is advisory data only in this foundation. It must execute autonomously and
  must not expose checkpoint behavior until Plan 02 supplies runtime-only Pair state and tools.
- Runtime collaboration style must not become Plan Front Matter. Remove the partial `collaborationMode` persistence;
  later lost-context recovery derives ownership from the Plan and re-asks style under the sibling Pair contract.
- Recovery must create active owner state even when in-place/non-Git execution has no baseline tree, worktree path,
  branch, or registry ID; optional worktree fields remain absent.
- Do not migrate active nonterminal Plans, rewrite verified/archived history, update Skills/docs, add Pair metrics, or
  implement host checkpoint UX in this slice.
- Keep browser verification requirements in the Plan body/dev-server hints rather than adding a redundant
  `browserVerification` field.
- Keep executable code in pure JavaScript with JSDoc types. TypeScript remains allowed only under `src/ui/workspace/`.
