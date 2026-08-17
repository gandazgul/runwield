---
planId: "5c06ed28-b643-4084-85a5-ca3de6ffb7a9"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
summary: "Keep the active Agent when a configured model is unavailable, render model-selection failures as errors, and prove preset and /model recovery in Golden TUI journeys."
affectedPaths:
    - "src/cmd/agents/index.ts"
    - "src/cmd/agents/index.test.ts"
    - "src/cmd/models/index.ts"
    - "src/cmd/models/index.test.ts"
    - "src/ui/tui/testing/scenario-runner.js"
    - "src/ui/tui/golden-scenarios/slash-command-tree-configuration.ts"
    - "src/ui/tui/golden-scenarios/slash-command-configuration.test.ts"
objectiveChecks:
    - id: "OC1"
      command: "grep -q 'export const slashAgentUnavailablePresetRecoveryScenario' src/ui/tui/golden-scenarios/slash-command-tree-configuration.ts && grep -q 'export const slashModelUnavailableOverrideRecoveryScenario' src/ui/tui/golden-scenarios/slash-command-tree-configuration.ts && deno run -A scripts/run-tests.js src/ui/tui/golden-scenarios/slash-command-configuration.test.ts"
      rationale: "Both new registered Golden journeys are absent today; after implementation this check runs their composed TUI assertions for blocked switches, error severity, recovery, and post-recovery model turns."
    - id: "OC2"
      command: "grep -q 'keeps the active Agent when its configured model is unavailable' src/cmd/agents/index.test.ts && deno run -A scripts/run-tests.js src/cmd/agents/index.test.ts src/cmd/models/index.test.ts"
      rationale: "The unavailable-model command regression test is absent today; after implementation it must pass with the command tests that assert unchanged Agent/model state and error-styled recovery behavior."
objectiveChecksBaseline:
    recordedAt: "2026-08-17T18:31:01.021Z"
    head: "a9d26bbe600ace63628e1033f0739676491d4f78"
    results:
        - id: "OC1"
          command: "grep -q 'export const slashAgentUnavailablePresetRecoveryScenario' src/ui/tui/golden-scenarios/slash-command-tree-configuration.ts && grep -q 'export const slashModelUnavailableOverrideRecoveryScenario' src/ui/tui/golden-scenarios/slash-command-tree-configuration.ts && deno run -A scripts/run-tests.js src/ui/tui/golden-scenarios/slash-command-configuration.test.ts"
          rationale: "Both new registered Golden journeys are absent today; after implementation this check runs their composed TUI assertions for blocked switches, error severity, recovery, and post-recovery model turns."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 27
          output: "\n"
        - id: "OC2"
          command: "grep -q 'keeps the active Agent when its configured model is unavailable' src/cmd/agents/index.test.ts && deno run -A scripts/run-tests.js src/cmd/agents/index.test.ts src/cmd/models/index.test.ts"
          rationale: "The unavailable-model command regression test is absent today; after implementation it must pass with the command tests that assert unchanged Agent/model state and error-styled recovery behavior."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 20
          output: "\n"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-17T14:16:31-04:00"
