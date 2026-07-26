---
planId: "e6f09a2a-f435-48aa-ae27-15c96f7db007"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Recover interrupted or failed Plan Reviews, rescue approved Plans that cannot be loaded for execution, and give users clear Session completion guidance."
affectedPaths:
    - "src/shared/workflow/plan-review-recovery.js"
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/decisions.js"
    - "src/shared/workflow/orchestrator.js"
    - "src/shared/session/agent-handler.js"
    - "src/tools/plan-written.js"
    - "src/ui/review/plan-review.js"
    - "src/cmd/load-plan/index.js"
    - "src/agent-definitions/planner.md"
    - "src/shared/workflow/plan-review-recovery.test.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/decisions.test.js"
    - "src/shared/session/agent-handler.test.js"
    - "src/tools/__tests__/plan-written.test.js"
    - "src/ui/review/plan-review.test.js"
    - "src/cmd/load-plan/index.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-25T17:04:00-04:00"
updatedAt: "2026-07-26T03:55:07.841Z"
status: "implemented"
origin: "internal"
failureReason: "Semantic validation did not approve after 3 cycles."
executionMode: "worktree"
executionBaselineTree: "412a5de3d7d5f8090036de1ba37a72990f022390"
worktreeId: "fc9b87ef"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-recover-interrupted-plan-review-fc9b87ef"
worktreeBranch: "runwield/worktree/recover-interrupted-plan-review-fc9b87ef"
worktreeBaseBranch: "main"
worktreeStatus: "validation_failed"
---

# Recover Interrupted Plan Review

## Context

A user approved a Plan through `plan_written`, but the subsequent execution dispatch could not load the Plan. RunWield
reported `Could not load plan`, moved toward Engineer intervention, and left the user without a deterministic way to
reopen Plan Review. The same dead end can occur when Plannotator returns no decision because its review times out,
launching or serving the review fails, or the user explicitly interrupts `plan_written` with Esc or Ctrl+C.

Current behavior also conflates some unanswered decisions with empty Feedback: the Workspace review timeout resolves a
canceled decision, but `submitPlanForReview` does not currently stop before recording `review_feedback`. Meanwhile,
`plan_written` treats adapter errors without review metadata as Feedback. Both paths can send Planner misleading empty
revision requests instead of offering recovery.

The requested behavior is a system-owned recovery loop. Whenever local Plan Review ends without an answer, or an
approved Plan cannot be loaded for execution, RunWield immediately asks **Review the Plan again?** with **Yes** and
**No** choices. Yes launches a fresh Plan Review. No, or canceling that confirmation, ends the current Session workflow
without changing the Plan and displays:

> This session is complete. To work on something new, make a new session with `/new` or close `wld`.

The same guidance must follow the canonical **Approve for Later** outcome (called “Save for Later” in the User Request),
after the existing command that tells the user how to resume the Plan. Ordinary Feedback remains in the Review Loop and
continues to Planner for revision.

Closing a browser tab is intentionally not detected. RunWield reacts when the existing review timeout expires, when the
review surface reports an error, or when Esc/Ctrl+C cancels the active runtime interaction. A future first-run tutorial
inside Plan Review is useful onboarding work but is outside this FEATURE.

## Objective

Make interrupted Plan Review and post-approval Plan-load failures recoverable without model improvisation or an
incorrect Engineer handoff. Preserve normal approval, Feedback, Plan Lifecycle, and execution semantics while giving
users an explicit way to reopen review or cleanly end the Session workflow.

Also strengthen Planner instructions so a same-Session request about, or to continue, review, or execute, an
already-submitted Plan causes an actual repeat `plan_written` call for the existing Plan, unless the user requested a
revision.

## Approach

Add an adapter-neutral Plan Review recovery coordinator in the shared workflow layer. It should classify a response as:

- **answered** — approval (including Approve for Later) or substantive Feedback;
- **unanswered** — timeout/exit, Esc/Ctrl+C cancellation, review launch/runtime error, blocked/unsupported interaction,
  or a malformed response with no semantic decision;
- **declined recovery** — the user selects No or cancels the recovery confirmation.

