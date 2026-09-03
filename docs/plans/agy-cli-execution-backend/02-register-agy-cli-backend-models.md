---
planId: "23d6941e-4c8c-49d9-9a29-5bf772926a44"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/models/model-registry.ts"
    - "src/shared/models/model-execution.ts"
    - "src/shared/models/"
    - "src/shared/session/model-selection.ts"
    - "src/cmd/auth/"
    - "src/cmd/models/"
    - "src/cmd/resume/"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-23T20:02:05.454Z"
status: "ready_for_work"
origin: "internal"
parentPlan: "agy-cli-execution-backend"
order: 2
dependencies:
    - "01-prove-agy-custom-agent-execution-spike"
userVerifiedAt: null
targetBranch: "feature/agy-cli-execution-backend"
---

# Register Agy CLI Backend Models

## Context

Child 01 was already validated and delivered to `main` before this Epic adopted a shared integration branch. Create
`feature/agy-cli-execution-backend` from that updated `main` so it contains child 01. Children 02 through 06 use the
feature branch as their shared target and build on it in dependency order. Publish that branch to `main` only after all
remaining intended children are delivered.

This child represents Antigravity as an Execution Backend candidate without claiming that normal Session turns can use
it yet.

RunWield must not represent Antigravity as a Pi API provider or send users through `/login`. The current Claude CLI
registration is the closest precedent: an external CLI model reference can be valid for settings and direct selection
without API credentials. The important difference is catalog stability. Claude CLI has stable aliases such as `sonnet`
and `opus`; the installed `agy 1.1.24` reports versioned model IDs that can change. The user chose explicit references
instead of a fixed catalog for this child.

## Objective

Make each explicit non-empty `agy-cli/<model-id>` reference valid for configuration and direct model selection. Its
model descriptor identifies `executionBackend: "agy-cli"`, external CLI authentication, and execution-time health
checking. Keep Antigravity out of API authentication and built-in model lists. Until child 03 adds Session routing, an
attempt to activate or execute this backend must fail through the existing typed unsupported-backend path before Pi
AgentSession construction.

## Approach

Keep external CLI provider facts in the model registry. Generalize the current Claude-only classification so registry
lookup, selection, display names, credential access, configured-provider filtering, and auth commands all use one
registry-owned definition of external CLI providers.

Do not run `agy models` from the registry and do not add built-in Antigravity aliases in this child. A direct lookup
synthesizes a descriptor from the exact non-empty model ID:

```text
find("agy-cli", modelId)
  -> RunWieldModel { executionBackend: "agy-cli", authenticationKind: "external-cli" }
  -> isSelectable: true
  -> hasConfiguredAuth: false
  -> API auth methods: no credential
```

Registration and execution support remain separate:

```text
explicit /model agy-cli/<model-id>
  -> registry resolves the model
  -> Session rebuild reaches assertModelExecutionBackendSupported
  -> typed UnsupportedModelExecutionBackendError
  -> current Session stays unchanged; default is saved as deferred
```

`ExecutionBackend` includes `"agy-cli"` because the descriptor is valid, but `assertModelExecutionBackendSupported`
continues to accept only `"pi"` and `"claude-cli"` in this child. Child 03 will make `"agy-cli"` runnable and extend
that support guard when it adds `AgyCliExecutionSession` dispatch. Unknown backend strings must continue to receive the
same typed rejection.

