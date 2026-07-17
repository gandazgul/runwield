---
kind: "work_record"
recordId: "d19376ea-2d87-4fff-bc8d-49706ebdfef0"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:49:53.582Z"
provenance:
    sourcePlans:
        - "4e2360fb-4fbc-419d-b79f-a7bcf77baa9e"
---

# Replaced RTK command rewriting with Snip

## Summary

Removed the RTK integration and replaced it with optional Snip-based rewriting for safe, simple agent bash commands.
Added Harns-managed Snip configuration and bundled Deno fmt, lint, and test filters, updated runtime wiring and tests,
removed RTK references, refreshed documentation, and verified the change with the full CI suite.
