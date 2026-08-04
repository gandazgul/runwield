---
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "MEDIUM"
summary: "Remove the remaining injection seams from model onboarding (model-welcome) and auth commands; tests drive the real registry, settings, command registry, composed TUI, and SessionRuntime, faking only Pi OAuth/provider interaction, model responses, terminal input, and fixture filesystem state. Tightens the injection-seam ratchet by 7 seams across 2 modules."
affectedPaths:
    - "src/ui/tui/model-welcome.js"
    - "src/ui/tui/model-welcome.ts"
    - "src/ui/tui/model-welcome.test.js"
    - "src/ui/tui/model-welcome.test.ts"
    - "src/ui/tui/chat-session.js"
    - "src/cmd/auth/index.ts"
    - "src/cmd/auth/index.test.ts"
    - "src/cmd/testing/runtime-command-fixture.ts"
    - "src/ui/tui/testing/interactive-composition-fixture.ts"
    - "src/ui/tui/testing/scenario-runner.js"
    - "src/ui/tui/testing/child-protocol.js"
    - "src/ui/tui/golden-scenarios/initial-scenarios.js"
    - "scripts/injection-seam-baseline.json"
    - "scripts/language-policy-baseline.json"
objectiveChecks:
    - id: "OC1"
      command: "deno task seams:check && ! grep -q '\"src/cmd/auth/index.ts\"' scripts/injection-seam-baseline.json && ! grep -q 'model-welcome' scripts/injection-seam-baseline.json"
      rationale: "Both baseline entries can only disappear after the source seams are gone because the ratchet rejects unbaselined residual seams; proves all 7 seams were removed and the baseline tightened."
    - id: "OC2"
      command: "test -f src/ui/tui/model-welcome.ts && grep -q \"export async function maybeShowModelWelcome\" src/ui/tui/model-welcome.ts && grep -q \"projectRoot: string\" src/ui/tui/model-welcome.ts && ! grep -qE \"@ts-nocheck|export \\*|(__tests__|test-support|legacy)\" src/ui/tui/model-welcome.ts && test ! -f src/ui/tui/model-welcome.js"
      rationale: "Requires the TypeScript module to own the implementation with a required project root, blocking a facade or legacy test-directory re-export."
    - id: "OC3"
      command: "grep -q \"uiAPI: AuthUiPort;\" src/cmd/auth/index.ts && ! grep -q \"uiAPI?:\" src/cmd/auth/index.ts && ! grep -qE \"createUiHarness|run(Login|Logout|Status)Command\\(\" src/cmd/auth/index.test.ts"
      rationale: "Proves auth requires the UI surface and the auth tests no longer call command functions through a hand-built UI harness."
    - id: "OC4"
      command: "! grep -q \"commandRegistry\" src/ui/tui/testing/scenario-runner.js && ! grep -q \"configureUiAPI: scenario.modelSetup\" src/ui/tui/testing/scenario-runner.js"
      rationale: "Proves the Golden startup runner no longer patches the command registry or replaces startup prompt/model-selector methods, even through a renamed alias."
    - id: "OC5"
      command: "! grep -qE \"getModelRegistry:|getSettingsManager:|commandRegistry:|quit:\" src/ui/tui/model-welcome.test.ts && deno run -A scripts/run-tests.js src/ui/tui/model-welcome.test.ts src/cmd/auth/index.test.ts src/ui/tui/golden-scenarios/initial-scenarios.test.js"
      rationale: "Requires real-machinery onboarding/auth tests without the old authority overrides and verifies them together with the real child-process startup scenarios."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-04T09:29:36-04:00"
updatedAt: "2026-08-04T15:35:55.322Z"
origin: "internal"
userVerifiedAt: null
planId: "577e1104-a38d-49b5-83ff-cd77d80b6906"
status: "validated_reviewer"
---

# Model Welcome and Auth Dependency-Seam Refactor

## Context

`model-welcome-auth-deps-refactor.md` (repository root) proposes removing the last optional-override patterns from model
onboarding and authentication. Investigation confirms the proposal matches current source:

- `src/ui/tui/model-welcome.js` — `maybeShowModelWelcome` accepts optional `getModelRegistry` / `getSettingsManager` (2
  ratchet-counted seams in `scripts/injection-seam-baseline.json`) plus optional `commandRegistry` and `quit` overrides
  the ratchet does not count. The production caller in `chat-session.js` passes the same real implementations back in —
  indirection with no production purpose. `model-welcome.test.js` fakes the registry, settings, command registry,
  `SessionRuntime.switchAgent`, editor, and TUI.
