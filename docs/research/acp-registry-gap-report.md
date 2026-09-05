# ACP Registry gap report

_Last updated: 2026-09-03_

## Summary

RunWield now closes the registry's mandatory authentication gap in source: `initialize` advertises Terminal Auth to ACP
Clients that declare support. The method launches `wld login`, which stores credentials in `~/.wld/auth.json`, requires
a usable default model, exits, and lets the ACP Client reconnect to `wld acp`.

RunWield also implements Core-owned stdio MCP tool support for ACP `session/new` and `session/load` requests. This
closes the prior gap where RunWield rejected every non-empty ACP `mcpServers` list. The implementation is limited to
stdio MCP tools. HTTP, SSE, ACP-carried MCP transport, MCP prompts, MCP resources, and dynamic tool-list updates are
still not supported.

RunWield is not listed in the ACP Registry yet. Registry metadata, the 16×16 monochrome icon, public release asset URLs,
and the upstream registry pull request are still publication work.

Do not use this report as a claim that RunWield supports optional ACP features it does not advertise. See
`docs/acp-implementation-details.md` for the current ACP behavior and limits.

## Current Terminal Auth behavior

- Capable Clients receive one Terminal Auth method: `runwield-terminal-login`.
- The method has `type: "terminal"` and `args: ["login"]`.
- RunWield also accepts the registry validator's temporary `_meta["terminal-auth"]` capability marker.
- Clients without Terminal Auth support receive `authMethods: []`.
- The unrelated ACP terminal capability does not enable Terminal Auth.
- `session/new` returns ACP error `-32000` when no usable default model is configured.

## Remaining ACP and registry gaps

- Registry publication still needs `agent.json`, a compliant icon, versioned tarballs, checksums, and an upstream PR.
- HTTP/SSE MCP transports, MCP prompts, MCP resources, optional Session methods, additional roots, and exact
  context-capacity reporting remain out of scope.

## Closed ACP hardening gaps

- `initialize` now returns supported `protocolVersion: 1` instead of echoing unsupported versions.
- Cancellation now waits for Runtime settlement and pending updates before the prompt response returns `cancelled`.
- `usage_update.cost` now uses `{ amount, currency: "USD" }`, with `amount` as the cumulative ACP Session cost.
- `agentInfo.version` now comes from the generated RunWield version.
- The ACP SDK baseline is now `@agentclientprotocol/sdk` 1.4.0.
