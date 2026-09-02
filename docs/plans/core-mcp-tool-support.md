---
planId: "b42e8d67-c4cd-4f4a-a498-994e2fd02d93"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
affectedPaths:
    - "src/shared/mcp/"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session.js"
    - "src/acp/server.js"
    - "src/acp/server.test.js"
    - "src/acp/managed-session.integration.test.ts"
    - "deno.json"
    - "docs/mcp.md"
    - "docs/acp-implementation-details.md"
    - "docs/research/acp-registry-gap-report.md"
    - "docs/domain-language.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-09-02T13:20:25-04:00"
status: "implemented"
origin: "internal"
userVerifiedAt: null
targetBranch: "main"
---

# Core MCP Tool Support for ACP and Local Configuration

## Context

WebStorm sends one or more Model Context Protocol (MCP) server definitions when it creates an Agent Client Protocol
(ACP) Session. RunWield currently rejects every non-empty `mcpServers` list, so the WebStorm chat fails before the
Session starts. ACP v1 requires Agents to support stdio MCP servers.

This change must not be a WebStorm-only exception. RunWield Core must own MCP client behavior so the same external tools
can be used in TUI, Workspace, and ACP Sessions. Users also need dedicated global and project-local MCP configuration
without adding executable commands or secrets to `settings.json`.

The working tree had unrelated in-progress prompt-queue changes in `src/acp/server.js` and
`src/acp/managed-session.integration.test.ts` when this Plan was written. Implementation must preserve that behavior and
integrate with the final source rather than restoring the older ACP prompt path.

## Objective

Add Core-owned stdio MCP tool support that:

- connects to servers from `~/.wld/mcp.json`, an optional safe project-local `.wld/mcp.json`, and ACP `session/new` /
  `session/load` requests;
- exposes discovered MCP tools to every root Agent in the RunWield Session for both Pi and Claude CLI Execution
  Backends;
- keeps the tools available through prompts, Agent changes, managed-session dehydration, reload, queued messages, and
  Runtime Session replacement;
- cancels calls and closes MCP clients and child processes with the owning Session;
- warns and continues when one valid server cannot start or initialize; and
- removes the current WebStorm initialization failure without claiming support for MCP prompts, resources, HTTP, SSE, or
  unstable ACP-carried MCP transport.

## Approach

Introduce a Core MCP client module with a small interface: resolve trusted configuration, connect stdio servers, expose
namespaced RunWield `ToolDefinition` objects, report redacted warnings, and close all owned clients. `SessionRuntime`
attaches this tool collection to a `HostedSession`. A managed Session can dehydrate its model and transcript objects
without closing MCP clients. Final Session close owns complete cleanup.

```text
~/.wld/mcp.json -----------+
project/.wld/mcp.json -----+--> Core MCP config resolver --> stdio MCP clients
ACP session mcpServers ----+                                  |
                                                               v
ACP / TUI / Workspace --> SessionRuntime --> HostedSession tool collection
                                            |
                                            +--> root Pi Agent tools
                                            +--> Claude CLI Bridged Tools
```

The Core configuration file uses the common named-server form:

```jsonc
{
    "mcpServers": {
        "project-tools": {
            "command": "my-mcp-server",
            "args": ["--stdio"],
            "env": { "TOKEN": "secret-value" }
        },
        "disabled-global-server": {
            "enabled": false
        }
    }
}
```

Global and project files use JSONC. A complete project server replaces the global server with the same name;
`enabled: false` disables that global server for the Project. Fields from two server definitions are never merged. The
ACP adapter validates the ACP array form, including the required absolute executable path, then passes typed,
request-scoped definitions to Core without persisting them. ACP definitions are additive. A duplicate ACP server name or
a name already present after file resolution is skipped with a redacted warning rather than silently replacing local
configuration.

