---
planId: "86abb955-7955-4cae-b41a-b00018166ac6"
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
updatedAt: "2026-07-17T04:43:28.930Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-06-17T14:11:27.819Z"
workRecord:
    status: "generated"
    recordId: "94036c10-ebdc-49d5-88c1-b3434455a481"
    path: "docs/work-records/2026-07-17-interactive-slicer-mvp.md"
    lastAttemptAt: "2026-07-17T04:43:22.982Z"
---

# Interactive Slicer MVP

## Context

The PROJECT decomposition Epic has already reframed PROJECT plans as non-executable Epics. Child FEATURE plan
materialization now exists via `saveChildFeaturePlans()` / `materializeSlicerDraft()`. The remaining MVP gap is the
Slicer experience: the old workflow Slicer is still a one-shot task-table prompt that silently mutates legacy PROJECT
plans, while Epics need an interactive PM/lead-engineer conversation.

This slice should make the workflow-only Slicer useful for Epics without exposing it in `/agent` listings. A user who
loads an Epic can open or resume Slicer, discuss FEATURE boundaries, ask it to write draft child FEATURE plans, and only
finalize the Epic decomposition after explicit confirmation.

## Objective

Deliver the first interactive Slicer flow for Epics:

- Slicer opens as the active conversational specialist for an Epic and remains active for follow-up turns.
- Slicer proposes decomposition in natural language before writing files.
- On explicit user request, Slicer materializes draft child FEATURE plans under `plans/<epic-name>/` through the
  existing child-plan helper.
- On explicit user confirmation, Slicer finalizes decomposition by moving the Epic to `ready_for_work`.
- Legacy non-Epic PROJECT task-table slicing remains isolated for compatibility until the old DAG path is retired.

## Approach

Keep the Slicer as a hidden workflow pseudo-agent loaded from `src/agent-definitions/workflow-prompts/slicer-prompt.md`.
Change `runSlicerAgent()` from a transient one-shot call into an Epic-rooted interactive session:

1. Load the Epic and its existing child FEATURE plans.
2. Build a rich initial Slicer request containing the Epic markdown/body, status, triage metadata, and child-plan
   summary.
3. Install custom Slicer-only tools for draft materialization and finalization.
4. Run the first Slicer turn on the root session, then set the active handler to a Slicer-specific handler so follow-up
   user messages continue the same Slicer conversation.

Do not let the prompt write child files directly with generic `write`/`edit`. The Slicer should call workflow tools that
reuse `materializeSlicerDraft()` and lifecycle transitions. Preserve the old task-table prompt by moving/copying it to a
legacy prompt file and pointing `ensureSlicerTasks()` at a legacy runner, so this feature does not accidentally break
older non-Epic PROJECT plans before feature 9 retires that path.

## Files to Modify

- `src/shared/workflow/workflow-slicer.js` — implement interactive Epic Slicer orchestration, Slicer-specific active
  handler, draft/finalize custom tools, and a separate legacy task-slicer runner for `ensureSlicerTasks()`.
- `src/agent-definitions/workflow-prompts/slicer-prompt.md` — rewrite from task-table instructions to the interactive
  PM/lead-engineer Epic decomposition role.
- `src/agent-definitions/workflow-prompts/legacy-task-slicer-prompt.md` — preserve the current task-table prompt for
  legacy non-Epic PROJECT compatibility.
- `src/shared/workflow/workflow-prompts.js` — replace `buildSlicerRequest()` with an Epic decomposition request builder
  that includes Epic body, lifecycle state, triage metadata, and existing children.
- `src/shared/workflow/plan-lifecycle.js` — allow decomposition finalization to transition an approved or
  `ready_for_decomposition` Epic to `ready_for_work` via a lifecycle event.
- `src/shared/session/agents.js` — add a Slicer attention nudge/display fallback for long active Slicer conversations
  while keeping the Slicer hidden from `/agent` discovery.
- `src/shared/workflow/workflow.test.js` — update Slicer request/orchestration tests and add custom tool/finalization
  coverage.
- `src/cmd/load-plan/index.test.js` — cover that loading an Epic opens Slicer without executing or invoking legacy task
  slicing, and that the user can still cancel/view/pick child plans.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — reuse `loadPlan()`, `findPlansByParent()`, and `saveChildFeaturePlans()` instead of adding a
  parallel child-plan writer.
- `src/shared/workflow/workflow-slicer.js` — reuse `materializeSlicerDraft()` as the persistence boundary for "write a
  draft".
- `src/shared/session/session.js` — reuse root-session support (`runRootTurn` / root session infrastructure) so Slicer
  conversations persist across turns.
- `src/shared/interactive/chat-session.js` — reuse `setActiveAgent()` patterns so the footer and active message handler
  reflect the Slicer after it opens.
- `src/shared/workflow/plan-lifecycle.js` — reuse lifecycle event recording instead of editing Epic front matter
  directly.
