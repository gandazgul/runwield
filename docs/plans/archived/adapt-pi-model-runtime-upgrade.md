---
planId: "adcd3dea-10bd-4f5e-98b9-9477809b315d"
classification: "PLANNED_CHANGE"
complexity: "MEDIUM"
summary: "Adapt RunWield to the latest @earendil-works Pi package model/auth runtime APIs while keeping dependencies upgradeable"
affectedPaths:
    - "deno.json"
    - "deno.lock"
    - "src/shared/models/model-registry.js"
    - "src/shared/models/model-validation.js"
    - "src/shared/session/session.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-context-resilience.test.js"
    - "src/shared/session/session-temperature.test.js"
    - "src/shared/session/hosted-session.test.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/ui/tui/chat-session.js"
    - "src/ui/tui/ui-api-overrides.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-27T12:29:26-04:00"
updatedAt: "2026-07-29T03:36:51.776Z"
archivedAt: "2026-07-01"
status: "verified"
origin: "internal"
implementedAt: "2026-07-28T03:06:10.921Z"
verifiedAt: "2026-07-29T03:36:39.245Z"
userVerifiedAt: null
executionReport: "- Implemented Pi 0.82.1 runtime integration: `ModelRuntime` creation/caching, RunWield model facade, `createAgentSession({ modelRuntime })`, TUI model selector runtime wiring, and `streamFunction` temperature wrapping.\n- Updated Earendil imports to upgradeable `^0.82.1` ranges, removed latest-observed aliases, and regenerated `deno.lock` resolving Pi packages to 0.82.1.\n- Added end-to-end `max` thinking-level support and coverage for HostedSession/SessionRuntime cycling.\n- Verification passed: `deno task -q check`, targeted session/model tests, `deno task -q lint`, `deno task -q test`, and `deno task -q ci`."
workRecord:
    status: "generated"
    recordId: "bce0330f-dbc0-4a9a-8a82-27b051646984"
    path: "docs/work-records/2026-07-29-adapt-pi-modelruntime-upgrade.md"
    lastAttemptAt: "2026-07-29T03:36:45.584Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "3ef31fabd2d76768e665ef06693c9c7b6a4bbe4d"
    targetBranch: "main"
    targetHeadBeforeMerge: "ac976f24935c6995031211d25eef3dc16c967fcf"
---

# Adapt Pi ModelRuntime Upgrade

## Context

The User Request is to upgrade the `@earendil-works` packages to their latest versions and avoid exact pins in
`deno.json` so future compatible versions can be resolved. The dependency operation has already changed the local
working copy to use `^0.82.1` ranges for the Pi packages and `deno.lock` resolves them to `0.82.1`, but
`deno task check` now fails because RunWield still integrates with removed Pi SDK APIs.

Upstream investigation shows the breakage is intentional, not a local typing accident:

- Pi 0.80.8 release notes: <https://pi.dev/news/releases/0.80.8>
  - `CreateAgentSessionOptions.authStorage` and `modelRegistry` were replaced by async `modelRuntime`.
  - `AuthStorage` is no longer exported from the package root; SDK users should use `ModelRuntime`, a custom pi-ai
    `CredentialStore`, or `readStoredCredential()` for one-off reads.
  - request auth assembly moved from `ModelRegistry.getApiKeyAndHeaders()` to `ModelRuntime.getAuth()` so provider/model
    headers and extension transforms are included before dispatch.
  - redundant `ModelRuntime` projection helpers were removed; consumers should use the pi-ai `Models` methods
    `getModels()`, `getModel()`, `getProviders()`, and `checkAuth()`.
  - `ModelRegistry.refresh()` became async because dynamic `models.json`/catalog loading is async.
- Pi SDK docs: <https://pi.dev/docs/latest/sdk>
  - `createAgentSession({ modelRuntime })` is the public embedding path.
  - `ModelRuntime.create({ authPath, modelsPath })`, `checkAuth()`, `getAvailable()`, `login()`, `logout()`, and
    `setRuntimeApiKey()` are the public model/auth surface.
  - `Agent.agent.streamFunction` is the public field on `Agent`; RunWield currently patches `streamFn`.
