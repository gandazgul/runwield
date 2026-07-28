---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Make Plan Review re-submission deterministic when Planner or Architect forgets to call plan_written after a user asks to review an existing Plan."
affectedPaths:
    - "src/shared/session/agent-handler.js"
    - "src/shared/workflow/plan-review-recovery.js"
    - "src/shared/workflow/decisions.js"
    - "src/shared/workflow/workflow-results.js"
    - "src/tools/plan-written.js"
    - "src/cmd/load-plan/index.js"
    - "src/agent-definitions/architect.md"
    - "src/agent-definitions/planner.md"
    - "src/shared/session/agent-handler.test.js"
    - "src/tools/__tests__/plan-written.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-27T16:46:20-04:00"
updatedAt: "2026-07-27T20:51:20.306Z"
status: "feedback"
origin: "internal"
---

# Deterministic Plan Review Resubmission

## Context

A user can ask a planning Agent to review, re-review, run, or otherwise continue an existing Plan, but RunWield
currently depends on the model to call the `plan_written` tool in that turn. If the model summarizes the Plan and stops,
no `plan_written` tool result exists, so `src/shared/session/agent-handler.js` has no workflow outcome to dispatch and
Plan Review does not open.

Current evidence:

- `src/tools/plan-written.js` already owns the correct Plan Review behavior once called: Plan existence checks, Plan
  Review launch, unanswered-review recovery, approval action normalization, readiness Plan Events, workflow metrics,
  feedback/image return, PROJECT decomposition, FEATURE execution, and approve-for-later handling.
- `src/shared/session/agent-handler.js` captures the current-turn message boundary and only dispatches workflow
  continuation from a fresh `plan_written` outcome. This correctly prevents stale Plan outcomes, but it has no
  deterministic fallback for a missed tool call.
- `src/shared/session/workflow-context-session.js` persists a lightweight workflow context including `planName`;
  `HostedSession.setWorkflowPlanName()` is called by `plan_written`, so many follow-up requests already have a durable
  current Plan pointer.
- `src/cmd/load-plan/index.js` already has deterministic loaded-Plan re-review behavior, including the
  `buildReReviewRevisionRequest()` prompt used when review feedback should be routed back to a planning Agent.
- `src/agent-definitions/planner.md` explicitly instructs Planner to call `plan_written` again for an existing submitted
  Plan when the user asks about continuing/reviewing/running/executing it. `src/agent-definitions/architect.md` lacks
  the equivalent instruction, which explains the observed Architect failure but is not sufficient as the only fix.
- Work Record `Recovered interrupted Plan Review flows` confirms the existing direction: Plan Review interruptions
  should be deterministic workflow outcomes, not misleading Agent handoffs.

## Objective

Make a user request such as “ok now let me review the plan”, “re-review the plan”, “submit it for review”, or “call
plan_written” reliably open Plan Review for the current or explicitly named Plan even when Planner or Architect fails to
call the tool.

The model should still be allowed to revise Plans, ask clarification questions, and call `plan_written` normally. The
deterministic path should activate only for high-confidence Plan Review activation requests and should reuse the same
Plan Review semantics as `plan_written`, including feedback, approval, save-for-later, PROJECT decomposition, FEATURE
execution, cancellation, and recovery.

This is worth doing only as a narrow workflow reliability fix, not as a broad natural-language classifier. The cutline
is: when the user explicitly asks to open/re-open/submit the known Plan for Plan Review, RunWield should treat that as a
workflow command and not rely on the Agent remembering tool ceremony. Ambiguous requests such as “review this for
accuracy” or “think through the Plan” should remain normal planning conversation. If implementation cannot keep the
trigger set conservative and well-tested, the fallback should be reduced to the safest explicit cases
(`call plan_written`, `open Plan Review`, `let me review the plan`) plus Architect prompt parity.

## Approach

Add a narrow deterministic Plan Review resubmission path around the existing planning turn rather than replacing
`plan_written`.

1. Introduce a small intent resolver for high-confidence Plan Review activation requests.
   - Scope it to planning Agents that can legitimately submit Plans (`planner` and `architect`).
   - Resolve the target Plan from an explicit `plans/<name>.md` mention first, then from
     `hostedSession.getWorkflowContext()?.planName`.
   - Treat direct phrases like “let me review the plan”, “re-review the plan”, “open plan review”, “submit/resubmit the
     plan for review”, “call plan_written”, “run the plan”, and “execute the plan” as activation requests when a Plan is
     known.
   - Avoid broad matches such as “review the plan for accuracy”, “compare this plan”, or “summarize the plan”, which
     should remain normal Agent conversation.
