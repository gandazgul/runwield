---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Fixconsistency issues with custom tools (`user_interview` and `plan_written`). Currently, these tools are explicitly passed in `reviewLoop` from `router` and `resume` commands rather than relying on agent frontmatter. They should be moved to the agent definition frontmatter for consistency and to ensure they are available regardless of the entry point. Also, consolidate the logic between `--agent` / `/agent` and `router` -> `reviewLoop` / `--resume` / `/resume` paths to eliminate duplicated instructional logic."
affectedPaths:
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/architect.md"
    - "src/cmd/router/index.js"
    - "src/cmd/resume/index.js"
createdAt: "2026-04-30T04:21:36.635Z"
updatedAt: "2026-04-30T04:31:51.325Z"
status: "approved"
origin: "internal"
---

# Plan: Standardize Planning Tool Availability and Request Logic

## Objective

Standardize the availability of `user_interview` and `plan_written` tools by moving them to agent definitions (
front-matter). Consolidate the logic for instantiating agents with new prompts and handling hand-offs (across `--agent`,
`/agent`, `router` -> `reviewLoop`, `--resume`, and `/resume`) to ensure consistent behavior and parity regardless of
the entry point.

## File Impacts

| File                                 | Action | Description                                                                                                                                    |
| ------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agent-definitions/planner.md`   | Modify | Add `user_interview` and `plan_written` to `tools` list in front-matter.                                                                       |
| `src/agent-definitions/architect.md` | Modify | Add `user_interview` and `plan_written` to `tools` list in front-matter.                                                                       |
| `src/cmd/router/index.js`            | Modify | Remove explicit `customTools` (planWritten, userInterview) from `reviewLoop` calls. Clean up duplicate instructional blocks.                   |
| `src/cmd/resume/index.js`            | Modify | Remove explicit `customTools` (planWritten, userInterview) from `reviewLoop` calls. Clean up duplicate instructional blocks.                   |
| `src/shared/workflow.js`             | Modify | Update `reviewLoop` to rely on agent front-matter tools, while still accepting `customTools` for dynamic extensions (like `uiAPI` based ones). |

## Implementation Steps

- [ ] **Step 1: Update Agent Definitions**
  - [ ] Add `user_interview` and `plan_written` to `src/agent-definitions/planner.md` front-matter `tools`.
  - [ ] Add `user_interview` and `plan_written` to `src/agent-definitions/architect.md` front-matter `tools`.

- [ ] **Step 2: Refactor `runAgentSession` / `reviewLoop` for Tool Handling**
  - [ ] Ensure `runAgentSession` in `src/shared/session.js` correctly merges front-matter tools with `customTools`. (
        Verify current logic: it already does `[...new Set([...(selectedToolNames || []), ...customToolNames])]` where
        `selectedToolNames` defaults to `agentDef.tools`).
  - [ ] In `src/shared/workflow.js`, ensure `reviewLoop` doesn't need to explicitly pass `toolNames` if the front-matter
        is sufficient.

- [ ] **Step 3: Clean up `src/cmd/router/index.js`**
  - [ ] Remove `customTools: [planWrittenTool, createUserInterviewTool(uiAPI)]` from `reviewLoop` calls.
  - [ ] _Note_: `createUserInterviewTool(uiAPI)` creates a tool instance. We must ensure that the tool implementation
        can handle the `uiAPI` context even when loaded via front-matter.
  - [ ] **Wait**: `user_interview` requires `uiAPI`. If it's in front-matter, `runAgentSession` needs to provide the
        `uiAPI` to the tool. I need to check if `user_interview` is implemented as a static tool or a factory. (Looking
        at imports: `createUserInterviewTool(uiAPI)`).
  - [ ] _Decision_: Front-matter tools are typically name-based. The `createUserInterviewTool` is a factory. I will
        verify how `runAgentSession` handles "custom" vs "named" tools. Since `user_interview` needs `uiAPI`, it should
        stay in `customTools` but we can move the common ones (like `plan_written`) to front-matter.
  - [ ] _Correction_: The request asks for `user_interview` to be available via front-matter. This implies the tool
        system should support injecting the `uiAPI` into tools that need it, or `runAgentSession` should automatically
        add the `uiAPI`-bound version of `user_interview` if the agent requests it.

- [ ] **Step 4: Clean up `src/cmd/resume/index.js`**
  - [ ] Remove `customTools: [planWrittenTool, createUserInterviewTool(uiAPI)]` from `reviewLoop` calls.
  - [ ] Remove redundancy in `resumeRequest` and other prompts that overlap with the now-enhanced agent system prompts.

- [ ] **Step 5: Consolidate Prompting and Hand-off Logic**
  - [ ] Identify and extract common prompt components (like the Triage Report block and the "Review/Finalize"
        instructions) into a shared utility or common constants.
  - [ ] Update `src/cmd/router/index.js` and `src/cmd/resume/index.js` to use these shared components when preparing
        requests for the `planner` and `architect`.
  - [ ] Ensure that direct agent startup (via `--agent` or `/agent`) results in similar behavior to the `reviewLoop`
        when a planning task is in progress.
  - [ ] Move the detailed planning instructions (Iterative Planning, Interview Guidelines, Plan Structure) from the
        command handlers into the agent `.md` files (system prompts) to ensure parity across all entry points.

## Edge Cases & Considerations

- **`uiAPI` Dependency**: `user_interview` requires `uiAPI`. If it's listed in front-matter, `runAgentSession` must
  ensure the `createUserInterviewTool(uiAPI)` version is used when `uiAPI` is available.
- **Tool Name Collision**: Ensure `plan_written` (named tool) doesn't collide with any provided `planWrittenTool`
  object.
- **Consistency**: EnsureThat moving instructions to `.md` files doesn't remove critical context (like the specific
  Triage Report) that was previously injected. The Triage Report should still be passed in the `userRequest`.