- Pi 0.80.6 release notes: <https://pi.dev/news/releases/0.80.6>
  - `max` became an official thinking level. RunWield’s local `ThinkingLevel` typedefs and cycling fallback still stop
    at `xhigh`.
- Pi 0.82.0/0.82.1 release notes: <https://pi.dev/news/releases/0.82.0> and <https://pi.dev/news/releases/0.82.1>
  - model catalogs, provider-verified reasoning levels, OAuth providers, header-only auth, and catalog refresh semantics
    continued to evolve around `ModelRuntime`/`Models`.

Current local failures are concentrated around these mismatches:

- `src/shared/models/model-registry.js` imports root `AuthStorage` and calls `ModelRegistry.create(...)`, neither of
  which matches Pi 0.82.1.
- `src/shared/session/session.js` passes `authStorage` and `modelRegistry` to `createAgentSession`, then reads
  `session.modelRegistry`, but Pi 0.82.1 expects `modelRuntime` and does not expose `session.modelRegistry`.
- `applySessionTemperature()` patches `session.agent.streamFn`; Pi 0.82.1 exposes `streamFunction`.
- `src/shared/session/hosted-session.js`, `src/shared/session/session-runtime.js`, and TUI initialization reject or omit
  the new `max` thinking level.
- `src/ui/tui/ui-api-overrides.js` passes RunWield’s old registry object into Pi’s `ModelSelectorComponent`, whose
  0.82.1 constructor expects the Pi model runtime shape.
- `src/shared/session/session-context-resilience.test.js` still treats “latest observed” aliases as exact version
  sentinels, but the main Pi imports are now the latest range and exact pins in `deno.json` conflict with the User
  Request.

No `docs/domain-language.md` update is needed: this is a dependency/runtime integration repair and does not introduce or
redefine a RunWield domain term.

## Objective

Complete the Pi dependency upgrade by adapting RunWield to Pi 0.82.1’s public model/auth/runtime APIs while preserving
RunWield-owned Session, workflow, TUI, image preflight, prompt-template model validation, and dependency-upgrade
behavior.

The completed change must:

- keep `@earendil-works/*` imports in `deno.json` as upgradeable ranges, not exact version pins;
- create Agent Sessions with Pi’s async `ModelRuntime` instead of removed `authStorage`/`modelRegistry` options;
- keep RunWield’s existing synchronous model-validation call sites working through a local compatibility facade or an
  intentionally bounded async refactor;
- use `Agent.streamFunction` for temperature injection;
- support Pi’s `max` thinking level end-to-end;
- update tests that currently assert exact Pi import specifiers or old API names; and
- pass the repository verification gates.

## Approach

Use Pi’s public `ModelRuntime` as the canonical runtime for all real model/auth operations, and keep only a thin
RunWield-owned compatibility facade where RunWield still needs synchronous reads for validation/UI. Do not recreate Pi’s
removed `AuthStorage` API or reach into private Pi internals.

Recommended local shape:

1. In `src/shared/models/model-registry.js`, replace the old root `AuthStorage`/`ModelRegistry.create()` path with:
   - an async cached `getModelRuntime()`/`createRunWieldModelRuntime()` helper that calls
     `ModelRuntime.create({
     authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") })`
     after the existing one-time Pi config migration;
   - a `RunWieldModelRegistry` compatibility facade only for RunWield call sites that still need `find()`, `getAll()`,
     `getAvailable()`, `hasConfiguredAuth()`, `getProviderAuthStatus()`, and `registerProvider(...)` style access;
   - provider-config `apiKey` fallback behavior for custom OpenAI-compatible providers already supported by
     `discoverProviderModel()`; and
   - replay of locally registered provider configs into `ModelRuntime.registerProvider(...)` once the runtime exists.
2. In `src/shared/session/session.js`, await the model runtime during Agent Session construction and pass `modelRuntime`
   to `createAgentSession(...)`. Keep the RunWield facade available separately for image fallback, template validation,
   and custom provider discovery rather than expecting `session.modelRegistry` to exist.
