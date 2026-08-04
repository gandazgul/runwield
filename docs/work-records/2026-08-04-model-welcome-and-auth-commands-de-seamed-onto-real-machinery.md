---
kind: "work_record"
recordId: "b65384be-ba26-499e-a5e8-991b2af7d2a6"
status: "approved"
scope: "planned_change"
workKind: "REFACTOR"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-04T21:27:35.235Z"
provenance:
    sourcePlans:
        - "577e1104-a38d-49b5-83ff-cd77d80b6906"
---

# Model welcome and auth commands de-seamed onto real machinery

## Summary

Removed the last optional-override dependency seams from model onboarding and authentication. `model-welcome.js` was
converted to TypeScript (`model-welcome.ts`) owning the real implementation of the availability helpers and
`maybeShowModelWelcome`; all override options (`getModelRegistry`, `getSettingsManager`, `commandRegistry`, `quit`) were
deleted, `projectRoot` became required, and `/login`/`/model`/`/quit` now run through the canonical command registry.
`src/cmd/auth/index.ts` now requires `uiAPI: AuthUiPort`, deleting the unreachable interactive-session console fallbacks
(module seam count 5 → 0). Tests were rewritten to drive the real registry, settings, command registry, composed TUI,
and SessionRuntime — faking only Pi OAuth/provider interaction, model responses, terminal input, and fixture filesystem
state — via a new in-process composed-TUI harness (`interactive-composition-fixture.ts`) and a scripted native OAuth
provider on the real `ModelRuntime`. Golden startup scenarios now assert the real welcome prompt/selector and observe
the real `/quit` as child exit code 0 instead of patched machinery. The injection-seam ratchet tightened 31 → 24 seams
across 11 → 9 modules, the language-policy baseline dropped `model-welcome.js`, and full `deno task ci` passed (545
files type-checked, 244 test files green). Future planning should treat model onboarding and auth as covered by
real-machinery tests and zero-seam modules.

## Deviations from Plan

Two changes beyond the listed Files to Modify were required. (1) `src/cmd/registry.js` gained a `requireAuthUi` adapter:
the required-`uiAPI` auth signature is not assignable to the registry's `CommandHandler` (whose `CommandContext.uiAPI`
is optional), so the three auth entries wrap through an adapter that fails loudly if a UI is missing. (2)
`src/shared/session/session-runtime.test.js` received a one-line pre-existing fix (`STABLE_TEST_CWD` → the file's own
`runtimeProjectRoot()` helper) that unblocked `deno task check`/`ci`, which were already red at the base commit
(confirmed via `git stash`). The redundant command-level `registry.refresh()` calls after login and logout were removed:
the real registry login, API-key, and logout operations already update their runtime state. Mutation proofs now target
behavior rather than those redundant wrappers: skipping the real OAuth login fails before the redirect prompt, erasing
the selected default after `/model` prevents root activation, and removing the root `switchAgent` call fails the
root-activation assertions. Every mutation produced a focused test failure and was reverted.

## Future Planning Notes

When a real authority already performs a state change, remove redundant wrapper calls instead of writing assertions for
implementation details with no behavioral opposite. Mutation proofs should disable the actual behavior and prove that
durable-outcome assertions fail: no login, no persisted default, or no root activation. Required-port signatures may not
be assignable to a registry `CommandHandler` whose context fields are optional — wrap such entries in a loud-failing
adapter at the boundary (the `requireAuthUi` pattern) rather than loosening the required port. Base-commit CI can
already be red for unrelated pre-existing reasons (session-runtime.test.js); verify via `git stash` before attributing
breakage to the change. Startup onboarding prompts block composition resolution, so scenario input must be fed in flight
against screen markers, and the real `/quit` must be exercised only in child-process Golden scenarios because it calls
`Deno.exit(0)`.

## Execution Report

## model-welcome-auth-deps-refactor — complete

- **model-welcome de-seamed (JS → TS)**: `src/ui/tui/model-welcome.js` deleted; `model-welcome.ts` owns
  `detectModelAvailability`, `getConfiguredModelAvailability()`, `getConfiguredProviderAvailability()`,
  `getSelectedDefaultModelAvailability(projectRoot)`, `maybeShowModelWelcome`. All overrides removed
  (`getModelRegistry`, `getSettingsManager`, `commandRegistry`, `quit` gone); `MaybeShowModelWelcomeOptions` requires
  `projectRoot: string`; `/login`/`/model`/`/quit` run through the imported canonical `commandRegistry`; availability
  reads the real registry/settings. No `any`/`unknown`, no `@ts-nocheck`, not a re-export.
- **chat-session.js**: both `maybeShowModelWelcome` call sites + `shouldBlockForModelSetup` use the new signatures with
  `projectRoot: getRuntimeSnapshot().cwd`; unused `getModelRegistry` import removed; source-order contract string
  `const modelWelcomeResult = await maybeShowModelWelcome({` intact (chat-session.test.js greps pass);
  `forceModelSelection` retry preserved.
- **auth/index.ts**: `uiAPI: AuthUiPort` required; `getUi()` and all three "only available in the interactive session"
  console fallbacks deleted; no `options.uiAPI?.` chains; `skipPostLoginSetup`, back-navigation loop, and
  `sessionId && sessionRuntime`-guarded Router switch unchanged. Seam count for the module: 5 → 0.