The option set aside is hard-coding the current output of `agy models`. That would populate selection lists sooner, but
the catalog is version-dependent and would become stale. Dynamic discovery and user-facing choices remain in child 06.
Antigravity also remains model-selected rather than a special per-Agent mode.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/models/model-registry.ts` — add the `agy-cli` model namespace and backend type, synthesize descriptors for
  explicit model IDs, and make external CLI classification the source of truth for all registry auth and provider paths.
- `src/shared/models/model-execution.ts` — preserve the distinction between a registered backend value and a backend
  that this release can execute; `agy-cli` remains rejected by the typed support guard until child 03.
- `src/shared/models/agy-cli-models.test.ts` and current model registry/validation tests — prove exact model-ID lookup,
  metadata, no built-in catalog, auth exclusion, configuration validation, and Pi/Claude regressions.
- `src/shared/session/model-selection.ts` and focused Session model-selection tests — preserve deferred selection: a
  failed `agy-cli` rebuild saves the future default without replacing the active Session model.
- `src/cmd/auth/` — exclude all registry-classified external CLI providers from `/login`, `/logout`, and `/status`
  credential surfaces instead of adding another isolated provider-name check.
- `src/cmd/models/` — prove explicit `wld model agy-cli/<model-id>` and `/model` references resolve while no fixed
  Antigravity choices appear in completion or picker lists.
- `src/cmd/resume/` — prove persisted model-reference resolution recognizes explicit `agy-cli` IDs and uses descriptor
  metadata such as the conservative context-window fallback without treating the reference as API-authenticated.

`src/shared/session/session.js` is deliberately not changed: its existing support guard runs before Pi construction and
already provides the required safety behavior. The private modules delivered by child 01 are also not wired into normal
Sessions here. `docs/domain-language.md` remains unchanged because its current definition says an Execution Backend
executes a turn; child 03 will add Antigravity to the glossary only when that behavior becomes true.

## Reuse Opportunities

- `src/shared/models/model-registry.ts#createClaudeCliModelDescriptor` and the Claude provider clauses — generalize the
  proven synthetic-descriptor and external-auth behavior rather than copy each clause for Antigravity.
- `src/shared/models/model-execution.ts#UnsupportedModelExecutionBackendError` — reuse the typed failure consumed by
  deferred model selection; do not add an Antigravity-specific error or a testing seam.
- `src/shared/session/model-selection.ts#setActiveSessionModel` — reuse its transactional rebuild and deferred-default
  behavior so failed activation cannot replace the current model.
- `src/shared/models/model-validation.ts#resolveTemplateModel` — reuse strict `provider/id` validation for settings,
  presets, and Prompt Templates.
- `src/cmd/models/index.ts#runModelsCommand` and `src/cmd/resume/index.ts#getResumeModelSelection` — reuse direct
  registry lookup; do not add Antigravity-specific command syntax.

## Implementation Steps

- [ ] Before execution starts, `feature/agy-cli-execution-backend` exists from current `main` and contains child 01's
      delivered execution commit `3d69b058b80e9cb2b1ccf942d92674e746f501b6` as an ancestor. Child 02 preserves the
      private Antigravity spike modules without exposing them through normal Session dispatch.
- [ ] `RunWieldModel.executionBackend` permits `"agy-cli"`, and registry-owned external CLI provider data covers both
      `claude-cli` and `agy-cli` for display, lookup, configured-provider filtering, credentials, OAuth checks, and API
      key/header access. Misleading `auth.json` or `models.json` entries cannot turn either namespace into a Pi
      provider.
- [ ] `RunWieldModelRegistry.find("agy-cli", modelId)` returns a text-only external CLI descriptor for each trimmed,
      non-empty model ID and returns `undefined` for an empty ID. The descriptor preserves the requested ID, uses
      `executionBackend: "agy-cli"`, `authenticationKind: "external-cli"`, `healthCheck: "execution-preflight"`, and a
      conservative `128000` context window until live discovery owns richer metadata.
- [ ] Explicit Antigravity descriptors satisfy `isSelectable` and strict template/settings validation while
      `hasConfiguredAuth`, provider auth status, OAuth use, API key access, and available/runnable model results all say
      that no Pi API credential or runnable Pi model exists.
- [ ] `getAll`, `getSelectable`, command completions, and picker data contain no built-in `agy-cli` entries in this
      child. Direct `agy-cli/<model-id>` references still resolve. No production registry path invokes the `agy`
      executable or snapshots the output of `agy models`.
- [ ] `/login`, `/logout`, and `/status` omit both external CLI namespaces, including when misleading credentials exist;
      ordinary Pi provider authentication behavior remains unchanged.
- [ ] `assertModelExecutionBackendSupported` still accepts Pi and Claude CLI and throws
      `UnsupportedModelExecutionBackendError` for `agy-cli` and unknown backend values. A real explicit `/model`
      activation attempt therefore keeps the active Session model unchanged, saves `agy-cli/<model-id>` as the deferred
      default, and reports that the current Session did not switch.
- [ ] Direct standalone `wld model agy-cli/<model-id>`, settings, presets, Prompt Templates, and resume model lookup can
      preserve the explicit reference. None can route an Antigravity turn through Pi before child 03.