MCP tool definitions do not reliably declare whether they read or mutate state. By user decision, all connected tools
are trusted and available to every root Agent. Tool aliases use a deterministic `mcp_<server>_<tool>` namespace,
normalization, length limit, and stable collision suffix so they cannot replace built-in or workflow tool names. The
original server name, tool name, and description remain visible in the tool description. Bounded delegated Agents and
isolated subagents do not inherit this root tool collection; their existing tool ceilings remain effective.

A server that cannot spawn, complete MCP initialization, or list tools produces a visible Session warning that names the
server and failure stage but never includes command arguments, environment values, headers, or raw protocol payloads.
Other servers and the Session continue. Structurally invalid ACP parameters still fail with ACP invalid-parameters
semantics. Invalid file configuration starts no servers from that file and reports the file and field without printing
secret values.

The main option set aside is implementing MCP only inside `src/acp/`. That is smaller, but it duplicates tool and
lifecycle behavior and does not support normal RunWield Sessions or backend parity.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/mcp/` — new TypeScript configuration, stdio client-pool, tool-wrapper, result conversion, and real fixture
  coverage. Core types must not import ACP types.
- A focused helper under `src/shared/mcp/` — resolve `~/.wld/mcp.json` and the primary-checkout project file without
  adding an `mcpServers` setting, changing `src/shared/settings.js`, or caching `HOME` / cwd at module load.
- `src/shared/session/hosted-session.js` — own the active root MCP tool collection and its source definitions across
  managed-session dehydration, with explicit transfer and final disposal behavior.
- `src/shared/session/session-runtime.js` — load and refresh configured servers at safe Session boundaries, accept
  request-scoped definitions, preserve them through queued prompts and both Runtime Session replacement paths, emit
  warnings, and settle cleanup.
- `src/shared/session/session.js` and `src/shared/session/agent-switching.js` as needed — compose the root MCP tools
  into each top-level Agent build and handoff without adding them to delegated or isolated subagent tool ceilings.
  Preserve the existing Claude CLI caller-tool bridge.
- `src/acp/server.js` and `src/acp/session-map.js` as needed — replace the blanket rejection with stdio-specific ACP
  validation, pass temporary definitions into Core, and keep ACP mapping/close behavior consistent when Runtime Session
  ids change.
- `src/acp/server.test.js`, `src/acp/managed-session.integration.test.ts`, and shared Session tests — prove ACP setup,
  managed queue delivery, Agent changes, Runtime replacement, failure warnings, cancellation, and cleanup through real
  protocol and Session boundaries.
- `deno.json` / `deno.lock` only if resolution changes — expose the MCP SDK stdio client import while retaining the
  existing pinned MCP dependency.
- `docs/mcp.md` and `src/skills/runwield/SETTINGS.md` — document file shape, source precedence, reload behavior, trust,
  plaintext secret handling, failure warnings, supported scope, and examples.
- `docs/acp-implementation-details.md` and `docs/research/acp-registry-gap-report.md` — mark required stdio MCP handling
  as implemented only to the behavior proven here; retain the other ACP conformance gaps.
- `docs/domain-language.md` — define the Core-owned MCP Server Configuration and distinguish client-provided tools from
  RunWield Custom Tools and Claude CLI Bridged Tools.
- Project Git-safety helpers and tests under `src/shared/` — verify that project `.wld/mcp.json` is local-only and
  cannot enter staging, publication, or linked execution-worktree configuration paths.

`config.schema.json` and `docs/settings.md` do not gain MCP fields because `settings.json` is deliberately not an MCP
configuration owner. A separate published schema is not required for this first file-based version.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `@modelcontextprotocol/sdk/client` and `@modelcontextprotocol/sdk/client/stdio` — use the existing MCP SDK `Client`
  and `StdioClientTransport` instead of implementing JSON-RPC framing or child-process supervision.
- `src/shared/session/session.js` — reuse `ToolDefinition` composition for Pi and `composeClaudeCliBridgedTools()` for
  Claude CLI backend parity.
- `src/shared/session/backends/claude-cli/mcp-bridge.ts` — preserve the existing route from caller-supplied
  `ToolDefinition` objects into a Claude CLI turn; do not build a second Claude-only route.
- `src/shared/collaboration/secrets.js` — reuse its owner-only permission checks and redacted-error practices where they
  apply to manually managed `mcp.json` files; this change does not need a RunWield writer for those files.
- `src/shared/primary-checkout.ts` and real Git fixtures — resolve project-local configuration from the primary checkout
  and prove tracked/ignored state with Git rather than path-string assumptions.
- `src/shared/git-test-fixture.ts` and `src/testing/process-global-lock.js` — use real repositories and protect tests
  that change `HOME`, `PATH`, or cwd.
- `src/shared/session/session-runtime-events.js` — use semantic warning/status events so TUI, Workspace, and ACP clients
  receive the same safe failure notice.

## Implementation Steps

- `src/shared/mcp/` defines a Core-owned stdio server configuration and result type with named properties. It accepts
  the named JSONC file form and the already-validated request-scoped form without importing ACP modules or using
  TypeScript `any`, `unknown`, or `object`.
- The MCP configuration resolver reads `~/.wld/mcp.json` plus only the primary checkout's `.wld/mcp.json`. Project
  definitions replace complete global entries by name, `enabled: false` disables a global entry, and request-scoped ACP
  definitions are additive. No source writes ACP definitions or environment values to settings, Session manifests,
  transcripts, metrics, or debug logs.
- A project `.wld/mcp.json` contributes servers only when it is a regular non-symlink file, is not tracked/staged/
  intent-to-add, and `git check-ignore --no-index` proves an effective ignore rule. An unsafe file produces a redacted
  warning and starts no project server. Linked execution and repair worktrees resolve to the primary checkout instead of
  reading their own MCP file. Ordinary Session startup does not edit `.gitignore`; documentation gives the exact
  `.wld/mcp.json` ignore entry.
- Global and accepted project MCP files are read as JSONC and require owner-only mode `0600` where the platform exposes
  POSIX modes. A group- or world-accessible file is skipped with an actionable `chmod 600` warning. This change does not
  create or rewrite either file. Permission, parse, and schema errors identify only the file, server, and invalid field;
  they never print secret values.
- The stdio MCP pool uses the pinned SDK to start each valid server with the Session project root as child cwd, complete
  protocol initialization, follow pagination when listing tools, and expose one deterministic namespaced
  `ToolDefinition` for every listed tool. File-config commands can be absolute paths or executable names resolved by the
  child process environment; ACP commands remain absolute as required by ACP v1.
- Each remote tool wrapper forwards validated arguments and the active abort signal to `Client.callTool()`. It preserves
  MCP `isError`, text, images, and structured data in the RunWield tool-result shape; resource links or embedded
  resource content that the active Execution Backend cannot represent become bounded descriptive text rather than being
  dropped or executed. Unsupported audio is reported as unsupported content without exposing raw binary data.
- Tool aliases always start with `mcp_`, fit provider tool-name limits, remain stable for the same source/server/tool,
  and use a stable suffix when normalization or truncation would collide. They cannot shadow RunWield built-ins,
  workflow tools, or each other. The model-facing description identifies the original server and tool.
- A `HostedSession` retains the connected pool and root tool definitions across model disposal and managed-session
  dehydration. Root Agent activation, reload, user Agent changes, workflow handoffs, queued-message hydration, and model
  changes all receive the same current tool collection. Bounded delegated and isolated subagent builds do not.
- TUI's new empty Session remains side-effect free: configured MCP processes do not start until the first submitted
  message activates the Session. ACP `session/new` / `session/load` completes available server connections before it
  returns so WebStorm can prompt against the advertised tools immediately.
- `/reload` re-reads global and project `mcp.json` at a safe idle boundary, retains in-memory ACP definitions, starts a
  replacement pool, rebuilds the root Agent with the successful tool set, and then closes the prior pool. A failed
  server remains omitted with a warning and does not remove successful servers.
- `replaceSessionForExecutionFollowUp()` and Epic continuation transfer the MCP pool and request-scoped source metadata
  to the replacement `HostedSession` before root Agent activation. The old Session does not close the transferred pool,
  and the stable ACP mapping continues to reach the new Runtime Session.
- Cancellation reaches in-flight MCP tool calls through their abort signal. `closeSessionWhenIdle()`, ordinary Session
  close, ACP `session/close`, failed Session construction, and ACP connection shutdown close all MCP clients/transports
  and leave no child process. One close failure cannot prevent other clients or Session resources from closing.
- `validateNewSessionParams()` and load validation accept valid stdio ACP entries, reject HTTP/SSE/ACP transport entries
  with a precise unsupported-transport invalid-parameters error, and enforce the ACP schema without echoing commands,
  arguments, or environment values. The initialize response does not advertise optional MCP transport capabilities.
- Behavioral tests use a real stdio MCP fixture that advertises a uniquely identifiable tool, records calls, returns a
  unique result, supports cancellation, and reports shutdown. The tests prove the tool reaches a root Pi Agent and a
  Claude CLI root Agent, survives Agent handoff/dehydration/replacement, and disappears from bounded subagents.
- Documentation states that MCP servers are trusted code, server declarations do not reliably distinguish reads from
  writes, and configured tools can bypass normal root-Agent tool restrictions. It also states that delegated Agent mode
  ceilings remain enforced, project files must stay ignored and untracked, environment values are plaintext secrets,
  only stdio tools are supported, and individual server failure warns and continues.
- `docs/domain-language.md` defines MCP Server Configuration and its stable relationships to a Session, root Agent,
  Custom Tool, ACP, and Bridged Tool. The ACP audit and registry gap report stop listing stdio MCP handling as missing
  but do not claim full ACP v1 conformance.

## Approval Confirmation

No Work Record is proposed for supersession. The prior ACP audit remains useful because this change resolves only its
stdio MCP finding; its other conformance findings remain active.

## Verification Plan

- Automated: run
  `deno run -A scripts/run-tests.js src/shared/mcp/ src/shared/session/session-runtime.test.js src/shared/session/agent-switching.test.js src/shared/session/__tests__/session-tools-policy.test.js src/shared/session/claude-cli-execution.test.ts src/acp/server.test.js src/acp/managed-session.integration.test.ts src/acp/session-map.test.js`.
- Automated behavior proof: the real fixture's side-effect log must show the exact arguments from a model-issued tool
  call and its returned marker must enter the Agent turn. This test must fail if the MCP module is replaced by a static
  tool list, a pass-through wrapper, or a fake success response.
- Automated lifecycle proof: fixture process ids or shutdown markers must prove no process remains after normal close,
  failed setup, cancellation, Runtime Session replacement followed by close, and ACP connection loss. A test that only
  asserts the JavaScript map is empty is insufficient.
- Automated ownership proof: a two-Session integration test starts two distinct real fixture children for the same
  Project, directly disposes one owning `HostedSession`, proves only that child's shutdown, and then invokes the other
  Session's original child successfully. The same test proves managed dehydration keeps the pool alive and final owner
  disposal closes it. This must fail for a module-global or ACP-map-owned pool even when keyed by Session id.
- Automated configuration proof: real Git fixtures cover global/project whole-server replacement, disable entries,
  ignored-untracked acceptance, tracked/staged/intent-to-add/symlink/non-ignored refusal, primary-checkout resolution,
  execution-worktree exclusion, redacted errors, and POSIX `0600` behavior. Tests that change `HOME`, `PATH`, or cwd run
  under `withProcessGlobalTestLock`.
- Automated policy proof: after Router-to-Planner or Planner-to-Engineer handoff, the root Agent can still invoke the
  fixture MCP tool. A bounded read delegate and isolated validation/review subagent cannot see or invoke it. Existing
  RunWield workflow tools remain authoritative and cannot be shadowed by a colliding remote tool name.
- Automated backend proof: one Pi test calls the external MCP fixture through the real `ToolDefinition`; one Claude CLI
  test traverses Claude's existing loopback bridge and then the external MCP client before asserting the fixture result.
- Automated ACP proof: a black-box `session/new` and `session/load` with a valid stdio definition succeed and invoke the
  fixture tool. HTTP/SSE/ACP entries return redacted invalid-parameters errors. One dead stdio server emits a warning
  but does not prevent prompt handling through another working server.
- Automated regression: preserve existing empty-`mcpServers` behavior, Session replay, queued ACP prompt behavior,
  cancellation settlement, interaction mapping, and all current close semantics. The old behavior expected to stop is
  rejection of every non-empty MCP server list.
- Automated architecture and full suite: run `deno task seams:check`, `deno task check`, `deno task ci`, and
  `deno task compile`. The compile check proves the Node-compatible SDK stdio transport and its static import are
  present in the standalone binary.
- Manual TUI: add a harmless fixture server to `~/.wld/mcp.json`, start `wld`, verify no fixture process starts before
  the first message, invoke the remote tool after the first message, switch Agent, invoke it again, run `/reload`, and
  confirm the visible warning/continued Session behavior after making one server unavailable.
- Manual WebStorm: configure the RunWield ACP command as `wld acp` with JetBrains MCP tools enabled, open a new chat,
  and verify the Session initializes without `RunWield ACP MVP does not support MCP servers yet`. Ask the active Agent
  to use one identifiable WebStorm tool, confirm its real IDE result, cause one normal RunWield Agent handoff, and use
  an IDE tool again. Close the chat and confirm RunWield and MCP child processes exit.
- Documentation: validate links and confirm `docs/mcp.md`, the bundled RunWield settings skill, the glossary, and both
  ACP reports describe the same implemented file paths, precedence, trust limitation, supported transport, and failure
  behavior.

## Edge Cases & Considerations

- **Trusted-tool weakness:** an MCP schema cannot reliably prove that a tool is read-only. Root Agents receive all tools
  by explicit user decision. Documentation must not describe normal root-Agent tool lists as a security boundary when
  MCP is enabled.
- **Delegation authority:** external tools must not leak into bounded delegated Agents or isolated reviewers. Their mode
  and tool ceilings remain authoritative even though the parent root Agent has trusted MCP tools.
- **Project command safety:** an ignored file can still be created by software other than the user. The untracked,
  ignored, regular-file, primary-root, and permission checks reduce accidental repository delivery but do not sandbox a
  trusted server. HTTP/SSE support would add data-disclosure and authentication risks and remains out of scope.
- **Secrets:** `env` values are plaintext. Redaction covers RunWield errors and logs, but a trusted MCP child receives
  those values and controls its own logging. Users must protect both files and rotate a secret if a project MCP file was
  ever tracked or published.
- **Name and schema drift:** tool list-change notifications are not applied during an active turn in this version. The
  initial list is the Session truth until `/reload` or Session restart. Unknown future ACP transports fail clearly
  rather than being treated as stdio.
- **Partial availability:** valid server startup failures warn and continue. Invalid file syntax or shape starts no
  servers from that file so a partially parsed secret-bearing configuration cannot produce surprising commands.
- **Ordering:** a replacement pool becomes authoritative only after all connection attempts settle. Old clients remain
  valid until the root Agent rebuild succeeds, then close. A failed rebuild retains the old pool and reports the reload
  failure.
- **Result size and content:** preserve useful text/image/structured results while using existing tool-result and
  context safeguards. Do not fetch resource links automatically or place binary audio/resource data into prompts.
- **No migration:** MCP-in-settings support has not shipped, so there is no `settings.json` migration. Existing
  `models.json` and `auth.json` migration behavior is unchanged.
- **Current dirty source:** execution must reconcile with the existing ACP queued-prompt changes. Deleting those changes
  to simplify MCP integration is not an acceptable resolution.
