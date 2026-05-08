# Refactor plan: split `src/shared/chat-session.js`

## Why

`chat-session.js` is 1,162 lines, ~840 of which live inside one `startInteractiveSession()` function. It mixes layout
setup, cancellation state, bash command interception, slash-command dispatch, keybindings, UI-API overrides, and message
hydration. It has no unit tests of its own — the related `cancellation_test.js` re-implements the generation-gating
pattern inline (because the production version is a closure inside `startInteractiveSession`), so regressions in the
real code wouldn't fail the test.

Goal: extract cohesive units into siblings so the top-level loop stays a thin coordinator, and turn
`cancellation_test.js` into a real test.

This refactor is **structural only** — no behavior changes. Each extracted unit keeps its current semantics; we add
seams, we don't redesign.

## Target layout

```
src/shared/interactive/         # new folder for the interactive TUI loop
├── chat-session.js             # thin orchestrator (~300 lines)
├── generation-guard.js         # extracted createGenerationGuard()
├── generation-guard_test.js    # renamed/rewritten cancellation_test.js
├── bash-interceptor.js         # `!command` and `!!command` handling
├── slash-dispatch.js           # `/command` and template dispatch
├── keybindings.js              # editor.handleInput key handling
├── ui-api-overrides.js         # setAgentInfo / showModelSelector / etc.
├── message-hydration.js        # restorePersistedMessagesToUi + helpers
└── boot-banner.js              # boot summary (loaded prompts, skills, warnings)
```

`clipboard.js` and `runtime-preflight.js` stay where they are — they're cross-cutting and used elsewhere too.

## Extraction units

### 1. `generation-guard.js` (small, do first)

Extract this closure pair from `chat-session.js:505-513`:

```js
let operationGeneration = 0;
function generationStillCurrent(gen) {
    return gen === operationGeneration;
}
```

into a factory:

```js
export function createGenerationGuard() {
    let operationGeneration = 0;
    return {
        bump: () => ++operationGeneration,
        isCurrent: (gen) => gen === operationGeneration,
        invalidateAll: () => {
            ++operationGeneration;
        },
    };
}
```

Then **rename** `src/shared/cancellation_test.js` → `src/shared/interactive/generation-guard_test.js`, **import** the
real factory, drop the inline copy. The cancel-callback and bash-kill tests stay (they cover patterns, not exports) but
get a comment noting they document the pattern in `chat-session.js`.

**Risk**: trivial. Pure logic, no I/O, no globals.

### 2. `bash-interceptor.js`

Extract `chat-session.js:685-865` (the `userRequest.startsWith("!")` block). Signature:

```js
export async function handleBashCommand({
    userRequest,
    uiAPI,
    tui,
    rootSessionManager,
    generationGuard,
    registerBashProc,   // (proc | null) => void
    onIdle,             // optional cleanup hook
})
```

Returns `void`. The function owns:

- parsing `!` vs `!!` exclusion
- the inherit-stdio path for `!!` (stop/init TUI bracket)
- spawning sh, streaming stdout/stderr to tool block
- generation-gated session message persistence
- cancellation via the registered process

The caller's only responsibility becomes:

```js
if (userRequest.startsWith("!")) {
    return handleBashCommand({ ... });
}
```

**Risk**: medium. This block reaches into `activeBashProc`, `generationStillCurrent`, `getRootSessionManager`, and
`uiAPI`. The seam needs to pass each of those in explicitly — no module-level state.

### 3. `slash-dispatch.js`

Extract `chat-session.js:867-960` (the `userRequest.startsWith("/")` branch). Two sub-paths:

- **Built-in command** → `commandRegistry[command].execute(...)` with cancel registered as `abortActiveSession()`
- **Prompt template** → `setActiveAgent(operator) → runAgentSession(...)` with optional `templateModel` resolution

Signature:

```js
export async function handleSlashCommand({
    userRequest,
    args,
    savedImages,
    uiAPI,
    editor,
    tui,
    sessionStartedAt,
    promptTemplateByName,
    builtinNames,
    generationGuard,
    registerOperationCancel,
    originalHandleInput,
})
```

**Risk**: medium-low. Mostly a routing function; existing branches stay intact.

### 4. `keybindings.js`

Extract `chat-session.js:1023-1118` (custom `editor.handleInput`). Signature:

```js
export function installKeybindings({
    editor,
    tui,
    uiAPI,
    pastedImages,
    previewImages,
    submissionQueue,
    generationGuard,
    cancelActiveOperation,
    dismissActivePrompt,
    forceResetUI,
})
```

This wraps `editor.handleInput` with the Esc / Ctrl+C / Ctrl+V / Ctrl+O / Shift+Enter / backspace handlers and returns
the original handler so slash-dispatch can re-invoke it.

**Risk**: low. Pure delegation, no async control flow.

### 5. `ui-api-overrides.js`

Extract `chat-session.js:548-617` (the `uiAPI.setAgentInfo`, `uiAPI.disableInput`, `uiAPI.enableInput`,
`uiAPI.showModelSelector`, `uiAPI.appendImage` overrides). Signature:

```js
export function installUiApiOverrides({ uiAPI, tui, editor, container, messageList })
```

**Risk**: low.

### 6. `message-hydration.js`

Move `blockToDisplayText`, `messageToDisplayText`, and `restorePersistedMessagesToUi` (lines 163-319) verbatim. They
have no hidden dependencies on the closure scope.

**Risk**: trivial.

### 7. `boot-banner.js`

Extract `chat-session.js:1120-1149` (loaded prompts, skills, blocked-name warnings). Signature:

```js
export async function renderBootBanner({
    uiAPI,
    invokablePromptTemplates,
    blockedPromptTemplates,
    chatPromptAgentName,
})
```

**Risk**: trivial.

### 8. Move `chat-session.js` itself

Final step: `git mv src/shared/chat-session.js
src/shared/interactive/chat-session.js`, fix all importers (about a dozen
files in `cmd/` and `tools/`).

After extraction the file should look like:

1. imports
2. small exported helpers (`setActiveAgent`, `setActiveModel`, `resolveTemplateModel`, etc.) — these stay because
   they're imported by `cmd/` and `tools/` and act as the public surface
3. `startInteractiveSession()` — now ~250 lines: layout, wiring, `executeUserRequest()` becomes a 30-line dispatcher
   that calls `handleBashCommand` / `handleSlashCommand` / `activeOnMessage`

## Order of operations (one PR per stage, or one big PR with stages as

commits)

| Stage | Change                                                                                        | Verify by                                                                                     |
| ----- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A     | Add `interactive/` folder; extract `generation-guard.js` and rewire test                      | `deno task ci`                                                                                |
| B     | Extract `message-hydration.js`, `boot-banner.js`, `ui-api-overrides.js` (low-risk pure moves) | `deno task ci` + smoke-test interactive session                                               |
| C     | Extract `bash-interceptor.js`                                                                 | `deno task ci` + manual test: `!ls`, `!!vim`, Esc-cancel a long bash                          |
| D     | Extract `slash-dispatch.js`                                                                   | `deno task ci` + manual test: built-in `/help`, prompt template `/foo`, unknown `/bar`        |
| E     | Extract `keybindings.js`                                                                      | `deno task ci` + manual test: Esc, Ctrl+C twice, Ctrl+V, Shift+Enter, backspace-deletes-image |
| F     | `git mv` to `interactive/`, fix importers, update README tree                                 | `deno task ci`                                                                                |

## Open questions for review

1. **Folder name.** `interactive/` vs `chat/` vs leave at `shared/` root. Recommendation: `interactive/` — distinguishes
   the long-running TUI loop from short-lived `session/` agent invocations.
2. **Single PR or six?** Recommend one PR with stages A-F as separate commits — reviewers can read each commit, but
   bisect stays useful.
3. **Should `clipboard.js` move into `interactive/`?** It's only used by `chat-session.js`. Mild leaning yes, but it's a
   pure utility — could also stay loose. Not load-bearing.
4. **Tests.** Beyond `generation-guard_test.js`, do we want unit tests for `bash-interceptor` and `slash-dispatch`?
   They're feasible (pass a fake `uiAPI` and `Deno.Command` shim) but require some seams. Worth doing if we expect to
   keep iterating; skippable if this is one-shot.

## Non-goals

- No behavior changes. If a unit needs reshaping (e.g., the bash exclude path stops/restarts the TUI awkwardly), file a
  follow-up — don't fold it into this refactor.
- No new abstractions for hypothetical reuse. Each extracted module has exactly one caller after this work.
- No changes to `session/`, `workflow/`, `models/`, `ui/blocks.js`, etc.
- No type expansion beyond what the moves require.
