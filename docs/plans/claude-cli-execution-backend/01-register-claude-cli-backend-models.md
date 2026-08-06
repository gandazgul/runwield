---
planId: "221237ea-d2be-4472-be4b-27fb45ed68f5"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Register pass-through `claude-cli/<selector>` references with four advertised aliases, deferred default selection, explicit non-Pi readiness metadata, and safe pre-runtime rejection."
affectedPaths:
    - "src/shared/models/model-registry.ts"
    - "src/shared/models/model-validation.ts"
    - "src/shared/models/model-execution.ts"
    - "src/shared/models/claude-cli-models.test.ts"
    - "src/shared/models/model-registry.test.js"
    - "src/shared/models/model-validation.test.js"
    - "src/shared/session/claude-cli-model-selection.test.ts"
    - "src/shared/session/session.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/session/image-attachments.js"
    - "src/cmd/auth/"
    - "src/cmd/init/"
    - "src/cmd/models/"
    - "src/cmd/resume/"
    - "src/tools/"
    - "src/ui/tui/"
    - "scripts/language-policy-baseline.json"
objectiveChecks:
    - id: "OC1"
      command: "deno run -A scripts/run-tests.js src/shared/models/claude-cli-models.test.ts src/shared/session/claude-cli-model-selection.test.ts"
      rationale: "Both focused files are absent on the baseline; passing requires Claude selector registration/metadata, deferred selection persistence, transactional rollback, and pre-Pi execution rejection as tested behavior."
    - id: "OC2"
      command: "bash -lc 'set -e; test -s src/shared/models/model-registry.ts; test -s src/shared/models/model-validation.ts; test ! -e src/shared/models/model-registry.js; test ! -e src/shared/models/model-validation.js; ! grep -qE \"src/shared/models/model-(registry|validation)\\.js\" scripts/language-policy-baseline.json; deno task language-policy:check; deno task check'"
      rationale: "Fails on the current JavaScript-only shape and proves the production modules, live imports, language baseline, and type graph were actually migrated rather than wrapped or aliased."
    - id: "OC3"
      command: "bash -lc 'set -e; grep -q \"getSelectable\" src/cmd/models/getArgumentCompletions.js; grep -q \"isSelectable\" src/cmd/resume/index.ts; deno run -A scripts/run-tests.js src/cmd/models/index.test.ts src/cmd/auth/index.test.ts src/cmd/resume/index.test.ts src/shared/session/session-runtime.test.js src/ui/tui/model-welcome.test.js'"
      rationale: "Fails on the current auth-only completion/resume paths and can pass only when deferred selection integrates without breaking runnable onboarding, API-auth status, resume, or transactional model reconfiguration."