For unanswered review, issue a new approval interaction with the exact prompt `Review the Plan again?` and Yes/No
options. Yes starts a new review attempt with a fresh interaction and review surface; No or cancellation returns an
intentional Session-complete result. Keep this coordination above the TUI adapter so Esc/Ctrl+C can finish canceling the
original interaction before RunWield creates the follow-up prompt with a fresh abort controller.

Reuse that coordinator from `plan_written`, loaded-Plan re-review, and the execution load-failure path. Extract or share
review-result normalization and completion guidance rather than duplicating approval-action, lifecycle, and message
rules. A rescued review must flow back through the same readiness and post-planning decisions as an ordinary review:
Approve & Run retries loading and execution, Approve for Later prepares and saves the Plan, and Feedback returns to the
owning planning Agent for revision.

Represent intentional Session completion distinctly from incomplete execution. Update post-execution decision handling
so No/canceled recovery and Approve for Later do not activate Engineer or get reported as execution failure. Preserve
the planning Agent as the active Agent while instructing the user to use `/new` or close `wld` for unrelated work.

## Files to Modify

- `src/shared/workflow/plan-review-recovery.js` — add shared unanswered-review classification, retry confirmation loop,
  and the canonical Session-complete guidance string.
- `src/shared/workflow/workflow.js` — detect a structured Plan-load failure, invoke recoverable Plan Review, and route a
  valid rescued decision through normal readiness/planning/execution behavior instead of returning an opaque execution
  error.
- `src/shared/workflow/decisions.js` — distinguish intentional Session completion from canceled/incomplete execution so
  callers do not choose Engineer recovery.
- `src/shared/workflow/orchestrator.js` — honor the Session-complete execution decision in Router-dispatched FEATURE
  workflows without switching to Engineer; preserve normal validation after a successful rescued execution.
- `src/shared/session/agent-handler.js` — honor the same decision for direct Planner turns and avoid the misleading
  Engineer handoff shown in the reported case.
- `src/tools/plan-written.js` — use the recovery coordinator for canceled, errored, unsupported, or malformed Plan
  Review responses; preserve normal Feedback; append Session-complete guidance to recovery decline and Approve for
  Later.
- `src/ui/review/plan-review.js` — recognize timeout/exit decisions before Plan edits or Plan Events, return explicit
  cancellation metadata, and keep AbortSignal cancellation side-effect free.
- `src/cmd/load-plan/index.js` — apply the shared recovery loop to loaded-Plan re-review and show the same completion
  guidance after recovery decline or Approve for Later for both FEATURE Plans and Epics.
- `src/agent-definitions/planner.md` — instruct Planner to call `plan_written` again for the existing file when a user
  asks about, continues, reviews, or executes an already-submitted Plan in the same Session; edit first only when
  changes were requested, and never claim re-submission without the tool call.
- `src/shared/workflow/plan-review-recovery.test.js` — cover response classification, Yes retry loops, No/canceled
  confirmation, fresh attempts, and malformed/error outcomes.
- `src/shared/workflow/workflow.test.js` — cover execution load-failure rescue, reapproval and retry, repeated review
  failure, Approve for Later, Feedback routing, and recovery decline.
- `src/shared/workflow/decisions.test.js` — cover the intentional Session-complete decision and ensure existing
  execution cancellation remains unchanged.
- `src/shared/session/agent-handler.test.js` — prove load-failure recovery does not switch to Engineer when the user
  ends recovery or saves for later.
- `src/tools/__tests__/plan-written.test.js` — replace terminal-on-first-cancel expectations with retry confirmation
  coverage and assert completion guidance for No/canceled confirmation and Approve for Later.
- `src/ui/review/plan-review.test.js` — prove timeout/exit and AbortSignal cancellation do not write the Plan or record
  `review_feedback`.
- `src/cmd/load-plan/index.test.js` — cover re-review retry/decline and completion guidance for FEATURE and PROJECT
  Approve for Later flows.

## Reuse Opportunities

- `src/shared/session/session-runtime-interactions.js` — reuse `PLAN_REVIEW`, `APPROVAL`, normalized outcomes, and fresh
  HostedSession interaction requests rather than adding a TUI-only prompt API.
