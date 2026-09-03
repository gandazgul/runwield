---
kind: "work_record"
recordId: "3e723bb2-cbc2-47b7-a6f9-739bd6fe0cf9"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-03T00:58:46.039Z"
provenance:
    sourcePlans:
        - "b42e8d67-c4cd-4f4a-a498-994e2fd02d93"
---

# Core stdio MCP support

## Summary

RunWield now has Core-owned stdio MCP support for global, project, and ACP-provided server definitions. MCP tools load
into root Agent sessions for Pi and Claude CLI, survive reloads and Session replacement, and shut down with Session
lifecycle. ACP now accepts valid stdio MCP servers and rejects unsupported transports with safe errors. Documentation
and tests were added for configuration, trust limits, ACP behavior, and lifecycle handling.

## Deviations from Plan

`deno task ci` and standalone `deno task test` timed out during their test phases, but targeted MCP, ACP, and Session
suites passed along with `deno task check`, `deno task seams:check`, `deno task compile`, and `deno fmt --check`.

## Future Planning Notes

Future MCP work can build on `src/shared/mcp/` as the Core ownership point. The ACP audit remains useful because this
change resolves stdio MCP handling only; other ACP conformance gaps still need separate planning.