objectiveChecksBaseline:
    recordedAt: "2026-08-03T22:39:28.275Z"
    head: "d61332680f346768ac48b1c402d1dc033588982d"
    results:
        - id: "OC1"
          command: "deno run -A scripts/run-tests.js src/shared/models/claude-cli-models.test.ts src/shared/session/claude-cli-model-selection.test.ts"
          rationale: "Both focused files are absent on the baseline; passing requires Claude selector registration/metadata, deferred selection persistence, transactional rollback, and pre-Pi execution rejection as tested behavior."
          status: "unmet"
          stdout: ""
          stderr: "\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Uncaught (in promise) Error: Deno cache prewarm failed:\n\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Import 'file:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-claude-cli-execution-backend-01-register-claude--bae4a6ef/src/shared/session/claude-cli-model-selection.test.ts' failed, not found.\n\n    throw new Error(`Deno cache prewarm failed:\\n${output}`);\n\u001b[0m\u001b[31m          ^\u001b[0m\n    at \u001b[0m\u001b[1m\u001b[3mprewarmDenoDir\u001b[0m (\u001b[0m\u001b[2m\u001b[38;5;245mfile:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-claude-cli-execution-backend-01-register-claude--bae4a6ef/\u001b[0m\u001b[0m\u001b[36mscripts/run-tests.js\u001b[0m:\u001b[0m\u001b[33m91\u001b[0m:\u001b[0m\u001b[33m11\u001b[0m)\n    at async \u001b[0m\u001b[2m\u001b[38;5;245mfile:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-claude-cli-execution-backend-01-register-claude--bae4a6ef/\u001b[0m\u001b[0m\u001b[36mscripts/run-tests.js\u001b[0m:\u001b[0m\u001b[33m180\u001b[0m:\u001b[0m\u001b[33m9\u001b[0m\n"
          exitCode: 1
          durationMs: 48
          output: "\n\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Uncaught (in promise) Error: Deno cache prewarm failed:\n\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Import 'file:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-claude-cli-execution-backend-01-register-claude--bae4a6ef/src/shared/session/claude-cli-model-selection.test.ts' failed, not found.\n\n    throw new Error(`Deno cache prewarm failed:\\n${output}`);\n\u001b[0m\u001b[31m          ^\u001b[0m\n    at \u001b[0m\u001b[1m\u001b[3mprewarmDenoDir\u001b[0m (\u001b[0m\u001b[2m\u001b[38;5;245mfile:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-claude-cli-execution-backend-01-register-claude--bae4a6ef/\u001b[0m\u001b[0m\u001b[36mscripts/run-tests.js\u001b[0m:\u001b[0m\u001b[33m91\u001b[0m:\u001b[0m\u001b[33m11\u001b[0m)\n    at async \u001b[0m\u001b[2m\u001b[38;5;245mfile:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-claude-cli-execution-backend-01-register-claude--bae4a6ef/\u001b[0m\u001b[0m\u001b[36mscripts/run-tests.js\u001b[0m:\u001b[0m\u001b[33m180\u001b[0m:\u001b[0m\u001b[33m9\u001b[0m\n"
        - id: "OC2"
          command: "bash -lc 'set -e; test -s src/shared/models/model-registry.ts; test -s src/shared/models/model-validation.ts; test ! -e src/shared/models/model-registry.js; test ! -e src/shared/models/model-validation.js; ! grep -qE \"src/shared/models/model-(registry|validation)\\.js\" scripts/language-policy-baseline.json; deno task language-policy:check; deno task check'"
          rationale: "Fails on the current JavaScript-only shape and proves the production modules, live imports, language baseline, and type graph were actually migrated rather than wrapped or aliased."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 10
          output: "\n"
        - id: "OC3"
          command: "bash -lc 'set -e; grep -q \"getSelectable\" src/cmd/models/getArgumentCompletions.js; grep -q \"isSelectable\" src/cmd/resume/index.ts; deno run -A scripts/run-tests.js src/cmd/models/index.test.ts src/cmd/auth/index.test.ts src/cmd/resume/index.test.ts src/shared/session/session-runtime.test.js src/ui/tui/model-welcome.test.js'"
          rationale: "Fails on the current auth-only completion/resume paths and can pass only when deferred selection integrates without breaking runnable onboarding, API-auth status, resume, or transactional model reconfiguration."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 12
          output: "\n"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-03T14:20:03-04:00"
updatedAt: "2026-08-04T01:38:19.716Z"
status: "verified"
origin: "internal"
parentPlan: "claude-cli-execution-backend"
order: 1
dependencies:
    []
implementedAt: "2026-08-04T01:13:03.486Z"
verifiedAt: "2026-08-04T01:38:19.716Z"
userVerifiedAt: null
executionReport: "- Implemented approved plan `claude-cli-execution-backend/01-register-claude-cli-backend-models`: migrated model registry/validation to TypeScript, removed the retired JS modules, updated imports and policy baselines, and preserved the existing model-runtime config refresh/state behavior.\n- Registered selectable Claude CLI references for exactly `sonnet`, `opus`, `haiku`, and `fable`, plus non-empty pass-through selectors, with external CLI metadata while excluding them from runnable availability and API/OAuth auth flows.\n- Added typed unsupported-backend execution rejection before Pi runtime/session creation, plus deferred `/model` persistence so Claude CLI selections save defaults without switching the current Session.\n- Made active model reconfiguration transactional: failed activation restores the previous user override/root Session state and emits no model-changed event.\n- Test coverage changed by +7 tests: added 4 Claude model registry/validation tests, added 2 Claude CLI selection/deferred persistence tests, and added 1 SessionRuntime rollback regression; no tests were removed or replaced.\n- Verification passed: focused behavior suite (82 passed), settings/selection/onboarding suite (84 passed), exact OC1/OC2/OC3 commands passed, `deno task check && deno task language-policy:check && deno task seams:check` passed, and full `deno task ci` passed."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "59c398630754f7c6da5e120def175c4324724ff7"
    targetBranch: "main"
    targetHeadBeforeMerge: "f43e61e33f33b2cdf21913cab817a6890fafd9f9"
