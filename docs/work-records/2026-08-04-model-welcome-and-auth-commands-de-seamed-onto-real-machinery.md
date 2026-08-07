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