2. Refactor the Plan Review submission logic so `plan_written` and the deterministic fallback share the same
   implementation.
   - Keep `createPlanWrittenTool()` as the tool wrapper.
   - Extract the internal review-and-outcome flow into an exported helper that can return the same workflow details
     currently stored on the `plan_written` tool result.
   - Preserve tool-specific text/update behavior for actual tool calls, but let deterministic callers emit a clear
     RunWield system status such as `Opening Plan Review for plans/<name>.md.`
3. Run the deterministic path before the model only for pure Plan Review activation requests.
   - This eliminates the observed failure where the user only wants the browser review surface and the Agent answers
     conversationally instead.
   - If an approval outcome is returned, feed it into the existing `decidePostPlanning()` and downstream
     execution/Slicer dispatch path.
4. Run a fallback after the model turn for mixed requests that include Plan changes followed by review.
   - If the Agent produced a fresh `plan_written` outcome, do nothing extra.
   - If no fresh outcome exists, the request was recognized as asking for review after the Agent’s work, and a Plan
     target is known, open Plan Review deterministically.
   - This covers requests such as “make that wording explicit, then let me review the plan” when the model
     edits/summarizes but forgets the final tool call.
5. Preserve feedback semantics.
   - When deterministic Plan Review returns feedback instead of approval, route it back to the active planning Agent
     using the same wording as the loaded-Plan re-review path (`buildReReviewRevisionRequest()`), including review
     images/annotations.
   - Move or duplicate only the minimal shared prompt builder from `src/cmd/load-plan/index.js` into a shared workflow
     module so `load-plan` and `agent-handler` do not drift.
   - The follow-up planning turn must still be parsed through `readLatestPlanOutcome()` and dispatched through
     `decidePostPlanning()` so revised approvals, save-for-later, and execution behave normally.
6. Add prompt parity as a defense-in-depth improvement, not the primary guard.
   - Update `src/agent-definitions/architect.md` to include the same re-call requirement currently present in Planner:
     if an existing submitted Plan is already in this Session and the user asks about the Plan, asks to continue,
     review, run, execute, or otherwise proceed, call `plan_written` again for that Plan unless the user asked for
     changes first.
   - Keep Planner’s existing instruction, but tighten wording if needed so both Agents use the same Plan Review
     language.

## Files to Modify

- `src/shared/session/agent-handler.js` — detect deterministic Plan Review activation requests, invoke shared Plan
  Review submission when appropriate, prevent duplicate review if a fresh `plan_written` outcome exists, and route
  deterministic outcomes through the existing planning decision/execution/Slicer path.
- `src/tools/plan-written.js` — extract the reusable review submission flow currently embedded in
  `createPlanWrittenTool().execute()` while preserving the tool’s public name, parameters, streaming updates, details
  payload, termination behavior, metrics, and lifecycle events.
- `src/shared/workflow/plan-review-recovery.js` or a new `src/shared/workflow/plan-review-resubmission.js` — add shared
  helpers for high-confidence Plan Review request detection, Plan target resolution, deterministic review invocation,
  and feedback continuation prompt construction.
- `src/cmd/load-plan/index.js` — reuse the shared feedback continuation prompt instead of keeping a private
  `buildReReviewRevisionRequest()` copy if that prompt is needed by `agent-handler`.
- `src/shared/workflow/decisions.js` — update typedefs only if deterministic review produces a new internal outcome
  shape; prefer reusing existing `PlanOutcomeResult` and `decidePostPlanning()` unchanged.
- `src/shared/workflow/workflow-results.js` — update JSDoc typedefs if the shared helper reuses or exports
  `PlanOutcomeResult` details; avoid changing current message parsing semantics unless necessary.
- `src/agent-definitions/architect.md` — add explicit `plan_written` re-call guidance for existing submitted PROJECT
  Plans, matching Planner’s behavior.
- `src/agent-definitions/planner.md` — keep the existing guidance; optionally align wording with Architect if the new
  shared wording is clearer.
- `src/shared/session/agent-handler.test.js` — add regression coverage for pre-turn and post-turn deterministic Plan
  Review resubmission, duplicate prevention, feedback routing, and execution/Slicer dispatch.
- `src/tools/__tests__/plan-written.test.js` — adjust or extend tests around the extracted shared review helper so
  existing `plan_written` behavior remains unchanged.

No `CONTEXT.md` update is required because this change does not introduce new canonical domain language; it strengthens
existing Plan, Plan Review, and Plan Lifecycle behavior.

## Reuse Opportunities

- `src/tools/plan-written.js#createPlanWrittenTool` — source of truth for Plan Review submission semantics; extract from
  here rather than reimplementing review outcomes.
