---
planId: "8c55bf9e-f341-4156-a30b-7ad8cddbbd75"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
affectedPaths:
    - "src/ui/workspace/server/session-continuation.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-transcript-manifest.ts"
    - "src/ui/workspace/components/SessionActivationStatus.jsx"
    - "src/ui/workspace/islands/SessionSurface.jsx"
executionAgent: "engineer"
frontend: true
createdAt: "2026-09-07T23:05:28.350448-04:00"
status: "draft"
origin: "internal"
---

# Restore Ordinary Workspace Session Continuation

## Context

The same owner should be able to leave an idle TUI open, continue on a phone, and return to the updated conversation.
Source inspection found several barriers to this journey. These findings need reproduction and implementation work; they
are not architectural requirements.

Product intent: [Workspace PRD](../prd/runwield-workspace-prd.md), especially moving between TUI and phone.
Architecture: [ADR-015](../adr/015-file-authoritative-session-bundles.md).

## Objective

Restore ordinary continuation for long conversations and idle Sessions with prior workflow context, using existing Core
operations. Preserve actual concurrent-write protection and current Plan action checks.

## Findings to Reproduce

- The Workspace continuation endpoint requests a projection limited to 500 events, then rejects `complete: false`. The
  aggregate reader verifies all transcript segments before paginating events. Another history page does not mean invalid
  transcript evidence.
- The browser caps history loading and disables Send when that display limit is reached. Sending also reloads the
  timeline before submission. Continuing a conversation should not require rendering its entire history.
- The continuation policy rejects idle Sessions with `activeExecutionWorkflow` metadata. The browser adds its own
  workflow checks, including a read-only completed-work branch. Trace actual active work separately from retained
  context and preserve the Core path for directing a follow-up to the right Agent.
- TUI already releases activation after a managed turn. Confirm that both open screens discover saved changes and become
  usable without closing the other window or a manual recovery step.

## Approach and Implementation Steps

1. Reproduce the history-page refusal through the real Workspace continuation endpoint. Separate verified transcript
   validity from display pagination and remove the full-history prerequisite for sending.
2. Reproduce idle workflow and completed-work refusals. Use current Core continuation behavior and actual operation
   state to decide whether a message can run; remove browser-only restrictions based on historical workflow labels.
3. Verify automatic conversation updates in both directions, preserving drafts, Agent/model choices, and one Session
   identity. Fix observed failures in the existing synchronization path.

## Verification Plan

- Add regressions through real file-backed Session and Workspace fixtures for history exceeding one server page and the
  browser display limit, plus idle execution context and completed-work follow-up. Demonstrate the refusals before the
  fixes and successful continuation afterward. Verify actual invalid transcript evidence and competing writes still
  receive the appropriate handling.
- Run affected tests with `deno run -A scripts/run-tests.js <affected test files>` and the relevant Workspace checks.
- On the paired owner server, leave TUI open, continue from Workspace, and return to the TUI. Repeat in the other
  direction with a long conversation and a completed Plan. Check that both screens update and preserve unsent drafts.

## Separate Follow-up

Answering an interaction that is still waiting inside a different live process requires routing the answer to that
process. Transcript projection alone does not do that. Trace the available interaction transport before defining that
implementation; do not fold a new durable interaction system into these continuation fixes.
