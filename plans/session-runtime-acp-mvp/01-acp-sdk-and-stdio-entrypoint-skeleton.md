---
planId: "e3f93824-ab20-4129-8891-016f2ec7de69"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add a minimal ACP stdio mode that proves official SDK compatibility, CLI routing, initialize handling, protocol errors, and stdout/stderr separation before deeper runtime refactors."
affectedPaths:
    - "docs/prd/runwield-acp-session-host-PRD.md"
    - "deno.json"
    - "src/cli.js"
    - "src/cmd/registry.js"
    - "src/cmd/acp/index.js"
    - "src/acp/server.js"
    - "src/acp/protocol-smoke.test.js"
    - "src/acp/server.test.js"
frontend: false
createdAt: "2026-07-07T02:13:46.227Z"
updatedAt: "2026-07-07T02:13:46.227Z"
status: "draft"
origin: "internal"
parentPlan: "session-runtime-acp-mvp"
order: 1
dependencies:
    []
---

# ACP SDK and Stdio Entrypoint Skeleton

## Context

RunWield needs an ACP v1 stdio adapter, but the official ACP SDK, Deno check/compile behavior, CLI mode routing, and
stdout purity should be proven before moving core session orchestration. The Epic decision is that ACP will be a sibling
adapter over a later `SessionRuntime`, not a wrapper around TUI internals. This first slice intentionally stays small:
it creates the ACP entrypoint and minimal protocol skeleton without implementing real RunWield prompt execution.

## Objective

Add a minimal `wld acp` and `wld --mode acp` mode that speaks JSON-RPC/ACP over stdio using the official SDK if
feasible. The skeleton should handle `initialize`, advertise only safe MVP capabilities, return deterministic errors for
unimplemented session methods, and ensure protocol output is never polluted by diagnostics.

## Approach

Start by adding the ACP SDK import alias and a project-level smoke test that imports the SDK, constructs the selected
NDJSON stream abstraction, and proves it passes Deno check/test in this repository. Then add a CLI command entrypoint
and global `--mode acp` routing that starts an ACP server module. The initial server should be intentionally minimal:
initialize succeeds, server metadata/capabilities are stable, unsupported methods fail as structured JSON-RPC/ACP
errors, and all diagnostics go to stderr.

If the direct `npm:@agentclientprotocol/sdk` import fails under repository check/test/compile constraints, document that
result in the implementation notes and use a small compiled wrapper package pattern analogous to the existing
Plannotator compiled package rather than hand-rolling protocol semantics.

## Files to Modify

- `docs/prd/runwield-acp-session-host-PRD.md` — update Slice 2 wording to identify this work as
  `SessionRuntime + ACP MVP`, with ACP as a sibling adapter rather than a TUI wrapper.
- `deno.json` — add the ACP SDK import alias if direct SDK compatibility is proven, or wire the selected wrapper alias
  if direct import is not viable.
- `src/cli.js` — parse `--mode acp` before normal command dispatch and route it to the ACP command without starting the
  TUI.
- `src/cmd/registry.js` — register an `acp` CLI-only command and help metadata; do not expose it as a slash command.
- `src/cmd/acp/index.js` — create the ACP command entrypoint, reserve stdout for protocol messages, send
  diagnostics/fatal startup messages to stderr, and perform shutdown cleanup.
- `src/acp/server.js` — create the minimal ACP server skeleton with initialize handling and structured
  unsupported-method behavior.
- `src/acp/protocol-smoke.test.js` — prove SDK import and selected stream construction work in Deno.
- `src/acp/server.test.js` — cover initialize, unimplemented session method errors, and stdout/stderr separation at the
  skeleton level.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/cli.js` — reuse the existing command dispatch shape and global flag parsing style.
- `src/cmd/registry.js` — reuse existing command metadata and command surface handling.
- `src/cmd/*/index.js` — follow existing command entrypoint patterns for argument handling and tests.
- `@agentclientprotocol/sdk` — prefer official protocol constants, agent-side helpers, request registration, and NDJSON
  stream utilities.
- `@gandazgul/plannotator-pi-extension-compiled` alias pattern in `deno.json` — use as the fallback shape if direct ACP
  SDK import is not compatible.

## Implementation Steps

- [ ] Step 1: Add a focused SDK compatibility smoke test that imports the selected ACP SDK path and constructs the
      stream/server primitives needed by RunWield under Deno.
- [ ] Step 2: Add the ACP SDK import alias to `deno.json` only after the smoke test proves the import path.
- [ ] Step 3: Create `src/acp/server.js` with a minimal ACP server factory/start function that handles `initialize` and
      returns structured errors for unimplemented session methods.
- [ ] Step 4: Create `src/cmd/acp/index.js` to start the ACP server on stdin/stdout, send diagnostics to stderr, and
      close resources on process shutdown.
- [ ] Step 5: Register `acp` as a CLI-only command in `src/cmd/registry.js` with help text and no slash command surface.
- [ ] Step 6: Update `src/cli.js` so `wld --mode acp` routes to the same command as `wld acp` before unknown-option
      handling.
- [ ] Step 7: Add server/CLI tests covering initialize, unsupported method errors, global mode routing, and stdout
      purity.
- [ ] Step 8: Update PRD roadmap terminology to reflect `SessionRuntime + ACP MVP` and sibling adapter intent.

## Verification Plan

- Automated: run `deno task check` to prove the SDK import and new ACP modules type-check under pure JavaScript/JSDoc
  rules.
- Automated: run `deno test -A src/acp/protocol-smoke.test.js src/acp/server.test.js`.
- Automated: run any focused CLI/registry tests affected by `src/cli.js` or `src/cmd/registry.js` changes.
- Automated: run `deno run ci` and fix all issues.
- Manual: run `wld acp`, send an ACP `initialize` JSON-RPC message over stdin, and verify a valid response appears on
  stdout.
- Manual: run `wld --mode acp` and verify it behaves identically to `wld acp`.
- Manual: verify diagnostic startup messages, if any, are written to stderr and not stdout.
- Expected result: ACP mode starts without launching the TUI, initialize succeeds, unimplemented methods fail cleanly,
  and stdout contains protocol frames only.

## Edge Cases & Considerations

- Direct SDK import may work in an isolated probe but fail under repository `deno check` or compile; prove it before
  relying on it.
- Any accidental `console.log` in ACP mode can corrupt clients; prefer explicit protocol writer/stdout isolation and
  stderr diagnostics.
- Do not import `src/shared/interactive/chat-session.js` or TUI modules from ACP server code.
- Advertise only capabilities implemented in this skeleton. Real session capabilities come in later slices.
- Keep all executable code pure JavaScript with JSDoc typedefs; do not add TypeScript files or TypeScript syntax.