- `src/shared/workflow/plan-review-recovery.js#requestRecoverablePlanReview` — continue using this for unanswered Plan
  Review recovery.
- `src/shared/session/workflow-context-session.js#normalizeWorkflowPlanName` and `HostedSession.getWorkflowContext()` —
  use the existing persisted current Plan pointer when the user says “the plan”.
- `src/plan-store.js#getStoredPlanPath` and existing Plan front matter parsing helpers — validate explicit Plan paths
  safely and avoid path traversal.
- `src/cmd/load-plan/index.js#buildReReviewRevisionRequest` — move to a shared workflow helper and reuse for
  deterministic feedback routing.
- `src/shared/workflow/decisions.js#decidePostPlanning` — keep downstream workflow decisions centralized.
- `src/shared/session/agent-handler.js` existing post-planning branches — reuse the current `execute_plan`,
  `start_slicer`, `save_plan`, and `stay_with_agent` handling rather than adding a parallel dispatcher.

## Implementation Steps

- [ ] Add a shared resolver for deterministic Plan Review activation.
  - Create `src/shared/workflow/plan-review-resubmission.js` or extend `src/shared/workflow/plan-review-recovery.js`
    with pure helpers:
    - `resolvePlanReviewRequest({ userRequest, agentName, workflowContext, cwd })` returning `null` or
      `{ planName, timing: "before_turn"|"after_turn", reason }`.
    - `extractMentionedPlanName(userRequest)` for explicit `plans/<name>.md` or `<name>.md` mentions where safe.
    - `isPurePlanReviewActivationRequest(userRequest)` for pre-turn bypass.
    - `buildReReviewRevisionRequest(planName, feedback)` moved from `load-plan`.
  - Use high-confidence phrase matching only; prefer false negatives over accidentally opening Plan Review for a
    conversational request.
- [ ] Extract reusable Plan Review submission from `src/tools/plan-written.js`.
  - Keep `createPlanWrittenTool()` as the public tool factory.
  - Extract a helper such as
    `submitPlanWrittenReview({ cwd, planName, params, agentName, hostedSession, triageMeta, onUpdate, requestPlanReview, recordPlanEvent, recordWorkflowMetric, stat })`.
  - The helper should return the same result details currently produced by the tool wrapper, including `outcome`,
    `planName`, `triageMeta`, `feedback`, `imageCount`, and review images where applicable.
  - Preserve existing behavior for missing Plan files, invalid execution policy, remote review, cancellation, feedback,
    PROJECT readiness/decomposition, FEATURE readiness/execution, and approve-for-later.
- [ ] Wire pre-turn deterministic review in `src/shared/session/agent-handler.js`.
  - Before `runRootTurn()`, call the resolver for pure Plan Review activation requests by Planner/Architect.
  - If it resolves, invoke the shared Plan Review submission helper directly and skip the model turn.
  - Emit a RunWield system status explaining the deterministic action.
  - Feed the returned Plan outcome into the same post-planning decision path currently used for tool outcomes.
- [ ] Wire post-turn fallback in `src/shared/session/agent-handler.js`.
  - After `runRootTurn()` and before `decidePostPlanning()`, continue reading a fresh `plan_written` outcome from the
    current turn.
  - If a fresh outcome exists, do not run deterministic review.
  - If no outcome exists and the resolver identifies a review-after-work request for a known Plan, invoke deterministic
    Plan Review and use that outcome.
  - Record a planning workflow metric identifying that deterministic fallback substituted for a missing `plan_written`
    call.
- [ ] Preserve feedback routing for deterministic reviews.
  - If deterministic Plan Review produces feedback, call the planning Agent with
    `buildReReviewRevisionRequest(planName, feedback)` and pass review images/annotations.
  - Parse that continuation turn’s fresh `plan_written` outcome and dispatch it through `decidePostPlanning()`.
  - If the continuation still fails to produce an outcome, stay with the planning Agent and request attention; do not
    execute or decompose without approval.
- [ ] Avoid duplicate or stale Plan Review actions.
  - Ensure the deterministic path only considers the active turn’s missing outcome, preserving the existing
    `preTurnCount` stale-outcome protection.
  - Ensure a normal Agent `plan_written` call wins over fallback.
  - Ensure fallback never runs for Router, Engineer, Frontend Engineer, Operator, Guide, Tester, or Reviewer turns.
- [ ] Add Architect prompt parity.
  - Update `src/agent-definitions/architect.md` so an existing submitted Epic Plan must be re-submitted with
    `plan_written` when the user asks to review, continue, run, execute, decompose, or otherwise proceed, unless the
    user requested changes first.
  - Align Planner wording only if necessary; do not weaken the current instruction.
