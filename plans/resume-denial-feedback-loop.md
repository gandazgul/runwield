## Context

- In `src/cmd/resume/index.js`, approved-plan -> `review` currently calls `submitPlanForReview()` once, and if denied it
  prints a rerun hint and returns. The `finally` then restores Router, which breaks the iterative revise/resubmit UX.
- `src/shared/workflow/workflow.js` already has the canonical denial-feedback loop (`reviewLoop`) that feeds structured
  feedback back to planner/architect and retries up to `maxRevisions`.
- User requirement: centralize the plan loop in one place and reuse it for both Router and Resume flows:
  - Router -> plan loop -> execute or save
  - Resume -> plan loop (if chosen) -> execute or save

## Approach

- Introduce a single shared workflow entrypoint in `src/shared/workflow/workflow.js` (e.g., `runPlanLifecycle`) used by
  both Router and Resume.
- `runPlanLifecycle` will unify these phases:
  1. **Planning/revision phase**
     - If starting from a user request, call existing `reviewLoop(...)` with
       `{ agentName, initialRequest, triageMeta, customTools }`.
     - If starting from an existing plan file (resume approved->review), run a targeted `reReviewLoop(...)` inside
       workflow.js that:
       - repeatedly calls `submitPlanForReview(...)`,
       - on denial, constructs the same structured-feedback prompt style currently used in `reviewLoop`,
       - invokes `runAgentSession(...)` + `resolveDeclaredPlan(...)` for same plan name,
       - repeats until approved (no fixed retry cap).
     - Escape handling while waiting on Plannotator review should be treated as a user cancellation of the review wait
       (not a denial), returning control to interactive mode without forcing a Router switch.
  2. **Post-approval decision phase**
     - For FEATURE: use `askPostApproval(...)`.
     - For PROJECT: use `askApprovalWithTasks(...)`.
  3. **Execution phase**
     - If user chooses proceed, call `executePlan(...)` and keep current repair-loop behavior for PROJECT task table
       failures.
     - If save, emit standardized resume guidance message once.
- Refactor both `src/cmd/router/index.js` and `src/cmd/resume/index.js` to delegate to this shared entrypoint, keeping
  only route-specific triage/request setup.
- Remove the manual rerun hint on denial in resume review path once shared iterative behavior is in place.

## Files to modify

- `src/shared/workflow/workflow.js` (new shared orchestrator for plan loop + post-approval decision/execution)
- `src/cmd/router/index.js` (reuse shared orchestrator for FEATURE/PROJECT)
- `src/cmd/resume/index.js` (reuse shared orchestrator for resume planning/review paths; remove denied rerun hint)
- `src/cmd/resume/index_test.js` (assert denial continues through loop and no rerun-hint behavior)
- `src/cmd/router/index_test.js` (adjust expectations if control flow/messages move to shared helper)
- `README.md` and/or command notes if wording still implies manual rerun after denial

## Reuse

- `reviewLoop()` in `src/shared/workflow/workflow.js` for structured denial feedback prompt format and iterative
  revision behavior.
- `submitPlanForReview()` + `cancelActivePlanReview()` in `src/shared/workflow/submit-plan.js` for Plannotator lifecycle
  and Esc cancellation integration.
- `askPostApproval()` / `askApprovalWithTasks()` in `src/shared/workflow/workflow.js` for execute-or-save UX.
- `executePlan()` in `src/shared/workflow/workflow.js` for execution and task-table repair handling.
- Existing Router/Resume triage and prompt builders (keep route-specific initial prompt construction, but hand off to
  shared plan loop orchestrator).

## Steps

- [ ] Add shared lifecycle helper(s) in `src/shared/workflow/workflow.js`:
  - reusable denial-feedback prompt builder (single source of truth),
  - shared plan lifecycle entrypoint for plan->approve->execute/save,
  - resume re-review loop for existing plans that reuses the same denial-feedback prompt format,
  - unbounded human-in-the-loop retries (remove fixed `maxRevisions` stop behavior for this lifecycle).
- [ ] Refactor Router FEATURE/PROJECT branches to call the shared lifecycle entrypoint (preserving triage-specific
      initial prompts and existing sessionManager side effects).
- [ ] Refactor Resume to call the same shared lifecycle entrypoint for:
  - draft/denied/in_review plans,
  - approved->review path (iterative denial handling in-process, no manual rerun required).
- [ ] Ensure Esc during `submitPlanForReview` wait exits the review wait cleanly and leaves the user in interactive mode
      with the active planning agent (planner/architect), rather than forcing a Router handoff.
- [ ] Remove/replace resume-specific denial messaging that tells users to rerun `hns resume ...`.
- [ ] Update tests in `src/cmd/resume/index_test.js`:
  - denied approved->review path continues loop (not immediate return),
  - feedback is forwarded to planner/architect revision request,
  - old rerun-hint message no longer emitted.
- [ ] Update `src/cmd/router/index_test.js` only where delegation affects expectations (ensure behavior unchanged from
      user perspective).
- [ ] Update docs/help wording if it still implies manual rerun after denial.
- [ ] Run verification commands.

## Verification

- `deno test src/cmd/resume/index_test.js`
- `deno test src/cmd/router/index_test.js`
- `deno run ci`

## Decisions from User

- Continue the loop automatically until plan approval.
- Remove rerun hint once looping is implemented.
- Keep this loop centralized and reused by both Router and Resume.
- Retries should be effectively unbounded for human-in-the-loop plan revisions.
- Esc while waiting on Plannotator review should cancel waiting and return to interactive mode with planner/architect as
  the active context (escape hatch to continue later).
