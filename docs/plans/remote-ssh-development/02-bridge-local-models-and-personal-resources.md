---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/models/model-registry.ts"
    - "src/shared/session/session.js"
    - "src/shared/session/agents.js"
    - "src/shared/session/agent-assets.js"
    - "src/shared/session/named-invocation.ts"
    - "src/shared/settings.js"
    - "src/shared/session/backends/"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/remote-ssh-prd.md"
executionAgent: "engineer"
createdAt: "2026-09-21T02:05:48.458Z"
status: "draft"
origin: "internal"
parentPlan: "remote-ssh-development"
order: 2
dependencies:
    - "01-establish-the-remote-connection-and-matched-runtime"
targetBranch: "epic/remote-ssh-development"
planId: "a987b089-d345-4a3e-a882-905d86620a43"
---

# Bridge Local Models and Personal Resources

## Context

The remote Agent must use the laptop's personal model authentication and customization without copying credentials or
creating a remote personal profile. The current execution path combines cwd, settings, resources, model resolution, and
persistence, so the split must happen at real ownership boundaries rather than through remote-mode conditions in each
tool.

This slice delivers the model and customization part of the Remote SSH PRD's **Local personal environment** capability
and updates the Core PRD's models/providers and Agent/skill customization requirements. Session persistence remains
owned by a later child.

## Objective

Let the remote Core use named laptop-owned capabilities for model catalog and streaming, personal settings, Agents,
prompts, and complete skill-tree working copies. Preserve remote project overrides and the full supported Pi behavior
without exposing credentials or silently selecting another backend.

## Approach

Extend the connection-scoped personal service from child 01 with explicit capabilities. Keep
`createRunWieldModelRuntime` and provider callbacks on the laptop; send safe model metadata and stream events across the
authenticated bridge. Materialize personal text and resource trees in a separate connection-owned remote area, then
compose them with bundled defaults and remote project overrides at Session construction.

```text
remote Agent -> safe catalog and stream request -> laptop model runtime -> provider
remote loader -> connection resource copy + remote project override
```

Do not copy the credential store or serialize provider functions; that would move authority instead of bridging it.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/models/model-registry.ts` and Pi backend adapters — expose a credential-free catalog/status contract and
  complete streaming/cancellation behavior while runtime and auth stay local.
- `src/shared/session/session.js` and model selection modules — resolve remote Pi models without falling through to
  local remote credentials or unsupported CLI defaults.
- `src/shared/settings.js`, `src/shared/session/agents.js`, and `src/shared/session/agent-assets.js` — merge local
  personal resources with bundled and remote project-owned configuration.
- `src/shared/session/named-invocation.ts` and Pi resource loading — preserve full skill trees and resource-relative
  lookups in both loaders.
- The owning Remote SSH and Core PRD sections — mark only tested model and resource behavior delivered.

## Reuse Opportunities

- `createRunWieldModelRuntime` and `RunWieldCredentialStore` — retain them as laptop-side authorities.
- Existing model selection and compatibility checks — extend them with execution-location facts instead of building a
  second selector.
- `src/shared/session/agent-assets.js` — reuse tree-copy behavior for connection-owned resource copies.
- Pi stream shapes and the proven prototype bridge — reuse the event vocabulary while filling contract gaps found during
  implementation.

## Implementation Steps

- The personal service returns credential-free model metadata and authentication status, while endpoint URLs, headers,
  token refresh, OAuth callbacks, and provider functions execute only on the laptop.
- The remote Pi path preserves stream ordering, terminal events, `.result()`, tool calls, usage, reasoning, images,
  supported options, retry/timeout behavior, summarization, errors, and upstream cancellation for the verified provider
  matrix.
- Remote model selection covers root, saved, preset, delegated, execution, repair, and Guided Review choices; Claude CLI
  and Antigravity CLI fail before a provider request with no model or billing substitution.
- Local personal settings, Agents, and prompts are read through named capabilities; recognized personal mutations
  acknowledge only after the laptop write completes, while project mutations write to the remote primary checkout.
- Complete personal skill directories, including scripts and sibling files, are copied into a connection-owned remote
  resource area with preserved relative paths and normal project override precedence.
- Missing custom CLIs, machine-specific paths, native binaries, or third-party dependencies fail visibly for the
  affected skill without blocking unrelated RunWield core behavior or moving project execution to the laptop.
- Reconnect refreshes resource copies from local authority; normal cleanup removes connection-owned copies and later
  startup repairs stale copies without merging remote edits over local originals.
- The Core and Remote SSH PRD requirements and scenarios distinguish delivered Pi/resource behavior from untested
  providers, custom dependencies, persistence, and workflow behavior.

## Verification Plan

- Automated: add contract tests for catalog redaction, auth refresh ownership, every supported stream event/result,
  cancellation, request identity, lost mutation acknowledgements, and refusal of unsupported CLI backends.
- Automated: add resource tests for nested skill files, sibling reads, both skill loaders, project overrides, personal
  writes, remote project writes, reconnect refresh, and stale-copy cleanup. Run focused tests through
  `deno run -A scripts/run-tests.js <test paths>`.
- Automated: run `deno task seams:check` to ensure only genuine network, process, and model boundaries were added, then
  run `deno task ci`.
- Live: use an actual remote tool result in a second locally authenticated Pi model request. Exercise cancellation and a
  fresh connection. Confirm the provider sees laptop-owned authentication and the laptop sentinel project is untouched.
- Live: run a nested personal skill resource and a custom skill with a missing CLI. Confirm the first resolves relative
  files and the second reports its real dependency failure without disabling core tools.
- Expected: no provider key, credential store, full personal profile, or unsupported model fallback appears remotely;
  PRDs claim only the tested matrix.

## Edge Cases

- A saved unsupported CLI model must stay identifiable so continuation can explain the refusal instead of silently
  selecting a Pi default.
- Provider-specific callbacks cannot cross the bridge as serialized functions; define the request so they execute on
  their owning side.
- A resource tree can contain user secrets because the user placed them there. Do not claim secret detection or
  hostile-host isolation.
- Model cancellation and transport cancellation can race. Settlement must produce one terminal result without leaving a
  live provider request.
