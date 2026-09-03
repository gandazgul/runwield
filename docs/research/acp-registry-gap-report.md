# ACP Registry gap report

_Last updated: 2026-09-02_

## Summary

RunWield now closes the registry's mandatory authentication gap in source: `initialize` advertises Terminal Auth to ACP
Clients that declare support. The method launches `wld login`, which stores credentials in `~/.wld/auth.json`, requires
a usable default model, exits, and lets the ACP Client reconnect to `wld acp`.

RunWield is not listed in the ACP Registry yet. Registry metadata, the 16×16 monochrome icon, public release asset URLs,
and the upstream registry pull request are still publication work.

## Current Terminal Auth behavior

- Capable Clients receive one Terminal Auth method: `runwield-terminal-login`.
- The method has `type: "terminal"` and `args: ["login"]`.
- RunWield also accepts the registry validator's temporary `_meta["terminal-auth"]` capability marker.
- Clients without Terminal Auth support receive `authMethods: []`.
- The unrelated ACP terminal capability does not enable Terminal Auth.
- `session/new` returns ACP error `-32000` when no usable default model is configured.

## Remaining ACP and registry gaps

- Protocol-version negotiation still needs the ACP v1 conformance hardening Plan.
- Stdio MCP server support still depends on the Core MCP Plan.
- Cancellation settlement ordering still needs ACP hardening.
- `usage_update.cost` still needs the ACP cost object shape.
- `agentInfo.version` still uses the static MVP marker until the hardening Plan replaces it with the generated version.
- The ACP SDK baseline still needs the planned upgrade.
- Registry publication still needs `agent.json`, a compliant icon, versioned tarballs, checksums, and an upstream PR.
