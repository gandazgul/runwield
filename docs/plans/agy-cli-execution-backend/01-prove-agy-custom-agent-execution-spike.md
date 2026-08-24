---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Prove the risky Antigravity control boundary first: RunWield can materialize a namespaced global custom agent, select it with `agy -p --agent`, parse stream JSON, and reject prompt-packing as the authority model. This slice is a guarded spike, not user-selectable backend parity."
affectedPaths:
    - "src/shared/session/backends/agy-cli/"
    - "src/shared/session/backends/claude-cli/"
    - "src/shared/session/backends/agy-cli/agy-cli-backend.test.ts"
    - "src/shared/session/session-transcript-projection.test.js"
executionAgent: "engineer"
createdAt: "2026-08-23T20:02:05.445Z"
updatedAt: "2026-08-23T20:02:05.445Z"
status: "draft"
origin: "internal"
parentPlan: "agy-cli-execution-backend"
order: 1
dependencies:
    []
planId: "1993bfd8-b3fa-40e2-8647-f6400ce73e92"
---

# Prove Agy Custom Agent Execution Spike

## Context

The Epic found that `agy -p --output-format stream-json` can run headless, but ordinary user-text prompt packing is not
a safe substitute for a system instruction boundary. The useful path is a user-approved global Antigravity custom agent
under `~/.gemini/config/agents/<name>/agent.md`, selected with `agy -p --agent <name>`. Workspace-local agents did not
load on `agy 1.1.19`, and `init.agent` is not enough proof that an agent exists.

This child proves that boundary before RunWield exposes `agy-cli` as a normal selectable model backend. It may add
narrow Antigravity backend modules and tests, but it must not yet make `agy-cli/*` generally selectable for normal
users.

## Objective

Create a guarded Antigravity execution spike that proves RunWield can materialize a namespaced global custom agent,
preflight that it is real, run `agy -p --agent <agent> --output-format stream-json`, parse the assistant stream, and
keep RunWield as transcript and workflow authority. The spike must also prove that conflicting user text does not become
the source of role authority.

## Approach

Add the first `src/shared/session/backends/agy-cli/` module family around custom-agent files, command construction,
stream parsing, and a fake subprocess fixture. Keep the interface private to the spike until later children register the
backend and route normal Sessions through it.

The key proof is this path:

```text
RunWield Agent Definition
  -> namespaced global Antigravity custom agent
  -> agy -p --agent <agent> --output-format stream-json
  -> parsed assistant text/result
  -> RunWield-owned transcript/status evidence
```

The main option set aside is injecting the RunWield Agent Definition as ordinary user text. That is simpler, but it
weakens the system/user boundary that RunWield promises for Execution Backends.

## Files to Modify

- `src/shared/session/backends/agy-cli/` — add the private spike modules for custom-agent materialization, preflight,
  command construction, stream parsing, and fixture-driven execution.
- `src/shared/session/backends/claude-cli/` — reuse architecture patterns only where they are truly backend-neutral; do
  not force Antigravity event shapes into Claude modules.
- `src/shared/session/backends/agy-cli/agy-cli-backend.test.ts` — cover sandboxed home writes, preflight, stream
  parsing, conflicting prompt evidence, and safe cleanup.
- `src/shared/session/session-transcript-projection.test.js` — add only the replay evidence needed for any
  spike-specific status entries.

## Reuse Opportunities

- `src/shared/session/backends/claude-cli/command.ts` — reuse the command-builder style, not the Claude flags.
- `src/shared/session/backends/claude-cli/process.ts` — reuse the subprocess boundary pattern if it stays a genuine
  external-process boundary.
- `src/shared/session/backends/claude-cli/stream-parser.ts` — reuse test style, not the parser schema.
- `scripts/run-tests.js` — use the sandboxed test runner so Antigravity home writes never touch the developer's real
  home.

## Implementation Steps

- [ ] `src/shared/session/backends/agy-cli/` owns non-empty spike modules for namespaced custom-agent materialization,
      real-behavior preflight, command construction, and Antigravity stream parsing.
- [ ] Custom-agent tests use a sandboxed home and prove RunWield writes only namespaced `runwield-*` agent files, does
      not silently overwrite unrelated content, and can detect missing or drifted definitions.
- [ ] Stream parser tests cover `init`, `step_update.text_delta`, tool-step metadata as display-only data, terminal
      `result`, malformed JSON, and empty output.
- [ ] The spike proves behavior through fixtures and, where available, a manual live `agy` command; it does not trust
      the streamed `init.agent` field alone.
- [ ] No production path treats final assistant prose, sentinel text, or user-text prompt packing as workflow authority.

## Verification Plan

- Automated: `deno run -A scripts/run-tests.js src/shared/session/backends/agy-cli/agy-cli-backend.test.ts`
- Automated: run any transcript projection tests changed by this slice through `scripts/run-tests.js`.
- Automated: `deno task seams:check` if the slice introduces a subprocess or filesystem boundary.
- Manual: on a machine with authenticated `agy`, run the spike with a temporary global custom agent and confirm the
  marker instruction survives a conflicting user prompt.
- Expected result: the child proves the Antigravity control boundary without making `agy-cli/*` a normal selectable
  backend yet.

## Edge Cases & Considerations

- Global Antigravity config is user-owned. This slice must ask before live writes and must sandbox all automated tests.
- Workspace-local custom agents are not reliable yet and must not be the architecture basis.
- `agy` documentation and installed behavior can diverge; this slice must verify behavior, not version text only.
- No new testing-only seams are allowed for RunWield-owned lifecycle machinery.
