---
classification: "PROJECT"
complexity: "HIGH"
summary: "Comprehensive codebase optimization for production-grade quality. Focus areas: (1) Replace any/unknown types with specific JSDoc types across shared/ and cmd/ modules, (2) Extract repeated command handler patterns into shared helpers, (3) Refactor chat-session.js::onSubmit (250+ lines) into focused handlers, (4) Add inline comments for complex concurrency logic in workflow.js, (5) Improve variable naming for clarity. This requires systematic multi-file changes with careful attention to maintaining existing behavior and type safety."
affectedPaths:
    - "src/cli.js"
    - "src/constants.js"
    - "src/cmd/registry.js"
    - "src/shared/chat-session.js"
    - "src/shared/workflow.js"
    - "src/shared/session.js"
    - "src/shared/ui/api.js"
    - "src/shared/agents.js"
    - "src/shared/triage.js"
    - "src/cmd/router/index.js"
    - "src/cmd/agents/index.js"
    - "src/cmd/resume/index.js"
    - "src/tools/triage-report.js"
    - "src/tools/switch-agent.js"
createdAt: "2026-05-01T16:14:47.487Z"
updatedAt: "2026-05-01T16:14:47.487Z"
status: "in_review"
origin: "internal"
---

### Objective

Systematically improve code quality across the Harns `shared/` and `cmd/` modules by:

1. Eliminating `any`/`unknown` JSDoc types via a centralized `src/shared/types.js` module.
2. Extracting repeated TUI-cleanup, error-formatting, and repair-prompt patterns into `src/shared/command-helpers.js`.
3. Decomposing the 350-line `editor.onSubmit` closure in `chat-session.js` into pure, focused async handlers.
4. Documenting concurrency semantics (deadlock detection, task launch cap, retry flow) in `workflow.js`.
5. Improving callback variable naming (`t` → `task`, `a` → `agent`, `m` → `message`) and standardizing abbreviations
   (`parsed` → `parsedArgs`, `opts` → `options`).

Reference ADR: `docs/adr/002-codebase-optimization-types-and-handlers.md`.

### Vertical Slice Findings

**chat-session.js**: `editor.onSubmit` (lines 301–657) handles bash interception, slash-command dispatch,
prompt-template dispatch, and normal agent messaging in a single closure. It captures ~10 local variables (`editor`,
`uiAPI`, `pastedImages`, `previewImages`, `rootSessionManager`, etc.) making unit testing impossible. `any` types appear
for `images`, `editor` internal methods, `data` in `handleInput`, and `rootSessionManager` casts.

**workflow.js**: `executeProjectTasks` (lines 383–556) implements a custom task DAG executor with `MAX_PARALLEL_TASKS`
throttling, `Promise.race` readiness polling, and a retry loop. There are zero inline comments explaining the
deadlock-detection branch or why `mockUiAPI` suppresses concurrent TUI writes. `UiAPI` typedef uses `any` for
`addToolInvoked`, `addToolResult`, `startToolExecution`, and `getActiveToolBlock`. The `messages?: any[]` result field
is untyped.

**session.js**: Tool-event handlers (`tool_execution_start`, `tool_execution_update`, `tool_execution_end`) map partial
results through `any`-typed `content` blocks. `mergedAttrs` and `args` are `Record<string, unknown>` with no narrowed
accessor patterns. The `switchAgentTool` custom execute wrapper casts `params` with `/** @type {any} */`.

**cmd/router/index.js & cmd/resume/index.js**: Both contain the exact same 3-line repair-loop prompt string for
malformed task tables. Both repeat the post-error TUI cleanup pattern (`disableSubmit = false`, `setBusy(false)`,
`enableInput()`, `setFocus(editor)`).

**registry.js**: `CommandContext` typedef declares `editor`, `tui`, and `getArgumentCompletions` as `any`.

**cli.js & constants.js** (inspected): No `any` types, ambiguous callback names, or duplicated handler patterns were
found. They are excluded from the task list but retained in the triage audit trail.

### File Impacts

