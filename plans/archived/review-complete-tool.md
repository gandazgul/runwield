---
planId: "8e55a30d-5c03-4c84-a362-4e5048f75ec9"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "The Reviewer agent currently relies on text output ('APPROVED') to signal completion, which is brittle and leads to the workflow continuing even when the agent is just talking. I will implement a dedicated `review_complete` tool for the Reviewer to explicitly signal approval or provide feedback, and update `runValidationLoop` to wait for this tool call instead of parsing text. I will also ensure that Esc/interrupts do not prematurely advance the workflow."
affectedPaths:
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/workflow-results.js"
frontend: false
createdAt: "2026-07-08T14:59:11-04:00"
updatedAt: "2026-07-17T04:50:13.149Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-08T15:17:43.745Z"
verifiedAt: "2026-07-08T15:58:50.575Z"
workRecord:
    status: "generated"
    recordId: "213e1c4b-53cf-4515-a174-a66626ace1b9"
    path: "docs/work-records/2026-07-17-structured-reviewer-completion-signal.md"
    lastAttemptAt: "2026-07-17T04:50:07.271Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
archivedAt: "2026-07-08T16:34:21.764Z"
archivedFromStatus: "verified"
archivedFromPath: "plans/review-complete-tool.md"
routingIntent: "FEATURE"
sessionName: "fix reviewer workflow signal"
---

# Review Complete Structured Tool

## Context

The semantic Reviewer currently signals approval or rejection by outputting the word `APPROVED` (or a bulleted issue
list) as plain text, which the validation loop parses via `extractAssistantOutput()` and `isApprovedReviewResponse()`.
This is brittle:

- The reviewer often produces verbose output before/after "APPROVED", so `extractAssistantOutput` returns the full text,
  not just the keyword, causing `isApprovedReviewResponse` to return `false` even when the review passed.
- There is no structured signal — the workflow cannot distinguish "approved" from "failed with specific feedback"
  reliably.
- The Reviewer prompt explicitly bans `task_completed`, leaving text as the only communication channel.
- Hitting Esc during Reviewer or Engineer work can advance the workflow even though no terminal tool was called, because
  the running session completes without a terminal tool result and `extractAssistantOutput` picks up the partial output.

The fix: give the Reviewer a dedicated `review_complete` tool (analogous to `plan_written` for planners) that returns
structured `{ approved: boolean, feedback: string }` data and uses `terminate: true`. The validation loop reads the tool
result instead of parsing text. For Esc/interrupts, the absence of the `review_complete` tool result is a clear "not
done" signal that prevents workflow advancement.

## Objective

1. Create a `review_complete` custom tool that the Reviewer calls with `approved: boolean` and optional
   `feedback: string`, returning `terminate: true` to end the assistant turn.
2. Wire `review_complete` into the Reviewer agent session (via auto-wiring in `buildAgentSession`, same pattern as
   `task_completed`).
3. Add `readLatestReviewOutcome()` to `workflow-results.js` to extract the structured result from message streams.
4. Update `runValidationLoop` in `validation.js` to use `readLatestReviewOutcome()` instead of text-based parsing.
5. Update the Reviewer prompt to instruct use of `review_complete` instead of text-based "APPROVED".
6. Ensure that when the user hits Esc (or the session is interrupted), the absence of a `review_complete` tool result is
   treated as "reviewer did not finish" — the workflow stays with the current agent and does not advance.

## Approach

### 1. New file: `src/tools/review-complete.js`

Create a tool modeled after `task-completed.js` and `plan-written.js`:

- **name**: `review_complete`
- **parameters**: `approved` (boolean, required) and `feedback` (optional string with default "")
- **behavior**: Append a UI message, emit a workflow metric, return `terminate: true` with structured details
  `{ outcome: "approved" | "feedback", approved, feedback }`
- The tool does NOT need `message` parameter like `task_completed` — the structured `feedback` field is the message.

### 2. Auto-wire `review_complete` in `buildAgentSession` (`session.js`)

Add a block analogous to the existing `task_completed` auto-wiring:

