---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Introduce Frontend Engineer as a real execution owner and make autonomous frontend-owned FEATURE execution work end-to-end, including metadata, dispatch, Task Completion, and validation repair. This combines the owner identity and execution path so no Plan can select an owner that cannot run."
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
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/agent-handler.js"
    - "src/shared/session/agent-switching.js"
    - "src/tools/task-completed.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/validation.test.js"
    - "src/shared/session/hosted-session.test.js"
    - "src/tools/__tests__/task-completed.test.js"
    - "src/plan-store.test.js"
frontend: false
createdAt: "2026-07-18T15:02:23.955Z"
updatedAt: "2026-07-18T15:02:23.955Z"
status: "draft"
origin: "internal"
parentPlan: "frontend-engineer-pair-execution"
order: 1
dependencies:
    []
---

# Frontend Engineer Autonomous Execution Foundation

## Context

RunWield currently routes executable FEATURE Plans to the general Engineer and uses the legacy `frontend` boolean for
several separate concerns. The Epic requires a first-class `frontend-engineer` execution owner, but that owner must not
be emitted into Plans until the runtime can actually execute and repair those Plans. This slice combines the identity,
Plan metadata plumbing, autonomous dispatch, Task Completion authorization, and validation-repair ownership so the first
new owner contract is immediately executable.

This slice does not implement Pair Execution checkpoints. Frontend-owned Plans run autonomously here, including legacy
executable FEATURE Plans with `frontend: true`. TUI implementation work in this repository remains Engineer-owned and
this child Plan itself is not browser frontend work.

## Objective

Add Frontend Engineer as a supported execution Agent and make autonomous frontend-owned FEATURE execution work
end-to-end without creating a half-valid Plan state. After this slice, RunWield can parse and write the new ownership
metadata, resolve legacy frontend FEATURE Plans to Frontend Engineer autonomous execution, dispatch implementation to
the recorded owner, authorize Task Completion from that owner, and send all validation/code-review/merge repairs back to
that same owner.

## Approach

Start by adding the canonical Agent identity and a focused `frontend-engineer.md` definition that keeps browser-specific
execution discipline out of the general Engineer prompt. Then extend Plan front matter parsing/serialization to
understand `executionAgent` and `collaborationRecommendation`, validate supported values, preserve legacy read
compatibility, and stop emitting `frontend` for new writes where safe. Finally, thread the resolved owner through active
execution workflow state and validation repair paths so dispatch and repair no longer default independently to Engineer.

Do not migrate active Plans in this slice. Do not require Pair choices yet. If `collaborationRecommendation: pair` is
present before Pair support lands, execution should still run autonomously unless later slices add an interactive
selection path.

## Files to Modify

- `src/constants.js` — add the canonical `frontend-engineer` Agent name without changing routing intents or QUICK_FIX
  ownership.
- `src/agent-definitions/frontend-engineer.md` — define the browser-first execution Agent identity, model/tool
  configurability, browser preflight, design-system discovery, real-browser verification, and Task Completion
  discipline.
- `src/agent-definitions/engineer.md` — return Engineer toward a general execution policy while retaining concise
  compatibility guidance and keeping TUI work Engineer-owned.
- `src/agent-definitions/planner.md` — teach Planner to choose execution ownership by primary product outcome and to
  separate Pair recommendation from verification details once the runtime supports it.
- `src/agent-definitions/architect.md` — align Epic guidance with owner/recommendation language while keeping PROJECT
  Epics non-executable.
- `src/agent-definitions/workflow-prompts/slicer-prompt.md` — preserve the new owner/recommendation contract through
  future Epic decompositions without requiring the retired `frontend` flag.
- `src/agent-definitions/document-formats/planner-plan-format.md` — replace the canonical `frontend` field guidance with
  executable FEATURE ownership and collaboration recommendation guidance.
- `src/agent-definitions/document-formats/architect-plan-format.md` — remove Epic-level `frontend` requirements and
  describe how Epics identify browser-oriented child areas without assigning an execution Agent to the Epic itself.
- `src/plan-front-matter.js` — add canonical front matter key constants for `executionAgent` and
  `collaborationRecommendation` and keep legacy key handling explicit.
- `src/plan-store.js` — parse, normalize, order, serialize, round-trip, and validate the new fields; stop emitting
  `frontend` in new Plan writes where safe; preserve class-aware legacy read compatibility; and ensure child descriptor
  metadata can carry the new fields once supported.
- `src/shared/workflow/workflow.js` — resolve execution owner from loaded Plan metadata and legacy compatibility, start
  the active workflow with that owner, and dispatch to Engineer or Frontend Engineer through the existing worktree path.
- `src/shared/session/hosted-session.js` — extend active execution workflow state with execution owner and autonomous
  collaboration style.
- `src/shared/session/agent-handler.js` — ensure implementation continuation and Task Completion handling use the active
  execution owner rather than assuming Engineer.
- `src/shared/session/agent-switching.js` — reuse existing root-session switching behavior for the Frontend Engineer
  owner.
- `src/tools/task-completed.js` — recognize Frontend Engineer as an authorized execution Agent when it owns the active
  workflow.
- `src/shared/workflow/validation.js` — parameterize CI, semantic review, human review, and merge repair
  dispatch/display strings by the original execution owner while preserving Reviewer, Operator, merge-back, and
  lifecycle behavior.
- `src/plan-store.test.js` — cover new metadata serialization/round-trip, legacy `frontend` interpretation, and omission
  of `frontend` from new canonical writes.
- `src/shared/workflow/workflow.test.js` — cover Engineer dispatch, Frontend Engineer autonomous dispatch, legacy
  frontend FEATURE dispatch, and unsupported/unknown owner errors.
- `src/shared/workflow/validation.test.js` — cover owner-preserving repair routing for CI, semantic-review,
  human-review, and merge repair paths.