- Current task-table Slicer prompt — preserve it as the legacy prompt rather than reimplementing legacy slicing.

## Implementation Steps

- [ ] Preserve the current task-table prompt by copying `src/agent-definitions/workflow-prompts/slicer-prompt.md` to
      `src/agent-definitions/workflow-prompts/legacy-task-slicer-prompt.md` before rewriting the main prompt.
- [ ] Rewrite `slicer-prompt.md` for the interactive Epic Slicer role: propose FEATURE boundaries first, discuss
      tradeoffs, write drafts only when asked, finalize only after explicit user confirmation, and never call
      `plan_written`.
- [ ] In `workflow-prompts.js`, change `buildSlicerRequest()` to accept an object containing `planName`, Epic markdown
      or body, Epic front matter/status, triage metadata, and existing child FEATURE summaries.
- [ ] Include in the Slicer request enough current state for resume: existing child names, statuses, summaries,
      dependencies, and a clear instruction that existing child drafts must not be overwritten casually.
- [ ] In `workflow-slicer.js`, add custom tool creation for draft materialization. The tool should accept child plan
      descriptors, call `materializeSlicerDraft({ cwd: CWD, epicPlanName: planName, children })`, and return a concise
      created/updated summary.
- [ ] In `workflow-slicer.js`, add a finalize custom tool. It should load current Epic metadata, require at least one
      child FEATURE plan, reject `draft` Epics, no-op/succeed if already `ready_for_work`, and otherwise record the
      lifecycle transition to `ready_for_work`.
- [ ] Update `plan-lifecycle.js` so the finalize path can legally move an Epic from `ready_for_decomposition` to
      `ready_for_work` (and from `approved` if an approved Epic was opened directly in Slicer).
- [ ] Update `runSlicerAgent()` to load the Epic and children, load the hidden Slicer prompt, run the first turn on the
      root session with Slicer custom tools, then set the active handler to a Slicer-specific handler for follow-up
      turns.
- [ ] In `agents.js`, add an `_AGENT_ATTENTION_NUDGES[AGENTS.SLICER]` entry (and any display-name fallback needed by
      `setActiveAgent`) so long Slicer conversations remain clearly scoped.
- [ ] Keep the Slicer hidden from `/agent`: do not add a top-level `src/agent-definitions/slicer.md`, and do not make it
      discoverable through `listAvailableAgents()`.
- [ ] Update `ensureSlicerTasks()` to use a legacy task-slicer runner and `legacy-task-slicer-prompt.md`, preserving
      current legacy PROJECT tests while the new Epic Slicer uses the rewritten prompt.
- [ ] Update `workflow.test.js` tests for the new `buildSlicerRequest()` content, root-session Slicer orchestration,
      custom tool wiring, draft materialization delegation, finalization success/failure cases, and legacy
      `ensureSlicerTasks()` compatibility.
- [ ] Update `cmd/load-plan/index.test.js` cases that open Epics so they assert the interactive Slicer is opened and the
      legacy task slicer/executor is not invoked for Epics.
- [ ] Keep all implementation in pure JavaScript with JSDoc; do not add TypeScript files or TypeScript syntax.

## Verification Plan

- Automated:
  `deno test src/shared/workflow/workflow.test.js src/cmd/load-plan/index.test.js src/shared/workflow/plan-lifecycle.test.js`
- Automated: `deno run ci`
- Manual: create or use a scratch Epic (`classification: PROJECT`, `type: epic`), run `hns load-plan <epic-name>`, open
  Slicer, verify the footer/active agent stays on Slicer for follow-up prompts.
- Manual: ask Slicer to propose slices only; verify it responds conversationally and does not write child plan files.
- Manual: ask Slicer to "write a draft"; verify child FEATURE files appear under `plans/<epic-name>/` with
  `classification: FEATURE`, `status: draft`, `parentPlan`, and dependencies.
- Manual: ask Slicer to finalize after drafts exist; verify the parent Epic front matter becomes
  `status: ready_for_work` and `hns load-plan <epic-name>` offers child plan selection.
- Expected result: Epics are never silently mutated with task tables, child draft writes go through the existing helper,
  and finalization never happens without explicit user confirmation.

## Edge Cases & Considerations

- Existing child drafts may contain user edits. The prompt and request should warn the Slicer to summarize overwrite
  risk before calling the draft materialization tool again.
- If the Epic lacks enough detail to slice responsibly, Slicer should ask the user focused questions instead of writing
  vague child plans.
- The draft materialization helper intentionally overwrites deterministic draft paths; richer stale-child detection is
  out of scope for this MVP.
- Deferred work/on-hold child status is out of scope unless it is already supported by the child-plan helper; for now
  the Slicer can discuss deferred slices and simply avoid generating them.
- Legacy task-table PROJECT behavior should remain only as compatibility; new Epic code paths must not depend on
  `task-scheduling.js` or the old DAG executor.
- If Slicer custom tool execution fails, return the error to the conversation and leave the Epic status unchanged.