validationCiAttempts: 0
validationSemanticRounds: 2
---

# Register Claude CLI Backend Models

## Context

RunWield's model registry currently assumes every selectable model is a Pi-backed provider model: `getAvailable()`
filters by `hasConfiguredAuth()`, strict template resolution requires the same application programming interface (API)
auth predicate, and `buildAgentSession()` passes the resolved model directly to Pi's `createAgentSession()`. Claude CLI
is a different execution backend. Its authentication and health belong to the external `claude` process, not Pi's
API-key/OAuth provider runtime.

This child establishes a coherent intermediate state before child 02 adds execution. Users can store
`claude-cli/<selector>` as a deferred default, the registry identifies it as selectable but not runnable, and the
current Session remains on its existing model. Any fresh Session or configured-agent path that attempts to activate the
deferred reference fails clearly before Pi `AgentSession` construction. This child does not spawn `claude`, perform CLI
health/auth checks, or route a turn to Claude yet.

The existing settings layer is already provider-agnostic: `agents`, `activeModelPreset`, and `modelPresets` are
preserved as complete RunWield custom values. No new `claudeCli` settings object or `src/shared/settings.js` behavior is
needed in this child.

During planning, concurrent work overlapped `src/shared/models/model-registry.js`, Session composition/runtime, its
regression tests, and the language-policy baseline. That work has now landed. Its model-runtime config-directory refresh
behavior, root Session rebuild preservation, runtime import migrations, and tightened language baseline are the
execution authority; this Plan must preserve them rather than reconstructing the earlier source.

## Objective

Make `claude-cli/<selector>` a valid RunWield model reference in agent settings, active presets, model presets, strict
template resolution, and model selection while preserving existing strict provider qualification. Advertise `sonnet`,
`opus`, `haiku`, and `fable`; resolve any non-empty Claude CLI selector as a pass-through value because Claude CLI is
authoritative for selector validity; attach explicit non-Pi backend metadata; keep API auth and selection eligibility
distinct; preserve onboarding's definition of a model that is runnable now; save explicit Claude selection as a deferred
default without changing the active Session; and reject attempted activation with a clear backend-not-installed error
until child 02 lands.

As required by the repository language policy, migrate the materially changed model registry and validation modules to
Deno-native TypeScript without changing existing Pi provider, credential, migration, or OpenAI-compatible discovery
behavior.

## Approach

Migrate `model-registry.js` and `model-validation.js` to `.ts`, preserving their public exports while replacing broad
JSDoc shapes with named TypeScript interfaces/unions. Add a narrow TypeScript execution guard module so the legacy
`session.js` composition layer only wires a typed check before `createAgentSession()`; child 02 can replace that guard
with backend dispatch without changing how backend identity is represented.

Represent Claude CLI models as a registry-owned overlay, not as a Pi provider registration. The overlay lists four
recommended aliases and synthesizes a Claude CLI model descriptor when `find("claude-cli", selector)` receives any
non-empty selector. Claude descriptors carry explicit `executionBackend: "claude-cli"`, external-CLI authentication, and
deferred execution-preflight health metadata. Existing Pi models continue to default to `executionBackend: "pi"` without
mutating Pi's model objects.

Keep `getAvailable()` as the existing runnable-now view used by onboarding and API-auth status. Add
`RunWieldModelRegistry.isSelectable(model)` and `getSelectable()` for references that can be configured: Claude CLI
descriptors are selectable but are excluded from `getAvailable()` until child 02 supplies runtime health. Strict
template resolution and resume retention use `isSelectable()`; Vision Fallback and API auth continue using
`hasConfiguredAuth()`. `hasConfiguredAuth()` and `getProviderAuthStatus("claude-cli")` explicitly remain false even if
someone writes a misleading `claude-cli` entry to Pi auth/config files. Claude's descriptor metadata—not `/auth`
status—states `authenticationKind: "external-cli"` and `healthCheck: "execution-preflight"`.

