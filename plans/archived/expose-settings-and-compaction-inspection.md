---
planId: "046dc2a7-e537-4446-b938-1f27b2c89c55"
classification: "FEATURE"
complexity: "LOW"
summary: "The user wants to expose compaction settings and make current behavior easier to inspect, as per the PRD. This involves creating a new command (e.g., `/compact-settings`) to view and modify `CompactionSettings` (enabled, reserveTokens, keepRecentTokens) via the `SettingsManager`."
affectedPaths:
    - "src/cmd/compact/index.js"
    - "src/shared/settings.js"
frontend: false
createdAt: "2026-07-04T11:03:32-04:00"
updatedAt: "2026-07-17T04:42:50.954Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-04T16:04:55.975Z"
verifiedAt: "2026-07-04T16:58:36.998Z"
workRecord:
    status: "generated"
    recordId: "37dee1b8-525a-4761-94f2-3013a01ee657"
    path: "docs/work-records/2026-07-17-expose-compaction-settings-and-session-diagnostics.md"
    lastAttemptAt: "2026-07-17T04:42:18.260Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
archivedAt: "2026-07-05T04:13:26.531Z"
archivedFromStatus: "verified"
archivedFromPath: "plans/expose-settings-and-compaction-inspection.md"
routingIntent: "FEATURE"
sessionName: "expose compaction settings"
---

# Add Settings Command and Compaction Inspection

## Context

The TODO in `docs/prd/done/compaction-PRD.md` was about exposing Pi's compaction controls in RunWield and making it
easier to see why/when compaction will happen.

Current code already has:

- `/compact` in `src/cmd/compact/index.js` for manual compaction.
- Pi auto-compaction already active via `AgentSession._checkCompaction()`.
- Footer context usage already shows `(Auto-compact)` when compaction is enabled.
- `/session` only counts compaction entries and token totals; it does not show compaction settings, thresholds, or
  current compaction decision inputs.
- RunWield has no `/settings` command.

The user clarified two product choices:

- Do not create a dedicated `/compaction-settings` command; implement this under the Pi-style `/settings` command name.
- Include editable numeric controls for `reserveTokens` and `keepRecentTokens`, not only the Pi `Auto-compact` toggle.

## Objective

Build a slash-only `/settings` command that exposes compaction settings in the TUI and add a compaction-focused
inspection section to `/session` so users can answer:

- Is auto-compaction currently enabled?
- What are `reserveTokens` and `keepRecentTokens`?
- At what context threshold will auto-compaction trigger for the current model?
- How much recent context will manual/auto compaction keep?
- Has this session already been compacted?

## Approach

Implement `/settings` as a RunWield settings menu using the existing `uiAPI.promptSelect()` and `uiAPI.promptText()`
primitives. Keep the feature focused on the compaction TODO rather than copying Pi's full settings selector wholesale,
because Pi's exported `SettingsSelectorComponent` exposes `Auto-compact` but does not provide extension points or
setters for `reserveTokens` / `keepRecentTokens`.

The `/settings` menu should be easy to grow later, but for this feature it should include a clear `Compaction`
section/menu with:

- `Auto-compact` toggle.
- Editable `Reserve tokens` numeric value.
- Editable `Keep recent tokens` numeric value.
- A read-only summary of the current effective behavior.

Persist compaction settings in the same global settings scope Pi uses for `setCompactionEnabled()`. Pi's
`SettingsManager` has getters for all compaction fields but only a public setter for `enabled`, so add small RunWield
helpers for the two numeric settings that safely update the global `compaction` object and reload the settings manager.

Enhance `/session` to print effective compaction settings and current threshold/usage diagnostics.

## Files to Modify

- `src/cmd/registry.js` — add `COMMAND_NAMES.SETTINGS`, import/register the slash-only command, and include help
  metadata/usage for `/settings`.
- `src/cmd/settings/index.js` — new command handler and compaction settings menu using `promptSelect`/`promptText`.
- `src/cmd/settings/index.test.js` — tests for missing TUI context, toggling auto-compaction, editing numeric settings,
  rejecting invalid numeric input, and cancel paths.
- `src/cmd/session/index.js` — add compaction diagnostics using `getRootAgentSession()` and `getRootSessionManager()`.
- `src/cmd/session/index.test.js` — cover the new compaction section.
- `src/shared/settings.js` — add safe helpers to update global `compaction.reserveTokens` and
  `compaction.keepRecentTokens`, preserving sibling fields and reloading the Pi settings manager.
- `src/shared/settings.test.js` — verify numeric compaction helpers preserve existing compaction fields, persist
  globally, and reject invalid values.

## Reuse Opportunities

- `src/shared/settings.js` — reuse `getSettingsManager()`, `setCustomSetting()`, settings storage locking, and settings
  reload behavior.
- `src/shared/session/session-state.js` — reuse `getRootAgentSession()` and `getRootSessionManager()` for live
  settings/diagnostics.
- `src/shared/ui/api.js` — reuse existing `promptSelect()` and `promptText()` TUI primitives instead of adding a new
  overlay component.
- `src/cmd/session/index.js` — extend the existing session-summary command instead of introducing another inspection
  command.
- `src/cmd/compact/index.js` — optionally reuse/export its summarizable-token estimate if `/session` should show how
  much is currently compactable.

## Implementation Steps

- [ ] Step 1: Add `/settings` command registration.
  - Add `SETTINGS: "settings"` to `COMMAND_NAMES` JSDoc and object in `src/cmd/registry.js`.
  - Import `runSettingsCommand` from `src/cmd/settings/index.js`.
  - Add a slash-only registry entry with usage `"/settings"`, description `"Open settings menu"`, and notes explaining
    that this feature currently exposes compaction settings.