- `src/ui/tui/runtime-interaction-adapter.js` — preserve its existing Plan Review adapter and `promptSelect` approval
  behavior; recovery coordination should call it through SessionRuntime rather than embedding retry state here.
- `src/shared/workflow/plan-approval.js` — reuse canonical `run`, `decompose`, and `later` normalization so rescued
  review cannot drift from normal Plan Review.
- `src/tools/plan-written.js` — reuse/extract `buildFeedbackRequestText`, review metadata projection, Plan Event
  recording, and existing resume-command messages.
- `src/shared/workflow/workflow.js#runPlanningAgent` — return rescued Feedback to Planner through the established Review
  Loop instead of synthesizing an Engineer intervention.
- `src/shared/workflow/decisions.js#decidePostPlanning` and `decidePostExecution` — preserve the existing semantic
  dispatch boundary and add an explicit intentional-completion branch.
- `src/ui/tui/keybindings.js` and `HostedSession.cancelActiveInteractions()` — rely on existing Esc/Ctrl+C cancellation;
  do not introduce new key handling.

## Implementation Steps

- [ ] Add a pure-JavaScript/JSDoc Plan Review recovery module that accepts caller-provided review and confirmation
      request functions, loops on unanswered outcomes, returns answered review metadata unchanged, and returns an
      explicit Session-complete result for No or a canceled confirmation. Use the exact prompt and completion copy
      agreed above.
- [ ] Define unanswered outcomes precisely: canceled timeout/exit, AbortSignal cancellation from Esc/Ctrl+C,
      blocked/unsupported interaction, thrown/normalized review error, missing response, or a response lacking approval,
      Feedback, and remote-review semantics. Do not classify valid empty annotation state as Feedback.
- [ ] Update `submitPlanForReview` to inspect `decision.canceled`/`decision.exit` before canonical Plan writes or Plan
      Events. Return a typed cancellation reason when available, always stop the review server in `finally`, and
      preserve existing approval and substantive Feedback behavior.
- [ ] Replace `plan_written`'s one-shot request with the recovery coordinator. Keep tool-block output and fresh review
      URLs updated for every attempt. On Yes, reopen Plannotator; on No or canceled confirmation, record a canceled
      review metric, terminate the tool, and emit the Session-complete guidance without recording approval or Feedback
      events.
- [ ] Centralize the completion guidance and append it after existing resume instructions for all local normalized
      `later` outcomes, including FEATURE **Approve for Later**, Epic **Approve for Later**, and loaded-Plan re-review.
      Do not relabel remote review as Approve for Later or alter its asynchronous semantics.
- [ ] Replace the generic `Could not load plan` dead end with a structured execution load-failure result/cause. Before
      choosing an execution owner, invoke the same recovery coordinator using the conventional Plan path and trusted
      post-review metadata from the approved outcome.
- [ ] Route a rescued answered decision through established semantics: re-run the Readiness Gate after reapproval; retry
      Plan loading/execution only for `run`; save and intentionally complete for `later`; and pass Feedback plus images
      to Planner for revision. If the fresh review itself errors or times out, return to the Yes/No recovery prompt
      rather than switching Agents or manufacturing Feedback.
- [ ] Extend post-execution decisions and both workflow callers so intentional Session completion is terminal for the
      current workflow but not an execution failure. It must not run validation, activate Engineer, or claim the Plan is
      loaded/executing.
- [ ] Apply the coordinator to `/load-plan` re-review so timeout, error, Esc, and Ctrl+C follow the same Yes/No
      behavior; explicit No or prompt cancellation shows completion guidance and leaves the Plan at its pre-attempt
      lifecycle state.
- [ ] Add the Planner prompt rule for already-submitted Plans. Ensure the language requires a real repeated
      `plan_written` call when the user asks about that Plan or says “continue,” “review the Plan,” or “execute the
      Plan,” while preserving edits when the user asks for changes.
- [ ] Add focused regression tests across review transport, tool outcome handling, workflow dispatch, loaded-Plan flows,
      and prompt content. Assert Plan Events and Agent transitions, not only displayed strings.

## Verification Plan

- Automated: run
  `deno test -A src/shared/workflow/plan-review-recovery.test.js src/ui/review/plan-review.test.js src/tools/__tests__/plan-written.test.js src/shared/workflow/workflow.test.js src/shared/workflow/decisions.test.js src/shared/session/agent-handler.test.js src/cmd/load-plan/index.test.js`.
