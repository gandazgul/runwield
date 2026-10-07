---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/attached/claude/"
    - "src/shared/attached/"
    - "src/cmd/attached/"
    - "src/shared/session/agent-assets.ts"
    - "src/shared/session/agents.js"
    - "src/shared/workflow/"
    - "src/tools/"
    - "docs/domain-language.md"
    - "docs/prd/runwield-connect-prd.md"
executionAgent: "engineer"
createdAt: "2026-10-07T03:22:46.056Z"
status: "draft"
origin: "internal"
parentPlan: "attached-mode-claude-feature-preview"
order: 2
dependencies:
    - "01-activate-and-resume-an-attached-workflow"
targetBranch: "epic/attached-mode-claude-feature-preview"
planId: "5c2b4b19-93fa-4522-9ad2-caf82cbc131f"
---

# Plan one FEATURE request inside Claude Code

## Context

This child builds on the durable activation/action protocol from `01-activate-and-resume-an-attached-workflow`. The
first-party Claude adapter must let a user plan one FEATURE request without changing ordinary Claude behavior or making
Core-owned model calls.

Owning capabilities are [explicit activation](../../prd/runwield-connect-prd.md#explicit-per-request-activation),
[host-owned reasoning](../../prd/runwield-connect-prd.md#host-owned-reasoning),
[compatibility](../../prd/runwield-connect-prd.md#compatibility-and-honest-availability), and
[lazy setup](../../prd/runwield-connect-prd.md#lazy-project-setup-and-recovery). Core retains
[Plan lifecycle](../../prd/runwield-core-prd.md#plan-lifecycle) authority. Browser approval is the next child.

## Objective

A user can install a local development Preview plugin through Claude's first-party mechanism and explicitly invoke one
FEATURE request in a trusted, uninitialized Git repository. Claude performs Triage and planning, then submits a
canonical Plan while deterministic controls prevent implementation mutation.

## Approach

Generate Claude-native Skills and role definitions from effective project/home/bundled policy. Bundled asset extraction
alone is not the layered resolver. Share role/outcome semantics with existing Core carriers where needed; do not copy
prompts into the plugin.

Hooks call canonical CLI operations for deterministic enforcement. Model-facing tools use the thin MCP adapter. Both are
inert outside the bound workflow. Version support is based on black-box host evidence, not documentation alone. Other
routing intents remain unsupported or explicitly disclosed targets.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/attached/claude/` — plugin manifest, explicit command, hooks, materializer, host roles, and supported-version
  fixtures.
- `src/shared/attached/` and `src/cmd/attached/` — capability preflight, FEATURE Plan submission, and shared operation
  extensions.
- `src/shared/session/agent-assets.ts`, `agents.js`, and related resource resolution — effective layered role/Skill
  inputs without executing Session machinery.
- `src/shared/workflow/` and `src/tools/` — shared Triage/Plan outcome contracts and guarded lifecycle calls where
  needed.
- `docs/domain-language.md` and owning Connect/Core capability scenarios — Role Contract, Compatibility Matrix, and
  delivered planning behavior.

## Reuse Opportunities

- `loadAgentDef` and existing layered Skill resolution — project, home, bundled precedence.
- Plan Store and lifecycle services — canonical submission and normalized metadata.
- Existing preflight diagnostics and baseline inspection — honest local setup and defense in depth.

## Implementation Steps

1. The plugin's disclosed install flow obtains or verifies compatible local Core without separate model credentials or a
   RunWield account. Explicit invocation binds only its request and previews material repository-local setup; full
   initialization is not required.
2. Generated Claude assets preserve effective layered policy and carry Core/contract/content version evidence. Preflight
   rejects stale assets or unsupported hook/worker capabilities before consequential transitions and gives an
   update/regeneration path.
3. Claude-owned Triage and Planner turns consume shared role contracts and submit bounded structured outcomes through
   canonical operations. Core validates routing and persists the canonical FEATURE Plan without accepting host prose as
   a lifecycle event.
4. The Planning Gate distinguishes allowed canonical planning artifacts from implementation mutation. Supported host
   controls deny editing and mutating command paths before execution; baseline inspection detects unexpected changes
   without being represented as the hard gate.
5. Installed but inactive hooks cause no context injection, tool denial, repository inspection, or workflow mutation for
   ordinary prompts and unrelated host conversations. Planning cancellation preserves resumable state rather than
   closing delivery.
6. `docs/domain-language.md` defines Role Contract and Compatibility Matrix, avoided aliases, and relationships to
   canonical assets and tested capability evidence. Owning PRD scenarios record tested planning/activation behavior and
   keep incomplete review/execution/release outcomes as targets.

## Verification Plan

- Automated: run `deno run -A scripts/run-tests.js src/attached/claude/ src/shared/attached/ src/cmd/attached/` for
  generated-asset, operation, and adapter tests; Planner identifies the targeted existing layered-resolution tests.
- Black-box: for each claimed development Preview host version, install the plugin, send an ordinary prompt, activate a
  FEATURE request, exercise edit and mutating-command denial, and submit a canonical Plan. Test a second unrelated
  conversation and cancellation/restart during planning.
- Automated: change project/home overrides and Core/contract versions; prove regeneration respects precedence and stale
  materializations fail preflight. Include host-conversation sentinel text that must not enter RunWield artifacts.
- Manual pair check: exercise the host-visible install/trust flow and first request in an uninitialized trusted Git
  repository. Show allowed planning artifacts and denied implementation mutation.
- Expected: no separate credentials, fake HostedSession, Core model call, or copied role policy. Unsupported mutation
  paths are named and cause refusal or an already-approved explicit fallback, never a false enforcement claim.
- Confirm glossary and implemented contracts land together; keep full Preview availability unclaimed until the
  integrated release child.

## Edge Cases & Considerations

- Planning needs canonical Plan writes; the gate must not deny its own bounded artifact operations or broadly allow
  arbitrary repository mutation.
- Plugin installation must not loosen host permissions. Trust remains explicit through Claude's normal controls.
- Exact host versions and install commands are not established by repository source; Planner must derive them from fresh
  supported-version evidence.
- Worker handoff feasibility must be checked early, but implementation behavior belongs to child 4. Stable and
  later-host claims are out of scope.
