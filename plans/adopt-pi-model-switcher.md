---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Adopt the upstream ModelSelectorComponent from pi-coding-agent, replacing the current simple promptSelect-based model switcher with a rich, searchable UI."
affectedPaths:
    []
createdAt: "2026-05-07T10:00:00Z"
updatedAt: "2026-05-07T14:39:23.262Z"
status: "completed"
origin: "internal"
---

# Adopt Pi Model Selector

## Context

Currently, the `/model` command in Harns uses a basic `promptSelect` interface. The upstream `pi-coding-agent` has a
more sophisticated `ModelSelectorComponent` that supports fuzzy search, provider filtering, and a better overall UX.

## Objective

Replace the existing model selection flow with the `ModelSelectorComponent` from the pi-mono repository to provide a
professional model switching experience.

## Approach

The `ModelSelectorComponent` is a TUI component that manages its own state and rendering. We will integrate it into the
`UiAPI` flow so the `/model` command can trigger it without needing to know the implementation details of the TUI
layout.

The component requires several dependencies: `TUI`, `SettingsManager`, `ModelRegistry`, and optionally `scopedModels`.
We will wire these up in `chat-session.js` where the `UiAPI` implementation resides.

## Files to Modify

- `src/shared/ui/api.js` — Add `showModelSelector()` to the `UiAPI` class.
- `src/shared/ui/types.js` — Update `UiAPI` type definition to include `showModelSelector`.
- `src/cmd/models/index.js` — Update the `/model` command handler to use `uiAPI.showModelSelector()` instead of
  `promptSelect`.
- `src/shared/chat-session.js` — Implement `showModelSelector` by instantiating `ModelSelectorComponent`, mounting it to
  the `editorContainer` (replacing the editor), and handling the callbacks to restore the editor.
- `src/cmd/models/index_test.js` — Update mocks to expect `showModelSelector` instead of `promptSelect`.

## Reuse Opportunities

- Use the existing `ModelRegistry` and `SettingsManager` already present in Harns.
- Leverage the `editorContainer` pattern in `chat-session.js` (similar to how other selectors are managed in pi-mono).

## Implementation Steps

- [ ] **API Definition**: Add `showModelSelector()` to `UiAPI` in `src/shared/ui/api.js` and `src/shared/ui/types.js`.
- [ ] **TUI Integration**:
  - In `src/shared/chat-session.js`, import `ModelSelectorComponent`.
  - Implement `showModelSelector()`:
    - Create a new `ModelSelectorComponent` instance.
    - Clear `this.editorContainer`.
    - Add the selector to `this.editorContainer`.
    - Set focus to the selector.
    - Implement `onSelect` callback: Call `setActiveModel`, then restore the editor and request render.
    - Implement `onCancel` callback: Restore the editor and request render.
- [ ] **Command Update**: Modify `src/cmd/models/index.js` to call `uiAPI.showModelSelector()`. Remove the manual
      construction of `modelOptions`.
- [ ] **Test Update**: Update `src/cmd/models/index_test.js` to mock the new API method.
- [ ] **Verification**: Test the flow manually and run `deno run ci`.

## Verification Plan

- **Automated**: Run `deno run ci` to ensure no regressions.
- **Manual**:
  - Execute `/model` in the TUI.
  - Verify the search input works (fuzzy search).
  - Verify selecting a model updates the active model and persists the setting.
  - Verify pressing `Escape` closes the selector and returns focus to the editor.
  - Verify the "current model" is marked with a checkmark.

## Edge Cases & Considerations

- **Focus Management**: Ensure that focus is correctly transferred to the `ModelSelectorComponent`'s search input and
  returned to the editor upon completion.
- **Model Registry Sync**: Ensure `ModelRegistry` is refreshed before showing the selector to pick up any recent changes
  to `models.json`.
- **Scoped Models**: The upstream component supports "scoped" models. For this initial adoption, we will pass an empty
  array for `scopedModels` unless we decide to implement scoping later.
