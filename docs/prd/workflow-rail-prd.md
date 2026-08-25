---
title: Workflow Rail
status: draft
createdAt: "2026-07-31T13:09:56-04:00"
updatedAt: "2026-07-31T13:09:56-04:00"
---

# Workflow Rail PRD

## 1. Objective

Introduce a shared active-workflow awareness surface that makes RunWield's multi-step work understandable without hiding
or crowding the Agent transcript.

The first rendering is a collapsible right-side **Workflow Rail** in the TUI. The same underlying product concept
supports a selected-Session rail in Workspace and the Workspace Attention Dashboard's read-only workflow summaries. The
Workspace Session screen PRD (`docs/prd/runwield-workspace-session-screen.md`) includes the selected-Session browser
rail as part of its implementation scope.

## 2. Problem Statement

RunWield's strongest product promise is controlled workflow: Triage, Plans, execution, Workflow Validation, repair,
recovery, and Work Records. Today that control can feel opaque or bolted on:

- the footer shows only compressed context such as current Plan and Complexity;
- the persistent validation card improves validation visibility but occupies the above-input area and can hide streaming
  Agent messages;
- users lack a stable place to answer, "What is RunWield doing, why, and what can I safely do next?";
- validation feels like a special UI mode rather than one phase of the broader active workflow.

The UI should preserve the transcript as the primary conversation surface while keeping workflow truth continuously
available whenever RunWield owns a multi-step workflow.

## 3. Resolved Assumptions

- The Workflow Rail appears only when RunWield has an active multi-step workflow.
- Included workflows:
  - `QUICK_FIX`, because it has Engineer work followed by Mechanical Validation and possible repair attempts;
  - `PLANNED_CHANGE` / legacy `FEATURE`;
  - `PROJECT`, including Epic design, decomposition, child Plan execution, validation, and recovery;
  - loaded or resumed Plan workflows;
  - validation, repair, merge-back, and recovery states.
- Excluded flows:
  - `INQUIRY` / Guide;
  - `IDEATION` / Ideator;
  - `OPERATION` / Operator after self-verification;
  - idle chat with no active workflow.
- For `QUICK_FIX`, the rail says **Current Request**, not Current Plan.
- For planned work, the rail says **Current Plan** or **Current Epic** as appropriate.
- Persistent validation-loop state belongs in the Workflow Rail, not in a full-width above-input card.
- Above-input cards are reserved for blocking decisions or urgent intervention, such as approval, retry, recovery, Pair
  checkpoint, or destructive confirmation.
- The footer remains the collapsed summary and re-open affordance.
- Pinning or prioritizing a workflow elsewhere in Workspace does not grant writable activation or Plan ownership.

## 4. Technical Approach

This PRD intentionally defines the product contract rather than an implementation design.

RunWield should expose a shared active-workflow projection per Session. The projection should be consumer-neutral and
safe for TUI, Workspace, and ACP-facing clients to render without making presentation surfaces sources of truth.

The projection should answer:

- whether the Session has an active workflow;
- workflow kind: `QUICK_FIX`, `PLANNED_CHANGE`, or `PROJECT`;
- current stage in user-facing language;
- active owner: Agent, Reviewer, RunWield validation, or user;
- current request, Plan, Epic, or child Plan;
- whether user attention is required;
- safe next actions;
- recent durable artifacts or evidence, such as Plan review, validation result, recovery state, or Work Record;
- quiet-running versus blocked/decision-needed status.

TUI rendering:

- default to a right-side collapsible rail when terminal width allows;
- collapse automatically or by user action into the footer summary when space is constrained;
- keep the main transcript visible and avoid full-width persistent panels for ambient workflow state;
- use above-input cards only for blocking user decisions;
- preserve the existing validation-loop information by relocating it into the rail.

Workspace rendering later:

- show the same active-workflow projection beside the selected Session's browser chat;
- feed read-only workflow-step summaries into the Attention Dashboard;
- allow observing many workflows while requiring a Session Activation Lease before Workspace mutates one Session.

## 5. Experience Requirements

The rail should make the next safe action obvious without exposing protected lifecycle or registry internals.

It should show, when available:

- **Now:** concise current stage, such as "Planning", "Executing", "Mechanical Validation", "Semantic Review", "Repair",
  "Ready for approval", or "Recovery needed";
- **Owner:** who is currently responsible: user, Planner, Engineer, Frontend Engineer, Reviewer, Slicer, Recorder, or
  RunWield validation;
- **Subject:** Current Request, Current Plan, Current Epic, or child Plan;
- **Why this is happening:** one short explanation of the current phase;
- **Next:** likely transition or required human action;
- **Actions:** available safe actions, such as inspect Plan, inspect diff, approve, retry validation, pause, resume, or
  recover;
- **Evidence:** latest validation/report/worktree/recovery facts in product language.

The rail must prefer product-facing language over internal fields such as execution mode, registry status, raw
front-matter events, or activation implementation details.

## 6. Out of Scope

- A generic Session metadata sidebar for ordinary Guide, Ideator, or Operator chat.
- A second source of truth for Plan Lifecycle, validation, worktree state, Session activation, or recovery.
- Concurrent writable control of the same Session across TUI, Workspace, and ACP.
- Replacing the transcript, footer, or blocking interaction cards entirely.
- Token-level cross-process mirroring of live model streams for Workspace.
- Detailed schema, widget, keybinding, or layout implementation decisions.

## 7. Success Criteria

- During active workflows, users can identify current stage, active owner, subject, and safe next action without reading
  recent transcript messages.
- Long validation or repair loops remain visible without hiding streaming Agent output.
- Collapsing the rail leaves a useful footer summary and an obvious re-open path.
- No rail appears for ordinary one-turn or conversational flows without active workflow state.
- TUI and future Workspace renderings can consume the same active-workflow projection without presentation surfaces
  becoming sources of truth.

## Proposed Domain Language

### Active Workflow Surface

A shared user-facing projection of one Session's active multi-step workflow state. It is not a source of truth and does
not own Plan Lifecycle, Session activation, validation, or worktree state. It supplies the workflow facts that TUI,
Workspace, and future clients render.

Affected existing terms: Session, Routing Intent, Plan, Workflow Validation, Session Activation Lease, Plan Workflow
Lease.

Avoided aliases: workflow cockpit, agent dashboard, session sidebar, plan status cache.

### Workflow Rail

The TUI and selected-Session browser rendering of the Active Workflow Surface, usually as a collapsible right-side rail.
It appears only while a multi-step workflow is active and moves persistent validation-loop state out of the above-input
card.

Affected existing terms: TUI, Workspace, Session, Workflow Validation.

Avoided aliases: right sidebar, validation card, status drawer.

### Current Request

The subject label used for a `QUICK_FIX` active workflow because no durable Plan artifact exists. It distinguishes
no-plan quick-fix work from planned work while still acknowledging Engineer -> Mechanical Validation -> repair workflow
state.

Affected existing terms: QUICK_FIX, User Request, Plan.

Avoided aliases: mini-plan, temporary Plan, implicit Plan.