updatedAt: "2026-08-17T21:46:55.833Z"
status: "implemented"
origin: "internal"
failureReason: "All local submodules are initialized, pinned, and clean.\nSnip verified all generic Deno filters.\n[wld] version - ok\ntype check passed\n17:31:24 [types] Generated 30ms\n17:31:24 [check] Getting diagnostics for Astro files in /Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-handle-unavailable-model-agent-switches-b201eb02/src/ui/workspace...\nResult (113 files): \n- 0 errors\n- 0 warnings\n- 0 hints\n\nno lint errors\nLanguage policy baseline matches current production JS/JSX files.\nInjection-seam baseline holds: 0 seam(s) across 0 module(s), 0 of them machinery and 0 conditional seam(s) still to remove.\nChecked relative Markdown links in 423 tracked files.\n[wld] version - ok\nFAIL src/ui/tui/golden-scenarios/slash-command-terminal.test.ts — failure log: /var/folders/hw/zrm0bqr90xz63nflnb2g_qqr0000gn/T/tests-failure-61ad12e0d9a2f56f.log\n\nFAILED | 330 files passed | 1 failed (387.0s, 4 at a time)\n\n\u001b[0m\u001b[32mTask\u001b[0m \u001b[0m\u001b[36mci\u001b[0m deno task -q submodules:check && deno task -q snip:check && deno task -q check && deno task -q workspace:check && deno task -q lint && deno task -q language-policy:check && deno task -q seams:check && deno task -q doc-links:check && deno task -q test\n"
implementedAt: "2026-08-17T18:56:16.291Z"
userVerifiedAt: null
executionReport: "- Implemented `/agent` failure handling: unavailable model/provider switch failures now stay on the active Agent/model and render one error-styled recovery message.\n- Implemented `/model` error severity: invalid format and unknown model/provider selections now call `appendSystemMessage(..., true)` and do not change the active/default model.\n- Added opt-in Golden TUI `captureSystemMessages` support and registered two recovery journeys for bad preset model/provider and bad `/model` model/provider.\n- Added tests: +4 total tests/scenarios; no tests removed or replaced. Coverage added for Agent switch rollback, `/model` unchanged-state recovery, `/settings` preset recovery, and manual `/model` recovery.\n- Verification passed: `deno run -A scripts/run-tests.js src/cmd/agents/index.test.ts src/cmd/models/index.test.ts src/ui/tui/golden-scenarios/slash-command-configuration.test.ts src/ui/tui/golden-scenarios/slash-command-coverage.test.ts`.\n- Verification passed: `deno task seams:check`.\n- Verification incomplete: `deno task ci` failed twice on untouched `src/ui/tui/golden-scenarios/validation-workflow-publication.test.ts` with `Unused scripted Runtime interactions: 1`; rerunning that file alone passed."
humanReviewMode: null
humanReviewDecision: null
validationCheckpoint: null
executionMode: "worktree"
executionBaselineTree: "0c7aa06cc07fa1da6987c0f476ff7c9b5250aaa7"
worktreeId: "b201eb02"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-handle-unavailable-model-agent-switches-b201eb02"
worktreeBranch: "worktree/handle-unavailable-model-agent-switches-b201eb02"
worktreeBaseBranch: "main"
worktreeStatus: "validation_failed"
validationCiAttempts: 0
validationObjectiveCheckAttempts: 0
validationSemanticRounds: 0
---

# Handle Unavailable Models During Agent Switches

## Context

A configured model is a strict input to an Agent switch. `resolveModel` rejects an unknown model, unknown provider, or
unusable configured model. `switchActiveAgent` builds the replacement root before it commits the new Agent and handler,
so a failed build already leaves the current Agent intact.

The terminal user interface (TUI) does not make this failure clear enough. `/agent` lets the error reach the generic
slash-command catcher, which writes an `Error:` message as ordinary system text instead of an error-colored message.
`/model` also reports invalid or unknown model references as ordinary system text. The existing Golden TUI precedence
journeys cover only valid models and do not prove that the Session remains usable after either failure.

## Objective

When a requested Agent or manual model selection resolves to an unavailable model or provider:

- the active Agent and active model remain unchanged;
- the TUI shows a clear error-colored message with the failed model details and recovery guidance;
- a later valid preset selected through `/settings` or a valid `/model` selection repairs the Session;
- the user can retry `/agent`, submit a message, and receive a response from the intended Agent and model.

## Approach

Preserve the existing transactional switch boundary and improve only its command-level presentation and regression
coverage.

