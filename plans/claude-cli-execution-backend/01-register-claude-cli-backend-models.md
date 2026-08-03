---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Make `claude-cli/<model-or-alias>` a valid, selectable RunWield model reference without changing execution routing yet. This establishes backend metadata, availability/auth-health semantics, settings preservation, and strict provider/model validation coverage."
affectedPaths:
    - "src/shared/models/model-registry.js"
    - "src/shared/models/model-validation.js"
    - "src/shared/settings.js"
    - "src/shared/models/model-registry.test.js"
    - "src/shared/models/model-validation.test.js"
    - "src/shared/settings.test.js"
executionAgent: "engineer"
createdAt: "2026-08-03T18:20:03.221Z"
updatedAt: "2026-08-03T18:20:03.221Z"
status: "draft"
origin: "internal"
parentPlan: "claude-cli-execution-backend"
order: 1
dependencies:
    []
---

# Register Claude CLI Backend Models

## Context

RunWield currently treats selectable models as Pi-backed provider/model references. The Claude CLI Epic needs
`claude-cli/<alias-or-id>` references to be valid in the same places as existing model selections, while making clear
that `claude-cli` is an execution backend facade rather than an API-key provider that Pi should call directly.

This child establishes the model/provider configuration foundation only. It should not route agent execution to Claude
yet.

## Objective

Add Claude CLI backend models to RunWield model resolution and settings behavior so users and later runtime work can
select references such as `claude-cli/sonnet`, `claude-cli/opus`, `claude-cli/haiku`, or a full Claude model id through
`agents.<agent>.model`, `activeModelPreset`, and `modelPresets` without weakening strict errors for existing providers.

## Approach

Represent `claude-cli` as a narrow RunWield backend/provider facade in the model registry with explicit metadata
indicating that execution is handled by the Claude CLI backend, not by Pi's normal provider runtime. Keep strict
provider/model parsing unchanged in spirit: `provider/id` remains required, unknown non-Claude providers still fail, and
Claude CLI aliases are accepted only through deliberate registry support.

Settings writes should preserve Claude CLI model preset values and any Claude CLI backend settings as RunWield-owned
custom settings, without treating Claude CLI availability as API-key auth.

## Files to Modify

- `src/shared/models/model-registry.js` — expose Claude CLI aliases/full-id handling and backend metadata through the
  RunWield model registry facade.
- `src/shared/models/model-validation.js` — ensure strict provider/model parsing and formatting continues to accept
  `claude-cli/<model-or-alias>` references without relaxing invalid formats.
- `src/shared/settings.js` — preserve Claude CLI backend settings and model preset values through settings writes.
- `src/shared/models/model-registry.test.js` — cover Claude CLI registry availability, auth-health semantics, and non-Pi
  backend metadata.
- `src/shared/models/model-validation.test.js` — cover `claude-cli/<model>` parsing/resolution while preserving existing
  invalid-format behavior.
- `src/shared/settings.test.js` — cover preservation of Claude CLI provider/backend settings and preset values.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/models/model-registry.js` — reuse `RunWieldModelRegistry`, `find`, `getAvailable`, `hasConfiguredAuth`,
  and provider registration conventions where they fit.
- `src/shared/models/model-validation.js` — reuse `parseProviderModel`, `formatProviderModelReference`, and
  `resolveTemplateModel` rather than adding a parallel parser.
- `src/shared/settings.js` — reuse `RUNWIELD_CUSTOM_SETTING_KEYS`, `preserveRunWieldCustomSettingsForWrite`, and merged
  custom setting behavior.
- `src/shared/session/__tests__/agent-model-override.test.js` — preserve the existing settings precedence behavior for
  active model presets and agent model overrides.

## Implementation Steps

- [ ] `claude-cli/sonnet`, `claude-cli/opus`, `claude-cli/haiku`, and deliberate full Claude model ids can be
      represented by the model registry with metadata that identifies Claude CLI backend execution instead of Pi
      provider execution.
- [ ] `resolveTemplateModel` and model lookup accept valid `claude-cli/<model-or-alias>` references only when the Claude
      CLI facade supports them, while invalid strings and unknown non-Claude providers still fail with existing strict
      behavior.
- [ ] Claude CLI availability/auth-health is modeled separately from API-key provider auth so missing API keys do not
      incorrectly block `claude-cli/*` references and missing Claude CLI health can still be surfaced later.
- [ ] Settings writes preserve Claude CLI model preset values and backend settings; existing RunWield-only keys such as
      `modelPresets` continue to survive Pi SettingsManager writes.
- [ ] Existing Pi-backed model registry behavior, provider discovery, stored credentials, and OpenAI-compatible dynamic
      discovery remain protected by tests.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/shared/models/model-registry.test.js src/shared/models/model-validation.test.js src/shared/settings.test.js src/shared/session/__tests__/agent-model-override.test.js`
- Automated: `deno task test` before declaring the child complete if the model registry changes have broader impact.
- Expected: valid `claude-cli/<alias-or-id>` references resolve through RunWield's normal model selection path with
  Claude backend metadata.
- Expected: existing invalid model strings and unknown provider/model references still fail under strict resolution.
- Expected: settings writes preserve Claude CLI-related custom settings and existing model preset settings.
- Behavior protected afterwards: Pi-backed providers remain default, OpenAI-compatible discovery still works, and
  API-key/OAuth credential behavior is unchanged for existing providers.
- Behavior expected to stop existing: Claude CLI model references no longer fail solely because Pi does not expose a
  matching API provider.

### Objective-Failing Checks

- `OC1` —
  `deno run -A scripts/run-tests.js src/shared/models/model-registry.test.js src/shared/models/model-validation.test.js`
  — registry and validation tests prove `claude-cli/<model>` is selectable without relaxing strict provider/model rules.
- `OC2` — `deno run -A scripts/run-tests.js src/shared/settings.test.js` — settings preservation covers Claude CLI
  backend/model-preset values.

## Execution Policy

This child is Engineer-owned and can run autonomously. It has no browser-rendered UI outcome.

## Edge Cases & Considerations

- Do not implement Claude CLI as a normal Pi API provider; later children need backend metadata to branch execution
  safely.
- Do not require an API key for `claude-cli`; Claude Code authentication is external CLI health, not RunWield provider
  auth.
- Preserve strict `provider/id` semantics so supporting Claude CLI does not make malformed model references acceptable.
- Avoid adding `__deps` or `__testDeps` seams to RunWield-owned model/settings modules.
