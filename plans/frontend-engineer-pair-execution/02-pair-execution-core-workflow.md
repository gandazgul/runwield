---
planId: "70d7d21d-c9e6-46b4-a5ea-288feb542c30"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add the Pair Execution runtime style and checkpoint tool for Frontend Engineer without making checkpoints a Plan status, Task Completion, or validation boundary. This slice provides the workflow semantics while keeping host-specific rendering minimal."
affectedPaths:
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/workflow-prompts.js"
    - "src/shared/workflow/decisions.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/agent-handler.js"
    - "src/shared/session/session-runtime-interactions.js"
    - "src/tools/pair-checkpoint.js"
    - "src/tools/registry.js"
    - "src/shared/session/tool-event-title.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/session/agent-handler.test.js"
    - "src/shared/session/session-runtime-events.test.js"
    - "src/tools/__tests__/pair-checkpoint.test.js"
frontend: false
createdAt: "2026-07-18T15:02:23.967Z"
updatedAt: "2026-07-18T15:02:23.967Z"
status: "draft"
origin: "internal"
parentPlan: "frontend-engineer-pair-execution"
order: 2
dependencies:
    - "01-frontend-engineer-autonomous-execution-foundation"
---

# Pair Execution Core Workflow

## Context

After the autonomous foundation exists, Frontend Engineer can own browser UI/UX Plans but still runs in the traditional
AFK style. The Epic requires optional Pair Execution as runtime workflow state: the user chooses when execution starts,
Frontend Engineer checkpoints after coherent visible increments, and those checkpoints stay inside the same Agent
Session and active execution workflow. A checkpoint is not Task Completion, Plan completion, Workflow Validation, or an
execution failure.

This slice implements the core Pair semantics and custom tool over the existing interaction broker. Host-specific TUI
presentation and ACP/headless policy are completed in the following slice.

## Objective

Add a Pair-capable execution style for frontend-owned FEATURE Plans, including pre-execution style selection, persistent
active workflow state, a Pair-only checkpoint tool, structured decisions, revision feedback, switch-to-AFK, and
intentional stop semantics. The same Frontend Engineer session and worktree must continue across checkpoints until
normal Task Completion or an intentional stop.

## Approach

Extend execution policy resolution so frontend-owned Plans can choose `pair` or `autonomous` at runtime while defaulting
safely to autonomous when Pair cannot be offered. Supply a Pair checkpoint custom tool only when the active workflow
selected Pair. The tool should use the existing non-terminal interaction broker to present evidence-oriented checkpoint
prompts and return structured decisions to Frontend Engineer. It must not record Plan lifecycle events, mark validation
state, or synthesize Task Completion.

Implement this as an extension of active execution workflow state, not as a separate workflow or Plan front matter
mutation.

## Files to Modify

- `src/shared/workflow/workflow.js` — ask for collaboration style for frontend-owned execution when Pair is available,
  record the selection before execution starts, and pass Pair-only tool wiring to the active Agent turn.
- `src/shared/workflow/workflow-prompts.js` — add concise prompt text for the pre-execution Pair/autonomous choice using
  Planner recommendation as context.
- `src/shared/workflow/decisions.js` — normalize runtime collaboration decisions and preserve autonomous fallback
  behavior.
- `src/shared/session/hosted-session.js` — extend active execution workflow with `collaborationStyle`, checkpoint
  count/state, and switch-to-AFK behavior.
- `src/shared/session/agent-handler.js` — keep the same Frontend Engineer root session active across checkpoint tool
  calls and subsequent user directions.
- `src/shared/session/session-runtime-interactions.js` — expose the minimum interaction capability shape needed by Pair
  workflow without introducing a new Plan status.
- `src/tools/pair-checkpoint.js` — implement the Pair-only workflow custom tool with increment summary, evidence fields,
  structured continue/revise/switch-to-AFK/stop decisions, and optional revision text collection.
- `src/tools/registry.js` — register the Pair checkpoint tool as protected/custom workflow tooling only where
  appropriate.
- `src/shared/session/tool-event-title.js` — add stable tool titles/kinds for Pair checkpoint events.
- `src/shared/workflow/workflow.test.js` — cover style selection, autonomous fallback, cancellation, switch-to-AFK, and
  stop behavior.
- `src/shared/session/agent-handler.test.js` — cover same-session continuation across at least two checkpoints.
- `src/shared/session/session-runtime-events.test.js` — cover checkpoint interaction events and ensure they are
  non-terminal runtime events.
