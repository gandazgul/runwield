---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Modify the `/resume` command to check the token count of a session before loading it. If the session size exceeds a threshold (e.g., 50% of the model's context window), the user should be prompted whether they want to compact the session before proceeding with the resume. This prevents loading oversized contexts that could degrade model performance or exceed limits."
affectedPaths:
    - "src/cmd/resume/index.js"
createdAt: "2026-06-13T15:00:00.000Z"
updatedAt: "2026-06-14T02:27:08.779Z"
status: "completed"
origin: "internal"
---

# Resume Compaction Offer

## Context

When resuming a long session via `/resume`, the full conversation history is loaded into the LLM context. If the session
is large (e.g. >50% of the current model's context window), the user may want to compact it first to avoid hitting
context limits or degrading model performance.

Currently there is no warning — the session loads as-is and the user must manually run `/compact` afterward.

## Objective

After the user selects a session in `/resume` but **before** loading it, estimate the session's total token count. If it
exceeds a configurable percentage of the current model's context window, ask the user: compact now, resume as-is, or
cancel. If they choose compact, run compaction immediately before restoring the conversation.

## Approach

1. **Token estimation from raw session file** — read the JSONL file and estimate tokens using pi's existing
   `estimateTokens()` from `@earendil-works/pi-coding-agent` (chars/4 heuristic). For `compaction` entries, read the
   `tokensBefore` field directly.
2. **Model context window** — resolve the **currently configured default model** (not the session's original model)
   using `getModelRegistry()` and the settings' default provider/model.
3. **Threshold setting** — store `compactOnResumeThresholdPercent` as a Harns custom setting (default 50). Configurable
   via existing `setCustomSetting` API.
4. **User prompt** — a 3-option `promptSelect`: Compact now, Resume as-is, Cancel.
5. **Compact-then-resume flow** — if user picks compact: open the SessionManager, create/resolve the AgentSession, call
   `session.compact()`, then proceed with the normal restore/UI hydration flow.

## Files to Modify

- `src/cmd/resume/index.js` — all the core logic: token estimation, user prompt, compact-on-resume flow
- `src/shared/settings.js` — no structural changes needed, but document that `compactOnResumeThresholdPercent` (integer,
  1–100, default 50) is the canonical key for this setting

## Reuse Opportunities

- `@earendil-works/pi-coding-agent` → `estimateTokens` — already imported in `src/cmd/compact/index.js`, used to
  token-count individual messages
- `src/shared/models/model-registry.js` → `getModelRegistry()` — resolve current model's `contextWindow`
- `src/shared/settings.js` → `getCustomSetting()` / `setCustomSetting()` — read/write `compactOnResumeThresholdPercent`
- `src/shared/session/session-state.js` → `setRootSessionManager()`, `getRootAgentSession()` — manage session lifecycle
- `src/shared/session/session.js` → `ensureRootAgentSession()` — create AgentSession from SessionManager
- `src/shared/interactive/message-hydration.js` → `restorePersistedMessagesToUi()` — replay messages after load/compact
- `src/shared/session/root-session.js` → `getHarnsSessionDir()` — resolve session directory
- `uiAPI.promptSelect()` — 3-option selection prompt (already used in resume for session picker)

## Implementation Steps

- [ ] **Step 1: Add token estimation helper to `src/cmd/resume/index.js`**

  Create an async function `estimateSessionTokens(filePath)` that:
  1. Reads the session file
  2. Parses each line as JSON
  3. For `message` entries, calls `estimateTokens(entry.message)` from pi
  4. For `compaction` entries, reads `entry.tokensBefore | 0`
  5. Returns the sum (`{ estimatedTokens: number, messageCount: number }`)

  This is a lightweight scan — no need to load the full SessionManager.

- [ ] **Step 2: Add model context window helper**

  Create an async function `getCurrentModelContextWindow()` that:
  1. Gets the settings manager to read default provider/model
  2. Uses `getModelRegistry().find(provider, modelId)` to get the model object
  3. Returns `model.contextWindow ?? 128000` (fallback to pi's default)

- [ ] **Step 3: Add threshold constant and settings reader**

  Define `DEFAULT_COMPACT_ON_RESUME_PCT = 50`.

  Create a helper `getCompactThresholdPercent()` that reads `compactOnResumeThresholdPercent` from merged custom
  settings (project scope preferred, falling back to global) via `getMergedCustomSetting()`, validates it's 1–100, and
  returns the value (or default).

- [ ] **Step 4: Insert the compaction offer into the resume flow**

  In `runResumeCommand()`, after the user selects a session (`chosenPath`) and before calling `SessionManager.open()`:

  1. **Estimate tokens**: `const { estimatedTokens } = await estimateSessionTokens(chosenPath);`
  2. **Get threshold**: `const thresholdPct = getCompactThresholdPercent();`
  3. **Get context window**: `const contextWindow = getCurrentModelContextWindow();`
  4. **Check threshold**: If `estimatedTokens > contextWindow * (thresholdPct / 100)`:
     - Compute `pctUsed = ((estimatedTokens / contextWindow) * 100).toFixed(1)`
     - Show `promptSelect` with:
       - `"compact"` label: `Compact now (estimated ~${pctUsed}% of ${formatTokens(contextWindow)})`
       - `"resume"` label: `Resume as-is`
       - `"cancel"` label: `Cancel`
     - On `"cancel"`: return (don't load anything, editor stays blank)
     - On `"resume"`: continue with normal flow
     - On `"compact"`: proceed to Step 5

- [ ] **Step 5: Implement compact-then-resume flow**

  When user picks compact:

  1. `const rootSessionManager = SessionManager.open(chosenPath, sessionDir, cwd);`
  2. `setRootSessionManager(rootSessionManager);`
  3. `await ensureRootAgentSession({ agentName: currentAgent, uiAPI, sessionManager: rootSessionManager });`
  4. `const session = getRootAgentSession();`
  5. Show status: `uiAPI.appendSystemMessage("Compacting session before resume... (Esc to cancel)");`
  6. `await session.compact();`
  7. Show result: `uiAPI.appendSystemMessage(`Compacted. Tokens before: ${result.tokensBefore.toLocaleString()}`);`
  8. Then continue with the normal resume tail:
     - `uiAPI.clearMessages()`
     - `restorePersistedMessagesToUi(rootSessionManager, uiAPI)`
     - `uiAPI.appendSystemMessage(Resumed session: ...)`

  Handle cancellation (Escape) by catching the abort and falling back to normal resume.

- [ ] **Step 6: Handle edge cases**

  - **Session file unreadable** — catch errors, log warning, proceed with normal resume (no prompt)
  - **No model configured** — use default 128000 context window, show prompt based on that
  - **Session already compacted** — the estimate still reflects total size, prompt is still valid; compaction just won't
    do much (pi skips if last entry is compaction). That's fine.
  - **Zero or tiny sessions** — threshold won't trigger, no prompt
  - **Cancelled compaction** — catch, show "Compaction cancelled, resuming as-is", proceed with normal resume
  - **Compaction fails** — catch, show error, proceed with normal resume
  - **Settings file doesn't have the key** — default to 50, no error

## Verification Plan

- **Automated**: `deno run ci` — must pass lint and tests
- **Manual**:
  1. Start a session, send enough messages to exceed 50% of the model's context window
  2. Exit, run `/resume`, select that session
  3. Verify a prompt appears: "Compact now", "Resume as-is", "Cancel"
  4. Select "Compact now" — verify compaction runs and session resumes with summary
  5. Repeat with "Resume as-is" — verify session loads without compaction
  6. Repeat with a small session (<50%) — verify no prompt appears
  7. Test `compactOnResumeThresholdPercent = 10` via `setCustomSetting` — verify prompt appears for small sessions
- **Expected results**:
  - Large sessions show the offer prompt
  - Compact flow produces a compacted, usable session
  - Small sessions resume silently without prompt
  - Cancel returns to the editor cleanly

## Edge Cases & Considerations

- **Compaction during resume should not auto-retry** — pi's `session.compact()` without arguments uses the manual path
  (no auto-retry after compact). Confirm this in pi's source.
- **Token estimation is approximate (chars/4)** — it may overcount or undercount vs the LLM's actual tokenizer. That's
  acceptable for a threshold check; the user can always skip compaction.
- **The model used during compact** is whatever `ensureRootAgentSession` configures (the current default). If user
  switches models between sessions, the compact summary is generated by the current model — which is fine and
  intentional.
- **Avoid loading the SessionManager twice** — the compact path opens the session once, compacts, then uses the same
  manager for the resume; the normal path opens it once. No double-load.
- **Performance** — reading + parsing a large session file (~5000 lines) is fast (<50ms). This happens in the event loop
  between user selection and session open, and the user is waiting anyway.