- **Fixture**: `withRuntimeCommandFixture` gains `providerState` variants ("none" / "provider-no-model" / "default"), a
  fake `mnemosyne` binary on PATH (needed by the real startup preflight), and `registerScriptedOAuthProvider` — real
  `ModelRuntime.registerNativeProvider` with scripted success (OAuth credential persisted to fixture auth.json through
  the real credential store), cancel (`Error("Login cancelled")`, nothing persisted), and failure (error surfaces,
  nothing persisted); unregister on cleanup; name sorts first so a bare Enter at the real provider prompt never selects
  a real builtin OAuth provider.
- **Harness**: new `src/ui/tui/testing/interactive-composition-fixture.ts` composes the real TUI on a `VirtualTerminal`
  in-flight and exposes `type`/`pressKey`/`waitForScreen`/`waitForComposition`/`completeOnboarding`/`clearMessages`;
  module doc warns the real `/quit` kills the in-process runner, and `pressKey("escape")` mechanically refuses while the
  welcome prompt title is on screen; dispose stops the TUI and closes runtime sessions.
- **model-welcome.test.ts** (converted from deleted `.js`): 11 tests against real machinery — detectModelAvailability
  value contract incl. error capture; malformed `models.json` degrades without throwing; configured+selected bypass
  activates the real root Session (router); no providers opens the real welcome prompt (never the selector); configured
  provider without a selected model opens the real model selector; cancelled model selection activates no root Session;
  scripted subscription login runs real `/login`→`/model` order (screen-order assertion) and activates the root Session
  with the persisted default; login failure renders the error and re-prompts; cancelled login re-prompts; failed root
  activation (unresolvable initial agent) returns focus to the editor with recovery guidance. OC5 grep confirms no
  `getModelRegistry:`/`getSettingsManager:`/`commandRegistry:`/`quit:` anywhere in the file.
- **auth/index.test.ts**: `createUiHarness` and all direct `runLoginCommand`/`runLogoutCommand`/`runStatusCommand` calls
  deleted; every flow is a slash command typed through the composed TUI — provider choices from the hydrated registry
  without OAuth, API-key login persisting through the real store + `/status`, claude-cli exclusion from status/logout,
  post-login model selector + real Runtime switch back to Router (session starts on guide), logout removing the fixture
  credential with `/status` reflecting it, cancelled API-key input leaving the store unchanged.
- **Golden runner**: `startupModelSetupCommandPatch` and startup `configureUiAPI` overrides removed from
  scenario-runner.js (OC4 grep clean); `runComposedTuiScenario` feeds scenario-declared `startupInput` while the
  composition is in flight, waiting on screen markers and recording the observed screen in `state.startupScreen`;
  scenarios can declare `expectedCleanExit`; child-protocol.js surfaces the pre-exit report + exit code 0 as success for
  declared scenarios (running the scenario's own assertions parent-side) and reclaims the heartbeat artifact root.
- **Golden scenarios**: `startup-no-providers-opens-login` asserts the real welcome prompt on the observed screen (never
  the selector) and ends via the real `/quit` observed as child exit code 0;
  `startup-provider-without-models-opens-model` asserts the real selector without login onboarding.
  `deno task test:golden-tui`: 57 passed (faux provider serves all model turns).
- **Ratchets**: `deno task seams:update` tightened the baseline — 31→24 seams across 11→9 modules;
  `src/cmd/auth/index.ts` and `src/ui/tui/model-welcome.*` entries removed (7 seams); `seams:check` green.
  `check-language-policy.js --update` dropped `src/ui/tui/model-welcome.js`; `language-policy:check` green.
- **Objective-failing checks**: OC1–OC5 all verified green via the exact commands.
- **Verification**: focused suites `model-welcome.test.ts` + `auth/index.test.ts` + `chat-session.test.js` +
  `models/index.test.ts` — 45 passed (6 steps), 0 failed. `deno task ci` — full gate green: type-check 545 files,
  workspace 0 errors, lint clean, ratchets green, doc-links ok, test 244 files passed / 0 failed.
- **Mutation proofs**: all three behavioral opposites now fail focused tests and were reverted: (1) skipping the real
  OAuth login fails while waiting for the redirect prompt; (2) erasing the selected default immediately after `/model`
  prevents Router activation; (3) removing the root `switchAgent` call fails the subscription and failed-root-activation
  assertions. The redundant command-level `registry.refresh()` calls after login/logout were removed rather than
  preserving implementation-detail assertions for behavior already owned by the real registry operations.
- **Plan-gap repairs (beyond the listed Files to Modify)**: `src/cmd/registry.js` gained a `requireAuthUi` adapter — the
  required-`uiAPI` auth signature is not assignable to the registry's `CommandHandler` (whose `CommandContext.uiAPI` is
  optional), so the three auth entries wrap through the adapter, failing loudly if a UI is missing.
  `src/shared/session/session-runtime.test.js` got a one-line pre-existing fix (`STABLE_TEST_CWD` → the file's own
  `runtimeProjectRoot()` helper) that unblocked `deno task check`/`ci`, which were already red at the base commit
  (verified via `git stash`).