- `src/cmd/auth/index.ts` — `AuthCommandOptions.uiAPI?: AuthUiPort` is optional with a `console.log` fallback (5
  ratchet-counted seams). All three commands (`/login`, `/logout`, `/status`) are `surfaces: ["slash"]` in
  `src/cmd/registry.js`, and slash dispatch always supplies a real `UiAPI`, so the console fallback is unreachable in
  production. `index.test.ts` hand-builds a partial fake UI (`createUiHarness`) and calls `runLoginCommand` directly,
  bypassing slash dispatch and the real prompt components.
- `src/ui/tui/testing/scenario-runner.js` — the two startup onboarding Golden scenarios (`modelSetup: "none"` /
  `"provider-without-models"`) patch `commandRegistry[COMMAND_NAMES.QUIT].execute` (`startupModelSetupCommandPatch`) and
  override `uiAPI.promptSelect` / `uiAPI.showModelSelector` via `configureUiAPI`. Same class of machinery replacement,
  not ratchet-counted.

Decisions from planning: TypeScript migration is **minimal** — only `model-welcome.js` converts (it is the de-seamed
production module); `chat-session.js` and `scenario-runner.js` stay JS with minimal edits. The Golden scenario-runner
rework **is in scope**: the two startup scenarios must drive the real welcome prompt and real `/quit` instead of
patching.

## Objective

After this change:

1. `maybeShowModelWelcome` reads the real `RunWieldModelRegistry`, real project-scoped settings, and the canonical
   command registry directly. Its remaining options are required runtime collaborators only.
2. Auth commands require the real interactive `UiAPI`; the unreachable console fallback is gone.
3. Tests exercise the real startup, command, model-registry, settings, TUI, and SessionRuntime machinery. They may fake
   only: Pi's OAuth/provider interaction (deterministic scripted fixture provider), model responses (faux provider),
   terminal input (VirtualTerminal), and fixture filesystem state under a sandboxed `HOME`/Project root.
4. The two Golden startup scenarios drive the real welcome prompt and real `/quit` (child-process exit) instead of
   patched machinery.
5. The injection-seam ratchet tightens by 7 seams; both `src/cmd/auth/index.ts` and `src/ui/tui/model-welcome.*` entries
   leave the baseline.

No command factory, no override bag renamed to `ports`. Pi's OAuth protocol itself is never tested — only RunWield's
orchestration around a deterministic provider boundary.

## Approach

**De-seam model-welcome (JS → TS).** Convert `src/ui/tui/model-welcome.js` to `model-welcome.ts`. Delete the
`getModelRegistry`, `getSettingsManager`, `commandRegistry`, and `quit` options from `MaybeShowModelWelcomeOptions`;
import `getModelRegistry`, `getSettingsManager`, and `commandRegistry` directly. Settings are project-scoped, so add a
required `projectRoot: string` option and build the manager with `getSettingsManager(projectRoot)` (today the production
caller already does this with the runtime snapshot cwd). The availability helpers lose their injectable parameters:
`getConfiguredModelAvailability()` and `getConfiguredProviderAvailability()` take no arguments;
`getSelectedDefaultModelAvailability(projectRoot)` takes the project root. `detectModelAvailability(registry)` stays a
pure value-contract function (takes a registry _value_, not a replaceable authority).

