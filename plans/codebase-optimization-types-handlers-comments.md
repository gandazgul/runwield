---
classification: "PROJECT"
complexity: "HIGH"
summary: "Comprehensive codebase optimization for production-grade quality. Focus areas: (1) Replace any/unknown types with specific JSDoc types across the full src/ tree (runtime + tests), (2) Extract repeated command handler patterns into shared helpers, (3) Refactor chat-session.js::onSubmit (250+ lines) into focused handlers, (4) Add inline comments for complex concurrency logic in workflow.js, (5) Improve variable naming for clarity. This requires systematic multi-file changes with careful attention to maintaining existing behavior and type safety."
affectedPaths:
    - "src/shared/types.js"
    - "src/shared/command-helpers.js"
    - "src/shared/chat-session.js"
    - "src/shared/workflow.js"
    - "src/shared/session.js"
    - "src/shared/session-state.js"
    - "src/shared/ui/api.js"
    - "src/shared/agents.js"
    - "src/shared/triage.js"
    - "src/shared/direct-agent.js"
    - "src/shared/submit-plan.js"
    - "src/cmd/registry.js"
    - "src/cmd/router/index.js"
    - "src/cmd/agents/index.js"
    - "src/cmd/resume/index.js"
    - "src/cmd/models/index.js"
    - "src/tools/switch-agent.js"
    - "docs/adr/002-codebase-optimization-types-and-handlers.md"
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

### Review Updates (2026-05-01)

- Confirmed from current code that the two repeated repair-loop prompts are duplicated in both `src/cmd/router/index.js`
  and `src/cmd/resume/index.js` exactly as described.
- Confirmed `src/shared/chat-session.js` still has a monolithic `editor.onSubmit` handler and several
  `/** @type {any} */` casts around editor/session-manager internals.
- Confirmed `src/shared/workflow.js` task executor still lacks explanatory comments on concurrency branches and still
  uses `any` in `UiAPI` and task-result typing.
- Scope updated per user direction: include **all type issues** across `src/`, including previously out-of-scope files
  such as `src/shared/ui/blocks.js`, `src/shared/model-registry.js`, `src/tools/user-interview.js`, command completion
  modules, and affected test files under `src/**/_test.js`.

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

### Full Type Audit Addendum (2026-05-01)

Current additional `any`/`unknown` hotspots confirmed by grep:

- Runtime modules: `src/shared/session-state.js`, `src/shared/model-registry.js`, `src/shared/ui/blocks.js`,
  `src/tools/user-interview.js`, `src/cmd/*/getArgumentCompletions.js`, plus previously triaged files.
- Tool/session boundaries: `src/tools/switch-agent.js` and `src/shared/session.js` still carry `AgentToolResult<any>`
  and cast-based gaps.
- Test modules: `src/tools/*_test.js`, `src/extensions/mnemosyne/index_test.js`, `src/cmd/models/index_test.js` contain
  broad `any` placeholders that should be tightened to explicit minimal fixture interfaces.

Normalization rule for this effort:

- Treat only type positions as in-scope (JSDoc typedefs, casts, function param/return docs).
- Ignore textual English occurrences of words like “any”/“unknown” in user-facing strings/messages.

### File Impacts