3. Replace `session.agent.streamFn` patching with `session.agent.streamFunction` patching. Keep a guarded fallback only
   if tests construct minimal fake agents that still expose `streamFn`, but production code should use `streamFunction`.
4. Update thinking-level typedefs, persisted pending intent shapes, initialization, runtime setters, cycling fallback,
   and tests to include `"max"`.
5. Update TUI model selector integration to pass a real `ModelRuntime`/compatible model runtime to Pi’s
   `ModelSelectorComponent`. Since `uiAPI.showModelSelector()` already returns a Promise, it may await
   `getModelRuntime()` before constructing the selector.
6. Remove or de-emphasize the `-latest-observed` Pi aliases now that the primary imports are upgradeable latest ranges.
   If a characterization test remains useful, make it characterize the selected Pi package contract from the primary
   imports and assert upgradeability separately instead of pinning an alias to an exact version.

## Files to Modify

- `deno.json` — keep `@earendil-works/pi-tui`, `pi-ai`, `pi-coding-agent`, and `pi-agent-core` on non-exact upgradeable
  ranges (`^0.82.1` currently). Remove or update redundant `-latest-observed` aliases so no Earendil import is
  exact-pinned in this file.
- `deno.lock` — update after `deno.json` and source changes so the resolved latest packages and any removed aliases are
  represented consistently.
- `src/shared/models/model-registry.js` — migrate RunWield model/auth ownership to Pi `ModelRuntime`, preserve existing
  config migration, and provide a local compatibility facade for sync reads/custom provider discovery.
- `src/shared/models/model-validation.js` — either keep using the compatibility facade synchronously or explicitly adapt
  template model validation if the implementation chooses an async model lookup path.
- `src/shared/session/session.js` — pass `modelRuntime` to `createAgentSession`, stop passing removed `authStorage` and
  `modelRegistry` options, replace `session.modelRegistry` reads, and patch `streamFunction` for temperature behavior.
- `src/shared/session/hosted-session.js` — extend `ThinkingLevel` and pending managed turn typing to include `"max"`.
- `src/shared/session/session-runtime.js` — use a model runtime/facade instead of `rootAgentSession.modelRegistry`,
  include `"max"` in fallback thinking cycling, and keep runtime events/cache projections authoritative.
- `src/ui/tui/chat-session.js` — accept/persist the package-level `"max"` thinking level when initializing and cycling.
- `src/ui/tui/ui-api-overrides.js` — await/use `ModelRuntime` or a compatible runtime for `ModelSelectorComponent`.
- `src/shared/session/session-context-resilience.test.js` — update old `streamFn` construction/contract probes and
  remove exact-version/latest-observed assumptions incompatible with range imports.