- `src/tools/__tests__/pair-checkpoint.test.js` — cover tool schema, interaction requests, structured responses,
  revision collection, unsupported adapter fallback, and no lifecycle mutation.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-runtime-interactions.js#requestHostedSessionInteraction` — use the adapter-neutral
  non-terminal broker for checkpoint prompts.
- `src/tools/user-interview.js` — reuse interaction sequencing/error-normalization patterns while keeping Pair as its
  own domain tool.
- `src/shared/session/agent-switching.js#runActiveAgentTurn` — preserve the same active Frontend Engineer root session
  across checkpoints.
- `src/shared/session/hosted-session.js#setActiveExecutionWorkflow` — store selected collaboration style and checkpoint
  counters in existing runtime workflow context.
- `src/tools/task-completed.js` — keep Task Completion as the only implementation-to-validation boundary; Pair
  checkpoint should not reuse completion semantics.
- `src/shared/session/tool-event-title.js` — follow existing structured tool title conventions for stable Runtime
  events.

## Implementation Steps

- [ ] Define collaboration style constants or normalizers for `autonomous` and `pair`, separate from Plan front matter
      recommendation.
- [ ] Add a pre-execution style resolver that uses `collaborationRecommendation` as guidance, asks the user only when
      Pair is actually available, and otherwise defaults to autonomous.
- [ ] Extend active execution workflow state with `collaborationStyle`, `collaborationRecommendation`, checkpoint count,
      and a flag for switched-to-AFK/autonomous continuation.
- [ ] Add `src/tools/pair-checkpoint.js` with a strict input schema for visible increment summary, evidence notes,
      route/state/viewport/diagnostic hints, and optional next-step framing.
- [ ] Implement checkpoint decision options: continue, revise, switch-to-AFK, and stop.
- [ ] For revise decisions, collect or return revision feedback as structured tool output so Frontend Engineer can
      continue the same turn/session with user intent.
- [ ] For switch-to-AFK, update active workflow state so later Pair checkpoints are no longer expected but Frontend
      Engineer continues autonomously.
- [ ] For stop, leave the Plan in progress and active workflow resumable without emitting Task Completion, validation
      events, or failure status.
- [ ] Supply the checkpoint tool only to Pair Frontend Engineer executions; keep the base Frontend Engineer Agent
      Definition independently usable without advertising an unavailable tool.
- [ ] Ensure adapter unsupported/canceled responses do not fabricate approval; capability loss should fall back to
      autonomous unless the user explicitly stopped or the whole turn was canceled.
- [ ] Add tests for two or more checkpoints in one Frontend Engineer session with stable owner, worktree, active
      workflow, and no validation before final Task Completion.
- [ ] Run `deno task ci` and fix all failures.

## Verification Plan

- Automated: run `deno test -A src/tools/__tests__/pair-checkpoint.test.js` and verify structured decisions, revision
  feedback, unsupported adapter handling, and absence of Plan lifecycle mutation.
- Automated: run `deno test -A src/shared/workflow/workflow.test.js` and verify frontend-owned Pair selection,
  autonomous selection, unsupported-host fallback, canceled pre-execution choice, switch-to-AFK, and intentional stop.
- Automated: run `deno test -A src/shared/session/agent-handler.test.js` and verify at least two continue/revise
  checkpoints stay in one Frontend Engineer Agent Session and one active execution workflow.
- Automated: run `deno test -A src/shared/session/session-runtime-events.test.js` and verify checkpoint
  requests/resolutions are Runtime interaction events, not Task Completion or validation events.
- Automated: run `deno task ci` after implementation and fix all failures.
- Manual: execute a frontend-owned test Plan in a Pair-capable local session, reach two checkpoints, provide one
  revision, then switch to AFK and confirm the same Plan/worktree/session continues.
- Manual: stop at a checkpoint and confirm the Plan remains In Progress without validation or failure semantics.
- Expected results: Pair checkpoint approval is never treated as browser verification, Workflow Validation, or Plan
  completion; only final `task_completed` starts validation.

## Edge Cases & Considerations

- Pair selection is runtime state. Do not write the user's Pair/autonomous choice back into Plan front matter.
- Checkpoint counts are not progress percentages and should not be displayed as completion estimates.
- A Pair checkpoint should happen only after a coherent visible increment, not after every file edit.
- If interaction support disappears mid-execution, report capability loss and continue autonomously rather than
  fabricating approval.
- Revision feedback can change treatment inside the approved Plan, but capability, information architecture, security,
  or material scope changes should return to planning.
- Keep checkpoint payloads evidence-oriented but avoid requiring screenshots or browser payloads in metrics.
