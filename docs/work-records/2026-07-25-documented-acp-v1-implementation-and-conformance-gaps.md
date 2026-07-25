---
kind: "work_record"
recordId: "78d6fbf0-ca56-4484-9b84-03d6651b8836"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-25T22:09:16.058Z"
provenance:
    sourcePlans:
        - "dbf5f2be-8d95-4ae3-9a24-29ffe39ed5bc"
---

# Documented ACP v1 Implementation and Conformance Gaps

## Summary

Added `docs/acp-implementation-details.md` and linked it from `docs/index.md`, creating a source-backed ACP v1 audit
reference for RunWield’s current stdio/SessionRuntime adapter. The record establishes that RunWield is an ACP v1 stdio
MVP, not yet fully v1-conformant, and gives future planning a prioritized map of required and optional protocol gaps.
Verification passed with docs format checks and full `deno task ci`.

## Deferred Work

Implementation fixes remain out of scope for this documentation task, including protocol-version negotiation, reloadable
session ids, stdio MCP server support, cancellation settlement ordering, and valid `usage_update.cost` shape.

## Future Planning Notes

Use the new ACP implementation reference as the baseline for future conformance-fix Plans; current repository ACP tests
prove MVP behavior, not official ACP v1 conformance.

## Execution Report

- Added `docs/acp-implementation-details.md` with ACP v1 audit baseline, current stdio/SessionRuntime implementation
  details, method/capability/event/interaction mappings, and prioritized required vs optional gaps.
- Updated `docs/index.md` to link the new ACP reference under RunWield reference docs.
- Key documented verdict: RunWield is an ACP v1 stdio MVP, not fully v1-conformant; required gaps include version
  negotiation, reloadable session ids, stdio MCP server support, cancellation settlement ordering, and
  `usage_update.cost` shape.
- Verified docs formatting with `deno fmt --check docs/acp-implementation-details.md docs/index.md`.
- Verified full repository with `deno task ci` (passed; only expected warnings about missing `.env`, chunk size, and
  package/build-script notices).