- `src/shared/session/hosted-session.test.js` — cover active workflow owner persistence and recovery shape.
- `src/tools/__tests__/task-completed.test.js` — cover Task Completion authorization for Frontend Engineer and rejection
  of the wrong active owner.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/agents.js#loadAgentDef` — reuse layered Agent Definition discovery for the new Frontend Engineer
  without adding a settings subsystem.
- `src/shared/session/agent-switching.js#runActiveAgentTurn` — reuse existing active-agent switching and root-session
  behavior for dispatch and repair.
- `src/shared/workflow/workflow.js#startActiveExecutionWorkflow` — extend the single execution start boundary instead of
  creating a frontend-specific workflow.
- `src/shared/workflow/validation.js#runCompletionGatedRepair` — parameterize the repair owner instead of duplicating
  validation flow.
- `src/shared/session/hosted-session.js#setActiveExecutionWorkflow` — persist ephemeral execution owner in the existing
  active workflow context.
- `src/shared/workflow/metrics.js#sanitizeMetricDetails` — reuse existing content-safe metric sanitization for new
  owner-related events.
- `src/agent-definitions/engineer.md` — preserve shared execution invariants while moving browser-specialist behavior
  into Frontend Engineer.

## Implementation Steps

- [ ] Add `AGENTS.FRONTEND_ENGINEER` with value `frontend-engineer` and update any Agent-name display/title/test
      utilities that enumerate bundled Agents.
- [ ] Create `src/agent-definitions/frontend-engineer.md` with shared execution discipline, browser/design-system
      preflight, headed verification requirements, autonomous behavior, and no Pair checkpoint claims yet.
- [ ] Trim duplicated browser-specialist language from `engineer.md` while preserving general implementation, repair,
      and TUI ownership guidance.
- [ ] Update Planner, Architect, Slicer prompt, and Plan format documents so future executable FEATURE Plans use
      `executionAgent` and `collaborationRecommendation` instead of `frontend`, while PROJECT Epics only describe
      browser-oriented child scope.
- [ ] Extend front matter key definitions and Plan store normalization to support
      `executionAgent: engineer | frontend-engineer` and `collaborationRecommendation: autonomous | pair`.
- [ ] Preserve legacy reads: executable FEATURE Plans with `frontend: true` resolve to Frontend Engineer plus autonomous
      style; `frontend: false` has no effect; PROJECT Epics remain non-executable and treat legacy frontend only as
      decomposition context.
- [ ] Stop emitting `frontend` in new Plan serializers/formats where safe, without rewriting verified/archived history
      or active Plans in this slice.
- [ ] Add an execution-owner resolver used by `executePlan()`/single-plan execution so unknown owners fail clearly
      instead of silently falling back.
- [ ] Thread `executionAgent` and default autonomous collaboration style into `startActiveExecutionWorkflow()` and
      `HostedSession.activeExecutionWorkflow`.
- [ ] Dispatch implementation and continuation turns to the resolved owner using `runActiveAgentTurn()` and existing
      worktree cwd handling.
- [ ] Update Task Completion checks so only the active execution owner, including Frontend Engineer, can complete the
      active implementation/repair turn.
- [ ] Replace hard-coded Engineer repair routing and user-facing repair strings in validation with the recorded active
      workflow owner.
- [ ] Add focused tests for Plan metadata, legacy compatibility, autonomous dispatch, owner persistence, Task Completion
      authorization, and validation repair routing.
- [ ] Run `deno task ci` and fix all failures.

## Verification Plan

- Automated: run `deno test -A src/plan-store.test.js` and verify new owner/recommendation metadata round-trips,
  serializers omit `frontend` for new writes, and legacy `frontend` compatibility resolves by Plan classification.
- Automated: run `deno test -A src/shared/workflow/workflow.test.js` and verify Engineer dispatch, Frontend Engineer
  autonomous dispatch, legacy `frontend: true` FEATURE dispatch, `frontend: false` normal Engineer behavior, and unknown
  owner rejection.
- Automated: run `deno test -A src/tools/__tests__/task-completed.test.js` and verify Frontend Engineer can complete
  only when it owns the active workflow.
- Automated: run `deno test -A src/shared/workflow/validation.test.js` and verify CI, semantic-review, human-review, and
  merge repair dispatch to the recorded execution owner.
- Automated: run `deno test -A src/shared/session/hosted-session.test.js src/shared/session/agent-switching.test.js` for
  active workflow owner persistence and agent switching behavior.
- Automated: run `deno task ci` after implementation and fix all failures.
- Manual: load a legacy executable FEATURE Plan with `frontend: true` and confirm the run selects Frontend Engineer
  autonomous behavior.
- Manual: load a legacy PROJECT Epic with `frontend: true` and confirm it remains non-executable.
- Manual: load a normal FEATURE Plan with no owner and confirm Engineer remains the default owner.
- Expected results: no new Plan can select `frontend-engineer` without a runnable Agent definition and dispatch path;
  validation repairs return to the same owner that implemented the Plan; QUICK_FIX remains Engineer-owned.

## Edge Cases & Considerations

- Unknown `executionAgent` values should fail readiness or execution with a clear recovery message rather than
  defaulting to Engineer.
- `collaborationRecommendation: pair` is advisory only in this slice; autonomous execution remains the only implemented
  style until Pair workflow lands.
- Do not migrate active nonterminal Plans yet; avoid broad churn and user-authored metadata risk.
- Avoid adding `browserVerification` front matter; browser expectations belong in the Verification Plan body.
- Keep PROJECT Epics non-executable even when they contain legacy `frontend` metadata.
- Keep all executable code in pure JavaScript with JSDoc types; do not add TypeScript outside `src/ui/workspace/`.
