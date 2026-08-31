---
planId: "c4f4bd36-cb3c-4972-a9b7-dbc6b5b84bab"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "HIGH"
affectedPaths:
    - "src/shared/workflow/workflow-tool-events.ts"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/agent-handler.ts"
    - "src/shared/session/session.js"
    - "src/shared/session/backends/claude-cli/"
    - "src/shared/workflow/"
    - "src/tools/"
    - "docs/domain-language.md"
    - "docs/architecture.md"
    - "docs/adr/006-uniform-agent-handler-workflow-tools.md"
tickets:
    - url: "https://app.todoist.com/app/task/make-terminal-workflow-tools-authoritative-in-every-path-6hFm55r9wQpjmFCC"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-30T18:01:47-04:00"
status: "validated"
origin: "internal"
userVerifiedAt: null
workRecord:
    status: "generated"
    recordId: "8106889d-c62b-4b01-b6ce-39a7c373bb98"
    path: "docs/work-records/2026-08-31-workflow-tool-events-became-authoritative.md"
    lastAttemptAt: "2026-08-31T15:05:17.982Z"
targetBranch: "main"
---

# Make Workflow Tool Events Authoritative

## Context

RunWield says that workflow progress comes from Custom Tools, not Agent prose. The implementation does not yet enforce
that rule consistently. `triage_report`, `plan_written`, `task_completed`, `review_complete`, and
`qa_checklist_generated` return structured results, but several root, planning, validation, repair, and continuation
paths wait for the Agent turn to stop and then search returned messages for those results. `review_diff` inspection is
also established from Reviewer messages before `review_complete` can be trusted.

This creates a timing and ownership defect. An accepted tool call can be lost between tool completion and post-turn
message inspection, a delayed backend can hold workflow progress after the result is known, and a transcript-shaped
result can become an accidental workflow authority. The defect exists in both Pi and Claude CLI paths. Root
`task_completed` calls have a durable accepted/consumed outbox, but live handling still waits for turn completion and
isolated repair handling still searches messages.

The user expanded the Todoist task scope from its three named tools to every Custom Tool that moves or gates a workflow.
Tools that already complete their transition inside `execute` without transcript inspection remain direct authorities;
they must be included in the audit and regression contract.

## Objective

Make an accepted workflow Custom Tool call the only live signal that can route, advance, pause, resume, approve, reject,
or complete a workflow. Deliver each cross-owner result through a typed, owner-scoped, consume-once Workflow Tool Event
before the Agent turn ends. Keep transcripts as display and audit history only. Preserve durable recovery through Plan
and controller state, validation checkpoints, and a generalized root Session outbox rather than transcript replay.

## Approach

Add one application-owned Workflow Tool Event module. A tool publishes an event only after its arguments and semantic
result are accepted and after any prerequisite write succeeds. The event contains the tool-call ID, typed payload,
source Session/turn ownership, workflow attempt or validation generation, and accepted timestamp. The live owner claims
it once. Root events also use a Session JSONL accepted/settled outbox so a process restart can continue an accepted
event without reading a `toolResult` message. Existing unconsumed `runwield.task_completion` entries remain readable
during the compatibility period.

```text
accepted workflow tool call
  -> publish owner-scoped Workflow Tool Event
  -> wake the registered root or isolated workflow owner
  -> claim once and start the transition
  -> reach a durable lifecycle/checkpoint boundary
  -> settle the event

Agent transcript
  -> UI, audit, metrics, and non-authoritative prose only
```

Root and isolated turn runners register the expected event kinds before they start the Agent turn. They react to the
event as soon as the accepted tool returns; they do not wait for backend idle or process exit before they start the
workflow transition. Terminal events request orderly source-turn shutdown. Late prose, duplicate calls, and late backend
exit cannot start a second transition. If a turn stops without the required event, the existing blocker, nudge, or pause
behavior remains.

Apply the event handoff to all results that a separate workflow owner currently discovers from messages:

- `triage_report` — routing and specialist dispatch.
- `plan_written` — save/feedback/approval outcome, Plan execution, or Epic decomposition.
- `task_completed` — operation completion, QUICK_FIX validation, Plan implementation completion, and isolated repair
  completion.
