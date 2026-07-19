# Product Requirements Document: Session Context Resilience

Last updated: 2026-07-18 11:23 EDT

## Objective

Make long-running RunWield Agent Sessions resilient to context-window pressure during autonomous model/tool activity,
not only before a User Request or after an Agent Session becomes idle.

RunWield should compact early enough to avoid preventable overflow, continue interrupted work safely, and stop automatic
compaction when another attempt would make no useful progress.

## Problem Statement

RunWield currently checks whether compaction is needed before submitting a prepared User Request. Pi also provides its
own threshold and overflow compaction paths. Those protections do not guarantee that context is re-evaluated soon enough
during one long autonomous run that chains many model and tool turns before becoming idle.

This matters particularly for execution, validation repair, research, and other workflows that can perform many tool
calls under one outer Runtime turn. Context may grow substantially after RunWield's pre-prompt check. If compaction
happens only after overflow, the Agent Session may lose time, repeat work, or become difficult to recover. Repeated
automatic compaction can also become harmful when the remaining context is not meaningfully compressible.

The current little-coder architecture demonstrates this failure mode against the same Pi ecosystem. Its wrapper now
monitors context during autonomous activity, resumes work after mid-run compaction, and pauses automatic compaction when
a compaction fails or frees too little context. RunWield should verify the failure independently and adopt the product
semantics that prove necessary rather than copying its implementation verbatim.

## Resolved Assumptions

### Universal Runtime Reliability

- Session Context Resilience is a Core reliability capability, not a small-model adaptation.
- It should protect supported Agent/model combinations without changing Routing Intent, Agent ownership, Plan Status, or
  validation semantics.
- TUI and ACP must observe the same behavior through the existing consumer-neutral `SessionRuntime` boundary.

### Pi Remains the Compaction Engine

- RunWield should continue using Pi's compaction and session-summary machinery.
- This capability coordinates when compaction runs and what happens afterward; it does not introduce a competing
  summarizer or transcript format.
- Existing user controls for manual compaction, automatic compaction, resume compaction, and cancellation remain valid.

### Context Health Is a Control Loop

- RunWield should observe context pressure during autonomous activity, not only at the outer User Request boundary.
- At most one automatic compaction may be active for an Agent Session at a time.
- After compaction, RunWield should measure whether meaningful headroom was recovered before permitting another
  automatic attempt.
- A failed or ineffective compaction should pause automatic retries and surface a recoverable state instead of entering
  a compaction loop.
- Automatic monitoring may re-arm after context pressure genuinely falls below a safe recovery band.

### Continuation Must Preserve Intent

- Mid-run compaction should continue the same assigned task when safe rather than strand the Agent Session at an idle
  prompt.
- Continuation context should tell the Agent to rely on the compaction summary and avoid restarting discovery or
  re-reading unchanged material without reason.
- Continuation must remain inside Runtime-owned turn, busy, cancellation, event, and interaction semantics.
- If safe continuation cannot be guaranteed, RunWield should stop and explain the condition rather than silently start a
  second unrelated User Request.

### Failure and Cancellation

- User cancellation must abort active compaction and any associated continuation.
- Compaction failure must not wedge the Agent Session or prevent a later manual recovery action.
- Runtime events should distinguish compaction start, successful completion, cancellation, ineffective completion, and
  paused automatic monitoring without exposing consumer-specific presentation vocabulary.

### Privacy-Safe Observability

- RunWield may record content-free context-health measurements through the existing opt-in workflow metrics surface.
- Measurements may include context percentage bands, compaction reason, duration, recovered headroom, continuation
  result, and pause/re-arm outcomes.
- Metrics must not include prompts, summaries, tool arguments or results, file contents, URLs, or other session content.

## Product Experience

For ordinary sessions, this capability should be invisible. Users should see a concise status only when RunWield:

- compacts during an active task;
- pauses automatic compaction because it made insufficient progress;
- cannot continue safely;
- or requires the user to free context, compact manually, clear the session, or select a larger-context model.

A mid-run compaction should not look like a completed task, a new routed request, or a failed Plan. The active Agent and
workflow remain unchanged.

## Functional Requirements

- Reproduce or rule out the long-autonomous-run overflow path against RunWield's pinned Pi version before finalizing the
  intervention.
- Evaluate context pressure at a bounded internal Agent-turn boundary during active work.
- Derive pressure from the active model's registered context window and effective compaction settings.
- Prevent overlapping automatic compactions for one Hosted Session while allowing independent Hosted Sessions to
  progress.
- Measure post-compaction progress and apply a recovery band before another automatic attempt.
- Continue interrupted work only after the Agent Session is ready and Runtime ownership remains valid.
- Preserve cancellation, replay, busy-state, and adapter parity through `SessionRuntime`.
- Provide deterministic tests for trigger, overlap prevention, continuation, ineffective compaction, pause, re-arm,
  cancellation, and failure recovery.
- Provide a long-run behavioral harness that demonstrates the Agent Session remains usable after context intervention.

## Technical Approach

The capability should sit at the Agent Session/Runtime seam where RunWield can observe semantic turn boundaries while
preserving Hosted Session ownership. It should coordinate Pi's existing context-usage and compaction operations through
a small state machine with explicit idle, compacting, measuring, paused, and recoverable outcomes.

Thresholds should follow registered model context and existing compaction settings. Any additional trigger percentage or
recovery band should have conservative defaults and remain configurable without creating multiple conflicting context
budgets.

Continuation must use a Runtime-owned path that preserves the active Agent Handler and outer workflow. Consumers receive
normalized status and lifecycle events; they do not implement the watchdog or decide whether to resume.

## Success Criteria

- A reproduced long autonomous run compacts before avoidable context overflow.
- Work safely continues after mid-run compaction without user prompting or duplicate routing.
- Ineffective compaction cannot cause an automatic retry loop or unusable Agent Session.
- Cancellation during monitoring, compaction, or continuation settles the Runtime turn cleanly.
- TUI and ACP receive equivalent semantic events and final Agent Session state.
- Context intervention does not change Plan Lifecycle or validation outcomes except by allowing the assigned work to
  continue.

## Out of Scope

- Replacing Pi's compaction summary algorithm.
- Building the Research Evidence Set described in `docs/vision/research-evidence-set-prd.md`.
- Automatically changing models or context-window configuration.
- Persisting arbitrary tool output outside normal Agent Session storage.
- Treating compaction as durable project memory or a Work Record.
- General prompt compression unrelated to demonstrated context-health failures.

## Dependencies and Sequencing

This capability can proceed independently of selective model adaptation. Its behavioral harness should feed the broader
Agent Behavior Evaluation capability described in `docs/prd/agent-behavior-evaluation-prd.md`.
