---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add an interactive user-interview tool surface for planning agents (planner/architect) so they can ask structured questions during plan creation: yes/no, free-text, and multiple-choice. This requires new custom tool definitions, wiring those tools into planner/architect invocation paths, and extending TUI prompt APIs beyond select to support text input reliably during an active agent session."
affectedPaths:
    - "src/cmd/router/index.js"
    - "src/cmd/resume/index.js"
    - "src/shared/workflow.js"
    - "src/tools/user-interview.js"
    - "src/shared/ui/api.js"
    - "src/shared/prompts.js"
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/architect.md"
createdAt: "2026-04-30T01:50:16.042Z"
updatedAt: "2026-04-30T01:59:45.112Z"
status: "approved"
origin: "internal"
---

### Objective

Add a user-interview tool surface for planning agents (`planner`, `architect`) so they can ask structured follow-up
questions during plan creation (yes/no, free-text, multiple-choice), with reliable interactive prompting in the TUI
during active agent runs. Implement this as a **flexible per-call questionnaire** workflow where each tool invocation
can include **1–3 questions** (or just one), so agents can gather a small batch when appropriate and still branch with
additional follow-up calls based on answers.

### File Impacts

| File                                 | Action | Description                                                                                                                                                                          |
| ------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/tools/user-interview.js`        | Create | Add custom tool definition(s) for asking users yes/no, text, and multiple-choice questions; bind execution to UI prompt APIs and return structured answers to the agent.             |
| `src/cmd/router/index.js`            | Modify | Wire interview tools into planner/architect review-loop invocations and update planning handoff prompts so agents know they can ask clarification questions before finalizing plans. |
| `src/cmd/resume/index.js`            | Modify | Wire interview tools into resume-time planner/architect review loops (including repair/revision loops) so questioning works consistently when revising existing plans.               |
| `src/shared/workflow.js`             | Modify | Extend `UiAPI` typing for new prompt capability (`promptText`), and update any internal mock/stub UI APIs used in parallel execution paths to satisfy the expanded interface safely. |
| `src/shared/ui/api.js`               | Modify | Implement new UI prompt method(s) needed by interview tools (text input, plus any wrappers), and ensure prompt lifecycle/focus restoration is safe while an agent session is active. |
| `src/shared/prompts.js`              | Modify | Add reusable prompt helper(s) for text input (and optional yes/no wrapper alignment) to support non-`uiAPI` fallback and shared prompt behavior.                                     |
| `src/agent-definitions/planner.md`   | Modify | Document how/when planner should use interview tools to resolve missing requirements before writing the final plan.                                                                  |
| `src/agent-definitions/architect.md` | Modify | Update architect instructions to use interview tools flexibly (single question or small grouped set) with recommendations, matching the intended interview workflow.                 |

### Implementation Steps

- [ ] Step 1: Create `src/tools/user-interview.js` with planning interview tool contract(s) using `defineTool`, designed
      to accept either a single question or a `questions` array (bounded to **1–3 questions per invocation**), with
      strict per-question schemas for type, prompt text, optional choices, defaults, and optional stable IDs.
- [ ] Step 2: In tool execution logic, route each question type to UI prompts sequentially: yes/no via select/confirm,
      multiple-choice via select, and free-text via a new text prompt API; return normalized tool `details` payloads as
      an ordered `answers` array so the model can branch in subsequent calls.
- [ ] Step 3: Add cancellation/validation behavior in the tool (user canceled prompt mid-batch, empty answer, invalid
      option set, malformed batch size) and define a consistent multi-answer return shape (including partial completion
      metadata) so planner/architect can recover, re-ask, or continue safely.
- [ ] Step 4: Extend prompt primitives in `src/shared/prompts.js` with a text-input prompt helper suitable for
      interactive TUI overlays, plus fallback handling for non-overlay contexts where applicable.
- [ ] Step 5: Extend `createUiApi` in `src/shared/ui/api.js` to expose `promptText` (and any helper wrappers needed),
      ensuring focus management and cleanup are correct when prompts appear mid-agent-turn.
- [ ] Step 6: Update `UiAPI` typedef in `src/shared/workflow.js` to include the new prompt method(s), and update
      internal mock `uiAPI` objects (e.g., in concurrent task execution) to provide no-op/stub implementations.
- [ ] Step 7: Wire interview tools into planning entrypoints in `src/cmd/router/index.js` and `src/cmd/resume/index.js`
      by appending them to existing planning `customTools` arrays alongside `planWrittenTool`.
- [ ] Step 8: Adjust planner/architect handoff request text in router/resume flows so agents are explicitly encouraged
      to ask clarification questions before locking the plan.
- [ ] Step 9: Update `src/agent-definitions/planner.md` and `src/agent-definitions/architect.md` with concrete interview
      guidance (when to ask one question vs a small grouped set, recommendation + user confirmation loop, and when to
      stop asking).
- [ ] Step 10: Validate end-to-end behavior in interactive mode: planner and architect can ask all three question types
      during review loops, responses are reflected in tool results, canceled prompts do not crash sessions, and normal
      plan-written flow remains intact.

### Edge Cases & Considerations

- Tool cancellation semantics must be explicit (e.g., `canceled: true`) so the LLM can retry or proceed gracefully
  instead of hallucinating an answer.
- Enforce bounded batching (`questions` length 1–3) to prevent overly long interviews in a single turn while still
  allowing efficient grouped prompts.
- Define clear behavior for partial batches (e.g., user cancels on question 2 of 3): return completed answers plus
  cancellation metadata rather than dropping prior responses.
- Text prompt UX must avoid trapping focus in overlays; always restore editor focus and re-enable input state after
  prompt completion.
- Multiple-choice prompts should guard against empty option arrays, duplicate option values, or excessively long labels,
  including when different question types are mixed in one batch.
- Resume/revision loops should not lose interview capability—wire tools into all planner/architect `reviewLoop` call
  paths, including repair prompts.
- Keep tool availability scoped to planner/architect paths (not globally injected) to avoid unexpected behavior in
  execution agents.
- Ensure compatibility for non-TUI/fallback invocation paths (or fail with a clear message) if an interview prompt is
  requested where interactive input is unavailable.