Explicit `/model claude-cli/<selector>` uses the selectable view, attempts normal activation, and handles the typed
backend-unavailable rejection by persisting the default as deferred while leaving the active Session model/agent pair
unchanged. `SessionRuntime.reconfigureSessionModel()` must roll back its user-model override if activation fails, so no
Claude projection can coexist with the previous Pi root agent. The command reports “saved for later,” never “switched.”
Onboarding continues to use runnable models, but when the selected default is deferred it explains that the Claude CLI
backend—not an API key—is missing and offers normal model setup/recovery.

Existing `provider/id` parsing remains generic and strict; only the `claude-cli` facade gains pass-through model
synthesis, so unknown non-Claude providers/models still fail.

Do not add a backend-specific settings schema. Protect existing settings precedence/preservation tests because arbitrary
provider-qualified strings already survive `SettingsManager` writes.

## Files to Modify

- `src/shared/models/model-registry.js` → `src/shared/models/model-registry.ts` — preserve the
  registry/runtime/credential facade while adding typed Claude CLI descriptors, four advertised aliases, pass-through
  selector lookup, execution-backend/readiness metadata, `isSelectable()`, and `getSelectable()`. Keep `getAvailable()`,
  `hasConfiguredAuth()`, and provider auth status runnable/API-auth-specific; do not register Claude CLI with Pi.
- `src/shared/models/model-validation.js` → `src/shared/models/model-validation.ts` — preserve strict `provider/id`
  parsing/formatting and make `resolveTemplateModel()` consume the registry's selection-eligibility contract rather than
  equating selection with API auth.
- `src/shared/models/model-execution.ts` — add a typed `UnsupportedModelExecutionBackendError` and pre-runtime guard
  that accepts Pi-backed models and rejects `executionBackend: "claude-cli"` with a stable, actionable error before Pi
  session construction; expose a predicate usable by command/onboarding adapters without parsing error text.
- `src/shared/session/session.js` — update real `.ts` imports, use `isSelectable()` when resolving configured
  candidates, record selection eligibility separately from API-auth state, and invoke the imported execution guard
  before image fallback, tool assembly, or `createAgentSession()`. Keep the guard logic out of this legacy composition
  module.
- `src/shared/session/session-runtime.js` — update the registry import and make `reconfigureSessionModel()`
  transactional: capture the previous user override, tentatively activate the requested model, commit/emit only on
  success, and restore the exact previous override when activation rejects. Preserve managed/deferred Session behavior.
- `src/shared/session/session-runtime.test.js` — prove failed model activation retains the previous active model, root
  agent, handler, and projection and emits no false `MODEL_CHANGED` event.
- `src/shared/models/claude-cli-models.test.ts` — add focused registry/validation tests for aliases, arbitrary non-empty
  pass-through selectors, metadata, listing/deduplication, API-auth false versus selectable true, and strict
  unknown-provider failures.
- `src/shared/session/claude-cli-model-selection.test.ts` — prove configured Claude activation reaches the explicit
  pre-runtime rejection before Pi construction and that explicit selection persists a deferred default while the current
  Session's active model/agent pair remains unchanged, using real settings/session fixtures rather than a new dependency
  bag.
- `src/shared/models/model-registry.test.js` and `src/shared/models/model-validation.test.js` — point imports and source
  characterization at `.ts`, adapt typed test doubles, and retain all current migration, provider availability, auth,
  parser, and discovery coverage.
- `src/cmd/models/index.ts` and `src/cmd/models/index.test.ts` — consume a typed activation result and report deferred
  Claude defaults as saved/not active rather than claiming the Session switched; retain existing Pi selection behavior.
- `src/cmd/models/getArgumentCompletions.js` — use `getSelectable()` so completions advertise `sonnet`, `opus`, `haiku`,
  and `fable` while no-argument Pi selector behavior remains child 05 scope.
- `src/cmd/resume/index.ts` and `src/cmd/resume/index.test.ts` — retain persisted Claude references via `isSelectable()`
  instead of discarding them for lacking API auth; activation still reaches the pre-runtime guard.
- `src/cmd/auth/index.ts` and `src/cmd/auth/index.test.ts` — update imports and prove Claude CLI is not presented as an
  API-key/OAuth provider or counted as runnable before backend health exists.