```
if (tools.includes("review_complete") && uiAPI && !finalCustomTools.find(t => t.name === "review_complete")) {
    const { createReviewCompletedTool } = await import("../../tools/review-complete.js");
    finalCustomTools.push(createReviewCompletedTool({ uiAPI, agentName: agentDef.displayName }));
}
```

This enables any agent with `review_complete` in its tools frontmatter to get the tool auto-wired — though in practice
only the Reviewer uses it.

### 3. Register in `PROTECTED_TOOL_NAMES` (`registry.js`)

Add `"review_complete"` to the protected tools array so it cannot be accidentally removed from agent definitions.

### 4. Add `readLatestReviewOutcome` (`workflow-results.js`)

New exported function that scans messages in reverse for the latest `review_complete` tool result:

```js
export function readLatestReviewOutcome(messages, fromIndex) {
    // Search backwards for toolResult with toolName "review_complete"
    // Returns { outcome: "approved"|"feedback", approved: boolean, feedback: string } | null
}
```

Pattern matches `readLatestPlanOutcome` — returns `null` when no `review_complete` call is found (interrupted / not
done).

### 5. Update `validation.js` — `runValidationLoop`

**a) Add `review_complete` to Reviewer tool names**

In both the large-diff and small-diff paths, ensure `"review_complete"` is in the tool names list passed to the reviewer
agent def. Currently the tools are set via `_agentDefOverride` — just add `"review_complete"` to the array.

**b) Replace text-based reviewer outcome detection**

Current code:

```js
reviewResponse = extractAssistantOutput(sessionMessages) || "";
...
if (isApprovedReviewResponse(reviewResponse)) { ... }
else { ... reviewer feedback text ... }
```

New code:

```js
const reviewOutcome = readLatestReviewOutcome(sessionMessages);
if (!reviewOutcome) {
    // No review_complete tool was called — interrupted or failed
    reviewerFailed = true;
    // existing retry/cancel prompt
} else if (reviewOutcome.approved) {
    // Approved — proceed to human review / merge
} else {
    // Rejected with feedback
    const feedbackText = reviewOutcome.feedback || "(no feedback provided)";
    // dispatch to Engineer for repair
}
```

**c) Retain reviewer failure handling**

The existing `reviewerFailed` → retry/cancel flow stays intact. When `review_complete` is not found (interrupted/Esc),
`reviewerFailed` is set to true, prompting the retry dialog. The workflow does NOT advance.

**d) Clean up obsolete helpers**

- Remove `isApprovedReviewResponse()` function (no longer needed)
- The `extractAssistantOutput()` call for reviewer-specific output is replaced, but keep the function itself since it
  may be used elsewhere (check with grep first)

### 6. Update `reviewer-prompt.md`

Replace the text-output instruction:

**Old (lines 38-40)**:

```
6. If the code completely fulfills the plan, you MUST output the exact word: `APPROVED`.
7. If the code is missing semantic requirements, output a concise bulleted list of all the issues the Engineer needs to fix.
```

**New**:

```
6. If the code completely fulfills the plan, call `review_complete` with `approved: true`.
7. If the code is missing semantic requirements, call `review_complete` with `approved: false` and a concise `feedback` string containing a bulleted list of all the issues the Engineer needs to fix.
```

Also update the Rules section:

- Remove "Do NOT use task_completed" (but keep it implicitly since the tool isn't in the reviewer tools)
- Add `review_complete` to the allowed tools list
- Remove the "Output only APPROVED or a concise bulleted list" rule — replace with "Call review_complete with your
  decision"

### 7. Esc/interrupt handling (already implicit)

When the user hits Esc during Reviewer execution:

- `runAgentSession` completes (possibly via abort) without a `review_complete` tool result
- `readLatestReviewOutcome` returns `null`
- `reviewerFailed` is set to `true`
- The existing retry/cancel prompt fires
- The workflow does NOT advance — it stays with the Reviewer (or asks the user what to do)

For Engineer interrupts during validation repair cycles: the repair flow already checks for `task_completed` and pauses
if not found. No additional changes needed.

## Files to Modify

- `src/tools/review-complete.js` — **New file**: `review_complete` custom tool
- `src/tools/registry.js` — Add `review_complete` to `PROTECTED_TOOL_NAMES`
- `src/shared/workflow/workflow-results.js` — Add `readLatestReviewOutcome()`
- `src/shared/session/session.js` — Add auto-wiring for `review_complete` in `buildAgentSession`
- `src/shared/workflow/validation.js` — Use `readLatestReviewOutcome` in `runValidationLoop`, add `review_complete` to
  reviewer tools
- `src/agent-definitions/workflow-prompts/reviewer-prompt.md` — Update instructions to use `review_complete` tool

## Reuse Opportunities

- Follow the exact pattern of `createTaskCompletedTool` in `src/tools/task-completed.js` for the new `review_complete`
  tool shape
- Follow `readLatestPlanOutcome` in `workflow-results.js` for the new `readLatestReviewOutcome` function
- Follow `task_completed` auto-wiring in `buildAgentSession` (`session.js`) for `review_complete` auto-wiring

## Implementation Steps

- [ ] Step 1: Create `src/tools/review-complete.js` with the `review_complete` custom tool
- [ ] Step 2: Add `review_complete` to `PROTECTED_TOOL_NAMES` in `src/tools/registry.js`
- [ ] Step 3: Add `readLatestReviewOutcome()` to `src/shared/workflow/workflow-results.js`
- [ ] Step 4: Add `review_complete` auto-wiring in `buildAgentSession` in `src/shared/session/session.js`
- [ ] Step 5: Update `runValidationLoop` in `src/shared/workflow/validation.js`:
  - Add `review_complete` to reviewer tool names (both small-diff and large-diff paths)
  - Import and use `readLatestReviewOutcome` instead of `extractAssistantOutput` + `isApprovedReviewResponse`
  - Remove `isApprovedReviewResponse` helper
  - Handle the null (interrupted) case as `reviewerFailed = true`
- [ ] Step 6: Update `src/agent-definitions/workflow-prompts/reviewer-prompt.md` to instruct use of `review_complete`
      tool
- [ ] Step 7: Run existing tests to verify no regressions: `deno task test:workflow`

## Verification Plan

- **Automated**:
  - `deno task test` — all existing tests pass
  - Verify `src/shared/workflow/workflow-results.test.js` has coverage for `readLatestReviewOutcome` (or add if missing)
  - Verify `src/shared/workflow/validation.test.js` still passes (mocked tool outcome)

- **Manual**:
  1. Run a FEATURE workflow end-to-end with a plan
  2. Verify the Reviewer calls `review_complete` with `approved: true` when implementation matches
  3. Verify the Engineer receives reviewer feedback as structured text when `approved: false`
  4. Verify hitting Esc during Reviewer execution triggers the retry/cancel dialog and does NOT advance the workflow

## Edge Cases & Considerations

- **Interrupted reviewer (Esc)**: No `review_complete` tool result → `readLatestReviewOutcome` returns null →
  `reviewerFailed = true` → retry/cancel prompt → workflow does NOT advance. This is the critical behavioral fix.
- **Reviewer that outputs text instead of calling the tool**: The `terminate: true` on `review_complete` should force
  the LLM to call it. But if the LLM still outputs text and stops, `readLatestReviewOutcome` returns null → same
  interrupt path with retry/cancel.
- **Feedback with no text**: When `approved: false` and `feedback` is empty string, treat as "reviewer failed to provide
  feedback" and still dispatch to Engineer with a note.
- **Compat**: The auto-wiring in `buildAgentSession` ensures the tool is available to any agent that lists
  `review_complete` in its tools. Currently only the Reviewer uses it, but no other agent's behavior changes.
- **Large diffs**: The `reviewerCustomTools` array already has `createReviewDiffTool` for large diffs. The
  `review_complete` tool is separate — it just needs to be in the tools list, and auto-wiring handles the rest.
