---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Implement 'Shift+Tab' keyboard shortcut to cycle through model thinking levels, persist the selection to settings.json, and display the current thinking level in the TUI footer. Also update the boot help text to reflect that this feature is now implemented."
affectedPaths:
    - "src/shared/interactive/chat-session.js"
    - "src/shared/interactive/keybindings.js"
    - "src/shared/settings.js"
createdAt: "2026-05-09T20:09:36.688Z"
updatedAt: "2026-05-09T20:09:36.688Z"
status: "completed"
origin: "internal"
---

# Plan: Implement Shift+Tab Thinking Level Cycling

## Overview

Implement `shift+tab` keyboard shortcut to cycle through the model's thinking levels, persist the selection to
`settings.json`, and display the current thinking level in the TUI footer with theme-appropriate colors.

## Thinking Levels (from `SettingsManager` / `AgentSession`)

`"off" | "minimal" | "low" | "medium" | "high" | "xhigh"`

## Theme Colors (`src/shared/ui/theme.js` / `catppuccin-mocha.json`)

| Level   | Theme Token       |
| ------- | ----------------- |
| off     | `thinkingOff`     |
| minimal | `thinkingMinimal` |
| low     | `thinkingLow`     |
| medium  | `thinkingMedium`  |
| high    | `thinkingHigh`    |
| xhigh   | `thinkingXhigh`   |

---

## Changes

### 1. `src/shared/session/session-state.js`

- Add `thinkingLevel` field to state object (initialized to `"off"`)
- Add `getThinkingLevel()` getter
- Add `setThinkingLevel(level)` setter

### 2. `src/shared/interactive/chat-session.js`

**Imports:**

- Import `getThinkingLevel`, `setThinkingLevel` from `session-state.js`

**`setActiveModel` function (line ~91):**

- After setting the model, also persist the current thinking level to settings via
  `settingsManager.setDefaultThinkingLevel()`
- Initialize thinking level state from settings: call `getDefaultThinkingLevel()` and store via `setThinkingLevel()`

**New helper `getModelAndProvider` (existing, line ~236):**

- Extend the returned object to also include `thinkingLevel` from `getThinkingLevel()` (or from settings/agent session)

**Footer `render` function (line ~294):**

- After the `modelStr` (`provider/model`), append the thinking level in parentheses with theme color
- Format: `provider/model_id (minimal)` — styled with the corresponding theme thinking color
- Use `theme.fg(thinkingColorToken, ...)` for coloring

**New `thinkingLevel` helper function:**

- Map thinking level string to theme token name
- Return `{ label, themeToken }` for use in footer rendering

**Help text (lines ~177-194):**

- Change `"shift+tab    to cycle thinking (not-implemented)"` → `"shift+tab    to cycle thinking level"`
- Change `"ctrl+t       to expand thinking (not-implemented)"` → `"ctrl+t       to expand thinking"`

**New `cycleThinkingLevel` function:**

- Get the root agent session via `getRootAgentSession()`
- If session exists and supports thinking, call `session.cycleThinkingLevel()`
- Persist the new level to settings via `settingsManager.setDefaultThinkingLevel()`
- Update session-state via `setThinkingLevel()`
- Trigger `tui.requestRender()`
- Return the new level

**Pass `cycleThinkingLevel` to `installKeybindings` (line ~480):**

- Add `cycleThinkingLevel` parameter to the context object

### 3. `src/shared/interactive/keybindings.js`

**`KeybindingsContext` typedef:**

- Add `cycleThinkingLevel: () => void`

**Destructure from ctx:**

- Extract `cycleThinkingLevel`

**New key handler — after existing handlers, before `originalHandleInput`:**

- Match `Key.shift("tab")`
- Call `cycleThinkingLevel()`
- `tui.requestRender()`
- `return` (consume the event)

### 4. `src/shared/ui/theme.js` (or inline in chat-session)

- No changes needed — the theme tokens already exist (`thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`,
  `thinkingHigh`, `thinkingXhigh`)

---

## Implementation Complete

### Changes made:

1. **`src/shared/session/session-state.js`** — Added `activeThinkingLevel` state field with getter/setter
2. **`src/shared/interactive/chat-session.js`** —
   - Added `persistThinkingLevel()` helper
   - Extended `getModelAndProvider()` to return `thinkingLevel`
   - Footer renders `(level)` after model with theme color
   - Initializes thinking level from settings on boot
   - `cycleThinkingLevel()` function calling `session.cycleThinkingLevel()` + persistence
   - Updated help text: removed "(not-implemented)" from shift+tab and ctrl+t lines
3. **`src/shared/interactive/keybindings.js`** — Added `Shift+Tab` handler calling `cycleThinkingLevel()`
