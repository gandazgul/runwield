---
classification: "FEATURE"
complexity: "HIGH"
summary: "Replace the silent Slicer task-table mutation with an interactive PM-style decomposition session for Epics."
affectedPaths:
    - "src/shared/workflow/workflow-slicer.js"
    - "src/shared/workflow/slicer-prompt.md"
    - "src/shared/session/agents.js"
    - "src/shared/workflow/workflow-prompts.js"
    - "src/shared/workflow/workflow.test.js"
createdAt: "2026-06-16T16:25:04Z"
status: "draft"
---

# Interactive Slicer MVP

## Context

This is a `HITL` slice. The implementation can be done by an agent, but the slice needs a human review point because the
Slicer prompt defines product behavior: how assertive it is, when it writes files, and what it asks before finalizing.

The current Slicer is a pseudo-agent that silently mutates a PROJECT plan by appending a task table. The new Slicer is
an interactive PM/lead-engineer agent. It reads an Epic, proposes FEATURE boundaries, discusses tradeoffs with the user,
materializes draft child plans on request, and finalizes only after user confirmation.

## Objective

Deliver the first usable interactive Slicer flow for Epics.

## Approach

Rewrite the Slicer request and prompt around conversation instead of task-table generation. The MVP should support four
moments: read Epic, propose decomposition, write draft child FEATURE plans, and finalize decomposition. It should reuse
existing session infrastructure for pause/resume where possible.

## Files to Modify

- `src/shared/workflow/workflow-slicer.js` - replace task-table validation flow with Epic decomposition session
  behavior.
- `src/shared/workflow/slicer-prompt.md` - rewrite the Slicer role and instructions.
- `src/shared/session/agents.js` - ensure the Slicer can remain active as the current specialist when appropriate.
- `src/shared/workflow/workflow-prompts.js` - replace or add prompt builders for Epic decomposition.
- `src/shared/workflow/workflow.test.js` - test Slicer session orchestration, success, cancellation, and failure cases.

## Reuse Opportunities

- `src/shared/session/session.js` - reuse `runAgentSession` and session persistence.
- `src/shared/session/agents.js` - reuse active-agent behavior for specialist follow-up.
- Child-plan creation helper from feature 4 - use it for "write draft" rather than direct file writes in the prompt.
- `src/tools/plan-written.js` - reuse existing plan review concepts where the Slicer writes normal FEATURE plans.

## Implementation Steps

- [ ] Rewrite the Slicer prompt to describe the PM/lead-engineer role and the rules for independent FEATURE slices.
- [ ] Add a Slicer request builder that includes the Epic plan name, body, existing children, and current decomposition
      state.
- [ ] Route approved Epics with no finalized children into the interactive Slicer instead of `ensureSlicerTasks`.
- [ ] Wire "write draft" behavior to the child-plan creation helper.
- [ ] Wire "finalize" behavior so the Epic can move into the decomposed/ready-for-child-selection state.
- [ ] Preserve pause/resume behavior using existing session infrastructure.
- [ ] Add tests with injected session runners and child-plan writers.
- [ ] Human review: run a sample Slicer conversation and adjust prompt language before considering the slice done.

## Verification Plan

- Automated: `deno test src/shared/workflow/workflow.test.js`
- Automated: `deno run ci`
- Manual: start from a sample Epic, open Slicer, ask it to propose slices, ask it to write a draft, inspect files, then
  finalize.
- Expected result: Slicer does not silently append task tables and does not finalize without user confirmation.

## Edge Cases & Considerations

- The Slicer should handle existing child plans without overwriting user edits casually.
- The Slicer should be able to tell the user when the Epic lacks enough detail to slice responsibly.
- Avoid implementing stale child detection or full Epic re-slicing mechanics in this MVP unless needed for basic safety.