```text
/agent planner
  runAgentsCommandTUI
  SessionRuntime.switchAgent
  switchActiveAgent
  resolveModel                  ← rejects missing model/provider
  build fails before commit
  current Agent/root remain     ← existing invariant
  command renders red error     ← new presentation and recovery guidance

/settings → valid preset  or  /model valid/model
  rebuild current Agent/model
  /agent planner retry
  Planner faux-model turn completes
```

`runAgentsCommandTUI` will handle both a thrown switch failure and an `{ ok: false }` runtime result. It will report the
original failure, state that the active Agent did not change, suggest `/model` or `/settings`, and restore editor focus.
It must not retry, fall through to another model, or change the model-resolution precedence.

`runModelsCommand` will mark invalid-format and unknown model/provider responses as errors. Successful model changes
remain ordinary status messages.

The Golden harness will optionally capture calls to `appendSystemMessage`, including the `isError` flag. Golden
assertions will use this flag as the error-color contract: `SystemMessageBlock` already maps `isError: true` to the
theme's `error` foreground color. This avoids checking hard-coded ANSI color values.

The option set aside is changing every generic slash-command exception to error styling in `slash-dispatch.ts`. That
would affect unrelated commands and would not add the `/agent`-specific unchanged-state and recovery guidance required
here.

## Files to Modify

- `src/cmd/agents/index.ts` — report failed Agent switches as error-colored messages, preserve the original failure
  details, handle non-throwing failure results, and always restore editor focus without claiming a switch occurred.
- `src/cmd/agents/index.test.ts` — cover an unavailable configured model against the real Session runtime and assert
  that the prior Agent/root state remains active and the UI receives an error-styled recovery message.
- `src/cmd/models/index.ts` — mark malformed and unknown explicit `/model` references as errors while keeping successful
  selections as normal status messages.
- `src/cmd/models/index.test.ts` — record message severity and verify failed selections do not replace the current model
  while a later valid selection still succeeds.
- `src/ui/tui/testing/scenario-runner.js` — add opt-in capture of system-message text, error severity, and header
  through the existing `configureUiAPI` test hook; preserve normal rendering by forwarding each captured call to the
  real UI API.
- `src/ui/tui/golden-scenarios/slash-command-tree-configuration.ts` — add composed TUI journeys for unavailable preset
  models/providers and unavailable `/model` selections, including both recovery paths and a real post-recovery Planner
  turn.
- `src/ui/tui/golden-scenarios/slash-command-configuration.test.ts` — register the new Golden scenarios without
  assigning duplicate slash-command coverage ownership.

## Reuse Opportunities

- `src/shared/session/agent-switching.js` — retain the staged root/handler commit behavior that leaves the previous
  Agent transaction intact when replacement construction fails.
- `src/shared/session/session.js` — retain strict configured-model resolution and its detailed errors for unknown
  providers, unknown models, missing authentication, and invalid references.
- `src/shared/session/session-runtime.js` — reuse `switchAgent` and `reconfigureSessionModel`; do not add a new
  injection seam or bypass their rollback behavior.
- `src/ui/tui/blocks.js` — reuse the existing `SystemMessageBlock` contract where `isError: true` maps to the theme's
  `error` color.
- `src/ui/tui/testing/scenario-runner.js` — extend the existing `configureUiAPI` and scripted interaction capture rather
  than introducing a product seam.
- `src/ui/tui/golden-scenarios/slash-command-tree-configuration.ts` — reuse the faux provider, model-turn capture,
  footer assertions, Planner fixture, and scripted `/settings` select interactions.

## Implementation Steps

- [ ] `runAgentsCommandTUI` treats thrown failures and `{ ok: false }` results from `SessionRuntime.switchAgent` as
      failed switches; it emits one `appendSystemMessage(..., true)` message with the failure detail, states that the
      active Agent did not change, points to `/model` and `/settings`, and returns focus to the editor without emitting
      or implying a successful Agent change.