- Automated: run `deno fmt --check` and `deno task ci`; fix all failures.
- Manual TUI: start Plan Review from `plan_written`, press Esc, verify `Review the Plan again?` appears immediately,
  choose Yes, and verify a fresh review surface opens and can Approve & Run normally.
- Manual TUI: repeat with Ctrl+C, then choose No; verify the exact Session-complete guidance appears and no Engineer
  handoff or Plan Event occurs. Repeat by canceling the Yes/No prompt and verify it has the same terminal behavior.
- Manual TUI: simulate/inject review launch failure and timeout through test seams; verify each reaches the Yes/No
  prompt and never appears as empty Feedback.
- Manual TUI: approve a FEATURE Plan for later and an Epic for later; verify the existing resume command is followed by
  the Session-complete guidance.
- Manual TUI: force `loadPlan` to fail after Approve & Run, choose Yes, and verify re-review approval retries execution;
  choose Approve for Later and verify intentional completion; send Feedback and verify Planner receives it for revision.
- Manual TUI: after an interrupted/submitted Plan, send `continue` to Planner and verify Planner calls `plan_written`
  again instead of only narrating re-submission.
- Expected: normal first-pass approval, substantive Feedback, remote-review save, `/load-plan`, Workflow Validation, and
  unrelated execution cancellation behavior remain unchanged.
- Execution policy matrix:
  - FEATURE Plans may omit `executionAgent`; omission defaults to `engineer` for backward compatibility.
  - FEATURE Plans may set `executionAgent: "engineer"` with `collaborationRecommendation: "autonomous"` or omitted.
    `pair` is invalid for Engineer-owned execution.
  - FEATURE Plans may set `executionAgent: "frontend-engineer"` with `collaborationRecommendation: "autonomous"` or
    `"pair"`.
  - Use `frontend-engineer` for browser-rendered UI work whose primary outcome is materially visual or interactive;
    otherwise use `engineer` (including TUI work and incidental frontend-file edits).
  - Recommend `pair` only when live visual judgment is valuable; use `autonomous` otherwise. Include known dev-server
    hints and exact headed-browser checks. Real-browser verification is mandatory for Frontend Engineer unless
    externally blocked.
  - PROJECT Epics are non-executable containers and must not define `executionAgent` or `collaborationRecommendation`;
    execution policy belongs only on child FEATURE Plans.
  - Legacy `frontend: true` on FEATURE Plans is still accepted as Frontend Engineer/autonomous compatibility metadata,
    but new Plans should use canonical `executionAgent` / `collaborationRecommendation` instead. Legacy
    `frontend: false` remains Engineer compatibility metadata and is distinct from an absent canonical owner.

## Edge Cases & Considerations

- A truly missing, unreadable, or malformed Plan may fail every fresh review attempt. Each failure should return to the
  Yes/No prompt; RunWield must not claim success. The user can select No/cancel, restore the file externally, or later
  use the normal Plan-loading workflow.
- The review confirmation needs a fresh runtime interaction. Reusing the aborted review signal can race with
  `Promise.race` cleanup and produce a hidden/background prompt.
- Closing the browser tab is not an immediate signal. Preserve the current timeout as the fallback and do not add
  `beforeunload`/beacon behavior in this FEATURE.
- No/canceled confirmation must preserve the Plan's pre-attempt status and content. A timeout or launch error is not
  Feedback and must not write `failureReason` or trigger `review_feedback`.
- Reapproval after a load failure may reopen a Ready For Work Plan. Ensure Plan Events transition through the existing
  Review Loop and Readiness Gate exactly once per answered attempt; do not double-record readiness merely because a load
  retry occurs.
- The Session-complete message is guidance, not a hard Session lock. RunWield should not disable `/new`, shutdown, or
  reject subsequent input.
- The broader Planner fallback is defense in depth, not the primary recovery mechanism. System-owned recovery should
  work even if no model turn runs after cancellation.
- A first-run Plan Review tutorial/onboarding treatment remains a separate future FEATURE requiring its own UX decisions
  and browser validation.