| File                                                       | Action | Description                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types.js`                                      | Create | Centralized JSDoc typedefs: `ImageAttachment`, `AgentMessageHandler`, `ChatSessionContext`, `CommandContext`, `EditorAPI`, `TuiAPI`, `PlanTask`, `ToolEvent`, `SessionEvent`                                                                         |
| `src/shared/command-helpers.js`                            | Create | `formatError(err)`, `resetTuiState(editor, uiAPI, tui)`, `buildRepairPrompt(planName, error)`, `showUnknownCommand(uiAPI, cmd)`                                                                                                                      |
| `src/shared/chat-session.js`                               | Modify | Decompose `onSubmit` into `handleBashCommand`, `handleSlashCommand`, `handleAgentMessage` (pure functions). Replace all `any` with imported typedefs. Rename template loop vars. Remove redundant `/** @type {any} */` casts on `rootSessionManager` |
| `src/shared/workflow.js`                                   | Modify | Replace `any` in `UiAPI` typedef and `results` Map. Add inline comments to `executeProjectTasks` readiness filter, launch cap, `Promise.race` polling, deadlock detection, retry flow, and `reviewLoop` revision cycle                               |
| `src/shared/session.js`                                    | Modify | Replace `any` in `currentMarkdownBlock`, tool-event `content` blocks, and `args` parameter. Narrow `mergedAttrs` accessors. Remove `/** @type {any} */` cast on `switchAgentTool` params. Use `formatError` helper                                   |
| `src/shared/ui/api.js`                                     | Modify | Replace `any` event parameters with `SessionEvent` from `types.js`. Align `addToolInvoked`/`addToolResult` types with `@mariozechner/pi-coding-agent` `SessionEvent`                                                                                 |
| `src/shared/triage.js`                                     | Modify | Keep existing types; rename `m` → `msg` / `match` where ambiguous                                                                                                                                                                                    |
| `src/shared/agents.js`                                     | Modify | Rename `a` → `agent` in callbacks                                                                                                                                                                                                                    |
| `src/shared/direct-agent.js`                               | Modify | Import `ImageAttachment` and `AgentMessageHandler` from `types.js`                                                                                                                                                                                   |
| `src/shared/submit-plan.js`                                | Modify | Verify `log` parameter typing; import `UiAPI` from `types.js` if used in JSDoc                                                                                                                                                                       |
| `src/cmd/registry.js`                                      | Modify | Import `CommandContext`, `EditorAPI`, `TuiAPI` from `types.js`; replace `any` fields. Type `getArgumentCompletions` return array                                                                                                                     |
| `src/cmd/router/index.js`                                  | Modify | Adopt `buildRepairPrompt` helper. Adopt `resetTuiState` helper in finally blocks. Rename `parsed` → `parsedArgs`                                                                                                                                     |
| `src/cmd/resume/index.js`                                  | Modify | Adopt `buildRepairPrompt` and `resetTuiState` helpers. Rename `parsed` → `parsedArgs`                                                                                                                                                                |
| `src/cmd/agents/index.js`                                  | Modify | Adopt `resetTuiState` helper. Rename `a` → `agent`, `parsed` → `parsedArgs`                                                                                                                                                                          |
| `src/cmd/models/index.js`                                  | Modify | Rename `m` → `model` in callbacks                                                                                                                                                                                                                    |
| `src/tools/switch-agent.js`                                | Modify | Rename `a` → `agent` in callbacks. Remove `/** @type {any} */` cast on `context?.sessionManager`                                                                                                                                                     |
| `docs/adr/002-codebase-optimization-types-and-handlers.md` | Create | ADR documenting the centralized types, pure handler, and shared helper decisions (already accepted)                                                                                                                                                  |

### Tasks

Tasks must form a Directed Acyclic Graph (DAG). Do not combine tasks that can be done in parallel.

| Task | Assignee   | Dependencies | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ---------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | engineer   |              | Create `src/shared/types.js` with centralized JSDoc typedefs (`ImageAttachment`, `AgentMessageHandler`, `ChatSessionContext`, `CommandContext`, `EditorAPI`, `TuiAPI`, `PlanTask`, `ToolEvent`, `SessionEvent`). Create `src/shared/command-helpers.js` with `formatError`, `resetTuiState`, `buildRepairPrompt`. Ensure both modules export all types/functions and have zero external deps beyond existing project constants. Verify `docs/adr/002-codebase-optimization-types-and-handlers.md` is up to date.                                                      |
| T2   | engineer   | T1           | Refactor `src/shared/chat-session.js`: (a) define a `ChatSessionContext` object shape, (b) extract `handleBashCommand`, `handleSlashCommand`, `handleAgentMessage` as pure async functions taking `(text, ctx)`, (c) replace all `any` and `/** @type {any} */` casts with specific imported types, (d) rename loop vars (`t`→`template`, `cmd`→`command` where ambiguous), (e) thin `editor.onSubmit` wrapper delegates to extracted handlers. Preserve all existing behavior including bash `!` and `!!` semantics, slash-command routing, and image paste handling |
| T3   | engineer   | T1           | Clean up types in `src/shared/session.js`, `src/shared/workflow.js`, `src/shared/ui/api.js`, `src/shared/triage.js`, `src/shared/agents.js`, `src/shared/direct-agent.js`, `src/shared/submit-plan.js`. Replace `any`/`unknown` with imported typedefs. In `workflow.js`, add brief inline comments above the readiness filter, the `toLaunch` slice, the `Promise.race` / `setTimeout(100)` polling strategy, the deadlock/blocked branch, and the retry-loop interaction with `askRetryFailedTasks`. These are structural comments to aid the doc-writer in T5.     |
| T4   | engineer   | T1           | Clean up `src/cmd/registry.js`, `src/cmd/router/index.js`, `src/cmd/resume/index.js`, `src/cmd/agents/index.js`, `src/cmd/models/index.js`. Replace `any` fields in `CommandContext` with imported types. Adopt `resetTuiState` and `buildRepairPrompt` from `command-helpers.js` where duplicate code exists. Rename callback vars (`a`→`agent`, `m`→`model`, `parsed`→`parsedArgs`)                                                                                                                                                                                 |
| T5   | doc-writer | T3           | Expand inline comments in `src/shared/workflow.js` added by T3 into full explanatory documentation: (1) how the readiness filter resolves task dependencies, (2) why `MAX_PARALLEL_TASKS - running.size` caps launches, (3) the `Promise.race` + `setTimeout(100)` polling loop and when it falls back to `Promise.all`, (4) the deadlock/blocked detection branch, (5) the `mockUiAPI` rationale for suppressing concurrent TUI writes. Also comment the `reviewLoop` revision flow and feedback concatenation. Do not change logic, only comments.                  |
| T6   | engineer   | T2, T3, T4   | Variable naming sweep: ensure every modified file uses descriptive names in `map`/`filter`/`find` callbacks. Fix any `opts` → `options`, `res` → `result`, `cmd` vs `command` inconsistencies that were missed in prior tasks. No behavioral changes. Verify `src/tools/switch-agent.js` `a` → `agent` rename and `any` cast removal.                                                                                                                                                                                                                                 |
| T7   | tester     | T5, T6       | Run `deno run ci` and fix all type/lint/test issues. Verify no behavioral regressions by reviewing the diff for unintended logic changes, especially in `chat-session.js` bash execution and `workflow.js` task scheduling. Flag any bugs uncovered by stricter typing (e.g., implicit assumptions on `Record<string, unknown>`) for follow-up rather than silently fixing out-of-scope issues.                                                                                                                                                                       |

### Edge Cases & Considerations

1. **pi-tui internal types**: `Editor` and `TUI` are third-party classes without published `.d.ts` files. The
   `EditorAPI` and `TuiAPI` typedefs in `types.js` will list only the methods/properties we actually invoke, annotated
   with `@ts-ignore` at the actual call sites if needed. These typedefs are best-effort and may need updating if pi-tui
   internals change.
2. **Chat-session state lifecycle**: The extracted `handleBashCommand` and `handleSlashCommand` functions mutate
   `pastedImages` and `previewImages` arrays on the context object. The context object must be a single mutable
   reference (not cloned) so that `editor.handleInput` (which also mutates `pastedImages`) continues to share state.
3. **Workflow concurrency semantics**: Adding comments is safe, but if any comment reveals an existing bug in the retry
   logic (e.g., `spinnerInterval` being re-declared inside `try` blocks), task T3 or T7 engineers should flag it for
   follow-up rather than silently fixing it — scope is optimization, not bug-fixing.
4. **Deno compatibility**: `deno run ci` must pass. Some `any` replacements (e.g., narrowing `Record<string, unknown>`)
   may expose existing implicit assumptions that Deno's type checking now surfaces. Budget extra time in T7 for these.
5. **String template extraction**: `buildRepairPrompt` centralizes the repair prompt text. If future agent prompts need
   to diverge between router and resume, a simple parameter can be added later without breaking call sites.
6. **T3 / T5 comment boundary**: T3 engineers add short structural comments (1–2 sentences) as landmarks while
   refactoring. T5 doc-writer expands these into full paragraphs. To avoid merge conflicts, T5 should edit the same
   comment blocks in-place rather than appending new ones.
