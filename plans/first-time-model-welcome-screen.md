---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Show a first-run RunWield TUI welcome/setup screen when no usable models are configured, and show the normal loaded-artifacts boot banner on later starts."
affectedPaths:
    - "src/shared/interactive/chat-session.js"
    - "src/shared/interactive/boot-banner.js"
    - "src/shared/interactive/model-welcome.js"
    - "src/shared/interactive/model-welcome-state.js"
    - "src/shared/ui/blocks.js"
    - "src/cmd/auth/index.js"
    - "src/shared/models/model-registry.js"
frontend: false
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-07-02T12:12:21-04:00"
status: "draft"
---

# First-Time Model Welcome Screen

## Context

RunWield currently enters the interactive TUI, renders the boot logo/title/help, eagerly tries to build the root Router
agent session, and then renders the loaded-artifacts boot banner (`renderBootBanner`). In a clean first-time environment
with no usable model credentials or default model, root session initialization fails with a technical “No configured
model found…” message before the user has been guided through setup.

The requested behavior is a Wield-styled welcome/setup screen in the TUI, similar in purpose to the provided Ante
screenshot, shown only when RunWield detects that no usable models are configured in a clean first-time environment.
That welcome screen should replace the loaded-artifacts boot banner for that first encounter; from the second start
onward, RunWield should show the normal loaded-artifacts banner again even if the user skipped setup.

Product sources:

- User request: show a TUI welcome screen when no models are configured.
- User request: screen should be Wield-styled and similar to the screenshot’s “choose how to connect” flow.
- User request: first welcome replaces the loaded-artifacts boot banner; the normal banner appears from the second start
  forward.
- Existing behavior to preserve: `/login`, `/model`, `/status`, startup help, `/init` offer, prompt templates/skills
  banner, theme handling, and normal root agent startup when a model is available.

## Objective

Build a first-run onboarding path that:

- Detects “no configured model available” without surfacing a root-agent initialization error as the first user
  experience.
- Shows a themed TUI welcome panel with connection options.
- Lets the user choose a subscription login, API key login, or skip for now.
- Records that the model welcome was shown so later TUI starts return to the normal loaded-artifacts boot banner.
- After successful setup, allows the user to select a model and initializes/re-initializes the root Router session so
  the next prompt works normally.

## Approach

Add a small onboarding module rather than embedding all behavior in `chat-session.js`:

- Add `model-welcome-state.js` for global first-run state under `~/.wld/` (not project-scoped), because model/auth
  configuration is global RunWield state.
- Add `model-welcome.js` for detection and orchestration:
  - determine whether any usable model is available via `getModelRegistry().getAvailable().length > 0`;
  - determine whether the welcome has already been shown;
  - render the welcome prompt and run the chosen setup action;
  - record “shown” when the welcome is displayed, not only when setup succeeds, to satisfy “second start forwards”
    behavior.
- Use existing `/login` and `/model` command handlers where possible instead of duplicating auth/model selection logic.
- Adjust `startInteractiveSession` to detect the no-model first-run case before the eager `ensureRootAgentSession` call.
  In that case, suppress the technical root initialization failure, show the welcome in place of `renderBootBanner`, and
  defer/build the root session after setup if a model becomes available.
- Keep the first-run UI inside the TUI message stream using existing theme tokens (`accent`, `text`, `muted`, `dim`,
  `selectedBg`) and existing prompt mechanics. Add a focused custom block only if `PromptSelectBlock` cannot render the
  welcome clearly enough with title/options/descriptions.

Recommended UX default, pending confirmation: after a successful login, immediately open model selection (`/model` /
`uiAPI.showModelSelector`) so the user leaves onboarding with a persisted default model when available. If the user
skips, leave input enabled and show a concise hint that `/login` and `/model` are available.

## Files to Modify

- `src/shared/interactive/chat-session.js` — call the welcome detection before eager root session initialization; skip
  `renderBootBanner` only when the first-run welcome is actually displayed; build the root session after setup if
  possible; avoid showing a technical root init failure for the intentional no-model onboarding path.