| File                                                       | Action        | Description                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types.js`                                      | Create        | Centralized JSDoc typedefs: `ImageAttachment`, `AgentMessageHandler`, `ChatSessionContext`, `CommandContext`, `EditorAPI`, `TuiAPI`, `PlanTask`, `ToolEvent`, `SessionEvent`                                                                         |
| `src/shared/command-helpers.js`                            | Create        | `formatError(err)`, `resetTuiState(editor, uiAPI, tui)`, `buildRepairPrompt(planName, error)`, `showUnknownCommand(uiAPI, cmd)`                                                                                                                      |
| `src/shared/chat-session.js`                               | Modify        | Decompose `onSubmit` into `handleBashCommand`, `handleSlashCommand`, `handleAgentMessage` (pure functions). Replace all `any` with imported typedefs. Rename template loop vars. Remove redundant `/** @type {any} */` casts on `rootSessionManager` |
| `src/shared/workflow.js`                                   | Modify        | Replace `any` in `UiAPI` typedef and `results` Map. Add inline comments to `executeProjectTasks` readiness filter, launch cap, `Promise.race` polling, deadlock detection, retry flow, and `reviewLoop` revision cycle                               |
| `src/shared/session.js`                                    | Modify        | Replace `any` in `currentMarkdownBlock`, tool-event `content` blocks, and `args` parameter. Narrow `mergedAttrs` accessors. Remove `/** @type {any} */` cast on `switchAgentTool` params. Use `formatError` helper                                   |
| `src/shared/ui/api.js`                                     | Modify        | Replace `any` event parameters with `SessionEvent` from `types.js`. Align `addToolInvoked`/`addToolResult` types with `@mariozechner/pi-coding-agent` `SessionEvent`                                                                                 |
| `src/shared/triage.js`                                     | Modify        | Keep existing types; rename `m` → `msg` / `match` where ambiguous                                                                                                                                                                                    |
| `src/shared/agents.js`                                     | Modify        | Rename `a` → `agent` in callbacks                                                                                                                                                                                                                    |
| `src/shared/direct-agent.js`                               | Modify        | Import `ImageAttachment` and `AgentMessageHandler` from `types.js`                                                                                                                                                                                   |
| `src/shared/submit-plan.js`                                | Modify        | Verify `log` parameter typing; import `UiAPI` from `types.js` if used in JSDoc                                                                                                                                                                       |
| `src/cmd/registry.js`                                      | Modify        | Import `CommandContext`, `EditorAPI`, `TuiAPI` from `types.js`; replace `any` fields. Type `getArgumentCompletions` return array                                                                                                                     |
| `src/cmd/router/index.js`                                  | Modify        | Adopt `buildRepairPrompt` helper. Adopt `resetTuiState` helper in finally blocks. Rename `parsed` → `parsedArgs`                                                                                                                                     |
| `src/cmd/resume/index.js`                                  | Modify        | Adopt `buildRepairPrompt` and `resetTuiState` helpers. Rename `parsed` → `parsedArgs`                                                                                                                                                                |
| `src/cmd/agents/index.js`                                  | Modify        | Adopt `resetTuiState` helper. Rename `a` → `agent`, `parsed` → `parsedArgs`                                                                                                                                                                          |
| `src/cmd/models/index.js`                                  | Modify        | Rename `m` → `model` in callbacks                                                                                                                                                                                                                    |
| `src/tools/switch-agent.js`                                | Modify        | Rename `a` → `agent` in callbacks. Remove `/** @type {any} */` cast on `context?.sessionManager`; replace `AgentToolResult<any>` with specific content/result typing                                                                                 |
| `src/tools/user-interview.js`                              | Modify        | Replace `question?: any`, `questions?: any[]`, and question helper `any` types with explicit union typedefs for yes/no, text, and multiple choice question payloads                                                                                  |
| `src/shared/model-registry.js`                             | Modify        | Replace `Record<string, any>` settings shape with a typed settings object (`defaultModel?`, `defaultProvider?` + index signature if needed)                                                                                                          |
| `src/shared/session-state.js`                              | Modify        | Replace `images: any[]` handler signature with shared `ImageAttachment[]` typedef                                                                                                                                                                    |
| `src/shared/ui/blocks.js`                                  | Modify        | Replace `any` child/item typing in block wrappers and list filtering with minimal structural interfaces (`render`, optional `invalidate`) and typed select items                                                                                     |
| `src/cmd/agents/getArgumentCompletions.js`                 | Modify        | Replace `Promise<any[]>` with typed completion-item array                                                                                                                                                                                            |
| `src/cmd/models/getArgumentCompletions.js`                 | Modify        | Replace `Promise<any[]>` with typed completion-item array                                                                                                                                                                                            |
| `src/cmd/resume/getArgumentCompletions.js`                 | Modify        | Replace `Promise<any[]>` with typed completion-item array                                                                                                                                                                                            |
| `src/extensions/mnemosyne/index_test.js`                   | Modify        | Replace `any` mocks with minimally typed test doubles for extension API/events/tool registration                                                                                                                                                     |
| `src/cmd/models/index_test.js`                             | Modify        | Replace `any` uiAPI test stub with narrowed fixture type                                                                                                                                                                                             |
| `src/tools/plan-written_test.js`                           | Modify        | Replace `any` helper params with typed tool/param fixtures                                                                                                                                                                                           |
| `src/tools/switch-agent_test.js`                           | Modify        | Replace `any` helper params/casts with typed fixture context/session-manager stubs                                                                                                                                                                   |
| `src/tools/triage-report_test.js`                          | Modify        | Replace `any` helper params with typed tool/param fixtures                                                                                                                                                                                           |
| `src/tools/user-interview_test.js`                         | Modify        | Replace `any` helper params with typed tool/param fixtures                                                                                                                                                                                           |
| `docs/adr/002-codebase-optimization-types-and-handlers.md` | Create/Update | ADR documenting the centralized types, pure handler, and shared helper decisions; append new “full type audit” scope note                                                                                                                            |

### Tasks

Tasks must form a Directed Acyclic Graph (DAG). Do not combine tasks that can be done in parallel.

| Task | Assignee   | Dependencies   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ---------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | engineer   |                | Create `src/shared/types.js` with centralized JSDoc typedefs (`ImageAttachment`, `AgentMessageHandler`, `ChatSessionContext`, `CommandContext`, `EditorAPI`, `TuiAPI`, `PlanTask`, `ToolEvent`, `SessionEvent`). Create `src/shared/command-helpers.js` with `formatError`, `resetTuiState`, `buildRepairPrompt`. Ensure both modules export all types/functions and have zero external deps beyond existing project constants. Verify `docs/adr/002-codebase-optimization-types-and-handlers.md` is up to date.                                                      |
| T2   | engineer   | T1             | Refactor `src/shared/chat-session.js`: (a) define a `ChatSessionContext` object shape, (b) extract `handleBashCommand`, `handleSlashCommand`, `handleAgentMessage` as pure async functions taking `(text, ctx)`, (c) replace all `any` and `/** @type {any} */` casts with specific imported types, (d) rename loop vars (`t`→`template`, `cmd`→`command` where ambiguous), (e) thin `editor.onSubmit` wrapper delegates to extracted handlers. Preserve all existing behavior including bash `!` and `!!` semantics, slash-command routing, and image paste handling |
| T3   | engineer   | T1             | Clean up types in `src/shared/session.js`, `src/shared/workflow.js`, `src/shared/ui/api.js`, `src/shared/triage.js`, `src/shared/agents.js`, `src/shared/direct-agent.js`, `src/shared/submit-plan.js`, `src/shared/session-state.js`, `src/shared/model-registry.js`, `src/shared/ui/blocks.js`, and `src/tools/user-interview.js`. Replace `any`/`unknown` with imported typedefs or local unions. In `workflow.js`, add brief inline comments above concurrency branches as previously scoped.                                                                     |
| T4   | engineer   | T1             | Clean up `src/cmd/registry.js`, `src/cmd/router/index.js`, `src/cmd/resume/index.js`, `src/cmd/agents/index.js`, `src/cmd/models/index.js`, and all `src/cmd/*/getArgumentCompletions.js`. Replace `any` fields in command typings and completion return types. Adopt `resetTuiState` and `buildRepairPrompt` where duplicate code exists. Rename callback vars (`a`→`agent`, `m`→`model`, `parsed`→`parsedArgs`).                                                                                                                                                    |
| T5   | engineer   | T3, T4         | Test typing sweep: remove `any` in `src/extensions/mnemosyne/index_test.js`, `src/tools/*_test.js`, and `src/cmd/models/index_test.js` by introducing minimal typed fixtures/helpers. Keep runtime behavior unchanged.                                                                                                                                                                                                                                                                                                                                                |
| T6   | doc-writer | T3             | Expand inline comments in `src/shared/workflow.js` into full explanatory documentation: readiness filtering, parallel launch cap, `Promise.race`/poll loop, deadlock/blocked detection, `mockUiAPI` rationale, and review-loop revision flow. Do not change logic.                                                                                                                                                                                                                                                                                                    |
| T7   | engineer   | T2, T3, T4, T5 | Final variable naming and consistency sweep in all touched files (`opts`→`options`, `res`→`result`, command naming consistency). No behavioral changes.                                                                                                                                                                                                                                                                                                                                                                                                               |
| T8   | tester     | T6, T7         | Run `deno run ci` and fix all type/lint/test issues introduced by stricter typing. Verify no behavioral regressions in `chat-session.js` bash/slash flows and `workflow.js` scheduling/retry semantics.                                                                                                                                                                                                                                                                                                                                                               |

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