- `src/shared/session/session-temperature.test.js` — update test doubles/assertions from `streamFn` to `streamFunction`.
- `src/shared/session/hosted-session.test.js` — add/adjust coverage for `"max"` thinking persistence/reset behavior.
- `src/shared/session/session-runtime.test.js` — add/adjust coverage for cycling through `"max"` and setting it from
  saved settings/pending managed intent.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/models/model-registry.js` — existing one-time migration from Pi config files into RunWield-owned config
  should remain the entry point for model/auth file location.
- `src/shared/models/model-registry.js::discoverProviderModel()` — keep its custom-provider discovery behavior but
  ensure registered provider config can be reflected into the new model runtime.
- `src/shared/session/image-attachments.js::resolveVisionFallbackModel()` — preserve image fallback semantics; adapt
  only the model lookup/auth calls if the facade shape changes.
- `src/shared/session/session.js::resolveModel()` — preserve source priority for model choice: manual `/model`,
  invocation override, per-agent setting, default setting, agent definition.
- `src/shared/session/session.js::applySessionTemperature()` — preserve unsupported-temperature fallback behavior while
  switching from `streamFn` to `streamFunction`.
- Pi public SDK APIs from 0.82.1:
  - `ModelRuntime.create({ authPath, modelsPath })`
  - `ModelRuntime.getModels()`, `getModel()`, `getProviders()`, `checkAuth()`, `getAvailable()`, `getAuth()`
  - `createAgentSession({ modelRuntime, ... })`
  - `Agent.streamFunction`

## Implementation Steps

- [ ] Step 1: Re-run `deno task -q check` or `deno check --doc src/cli.js` and save the current failure list as the
      repair baseline. Confirm failures include removed `AuthStorage`, removed `CreateAgentSessionOptions.authStorage`,
      removed `CreateAgentSessionOptions.modelRegistry`, `Agent.streamFn`, `ThinkingLevel`, and
      `ModelRuntime`/`ModelRegistry` shape errors.
- [ ] Step 2: Update `src/shared/models/model-registry.js` imports from `@earendil-works/pi-coding-agent` to use
      `ModelRuntime`, `ModelRegistry` only if its public constructor is useful, and `readStoredCredential` only for
      one-off stored credential reads. Do not import root `AuthStorage`.
- [ ] Step 3: Add an async cached RunWield model runtime helper using RunWield config paths:
      `authPath: join(getRunWieldModelConfigDir(), "auth.json")` and
      `modelsPath: join(getRunWieldModelConfigDir(), "models.json")`. The helper must run `migratePiModelConfigOnce()`
      before creating the runtime and must not fall back to Pi-owned runtime files after migration.
- [ ] Step 4: Provide a bounded RunWield compatibility facade if needed by sync call sites. It must expose the current
      RunWield-used methods (`find`, `getAll`, `getAvailable`, `hasConfiguredAuth`, `getProviderAuthStatus`,
      `registerProvider`, and any methods used by tests/UI), delegate to resolved `ModelRuntime` where possible, and
      retain custom provider discovery behavior. Avoid pretending to be Pi’s old `authStorage` object.
- [ ] Step 5: Adapt `discoverProviderModel()` so custom OpenAI-compatible provider discovery works with the new facade
      and ultimately registers provider/model config with `ModelRuntime.registerProvider(...)`. Preserve
      `imageInputModels` and explicit `options.input` behavior.
- [ ] Step 6: Update `src/shared/session/session.js::buildAgentSession()` to await/get the model runtime before calling
      `createAgentSession()` and pass `modelRuntime` instead of `authStorage` and `modelRegistry`. Keep
      `settingsManager`, `tools`, `customTools`, `resourceLoader`, `sessionManager`, and resolved `model` behavior
      unchanged.
- [ ] Step 7: Replace `session.modelRegistry` reads in `runPrompt()` and other session paths with the RunWield facade or
      model runtime obtained from construction context. Image fallback must still run when pasted images target a
      text-only model.
- [ ] Step 8: Update `applySessionTemperature()` to wrap `session.agent.streamFunction`. Preserve the current behavior:
      omit `temperature` for models without temperature support, try once with temperature for supported models, then
      retry without temperature only when the provider reports unsupported temperature.
- [ ] Step 9: Update `src/shared/session/hosted-session.js`, `src/shared/session/session-runtime.js`, and TUI
      initialization to include `"max"` in the RunWield thinking-level type/cycle set. Ensure saved settings with `max`
      do not produce a type error and remain visible through runtime events/snapshots.
- [ ] Step 10: Update `src/ui/tui/ui-api-overrides.js::showModelSelector()` to await the model runtime before
      constructing `ModelSelectorComponent`, pass the model runtime where Pi expects it, and keep active model selection
      stored through RunWield’s `setActiveModel(model.id, model.provider)` callback.
- [ ] Step 11: Update `deno.json` so all `@earendil-works/*` imports are upgradeable ranges and no exact `0.82.1`
      sentinel aliases remain unless they are also range-based and still justified. Prefer removing `-latest-observed`
      aliases if tests no longer need a separate package identity.
- [ ] Step 12: Regenerate `deno.lock` with the project’s current Deno command pattern. Use a bounded cache/check command
      such as `deno cache --lock deno.lock --reload src/cli.js` or the repository’s normal check task, and verify the
      lock resolves Pi packages to `0.82.1` or newer within the configured range.
- [ ] Step 13: Update tests: - `session-temperature.test.js` uses `streamFunction` on fake agents. -
      `session-context-resilience.test.js` no longer asserts exact `deno.json` imports or imports removed
      `-latest-observed` aliases; it should characterize the selected public Pi contract and separately assert Earendil
      specifiers are non-exact ranges. - hosted-session/runtime tests include `"max"` thinking level coverage. -
      model-registry/model-validation tests cover RunWield config migration, custom provider discovery, configured auth,
      and sync facade behavior if the facade remains.
- [ ] Step 14: Run formatting/lint/type/test gates and repair any remaining 0.82.1 API mismatches without using private
      Pi APIs or exact dependency pins.

## Verification Plan

- Automated: `deno task -q check`
- Automated: `deno task -q lint`
- Automated: `deno task -q test`
- Automated: `deno task -q ci`
- Automated targeted checks before full CI:
  - `deno test -A --no-check src/shared/models/model-validation.test.js src/shared/session/session-temperature.test.js`
  - `deno test -A --no-check src/shared/session/session-context-resilience.test.js`
  - `deno test -A --no-check src/shared/session/hosted-session.test.js src/shared/session/session-runtime.test.js`
- Manual/source checks:
  - `deno.json` contains no exact-pinned `npm:@earendil-works/*@0.82.1` style specifiers; primary Pi imports are ranges
    such as `^0.82.1`.
  - `deno.lock` resolves `@earendil-works/pi-tui`, `pi-ai`, `pi-coding-agent`, and `pi-agent-core` to `0.82.1` or a
    newer version allowed by the range.
  - No source code passes `authStorage` or `modelRegistry` into `createAgentSession()`.
  - No production source patches `session.agent.streamFn`; production uses `session.agent.streamFunction`.
  - RunWield accepts and persists `max` as a thinking level where other thinking levels are accepted.
- Expected results for key scenarios:
  - Existing model settings and migrated `~/.wld/auth.json`/`models.json` still resolve models and auth through Pi
    `ModelRuntime`.
  - Custom OpenAI-compatible providers discovered through `discoverProviderModel()` still work, including image fallback
    opt-in through `imageInputModels`.
  - TUI `/model` selector opens, shows available models, and saves the selected model through RunWield active model
    state.
  - Image preflight still selects a configured vision fallback when the active model is text-only.
  - Temperature fallback still retries without temperature only for unsupported-temperature provider errors.
  - Session-context-resilience characterization still documents that RunWield must not depend on private Pi compaction
    hooks.

## Edge Cases & Considerations

- Async runtime vs sync validation: Pi’s canonical runtime is async, while RunWield has synchronous template/slash
  validation. Keep the compatibility facade intentionally small, or convert call sites deliberately; do not scatter
  unresolved Promises through validation paths.
- Provider auth semantics changed: providers can be configured through OAuth, environment, headers, or runtime
  overrides. Do not reduce `hasConfiguredAuth()` to only “API key exists.” Prefer
  `ModelRuntime.checkAuth()`/`getProviderAuthStatus()` and preserve provider-config `apiKey` fallback only where
  RunWield already supports it.
- Header-only auth matters: Pi 0.82.1 fixed compaction/branch summaries for providers whose auth resolves entirely to
  request headers. RunWield must not bypass `ModelRuntime.getAuth(model)` for actual provider requests.
- `deno.lock` remains a resolved lockfile: the User Request forbids exact pins in `deno.json`, not lockfile resolution.
- `^0.82.1` on `0.x` packages may resolve conservatively under Deno/npm semantics. If the user later wants fully
  unbounded latest resolution, that should be a separate explicit dependency-policy decision.
- The working tree currently contains unrelated dirty files (`src/agent-definitions/workflow-prompts/reviewer-prompt.md`
  and `plans/early-foreground-steering-delivery.md`). Implementation should avoid touching them unless a later user
  request makes them in scope.