- `review_diff` — accepted inspection evidence for the current Reviewer round.
- `review_complete` — Semantic Review approval or blocking findings.
- `qa_checklist_generated` — accepted Epic-child Manual QA artifact.

Audit direct-authority tools (`slicer_finalize_decomposition`, `pair_checkpoint`, the final Pair decision inside
`task_completed`, `user_interview`, and `init_save_verification_command`) and keep their transitions inside the accepted
tool execution. They must not gain a transcript reader. `user_interview` resumes the same model call and is an
interaction rather than a cross-owner workflow handoff.

Keep assistant-text extraction only for human-readable reports, blockers, and `delegate_agent` handoffs. Such text can
explain why work paused but cannot prove completion or trigger a transition.

The set-aside option is to add callbacks separately to each tool. That is smaller at first, but it repeats ownership,
deduplication, backend, and recovery rules and makes the next workflow tool likely to restore transcript scanning.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/workflow/workflow-tool-events.ts` (new) — own the typed event union, accepted/claimed/settled states,
  owner and attempt matching, live waiters, duplicate rejection, and root outbox compatibility.
- `src/shared/session/hosted-session.js` and `src/shared/session/task-completion-session.ts` — host or delegate the live
  event inbox; generalize the current Task Completion fast path/outbox without losing old pending completion recovery.
- `src/tools/triage-report.ts`, `src/tools/plan-written.ts`, `src/tools/task-completed.ts`,
  `src/tools/review-complete.ts`, `src/tools/qa-checklist-generated.ts`, and `src/shared/workflow/review-diff-tool.js` —
  publish accepted typed payloads at the authoritative point and never publish rejected or failed calls.
- `src/shared/session/agent-handler.ts`, `src/shared/workflow/planning-agent.ts`, `src/shared/workflow/orchestrator.ts`,
  and `src/shared/workflow/engineer-runner.ts` — consume root routing, planning, and completion events instead of
  current-turn message slices.
- `src/shared/workflow/validation-session-adapter.ts`, `src/shared/workflow/validation-helpers.ts`,
  `src/shared/workflow/validation-semantic.ts`, and `src/shared/session/session-runtime.js` — consume isolated review,
  repair, QA, and continuation events; keep blocker prose non-authoritative.
- `src/shared/session/session.js` — connect Pi tool completion and orderly terminal-turn shutdown to the event lifecycle
  without using display Runtime events as workflow authority.
- `src/shared/session/backends/claude-cli/mcp-bridge.ts` and its execution-session/backend callers — publish the same
  accepted event after delegated tool validation, return the MCP result, and stop terminal turns without waiting for or
  trusting later Claude output.
- `src/shared/workflow/workflow-results.js` — remove workflow-transition readers; retain or relocate only presentation
  helpers that do not decide workflow state.
- Direct-authority tool modules and their tests — prove that Slicer, Pair, interview, and Init transitions remain direct
  and never acquire transcript consumers.
- `docs/domain-language.md` — define Workflow Tool Event and its relation to Custom Tool, Session outbox, transcript,
  lifecycle owner, and validation checkpoint.
- `docs/architecture.md`, `docs/sessions.md`, `docs/workflows.md`, `docs/validation-authority.md`, and
  `docs/adr/006-uniform-agent-handler-workflow-tools.md` — replace the post-turn inspection model with direct event
  delivery and document live versus restart authority.

## Reuse Opportunities

- `src/shared/session/task-completion-session.ts` — reuse its accepted/consumed JSONL outbox, workflow-attempt matching,
  root ownership checks, claim-before-settle contract, and legacy recovery tests.
- `src/shared/session/hosted-session.js` — reuse active steering-target identity, active turn ID, workflow context, and
  validation generation to scope events.
- `src/shared/workflow/decisions.js` — keep semantic routing decisions after a typed event is consumed; only replace how
  the decision input arrives.
- `src/shared/workflow/validation-supervisor.ts` and validation checkpoint modules — keep durable repair generation,
  Review Issue, and restart recovery authority after an isolated event is consumed.
- `src/shared/session/session-runtime-events.js` — continue display events for UI progress, but do not reuse them as the
  workflow event channel because UI delivery is not consume-once workflow ownership.
- `src/shared/session/backends/claude-cli/mcp-bridge.ts` — reuse serialized MCP calls, accepted terminal gating,
  canonical transcript recording, and tool-call IDs.

## Implementation Steps

- [ ] `src/shared/workflow/workflow-tool-events.ts` owns a closed typed union for routing, Plan review, Task Completion,
      Reviewer inspection, Reviewer completion, and Manual QA outcomes. Each accepted event carries a stable
      event/tool-call ID, source owner, turn ID, workflow attempt or validation generation where applicable, payload,
      and accepted time.
- [ ] The event owner can register before a turn, receive an event published before backend turn completion, claim it at
      most once, and settle it only after the corresponding lifecycle or validation checkpoint is safe to retry from.
      Duplicate publication, a wrong owner, a stale turn, and a stale workflow generation cannot advance state.
- [ ] Root Workflow Tool Events use one accepted/settled Session outbox contract. Restart claims do not inspect
      transcript messages, and legacy unconsumed `runwield.task_completion` entries still resume and settle exactly
      once.
- [ ] `triage_report`, `plan_written`, `task_completed`, `review_diff`, `review_complete`, and `qa_checklist_generated`
      publish only accepted semantic results. Invalid arguments, rejected approval with open findings, Pair
      revisions/stops, failed Plan review, failed diff reads, and invalid Manual QA do not publish a false advancing
      event.
- [ ] Pi and Claude CLI deliver the same event payload and ownership semantics. A terminal accepted event ends its
      source turn in an orderly way, but dispatch or validation starts from the event before backend idle/process exit.
      Late assistant prose and late tool-result persistence have no workflow effect.
- [ ] Root Agent handling, initial dispatch, planning/re-review/load-plan flows, Plan/Epic execution, OPERATION and
      QUICK_FIX completion, and steering continuations consume events rather than calling `readLatestTriageOutcome`,
      `readLatestPlanOutcome`, or Task Completion transcript readers.
- [ ] Isolated Semantic Review, Reviewer nudges, validation repairs, repair continuation, and Epic Manual QA consume
      owner- and generation-scoped events. A Reviewer round cannot approve without both accepted `review_diff` evidence
      and an accepted `review_complete` event from that round.
- [ ] A turn that stops without its required accepted event remains incomplete: Router does not dispatch, planning does
      not execute or decompose, implementation and repair do not validate, Reviewer omission still receives its bounded
      nudge, and invalid Manual QA still blocks delivery. Assistant prose can explain the stop but cannot change it.
- [ ] `workflow-results.js` and `orchestrator.ts` no longer expose transcript readers that return workflow decisions.
      Remaining transcript parsing is named and documented as presentation or non-authoritative handoff extraction, and
      no production workflow transition module imports a tool-result scanner.
- [ ] Direct-authority tools (`slicer_finalize_decomposition`, `pair_checkpoint`, `user_interview`, and
      `init_save_verification_command`) retain their accepted in-tool state/interaction behavior and have tests that
      prove no returned-message scan is required. `delegate_agent` prose remains a non-authoritative parent handoff.
- [ ] Existing Plan lifecycle, controller, worktree, validation-checkpoint, Review Issue, and publication ownership does
      not move into the event module. The event outbox remains a handoff that is settled after those authorities record
      a safe boundary.
- [ ] Current tool-result messages, runtime tool blocks, metrics, workflow messages, and transcript projections remain
      available for users and diagnostics, but replaying or injecting them cannot route or advance a workflow.
- [ ] `docs/domain-language.md`, architecture, Session, workflow, validation-authority, and ADR-006 text describe the
      implemented direct-event call path, consume-once behavior, recovery sources, and the prohibition on
      transcript-based transition inference.

## Approval Confirmation

This Plan does not declare any Work Record supersession. It extends the verified Task Completion outbox and structured
Reviewer completion work rather than replacing their historical record.

## Verification Plan

- Automated event-module and tool tests:
  `deno run -A scripts/run-tests.js src/shared/workflow/workflow-tool-events.test.ts src/tools/__tests__/task-completed.test.js src/tools/__tests__/plan-written.test.js src/tools/__tests__/review-complete.test.js src/tools/qa-checklist-generated.test.ts`
- Automated root and backend tests:
  `deno run -A scripts/run-tests.js src/shared/session/agent-handler.test.ts src/shared/session/task-completion-session.test.ts src/shared/session/claude-cli-execution.test.ts src/shared/session/backends/claude-cli/mcp-bridge.test.ts src/shared/session/backends/claude-cli/claude-cli-backend.test.ts`
- Automated workflow tests:
  `deno run -A scripts/run-tests.js src/shared/workflow/orchestrator.test.ts src/shared/workflow/agent-runners.integration.test.ts src/shared/workflow/validation-loop-review.test.js src/shared/workflow/validation-completion-gating.test.ts src/shared/workflow/validation-repair-resume.integration.test.ts src/shared/workflow/validation-loop-delivery.test.js src/shared/workflow/implementation-checkpoint-completion.test.ts`
- Architecture and full checks: `deno task seams:check` and `deno task ci`.
- Add timing tests for Pi and Claude CLI that hold the source turn/process open after an accepted terminal tool call.
  The test must observe routing, execution, or validation start before the held turn is released, then release it and
  prove the transition count remains one. A post-turn scanner or pass-through event wrapper fails this test.
- Add root behavior tests for `triage_report`, `plan_written`, and `task_completed` in which the returned message array
  is empty or contains forged/stale tool results. A real accepted event advances once; forged prose/tool-result messages
  and old-turn events do not advance.
- Add isolated behavior tests for `review_diff` plus `review_complete`, repair `task_completed`, and
  `qa_checklist_generated`. Hold the isolated turn open after the accepted event and prove the current validation
  generation advances; omit or reject the tool and prove validation stays paused or nudges the same Reviewer.
- Preserve restart tests that reopen real JSONL Session state. An accepted root event resumes from the outbox once, an
  event settled after a durable checkpoint does not replay, and a legacy pending Task Completion still resumes.
- Preserve behavior expected after the refactor: structured tool-result transcript display, blocker text, Reviewer
  omission nudges, Pair decisions, Slicer finalization, Init command confirmation, lifecycle checkpoints, and validation
  repair recovery. Behavior expected to stop existing: any transition caused by current-turn indexes, returned-message
  search, persisted `toolResult` replay, Claude post-terminal prose, or assistant text that resembles a tool result.
- Manual inspection: run one Router-to-QUICK_FIX flow and one PLANNED_CHANGE validation flow with tool/runtime output
  visible. Confirm each transition begins on the accepted tool block, later transcript output remains display-only, and
  no transition repeats after a continuation or Session reload.
- Confirm the glossary and architecture documents name the same implemented owners and do not describe transcripts or UI
  Runtime events as workflow authority.

## Edge Cases & Considerations

- **Event before listener:** register the owner before starting the Agent turn and retain an unmatched accepted event in
  the scoped inbox/outbox until its valid owner claims it.
- **Crash after acceptance:** root outbox recovery claims the event; Plan/controller or validation state decides whether
  to continue, settle, or discard it. Isolated validation restarts from its durable checkpoint and generation rather
  than replaying an isolated transcript.
- **Crash after transition but before settlement:** the consumer first compares authoritative lifecycle/checkpoint
  state, makes the transition idempotent, then settles the event.
- **Duplicate or competing consumers:** event ID, source owner, turn, workflow attempt, and validation generation
  prevent a root handler, repair continuation, and isolated adapter from claiming the same result.
- **Rejected terminal-looking calls:** `terminate` alone is not acceptance. The tool-specific accepted outcome controls
  publication; Pair checkpoint outcomes and rejected Reviewer approval remain non-advancing unless their direct tool
  logic explicitly changes Pair state.
- **Backend shutdown:** return the Claude MCP response before stopping the source process, classify event-driven
  terminal shutdown as success, and drain transcript/runtime display output without letting it gate workflow work.
- **Report text:** Task Completion reports and blocker prose can still populate Manual QA, status, and Work Records
  after the event payload supplies the trusted completion fact. Empty or persuasive prose cannot substitute for the
  event.
- **Compatibility:** keep transcript serialization and the old Task Completion outbox reader long enough to resume
  Sessions created before this change. Do not create compatibility readers that infer new events from old tool-result
  messages.
- **Zero-seam rule:** the event mechanism is RunWield-owned machinery, not a dependency-injection seam. Tests use real
  HostedSession, SessionManager, Git, Plan, and validation fixtures.