- `src/shared/interactive/model-welcome.js` — new orchestration module for first-run no-model detection, rendering
  actions, invoking login/model selection, and returning whether the boot banner should be suppressed.
- `src/shared/interactive/model-welcome-state.js` — new global state helper for `~/.wld/model-welcome-state.json` or
  equivalent, with test override hooks, read/write helpers, `hasModelWelcomeBeenShown()`, and
  `recordModelWelcomeShown()`.
- `src/shared/ui/blocks.js` — only if needed, add a small themed welcome/select block or extend prompt rendering to
  better support the screenshot-like layout while preserving existing prompt behavior.
- `src/cmd/auth/index.js` — optionally export/reuse auth labels or lightweight helpers if the welcome needs consistent
  labels; avoid changing core login behavior unless tests reveal the welcome needs a hook.
- `src/shared/models/model-registry.js` — optionally add a tiny helper such as
  `hasAvailableConfiguredModels(registry = getModelRegistry())` if that keeps detection testable and avoids duplicating
  registry semantics.
- Tests:
  - `src/shared/interactive/model-welcome-state.test.js` for state persistence and “shown once” behavior.
  - `src/shared/interactive/model-welcome.test.js` for no-model detection and action dispatch with stubbed
    UI/registry/commands.
  - `src/shared/interactive/chat-session.test.js` or a targeted new test if practical for root-init deferral and banner
    suppression decisions.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/models/model-registry.js#getModelRegistry` — source of configured/available model state and existing
  Pi-to-RunWield migration behavior.
- `src/cmd/auth/index.js#runLoginCommand` — existing interactive subscription/API-key login flow.
- `src/cmd/models/index.js#runModelsCommand` and `uiAPI.showModelSelector` — existing model picker and default-model
  persistence path.
- `src/shared/interactive/boot-banner.js#renderBootBanner` — keep as the normal second-start-and-later startup banner.
- `src/shared/interactive/chat-session.js#ensureRootAgentSession` startup path — reuse after setup once a model is
  selected.
- `src/cmd/init/init-state.js` — reference its read/write/test-override pattern, but prefer a new global model-welcome
  state file rather than adding project-scoped onboarding flags.
- `src/shared/ui/api.js#promptSelect` and `src/shared/ui/blocks.js#PromptSelectBlock` — existing TUI prompt/select
  mechanics and theme-aware rendering.

## Implementation Steps

- [ ] Add global model welcome state.
  - Create `src/shared/interactive/model-welcome-state.js` using pure JavaScript + JSDoc.
  - Store state in `~/.wld/model-welcome-state.json` with at least `{ shown: boolean, shownAt: string | null }`.
  - Include a test-only path override and resilient reads (missing/invalid file means not shown).
  - Add tests for missing file, record shown, idempotent second read, and invalid JSON fallback.
- [ ] Add model availability detection.
  - Implement a helper in `model-welcome.js` or `model-registry.js` that treats `registry.getAvailable().length > 0` as
    “a usable configured model exists”.
  - Catch registry construction/read errors and return a conservative no-model result with an error message that can be
    shown after the welcome if needed.
  - Test with stub registries for zero available models and one available model.
- [ ] Add the first-run welcome orchestration.
  - Create
    `maybeShowModelWelcome({ uiAPI, editor, sessionManager, ensureRootAgentSession, initialAgentInternalName, commandRegistry, getModelRegistry, ... })`
    or similar.
  - If any model is available, return `{ shown: false, suppressBootBanner: false }`.
  - If no model is available but the welcome has already been shown, return
    `{ shown: false, suppressBootBanner: false, noModel: true }`.
  - If no model is available and not yet shown, render the welcome, record shown, and return
    `{ shown: true, suppressBootBanner: true }`.
  - Welcome copy should be concise and Wield-branded, e.g. “Welcome to RunWield” and “Choose how you’d like to connect a
    model.”
  - Options should map to existing commands: subscription login, API key login, skip for now.
