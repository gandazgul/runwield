# ACP Registry Gap Report

RunWield now implements Core-owned stdio MCP tool support for ACP `session/new` and `session/load` requests.

This closes the prior gap where RunWield rejected every non-empty ACP `mcpServers` list. The implementation is limited
to stdio MCP tools. HTTP, SSE, ACP-carried MCP transport, MCP prompts, MCP resources, and dynamic tool-list updates are
still not supported.

Do not use this report as a full ACP v1 conformance claim. See `docs/acp-implementation-details.md` for remaining ACP
MVP gaps.