**Make auth UI required.** In `src/cmd/auth/index.ts`, change `AuthCommandOptions.uiAPI` to required
(`uiAPI: AuthUiPort` — the `Pick<UiAPI, ...>` fragment stays as the command's interface declaration), delete `getUi()`
and the three "only available in the interactive session" console fallbacks, and replace `options.uiAPI?.…` chains with
direct calls. `sessionId`, `sessionRuntime`, and `skipPostLoginSetup` stay optional: they express genuine absence
(non-session invocation), not replaceable machinery, and are not ratchet-counted.

**Fixture: scripted OAuth provider on the real runtime.** `ModelRuntime.registerNativeProvider(provider)` is a public
API, and `RunWieldModelRegistry.getOAuthProviders()` reads `runtime.getProviders()`, so a fixture provider with
`auth.oauth.login(interaction)` scripted to succeed, cancel (throw `Error("Login cancelled")`), or fail flows through
the real registry, real `/login` orchestration, real `AuthInteraction` prompt callbacks, and the real credential store.
Extend `src/cmd/testing/runtime-command-fixture.ts` with (a) fixture setup variants for "no providers", "configured
provider with no selected model", and "configured faux model with selected default", and (b) a
`registerScriptedOAuthProvider` helper that registers/unregisters the native provider on the process runtime and lets
the test script outcomes. Unregister on fixture cleanup.

**Composed-TUI test harness.** New TypeScript helper `src/ui/tui/testing/interactive-composition-fixture.ts`: inside the
isolated fixture environment, compose the real TUI via `createInteractiveTuiComposition` on a `VirtualTerminal` and
expose input helpers (`type`, `pressKey`, `waitForScreen`) that feed terminal input and poll normalized screen text. It
must document and enforce (where mechanically possible) that the real `/quit` is never driven in-process —
`runQuitCommand` calls `Deno.exit(0)`, which would kill the test runner; quit coverage lives in Golden child scenarios
only. Cleanup stops the TUI and closes runtime sessions. In-process composed TUI is precedented in
`src/ui/tui/golden-scenarios/initial-scenarios.test.js` (composition-startup-failure test).

**Rewrite the two focused test files around real machinery** (details in Implementation Steps). Both drive flows by
typing slash commands / answering real prompt components through the harness; neither builds a hand-made method bag.

**Golden runner: real startup input instead of patches.** The welcome prompt blocks inside
`createInteractiveTuiComposition`, but scenario `actions` only run after composition resolves — so feeding input after
startup deadlocks. Add a startup-input capability to `runComposedTuiScenario`: while the composition promise is in
flight, watch the VirtualTerminal screen for scenario-declared markers and feed scripted keys/text. Remove
`startupModelSetupCommandPatch` and the startup `configureUiAPI` overrides. The real `/quit` exits the child with code
0; extend the child protocol so a scenario can declare an expected clean exit as its terminal success signal instead of
a post-composition result (the protocol already surfaces `code`).

## Files to Modify

- `src/ui/tui/model-welcome.js` → `src/ui/tui/model-welcome.ts` — remove the four override options; direct imports of
  real authorities; required `projectRoot`; TypeScript with explicit interfaces (no `any`/`unknown`; `@typedef` shapes
  become TS interfaces).
- `src/ui/tui/chat-session.js` — both `maybeShowModelWelcome` call sites drop `commandRegistry`, `getModelRegistry`,
  `getSettingsManager` and pass `projectRoot: getRuntimeSnapshot().cwd`; `shouldBlockForModelSetup` calls
  `getSelectedDefaultModelAvailability(getRuntimeSnapshot().cwd)`; import path updated to `./model-welcome.ts`. Preserve
  the `const modelWelcomeResult = await maybeShowModelWelcome({` source-order contract string exactly —
  `chat-session.test.js` greps for it. Minimal edits only; file stays JS.
- `src/cmd/auth/index.ts` — required `uiAPI`; delete `getUi()` and console fallbacks; direct calls on the UI surface.
- `src/cmd/testing/runtime-command-fixture.ts` — provider-state setup variants + `registerScriptedOAuthProvider` (real
  `ModelRuntime.registerNativeProvider`, scripted success/cancel/failure, unregister on cleanup).
- `src/ui/tui/testing/interactive-composition-fixture.ts` — **new** composed-TUI harness (real composition on
  VirtualTerminal; `type` / `pressKey` / `waitForScreen`; TUI/session cleanup; no-in-process-quit guard).
- `src/ui/tui/model-welcome.test.js` → `src/ui/tui/model-welcome.test.ts` — rewrite around the real registry, settings,
  composed UI, command registry, and SessionRuntime (scenarios below).
- `src/cmd/auth/index.test.ts` — rewrite: slash commands typed through the composed TUI; `createUiHarness` deleted.
- `src/ui/tui/testing/scenario-runner.js` — remove `startupModelSetupCommandPatch` and startup `configureUiAPI`
  overrides; add in-flight startup-input driving; support scenario-declared expected child exit. Stays JS, minimal
  edits.
- `src/ui/tui/testing/child-protocol.js` — surface an expected clean child exit (code 0) as a successful scenario result
  for scenarios that declare it.
- `src/ui/tui/golden-scenarios/initial-scenarios.js` — the two `modelSetup` scenarios script real startup input and
  assert real screen text / child exit instead of synthetic `startup:prompt-select:*` / `startup:quit` events.
- `scripts/injection-seam-baseline.json` — via `deno task seams:update` only, after the source seams are gone.
- `scripts/language-policy-baseline.json` — via `deno run -A scripts/check-language-policy.js --update`, for the
  `model-welcome.js` → `.ts` rename.

## Reuse Opportunities

- `src/cmd/testing/runtime-command-fixture.ts` — isolated `HOME`, faux API-key provider, settings/credential fixture;
  extend rather than duplicate.
- `src/ui/tui/testing/isolated-environment.js` — Golden isolated env (fake `mnemosyne` binary, `NO_COLOR`, init-state)
  as reference for what a composed TUI needs from its environment.
- `src/ui/tui/testing/virtual-terminal.js` — `typeText`, screen text normalization, cursor/erase helpers.
- `src/ui/tui/golden-scenarios/initial-scenarios.test.js` — in-process composed-TUI precedent
  (`createInteractiveTuiComposition` + `VirtualTerminal` under `withProcessGlobalTestLock`).
- `src/ui/tui/ui-api-overrides.test.ts` — examples of driving real prompt components (`promptSelect`, `promptText`,
  `showModelSelector`) on a composed UI.
- `@earendil-works/pi-ai` `AuthInteraction` / `AuthEvent` types and pi-coding-agent
  `ModelRuntime.registerNativeProvider` / `unregisterProvider` — the deterministic OAuth boundary.

## Implementation Steps

- [ ] `src/ui/tui/model-welcome.ts` exists (the `.js` is deleted) and owns the implementation of
      `detectModelAvailability`, `getConfiguredModelAvailability()`, `getConfiguredProviderAvailability()`,
      `getSelectedDefaultModelAvailability(projectRoot)`, and `maybeShowModelWelcome` — it is not a re-export, facade,
      shim, or import of a legacy/test-support implementation, and contains no `@ts-nocheck`. No function in the module
      accepts a registry, settings-manager, command-registry, or quit parameter; `MaybeShowModelWelcomeOptions` contains
      no `getModelRegistry` / `getSettingsManager` / `commandRegistry` / `quit` members and requires
      `projectRoot: string`. All `/login`, `/model`, `/quit` execution goes through the imported canonical
      `commandRegistry`; all availability reads go through the real `getModelRegistry()` and
      `getSettingsManager(projectRoot)`. The module type-checks with no `any`.
- [ ] `src/ui/tui/chat-session.js` compiles against the new module: both `maybeShowModelWelcome` call sites and
      `shouldBlockForModelSetup` use the new signatures, pass `projectRoot` from the runtime snapshot cwd, and no longer
      pass `commandRegistry`, `getModelRegistry`, or `getSettingsManager`. The source-order contract string
      `const modelWelcomeResult = await maybeShowModelWelcome({` is intact, and the `forceModelSelection` retry path on
      "No configured model found" still works.
- [ ] `src/cmd/auth/index.ts` declares `uiAPI: AuthUiPort` (required) in `AuthCommandOptions`; `getUi()` and every "only
      available in the interactive session" branch are deleted; no `options.uiAPI?.` optional chain remains on the
      required surface. `/login`, `/logout`, `/status` behavior is otherwise unchanged, including `skipPostLoginSetup`,
      the back-navigation loop, and the post-login Router switch guarded by `sessionId && sessionRuntime`.
- [ ] `src/cmd/testing/runtime-command-fixture.ts` supports fixture setup with no providers, a configured provider with
      no selected model, and the existing configured-and-selected default; `registerScriptedOAuthProvider` registers a
      fixture OAuth provider on the real `ModelRuntime` whose scripted outcomes cover success (credential persisted to
      the fixture `auth.json` through the real credential store), cancellation (throws `Error("Login cancelled")`,
      nothing persisted), and failure (error surfaces to the caller, nothing persisted), and unregisters it during
      fixture cleanup.
- [ ] `src/ui/tui/testing/interactive-composition-fixture.ts` composes the real TUI on a `VirtualTerminal` inside the
      isolated fixture environment and exposes `type`, `pressKey`, and `waitForScreen` helpers plus cleanup that stops
      the TUI and closes runtime sessions. Its module doc warns that the real `/quit` must never be driven in-process.
- [ ] `src/ui/tui/model-welcome.test.ts` (converted from the deleted `.js`) passes against the real machinery and
      covers: `detectModelAvailability` value contract; registry-error capture via a malformed `models.json` in the
      fixture `HOME`; configured-and-selected fixture model bypasses onboarding and the real root Session activates; no
      providers opens the real welcome prompt (screen-visible title); configured provider without a selected model opens
      the real model selector; subscription login through the scripted OAuth fixture runs the real `/login` then
      `/model` order and activates the root Session; login failure renders a user-visible error and activates no root
      Session; cancelled login re-prompts instead of returning to chat; cancelled model selection activates no root
      Session; failed root activation returns focus to the editor with recovery guidance. No test in the file injects a
      registry, settings manager, command registry, quit function, or hand-built `uiAPI`.
- [ ] `src/cmd/auth/index.test.ts` passes with every flow typed as a slash command through the composed TUI: provider
      choices from the hydrated registry without starting OAuth; API-key login persists through the real credential
      store and `/status` reports it; `claude-cli` credentials stay out of API auth status and logout choices;
      post-login setup shows the model selector and switches a real Runtime Session back to Router; logout removes the
      fixture credential and `/status` reflects it; cancelled API-key input leaves the credential store unchanged.
      `createUiHarness` and every direct `runLoginCommand`/`runLogoutCommand`/`runStatusCommand` call with a hand-built
      `uiAPI` are gone.
- [ ] `src/ui/tui/testing/scenario-runner.js` contains no `startupModelSetupCommandPatch` and no assignment to
      `commandRegistry[...].execute`, and the startup `configureUiAPI` overrides for `modelSetup` scenarios are gone;
      `runComposedTuiScenario` feeds scenario-declared startup input while `createInteractiveTuiComposition` is in
      flight, driven by screen markers; a scenario can declare an expected clean child exit as its result.
- [ ] `startup-no-providers-opens-login` and `startup-provider-without-models-opens-model` pass with assertions on real
      screen content: the no-provider scenario shows the welcome login prompt, never the model selector, and cancelling
      follows the real `/quit` path observed as child exit code 0; the provider-without-models scenario opens the real
      model selector without the login onboarding prompt.
- [ ] `deno task seams:update` has been run after the source seams were removed: `scripts/injection-seam-baseline.json`
      no longer contains `src/cmd/auth/index.ts` or `src/ui/tui/model-welcome.*` entries (7 seams removed), and
      `deno task seams:check` passes.
- [ ] `scripts/language-policy-baseline.json` no longer lists `src/ui/tui/model-welcome.js` (updated via the policy
      script's `--update`), and `deno task language-policy:check` passes.

## Verification Plan

- Automated, in order:
  1. `deno run -A scripts/run-tests.js src/ui/tui/model-welcome.test.ts src/cmd/auth/index.test.ts src/ui/tui/chat-session.test.js src/cmd/models/index.test.ts`
     — focused suites (never `deno test` directly).
  2. `deno task seams:check` and `deno task language-policy:check` — ratchets green on tightened baselines.
  3. `deno task test:golden-tui` — all scenarios pass, including the reworked startup pair; confirm from output and
     fixture setup that the faux provider serves all model turns.
  4. `deno task ci` — full gate.
- Mutation proof (perform manually, then revert): deleting `await registry.refresh()` after login fails an auth test;
  removing default-model persistence from the `/model` flow fails an onboarding test; removing the root `switchAgent`
  call fails the root-activation assertions.
- Protected behavior that must still be true afterwards:
  - Welcome orchestration order: availability check → login (`skipPostLoginSetup: true`) → `/model` → root
    `switchAgent`; boot banner suppressed whenever onboarding showed.
  - `getSelectedDefaultModelAvailability` error capture (registry/settings failures become
    `{ available: false, error }`, never throw).
  - `claude-cli` deferred-backend handling in availability and its exclusion from API auth status/logout choices.
  - The "No configured model found" startup retry via `forceModelSelection`, and post-login model selector + Router
    switch.
  - Golden startup routing: no providers → login prompt before any model selector; configured provider without models →
    model selector without login onboarding.
- Behavior expected to stop existing: fake-registry error-injection tests, the hand-built `createUiHarness` UI bag, the
  `startup:prompt-select:*` / `startup:model-selector` / `startup:quit` synthetic events (replaced by real screen-text
  and child-exit observations), and the auth console fallbacks. Tests covering these are rewritten, not deleted outright
  — if a rewritten test cannot express its scenario against real machinery, that is a plan violation to surface, not a
  test to drop.

### Objective-Failing Checks

- `OC1` —
  `deno task seams:check && ! grep -q '"src/cmd/auth/index.ts"' scripts/injection-seam-baseline.json && ! grep -q 'model-welcome' scripts/injection-seam-baseline.json`
  — both baseline entries can only disappear after the source seams are gone (the ratchet refuses loosening), so green
  means all 7 seams were actually removed and the baseline tightened. Red today: both entries exist.
- `OC2` —
  `test -f src/ui/tui/model-welcome.ts && grep -q "export async function maybeShowModelWelcome" src/ui/tui/model-welcome.ts && grep -q "projectRoot: string" src/ui/tui/model-welcome.ts && ! grep -qE "@ts-nocheck|export \*|(__tests__|test-support|legacy)" src/ui/tui/model-welcome.ts && test ! -f src/ui/tui/model-welcome.js`
  — the TypeScript module owns the real implementation with a required project root; a facade/re-export hiding the old
  seams in a scanner-skipped test directory cannot pass. Red today: the `.ts` does not exist.
- `OC3` —
  `grep -q "uiAPI: AuthUiPort;" src/cmd/auth/index.ts && ! grep -q "uiAPI?:" src/cmd/auth/index.ts && ! grep -qE "createUiHarness|run(Login|Logout|Status)Command\(" src/cmd/auth/index.test.ts`
  — the auth UI surface is required and its tests no longer invoke command functions with a hand-built UI bag. Red
  today: `uiAPI` is optional and all three direct command-call patterns exist.
- `OC4` —
  `! grep -q "commandRegistry" src/ui/tui/testing/scenario-runner.js && ! grep -q "configureUiAPI: scenario.modelSetup" src/ui/tui/testing/scenario-runner.js`
  — the Golden runner no longer patches the command registry or replaces startup prompt/model-selector methods; merely
  renaming the patch variable or assigning through an alias cannot pass. Red today: both patterns exist.
- `OC5` —
  `! grep -qE "getModelRegistry:|getSettingsManager:|commandRegistry:|quit:" src/ui/tui/model-welcome.test.ts && deno run -A scripts/run-tests.js src/ui/tui/model-welcome.test.ts src/cmd/auth/index.test.ts src/ui/tui/golden-scenarios/initial-scenarios.test.js`
  — focused onboarding/auth tests contain no old authority overrides and pass together with the real child-process
  startup scenarios. Red today: `model-welcome.test.ts` does not exist.

## Edge Cases & Considerations

- **Real `/quit` kills the in-process test runner.** `runQuitCommand` ends in `Deno.exit(0)`. Focused tests must never
  drive Esc at the welcome prompt or `/quit`; the quit path is covered only by Golden child scenarios, where the child
  protocol observes exit code 0. The new harness documents this and the runner treats a scenario-declared clean exit as
  success, not premature termination.
- **Startup input deadlock.** The welcome prompt blocks composition startup while scenario actions normally run after
  it. Both the Golden runner capability and the focused harness must feed input in flight, waiting on screen markers —
  input sent before the TUI attaches its handler to the VirtualTerminal is dropped.
- **Shared process runtime mutation.** `registerNativeProvider` mutates the process-wide model runtime. Fixture cleanup
  must unregister, and all of these tests already serialize under `withProcessGlobalTestLock`.
- **`claude-cli` semantics are easy to regress** while touching availability: deferred-backend error text and its
  exclusion from auth status/logout choices are protected behavior (see Verification Plan).
- **Failed root activation without faking.** Realistic triggers that keep `SessionRuntime.switchAgent` real: an initial
  agent name the runtime cannot resolve (Golden scenarios already vary `initialAgentName`), or a selected default model
  that availability accepts but session creation rejects. The test asserts focus returns to the editor with recovery
  guidance and no root Session.
- **Ratchet hygiene.** `deno task seams:update` runs only after the source seams are gone — it tightens, and any
  residual seam fails the update. Do not edit `scripts/injection-seam-baseline.json` by hand.
- **Assumption (reviewable):** the focused composed-TUI tests run in-process under the fixture lock rather than as new
  Golden child scenarios, keeping the focused suites fast; the Golden suite keeps exactly the two startup scenarios
  (reworked) plus its existing default-path coverage of "usable selected model bypasses onboarding".