- [ ] Add regression tests.
  - In `src/shared/session/agent-handler.test.js`, cover:
    - Planner/Architect pure request like `ok now let me review the plan` with `workflowContext.planName` opens
      deterministic Plan Review without calling `runRootTurn()`.
    - Explicit `plans/public-site-app-separation.md` mention works without relying on workflow context.
    - If `readLatestPlanOutcome()` returns a fresh `plan_written` outcome, fallback is not invoked.
    - Mixed request like `make that explicit, then let me review the plan` runs the Agent once and then opens fallback
      review if no outcome appears.
    - Deterministic PROJECT approval with `decompose` calls `runSlicerAgent()` with review feedback/images.
    - Deterministic FEATURE approval with `run` calls `executePlan()` with review feedback/images.
    - Deterministic feedback invokes the planning continuation prompt and passes images.
    - Ambiguous conversational request such as `review the plan for accuracy` does not bypass the Agent.
  - In `src/tools/__tests__/plan-written.test.js`, confirm the extracted helper preserves existing tool behavior for
    approval, feedback, cancellation recovery, missing Plan file, invalid policy, and remote review.
- [ ] Update any affected JSDoc typedefs.
  - Follow the project’s JavaScript + JSDoc style: use `@typedef` object shapes rather than inline TypeScript syntax.
  - Do not add `.ts` files for this change.

## Verification Plan

- Automated:
  - `deno test src/shared/session/agent-handler.test.js src/tools/__tests__/plan-written.test.js src/shared/workflow/decisions.test.js`
  - `deno task fmt:check`
  - `deno task ci`
- Manual TUI checks:
  - Start or load a planning Session with a known Plan in footer/workflow context.
  - Ask: `ok now let me review the plan`.
  - Expected: RunWield opens the browser Plan Review surface even if the Agent would otherwise answer conversationally.
  - Approve a FEATURE Plan with Approve & Run.
  - Expected: execution starts through the normal workflow path.
  - Approve a PROJECT Epic with Decompose.
  - Expected: Slicer dispatch starts through the normal workflow path.
  - Submit feedback with an annotation/image.
  - Expected: Planner/Architect receives a revision prompt containing the feedback and image attachment, revises the
    Plan, and re-submits for review.
  - Ask: `review the plan for accuracy before we submit it`.
  - Expected: no pre-turn bypass; the planning Agent evaluates or asks clarifying questions normally.
- Expected results for key scenarios:
  - A missed model `plan_written` call no longer blocks Plan Review when the user clearly asked to review a known Plan.
  - Existing correct `plan_written` calls are not duplicated.
  - Stale Plan outcomes from earlier turns are still ignored.
  - Plan Review cancellation and unanswered-review recovery keep the existing session-complete behavior.
  - Approval, save-for-later, feedback, execution, and decomposition semantics match the current `plan_written`
    behavior.
- Glossary confirmation:
  - No `CONTEXT.md` changes are needed; existing terms Plan, Plan Review, Plan Lifecycle, PROJECT, FEATURE/legacy
    classification, and Plan Status remain accurate.

## Edge Cases & Considerations

- False positives are the main product risk and the main reason this Plan should stay small. Mitigation: use
  conservative phrase matching, require a known current or explicitly mentioned Plan, and prefer explicit
  workflow-command language over broad intent inference.
- If the safe trigger set feels too broad during implementation, ship the smaller version first: Architect prompt parity
  plus deterministic handling for explicit `call plan_written`, `open Plan Review`, and `let me review the plan`
  requests. Do not expand to fuzzy mixed requests without regression tests.
- Feedback from deterministic review happens outside a model tool call. Mitigation: route feedback through a bounded
  planning continuation prompt copied from the proven `load-plan` re-review flow.
- The deterministic path must not bypass required readiness or approval policy. Mitigation: reuse the extracted
  `plan_written` review submission logic and existing `decidePostPlanning()` dispatcher.
- The fallback should not hide invalid Plan policy. If the Plan fails `resolvePlanExecutionPolicy()`, return/stay with
  the planning Agent exactly as `plan_written` does.
- Workflow context may be absent or stale. Mitigation: explicit Plan path in the user request wins; otherwise require
  the persisted `workflowContext.planName` and Plan file existence.
- Remote Plan Review responses should remain save-for-review outcomes and must not trigger local execution/decomposition
  without approval.
- This is TUI/runtime workflow behavior, not browser-rendered UI work, so Engineer/autonomous execution is appropriate
  and headed browser verification is manual only for the Plan Review flow.
