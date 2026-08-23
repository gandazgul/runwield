---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Make `agy-cli/<selector>` a first-class model reference with explicit external CLI backend metadata, while keeping activation safe until the execution path exists. This follows the proven spike and preserves Pi and Claude behavior."
affectedPaths:
    - "src/shared/models/model-registry.ts"
    - "src/shared/models/model-execution.ts"
    - "src/shared/models/"
    - "src/shared/session/session.js"
    - "src/cmd/auth/index.ts"
    - "src/cmd/models/"
    - "src/cmd/resume/"
    - "docs/domain-language.md"
executionAgent: "engineer"
createdAt: "2026-08-23T20:02:05.454Z"
updatedAt: "2026-08-23T20:02:05.454Z"
status: "draft"
origin: "internal"
parentPlan: "agy-cli-execution-backend"
order: 2
dependencies:
    - "01-prove-agy-custom-agent-execution-spike"
---

# Register Agy CLI Backend Models

## Context

After the custom-agent spike is proven, RunWield can represent Antigravity as an Execution Backend candidate. It must
not look like a normal Pi API provider, and it must not require API-key auth through `/login`. Existing Claude CLI
support is the closest precedent: external CLI models can be configured and selected differently from provider-backed Pi
models.

This child establishes model identity and safe selection semantics. It does not need to complete subprocess execution
parity; later children own real turn routing, MCP, failure hardening, and UI.

## Objective

Add `agy-cli/<selector>` as a valid RunWield model reference with explicit `executionBackend: "agy-cli"` metadata. It
should be selectable/configurable without API-key auth, reject unknown backend values before Pi execution, preserve Pi
as the default backend, and preserve existing `claude-cli` behavior.

## Approach

Extend the model registry and backend validation as a registry-owned overlay, not as a Pi provider registration. Treat
Antigravity selectors as external CLI selectors whose final validity belongs to `agy`; registry validation should accept
only non-empty selectors and attach clear backend metadata.

Until child 03 supplies normal execution routing, activation should fail with a clear unsupported or not-yet-runnable
backend error before Pi `AgentSession` construction. That keeps settings/preset work shippable without silently sending
`agy-cli/*` to Pi.

The option set aside is making Antigravity a special per-Agent mode. That would break the existing product model where
the selected model reference determines the Execution Backend.

## Files to Modify

- `src/shared/models/model-registry.ts` — add `agy-cli` selectable descriptors and backend metadata.
- `src/shared/models/model-execution.ts` — permit `agy-cli` as a known backend while preserving pre-runtime rejection
  until execution lands.
- `src/shared/models/` tests — prove model reference parsing, selectable metadata, auth exclusion, and regression safety
  for Pi and Claude.
- `src/shared/session/session.js` — keep backend validation before Pi construction.
- `src/cmd/auth/index.ts` — keep `agy-cli` outside API-key auth flows.
- `src/cmd/models/` and `src/cmd/resume/` — include selectable `agy-cli` references only where model configuration, not
  API auth, is intended.
- `docs/domain-language.md` — update Execution Backend examples or related definitions only when this child makes
  Antigravity a true backend reference.

## Reuse Opportunities

- `src/shared/models/model-registry.ts` — reuse the existing external CLI provider pattern from `claude-cli`.
- `src/shared/models/model-execution.ts` — reuse the backend guard shape so unknown values still fail early.
- `src/cmd/auth/index.ts` — reuse the Claude CLI exclusion from API-key auth flows.
- `src/cmd/models/` — reuse selectable-model listing instead of adding an Antigravity-specific selector.

## Implementation Steps

- [ ] `RunWieldModel.executionBackend` and related backend validation include `"agy-cli"` without weakening
      unknown-backend rejection.
- [ ] `agy-cli/<selector>` references resolve to selectable external CLI descriptors for non-empty selectors and are
      excluded from normal API-key/OAuth auth status.
- [ ] Existing Pi and `claude-cli` model references keep their current behavior and tests.
- [ ] Attempted `agy-cli` execution before child 03 fails clearly before Pi `AgentSession` construction.
- [ ] `docs/domain-language.md` describes Antigravity only to the extent made true by this child, and does not claim
      full execution parity.

## Verification Plan

- Automated: targeted model registry, model execution, auth, model command, resume, and session selection tests through
  `deno run -A scripts/run-tests.js ...`.
- Automated: `deno task check` if model types or imports change.
- Automated: `deno task seams:check` to prove no RunWield-owned machinery seam was added.
- Expected result: users can store or select `agy-cli/<selector>` as a backend reference, but normal execution remains
  safely blocked until the execution child lands.
- Glossary check: confirm `docs/domain-language.md` matches implemented behavior and does not promote unimplemented
  parity.

## Edge Cases & Considerations

- Antigravity selector validity belongs to the `agy` CLI; RunWield should not over-validate beyond non-empty syntax
  without a live preflight.
- Auth failures are external CLI setup problems, not API-provider auth failures.
- Model presets must not gain hidden per-Agent backend semantics.
- Keep all home and cwd access behind existing project helpers.