- `src/ui/tui/chat-session.js` and `src/ui/tui/chat-session.test.js` — update imports and make `setActiveModel()` catch
  only the typed unsupported-backend error, persist provider/model as a deferred default, return a deferred activation
  result, and leave unrelated activation failures unpersisted and visible.
- `src/ui/tui/model-welcome.js` and `src/ui/tui/model-welcome.test.js` — require the selected default to be runnable,
  not merely returned by `find()`, so Claude aliases do not bypass onboarding; explain backend unavailability rather
  than missing API auth while preserving Pi login/model recovery.
- `src/shared/session/image-attachments.js`, `src/cmd/init/index.ts`, `src/tools/see-image.js`,
  `src/tools/delegate-agent.js`, `src/ui/tui/ui-api-overrides.ts`, and other direct importers enumerated by the
  repository search — update live imports to the real `.ts` extensions. Vision Fallback deliberately remains
  API-auth/runnable-only.
- `scripts/language-policy-baseline.json` — remove the retired `model-registry.js` and `model-validation.js` entries
  without changing unrelated in-flight baseline work.

`src/shared/settings.js` is intentionally not modified: preservation is value-agnostic and already owns `agents`,
`activeModelPreset`, and `modelPresets` as whole custom settings.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/models/model-registry.js` — retain `RunWieldModelRegistry`, `find`, `getAll`, `getAvailable`,
  `hasConfiguredAuth`, credential storage, model config migration, and OpenAI-compatible discovery behavior while typing
  the module.
- `src/shared/models/model-validation.js` — retain `parseProviderModel`, `formatProviderModelReference`, and
  `resolveTemplateModel`; do not create a Claude-specific reference parser.
- `src/shared/settings.js` — rely on the existing `RUNWIELD_CUSTOM_SETTING_KEYS` preservation of complete `agents`,
  `activeModelPreset`, and `modelPresets` values; no new key is justified.
- `src/shared/session/__tests__/agent-model-override.test.js` and `src/shared/settings.test.js` — retain the existing
  precedence and round-trip guarantees for arbitrary model-reference strings.
- `src/shared/session/__tests__/session-tools-policy.test.js` and existing process-global/Git/settings fixtures — reuse
  real composition setup for the pre-Pi rejection test; do not add `__deps`/`__testDeps` to model or Session modules.
- `plans/migrate-custom-tools-to-typescript.md` — follow the established Deno-native migration pattern: real `.ts`
  import extensions, no compatibility shims, JavaScript callers may remain JavaScript when only wiring/imports change,
  and the language-policy baseline only tightens.

## Implementation Steps

- [ ] The implementation preserves the landed model-runtime config-directory refresh, root Session rebuild state,
      runtime import migrations, associated regressions, and tightened language-policy baseline; none of that
      overlapping work is restored, overwritten, or loosened during this change.
- [ ] `src/shared/models/model-registry.ts` and `model-validation.ts` are the only live implementations of those
      modules; the `.js` files and compatibility shims do not exist, every live import uses the real `.ts` extension,
      and the two retired paths are absent from `scripts/language-policy-baseline.json`.
- [ ] The migrated modules preserve all current public exports and contain named concrete types rather than explicit
      `any`, explicit `unknown`, bare `object`, `@ts-ignore`, or `@ts-nocheck`; `deno task check` and the
      language-policy ratchet pass.
- [ ] `getAll()`/`getSelectable()` advertise exactly the Claude CLI aliases `sonnet`, `opus`, `haiku`, and `fable` once
      each, with stable display names and exact metadata `executionBackend: "claude-cli"`,
      `authenticationKind: "external-cli"`, and `healthCheck: "execution-preflight"`; `getAvailable()` excludes them
      until a later child establishes runnable health.
- [ ] `find("claude-cli", selector)` and strict template resolution synthesize the same typed Claude CLI descriptor for
      every non-empty selector, including pinned/full IDs and future CLI-recognized aliases; empty/malformed provider
      references still fail, and unknown non-Claude providers/models are not synthesized.
- [ ] `RunWieldModelRegistry.isSelectable()` returns true for Claude CLI descriptors without asserting API credentials;
      `hasConfiguredAuth()` and `getProviderAuthStatus("claude-cli").configured` remain false even if Pi auth/config
      files contain a `claude-cli` entry, while existing Pi behavior is unchanged.
- [ ] Completions use `getSelectable()` and advertise the four aliases; onboarding, auth status, and runnable model
      counts continue using `getAvailable()` and neither skip Pi setup nor describe Claude CLI as API-key/OAuth
      configured.
- [ ] A configured `agents.<agent>.model`, active model preset, model preset, template model, or persisted Session model
      retains `claude-cli/<selector>` through `isSelectable()` and resolves its backend metadata, while Vision Fallback
      remains gated by real API auth and existing settings precedence/whole-value preservation remains unchanged.
- [ ] Explicit `/model claude-cli/<selector>` persists the provider/model as a deferred default, reports that the Claude
      backend is not installed and the current Session is unchanged, and does not emit a false successful-switch
      message.
- [ ] Failed `SessionRuntime.reconfigureSessionModel()` activation restores the exact previous user override and keeps
      the previous root agent/handler/projection; no `MODEL_CHANGED` event is emitted. Successful Pi reconfiguration
      retains its current commit/event behavior.
- [ ] Before child 02, any fresh/configured attempt to build a Pi `AgentSession` from a Claude CLI descriptor fails with
      a typed stable error explaining that the Claude CLI execution backend is not installed yet; the guard runs before
      image fallback/tool setup and before `createAgentSession()`, and no fake Pi provider or stream implementation
      exists.
- [ ] Existing Pi-backed model selection remains the default and retains runtime snapshots, built-in/configured models,
      API-key/OAuth status, credential migration, custom provider registration, OpenAI-compatible `/models` discovery,
      image fallback, and `createAgentSession()` behavior.
- [ ] No test-only seam is added. New tests use the real registry, temporary RunWield config/settings, and existing
      process-global locking/fixtures where Session composition is exercised.

## Verification Plan

- Automated focused behavior:
  `deno run -A scripts/run-tests.js src/shared/models/claude-cli-models.test.ts src/shared/session/claude-cli-model-selection.test.ts src/shared/models/model-registry.test.js src/shared/models/model-validation.test.js src/shared/session/session-runtime.test.js`
- Automated settings/selection/onboarding regression:
  `deno run -A scripts/run-tests.js src/shared/settings.test.js src/shared/session/__tests__/agent-model-override.test.js src/cmd/models/index.test.ts src/cmd/auth/index.test.ts src/cmd/resume/index.test.ts src/ui/tui/chat-session.test.js src/ui/tui/model-welcome.test.js`
- Automated migration/policy: `deno task check && deno task language-policy:check && deno task seams:check`
- Full regression gate: `deno task ci`
- Manual: none for this intermediate child. Real Claude CLI health/auth and execution are intentionally deferred to
  children 02 and 04.
- Expected: completions/selectable registry listings and strict configured-model paths recognize advertised and
  pass-through `claude-cli/*` references and expose Claude backend metadata. Explicit `/model claude-cli/<selector>`
  saves a deferred default, states that the current Session did not switch, and does not ask for an API key. The
  Pi-owned interactive selector remains child 05 scope.
- Expected: onboarding still requires a runnable model, resume retains Claude references, and attempted Claude
  activation before child 02 produces the explicit backend-not-installed error without instantiating Pi `AgentSession`,
  changing the active Session model/agent pair, emitting a false model-change event, or mutating workflow state.
- Behavior protected afterwards: all current Pi-backed selection, auth, discovery, image capability, credential
  storage/migration, and settings precedence/preservation behavior remains covered.
- Behavior expected to stop existing: `claude-cli/*` no longer fails as an unknown Pi provider/model, disappears from
  selectable registry/completion results, or is discarded on resume; it never appears runnable, claims API auth,
  silently keeps a stale Pi agent under Claude state, or falls through into Pi execution.
- Glossary: no `docs/domain-language.md` update is made in this child because it does not yet implement Claude
  execution. The child 02 runtime slice (or later user-facing slice) must add stable Execution Backend language when
  that behavior becomes true.

### Objective-Failing Checks

- `OC1` —
  `deno run -A scripts/run-tests.js src/shared/models/claude-cli-models.test.ts src/shared/session/claude-cli-model-selection.test.ts`
  — both focused files are absent on the baseline; passing requires Claude selector registration/metadata, deferred
  selection persistence, transactional rollback, and the pre-Pi execution rejection to exist as tested behavior.
- `OC2` —
  `bash -lc 'set -e; test -s src/shared/models/model-registry.ts; test -s src/shared/models/model-validation.ts; test ! -e src/shared/models/model-registry.js; test ! -e src/shared/models/model-validation.js; ! grep -qE "src/shared/models/model-(registry|validation)\.js" scripts/language-policy-baseline.json; deno task language-policy:check; deno task check'`
  — fails on the current JavaScript-only shape and proves the touched production modules, imports, baseline, and type
  graph were actually migrated rather than wrapped or aliased.
- `OC3` —
  `bash -lc 'set -e; grep -q "getSelectable" src/cmd/models/getArgumentCompletions.js; grep -q "isSelectable" src/cmd/resume/index.ts; deno run -A scripts/run-tests.js src/cmd/models/index.test.ts src/cmd/auth/index.test.ts src/cmd/resume/index.test.ts src/shared/session/session-runtime.test.js src/ui/tui/model-welcome.test.js'`
  — fails on the current auth-only completion/resume paths and can pass only when deferred selection integrates without
  breaking runnable onboarding, API-auth status, resume, or transactional model reconfiguration.

## Execution Policy

- Engineer executes autonomously; there is no browser-rendered outcome or dev server.
- The formerly overlapping model-registry, Session runtime, tests, and language-policy changes are now landed and form
  the execution baseline. If those files become dirty again before execution, do not discard that work; return for
  baseline review or land it first.
- This child must leave the repository safe and testable on its own. Child 02 is not allowed to be an implicit
  same-commit requirement for preventing Claude descriptors from reaching Pi.

## Edge Cases & Considerations

- **CLI-authoritative selectors:** RunWield deliberately does not maintain a full Claude model catalog. The four aliases
  are discoverable defaults; other non-empty selectors are pass-through and may fail only when a later child invokes
  Claude CLI. Preserve the exact selector string after outer whitespace normalization.
- **Intermediate safety:** selecting a Claude model before child 02 saves a deferred default but does not alter the
  current Session. The message/error must say the execution backend is unavailable/not installed, not “missing API key,”
  “switched,” or an unknown Pi provider error.
- **Selectability versus availability:** `isSelectable`/`getSelectable` mean a reference can be configured and retained;
  `getAvailable` means runnable now and must remain false for Claude in this child. Neither proves that `claude` exists,
  is authenticated, or accepts the selector. Child 04 owns real executable/auth/version health checks.
- **No Pi facade:** do not call `ModelRuntime.registerProvider`, invent a Pi stream API, put Claude in `models.json`, or
  return fake API credentials for `claude-cli`.
- **Hydration/deduplication:** build `getSelectable()` from runnable Pi models plus the Claude overlay and deduplicate
  by provider/id in cold and hydrated states. Do not inject Claude aliases into `getAvailable()`.
- **Non-Claude strictness:** pass-through synthesis applies only to provider `claude-cli`; malformed references and
  unknown provider/model pairs retain current failures and discovery behavior.
- **Transactional selection:** activation failure must restore whether a user override existed as well as its prior
  provider/model values; do not restore only the display projection. Deferred persistence happens only for the typed
  unsupported-Claude error, not arbitrary rebuild failures.
- **Onboarding/auth:** Claude aliases must not make no-model onboarding green, appear in API login/logout choices, or
  inflate runnable model counts. A deferred selected default may be explained in recovery copy without implementing the
  child 05 interactive selector/caveat UI.
- **Image behavior:** Claude descriptors must not accidentally claim Pi image support or trigger Vision Fallback work
  before the pre-runtime guard. Child 02 decides how Claude CLI receives images/files.
- **Settings scope:** do not reserve a top-level `claudeCli` key or runtime option schema. Existing custom setting
  containers already preserve model strings, and runtime options should be designed by the child that consumes them.
- **Migration risk:** `model-registry.js` is roughly 729 lines and central to auth/discovery. Preserve behavior through
  concrete types and focused tests; do not use `any`, `unknown`, bare `object`, compatibility `.js` re-exports, or broad
  casts to make the migration compile.
- **Seams:** do not add `__deps`/`__testDeps`. Model registration and the pre-Pi guard are RunWield-owned behavior and
  must be tested through real fixtures.