- [ ] Step 2: Add compaction setting helpers.
  - In `src/shared/settings.js`, add a shared internal helper such as `setGlobalCompactionSetting(key, value)`.
  - Export `setCompactionReserveTokens(value)` and `setCompactionKeepRecentTokens(value)`.
  - Validate values as finite positive integers. Recommended minimum: `1`; optionally use a safer practical minimum such
    as `1024` if tests/docs state it clearly.
  - Read the existing global `compaction` object, merge the target key, write it back globally, and
    `await getSettingsManager().reload()`.
  - Preserve sibling fields (`enabled`, the other numeric setting) and all unrelated RunWield custom settings.

- [ ] Step 3: Implement `runSettingsCommand(argv, options)`.
  - If `argv[0]` is help-like, call `printCommandHelp(COMMAND_NAMES.SETTINGS)`.
  - If `options.uiAPI` is missing, print/report that `/settings` is only available inside an interactive session.
  - Build a loop around `uiAPI.promptSelect("Settings", ...)` with options:
    - `compaction` / current compaction summary.
    - `done`.
  - Selecting `compaction` opens another loop around `uiAPI.promptSelect("Compaction Settings", ...)` with options:
    - Toggle `Auto-compact`.
    - Edit `Reserve tokens`.
    - Edit `Keep recent tokens`.
    - Show/refresh behavior summary.
    - Back.
  - Use `uiAPI.promptText()` for numeric edits with the current value as default.
  - On successful numeric edit, call the new settings helper and append a concise confirmation message.
  - On invalid numeric edit, append a clear validation message and keep the old value.
  - On auto-compact toggle, call `session.setAutoCompactionEnabled(enabled)` when a root agent session exists; otherwise
    call `settingsManager.setCompactionEnabled(enabled)`. Flush/reload if needed, then request render if available so
    the footer indicator updates.

- [ ] Step 4: Format compaction behavior summaries.
  - Add helper(s) in `src/cmd/settings/index.js` or a small shared command-local section:
    - `formatCompactionSettings(settings)`.
    - `formatCompactionBehavior({ settings, contextUsage, contextWindow })`.
  - Show threshold as `contextWindow - reserveTokens` when context window is known.
  - Show `Current context: unknown` when the model has no usage data yet.
  - Explain behavior succinctly:
    `Auto-compaction triggers when current context exceeds threshold; compaction keeps about keepRecentTokens of recent messages.`

- [ ] Step 5: Enhance `/session` compaction diagnostics.
  - Import `getRootAgentSession()` in addition to `getRootSessionManager()`.
  - Add a `Compaction` section with:
    - `Compacted: <n> time(s)`.
    - `Auto-compact: enabled/disabled`.
    - `Reserve Tokens: <n>`.
    - `Keep Recent Tokens: <n>`.
    - `Auto Threshold: <contextWindow - reserveTokens>` when current model context window is known.
    - `Current Context: <tokens>/<contextWindow> (<percent>%)` when `session.getContextUsage()` has values.
  - Keep behavior graceful when no active root agent session or no context usage is available.

- [ ] Step 6: Add/update tests.
  - Registry test: `/settings` appears in slash commands, not CLI commands.
  - Command tests:
    - Missing TUI reports gracefully.
    - Main menu cancel exits silently or with a short cancellation message.
    - Auto-compact toggle calls `setAutoCompactionEnabled()` on the active session.
    - Numeric edits call the new settings helpers.
    - Invalid numeric input does not persist and reports the validation error.
  - Settings helper tests:
    - `setCompactionReserveTokens()` preserves existing `enabled` and `keepRecentTokens`.
    - `setCompactionKeepRecentTokens()` preserves existing `enabled` and `reserveTokens`.
    - Invalid values throw/reject before writing.
  - Session test: compaction settings and threshold render with a mocked root agent session/context usage.

## Verification Plan

- Automated: `deno task ci`
- Manual:
  - Start RunWield with `deno task cli`.
  - Run `/settings`.
  - Open `Compaction Settings`.
  - Toggle `Auto-compact`; verify the footer `(Auto-compact)` indicator appears/disappears without restarting.
  - Change `Reserve tokens` and `Keep recent tokens`; verify confirmations show the new values.
  - Run `/session`; verify the `Compaction` section shows enabled state, reserve/keep-recent values, threshold, and
    current context usage when available.
  - Restart RunWield and verify the changed compaction values persist from `~/.wld/settings.json`.
  - Run `/compact` on a small session and verify its existing small-session guard still works.

## Edge Cases & Considerations

- Pi's `SettingsManager` merges project settings over global settings, but Pi's `setCompactionEnabled()` writes global
  settings. Keep all new compaction setters global for consistency.
- If project-local `compaction` settings override globals, `/settings` should either report the effective merged value
  and write global with a note, or explicitly state that project overrides may still win. Prefer documenting this in the
  behavior summary if detected via `getProjectSettings()`.
- Very small `reserveTokens` can starve summarization output; very large `reserveTokens` can trigger compaction early.
  Validation should prevent non-positive values, but avoid over-constraining advanced users unless a clear policy is
  chosen.
- `keepRecentTokens` larger than the model context window can make compaction ineffective. Report the value, but do not
  silently clamp it unless tests and messages make that behavior explicit.
- The settings command is slash-only because it relies on TUI prompts.
- Preserve pure JavaScript/JSDoc style; do not add TypeScript files or TypeScript syntax.