- [ ] Wire setup actions to existing commands.
  - Subscription choice calls `commandRegistry.login.execute(["subscription"], { uiAPI, sessionManager })`.
  - API key choice calls `commandRegistry.login.execute(["api-key"], { uiAPI, sessionManager })`.
  - Skip choice records shown, dismisses the panel, and appends a short hint: “You can run /login and /model any time.”
  - After login, refresh/re-read model availability; if available, open model selection (`runModelsCommand([])` or
    `uiAPI.showModelSelector`) and then attempt to build the initial root session.
- [ ] Adjust `startInteractiveSession` startup order.
  - Keep settings/theme/TUI/container/editor/UI API setup order intact.
  - Move no-model first-run detection ahead of the eager root session build, after `uiAPI` and overrides are installed
    so prompt/select/model selector are available.
  - If no model and welcome is first-run, skip the initial root build until after setup selection.
  - If no model and welcome was previously shown, attempt the existing root build and preserve current error reporting,
    followed by the normal boot banner.
  - If a model becomes available during welcome setup, call
    `ensureRootAgentSession({ agentName: initialAgentInternalName, modelOverride: options.initialAgentModel, uiAPI, sessionManager: rootSessionManager })`.
- [ ] Preserve boot banner behavior.
  - Keep `renderBootBanner` unchanged for normal starts.
  - Gate the existing `renderBootBanner(...)` call with
    `if (!suppressStartupHeader && !modelWelcomeResult.suppressBootBanner)`.
  - Ensure blocked prompt warnings and Snip warnings still appear on second and later starts; decide whether critical
    warnings should still appear after the welcome if tests/product feedback require it.
- [ ] Add/adjust tests.
  - Unit-test state helpers and welcome decision/action helpers with stubs.
  - Unit-test that first no-model start returns boot-banner suppression and records shown.
  - Unit-test that second no-model start does not suppress boot banner.
  - Unit-test that available models bypass the welcome.
  - Unit-test skip copy and command dispatch for subscription/API-key choices.
- [ ] Run verification and fix all issues.
  - Run `deno task ci`.

## Verification Plan

- Automated:
  - `deno task ci`
- Manual TUI checks:
  - With a temporary clean `HOME` (no `~/.wld/models.json`, `~/.wld/auth.json`, or migrated `~/.pi` config), run
    `deno task cli`.
  - Expected first start: RunWield shows boot logo/title/help, then the welcome/setup panel instead of the
    loaded-artifacts boot banner; no technical root-agent “No configured model found” message appears above it.
  - Choose “Skip for now”. Expected: panel dismisses, editor remains usable, a concise `/login` + `/model` hint appears.
  - Start again with the same clean `HOME`. Expected: the welcome does not reappear; the normal loaded-artifacts boot
    banner appears.
  - Reset welcome state; choose subscription/API key path. Expected: existing `/login` flow runs, then model selection
    is offered when models become available, and selecting a model updates the footer/default model.
  - After model selection, submit a simple prompt. Expected: the root Router agent initializes and handles the prompt
    without no-model startup errors.

## Edge Cases & Considerations

- If Pi config migration finds existing usable model/auth files, the welcome should not show because this is not a clean
  no-model environment.
- If `models.json` defines providers but no credentials are usable, `getAvailable().length === 0` should still count as
  no usable configured model.
- If login succeeds but no model becomes available, show a helpful message instead of looping; the user can still run
  `/status`, `/login`, and `/model` manually.
- Recording “shown” on display means a failed or skipped first setup will not show the welcome again automatically. This
  matches the user’s “second start forwards” requirement, but the plan should keep the copy clear enough that users know
  the manual commands.
- Keep state global, not project-scoped, because model configuration lives under global `~/.wld`.
- Do not add TypeScript syntax; use pure `.js` files and JSDoc typedefs.
- Do not make this a browser/frontend plan; this is TUI UX and should be verified in a terminal, not via a web dev
  server.