- [ ] The failed `/agent` path preserves the pre-switch Agent, root Agent Session, active handler, footer Agent/model,
      and ability to accept another slash command; it does not silently fall through to defaults or lower-priority model
      sources.
- [ ] `runModelsCommand` sends invalid-format and unknown explicit model/provider messages with `isError: true`, does
      not mutate the active/default model for those failures, and continues to send successful switch messages with
      normal severity.
- [ ] The command tests exercise the real Session runtime for an unavailable configured model, assert the prior
      Agent/model state after failure, assert error severity and recovery guidance, then prove that a valid model
      selection remains usable.
- [ ] The composed Golden harness can opt into `state.systemMessages` capture with `{ text, isError, header }` entries
      while still calling the real `appendSystemMessage`; scenarios without the option retain their current state and
      behavior.
- [ ] A registered Golden scenario starts on Guide with a Planner preset that names a missing model on the real Golden
      provider, proves `/agent planner` emits a red/error-severity unavailable-model message and no Planner change
      event, repeats the blocked switch for a missing provider, then selects a valid preset through `/settings`,
      switches to Planner exactly once, and completes a captured Planner faux-model turn.
- [ ] A registered Golden scenario submits `/model` references for a missing model and a missing provider, proves each
      response has error severity and leaves the Guide footer/model unchanged, then selects a valid model with `/model`,
      switches to Planner, and completes a captured Planner faux-model turn using the manual override.
- [ ] The new scenarios do not claim additional ownership of canonical slash commands in `slashCommands`; the existing
      `/agent`, `/model`, and `/settings` owner scenarios remain the single owners required by
      `slash-command-coverage.test.ts`.

## Approval Confirmation

No Work Records are proposed for supersession.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/cmd/agents/index.test.ts src/cmd/models/index.test.ts src/ui/tui/golden-scenarios/slash-command-configuration.test.ts src/ui/tui/golden-scenarios/slash-command-coverage.test.ts`
- Automated: `deno task seams:check` to confirm the Golden observation hook does not add a product injection seam.
- Automated: `deno task ci` for the full type, lint, language-policy, seam, documentation-link, and isolated test suite.
- Expected preset-model journey:
  - a missing `golden/<model>` and a missing `<provider>/<model>` each produce an error-severity system message;
  - Guide remains active and no Planner model turn occurs;
  - selecting the valid preset through `/settings` reloads successfully;
  - one later `/agent planner` event occurs and its Planner turn uses the valid preset model and Planner prompt.
- Expected `/model` journey:
  - missing-model and missing-provider references do not change the footer or persisted default model;
  - both messages use error severity;
  - a valid `/model golden/manual` selection changes the active/default model normally;
  - the manual override survives `/agent planner` and handles the next Planner turn.
- Preserve existing behavior: valid model precedence remains manual `/model` override, active preset, base Agent
  setting, settings default, then Agent Definition fallback; successful `/agent`, `/settings`, and `/model` journeys and
  their model-turn capture remain covered.
- Behavior expected to stop existing: unavailable-model failures must no longer appear as ordinary, non-error system
  messages, and `/agent` must not silently ignore a non-throwing `{ ok: false }` switch result.

## Edge Cases & Considerations

- A known provider with an unknown model can attempt provider discovery before failing. Golden tests must use the
  isolated Golden configuration and bounded test timeout; they must not contact a real provider.
- Error output must retain the underlying model reference/source so users can identify whether the preset, provider, or
  model ID is wrong. Do not expose credentials or provider secrets.
- A failed switch can occur in an unpersisted prompt-ready Session or a persisted Session. The command-level invariant
  is the same: no partial Agent/model projection may become authority.
- A valid manual `/model` override intentionally outranks a still-invalid active preset. This is the `/model` recovery
  path, not a silent fallback.
- Selecting a valid preset rebuilds the current Agent before the later `/agent` retry. A reload failure must not be
  mistaken for a successful recovery.
- No settings schema, model precedence, migration, or domain-language change is required.