- [ ] Existing Pi and `claude-cli` registration, authentication, selection, deferred-switch, and execution behavior
      remains protected by tests. No existing behavior is expected to stop.

## Approval Confirmation

No Work Records are proposed for supersession. The completed Claude CLI Epic is a precedent, not work that this Plan
replaces.

## Verification Plan

- Automated registry and validation behavior:
  `deno run -A scripts/run-tests.js src/shared/models/agy-cli-models.test.ts src/shared/models/claude-cli-models.test.ts src/shared/models/model-registry.test.js src/shared/models/model-validation.test.js`
- Automated command, auth, resume, and typed Session rejection behavior:
  `deno run -A scripts/run-tests.js src/cmd/auth/index.test.ts src/cmd/models/index.test.ts src/cmd/resume/index.test.ts src/shared/session/claude-cli-model-selection.test.ts src/shared/session/agy-cli-model-selection.test.ts`
- Automated project gates: `deno task check`, `deno task seams:check`, then `deno task test` because the registry feeds
  settings, commands, TUI selection, Workspace continuation, and Session construction.
- Objective-failing registry test: generate opaque model IDs at test runtime, including UUID-based IDs and IDs at varied
  lengths through at least 4097 characters, and retain only values accepted by the existing `provider/id` parser. For
  every generated value, assert that the real registry preserves the exact ID, strict template validation and direct
  model command handling accept it, metadata identifies the `agy-cli` external backend, API auth is absent, catalog
  lists remain empty, and Session construction receives typed pre-runtime rejection. Semantic Review must also confirm
  that the Antigravity descriptor adds no prefix, vendor, catalog, or length rule beyond trimming, non-empty input, and
  the existing shared parser. A placeholder descriptor, fixture allowlist, hidden length cap, hard-coded current
  catalog, Pi pass-through, or auth-backed registration must fail this proof.
- Deferred-selection test: start a real fixture Session on a Pi-backed model, request
  `/model agy-cli/<fixture-model-id>` through the command/runtime path, and prove the active Session model is unchanged,
  the project default stores the Antigravity reference, and the message says that the current Session did not switch.
- Auth test: seed misleading credentials for both `claude-cli` and `agy-cli`; prove registry credential reads and
  `/login`, `/logout`, and `/status` surfaces omit them while a normal fixture provider remains present.
- Resume test: a persisted `agy-cli/<fixture-model-id>` resolves to that exact override and the conservative context
  window; attempting to construct the unsupported backend still fails before Pi construction.
- Manual in a disposable test home/project: begin with a working Pi model, enter an explicit
  `/model agy-cli/<installed-model-id>`, and confirm the deferred message, unchanged current model, and saved default.
  Open `/login api-key` and `/status` and confirm Antigravity is not offered as an API provider. The `agy` process must
  not run during any check in this child.
- Glossary check: confirm `docs/domain-language.md` still names only runtimes that can execute a turn. Antigravity must
  not be added as an example until child 03 makes it runnable.

## Edge Cases & Considerations

- Antigravity model-ID validity belongs to `agy`. This child checks only trimmed, non-empty syntax; child 03 or child 06
  must perform live executable, authentication, and model availability checks before a turn.
- Registration does not mean runnable. Keep the typed support guard closed until `AgyCliExecutionSession` exists, or a
  selected Antigravity model could fall into Pi or produce a generic error that bypasses deferred selection.
- No fixed catalog means Antigravity is absent from picker and completion results in this child. This is intentional;
  direct references, settings, presets, Prompt Templates, and resume resolution are the supported surfaces.
- Descriptor fields required by the Pi model shape are compatibility metadata only. They must not become API routing or
  credential evidence. The `128000` context window is a conservative planning/compaction fallback, not a claim about
  every Antigravity model.
- Auth failures will be external CLI setup failures when execution exists, not API-provider failures. `/login` must not
  offer a fake repair path.
- Model presets must not gain hidden per-Agent backend semantics. The model reference remains the source of the
  Execution Backend choice.
- Tests must not invoke a real `agy`, read the developer's home, or add a RunWield-owned dependency-injection seam. Use
  the standard test runner and existing runtime/config fixtures.
