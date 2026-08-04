# Model Welcome and Auth Dependency-Seam Refactor

## Goal

Remove the remaining optional override patterns from model onboarding and authentication while testing the real RunWield
startup, command, model-registry, settings, TUI, and Session Runtime machinery.

The tests may fake only genuine external boundaries:

- Pi's OAuth/provider interaction
- model responses
- terminal input through `VirtualTerminal`
- fixture filesystem state under a sandboxed `HOME` and Project root

They must not contact a real provider, launch a browser, read or write the developer's `~/.wld`, or use the real
RunWield checkout as a Project fixture.

## Current ratchet entries

### `src/ui/tui/model-welcome.js`

- `getModelRegistry`
- `getSettingsManager`

`MaybeShowModelWelcomeOptions` currently allows callers and tests to replace both internal authorities. Its tests also
replace more internal machinery that the ratchet does not currently report:

- the command registry and `/login`, `/model`, and `/quit` implementations
- `SessionRuntime.switchAgent`
- TUI/editor behavior
- the post-login model availability transition

The production caller in `src/ui/tui/chat-session.js` passes the same imported registry, settings, and command-registry
implementations back into `maybeShowModelWelcome`. That indirection has no production purpose.

### `src/cmd/auth/index.ts`

- `abortActivePrompt`
- `appendSystemMessage`
- `promptSelect`
- `promptText`
- `showModelSelector`

These are currently supplied through an optional `uiAPI` capability. The UI is a real caller boundary, but the existing
tests construct a partial fake UI and directly invoke command functions, bypassing slash dispatch, real TUI prompt
components, and some post-login composition.

OAuth itself is owned and tested by Pi. RunWield should verify its orchestration around that boundary without
duplicating Pi's OAuth machinery.

## Intended architecture

1. Model welcome reads the real `RunWieldModelRegistry`, real project-scoped settings, and canonical command registry
   directly.
2. Startup receives the real composed `UiAPI`, editor, TUI, and `SessionRuntime`; these are required runtime
   collaborators, not optional test overrides.
3. Auth commands continue to operate through the real interactive UI surface. Tests drive that surface with
   `VirtualTerminal` and the canonical slash-command registry rather than hand-built method bags.
4. Pi provider authentication remains the external port. Use a deterministic fixture provider/auth adapter; do not test
   Pi's internal OAuth protocol.
5. Model selection and root activation use the real settings persistence, model registry refresh, command
   implementation, and `SessionRuntime.switchAgent` transaction.

Do not introduce a command factory or rename an override bag to `ports`. Prefer the existing interactive composition and
fixture helpers.

## Suggested implementation order

1. Extend `withRuntimeCommandFixture` or the Golden TUI isolated environment only where needed to describe:
   - no configured providers
   - a configured provider with no selected model
   - a configured faux model and selected default
   - deterministic provider login success, cancellation, and failure
2. Remove `getModelRegistry`, `getSettingsManager`, `commandRegistry`, and `quit` overrides from model-welcome options.
3. Rewrite `model-welcome.test.js` around the real registry/settings fixture. Keep pure availability classification
   tests only where they test a public value contract rather than a replacement registry.
4. Exercise login/logout/status through canonical command/slash dispatch and the real UI composition. Avoid invoking
   real OAuth.
5. Remove any now-redundant fake-heavy auth tests.
6. Convert touched JavaScript production modules to TypeScript and tighten both baselines.

## Required scenarios

- A usable selected fixture model bypasses onboarding and activates the real root Session.
- No providers opens the welcome prompt; cancel follows the real quit path.
- A configured provider without a selected model opens the real model selector.
- API-key login persists only to the fixture `HOME`, refreshes the real registry, and makes the model selectable.
- Login cancellation leaves input and Session state recoverable.
- Login failure renders a user-visible error and does not activate a root Session.
- Logout removes only fixture credentials and refreshes availability.
- A failed root activation returns focus to the editor with recovery guidance.

## Verification

- Run focused tests with `scripts/run-tests.js`, never `deno test` directly.
- Prove the tests fail if model selection persistence, registry refresh, or root activation is removed.
- Run `deno task seams:update` only after the source seams are gone.
- Run `deno task ci`.
- Run `deno task test:golden-tui` and confirm the faux provider is used.
