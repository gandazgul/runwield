---
kind: "work_record"
recordId: "eadeaf2f-0c2e-409f-8233-724d929d8e04"
status: "approved"
scope: "planned_change"
workKind: "MAINTENANCE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-24T17:08:32.253Z"
provenance:
    sourcePlans:
        - "eca2ba1e-32ca-4e5a-bed5-dc579b81e0a2"
---

# Pi 0.87 compatibility upgrade

## Summary

Upgraded all four direct Pi packages to 0.87 and adapted provider context, temperature retries, stream termination,
workflow result reading, and compiled release behavior. Named Invocation expansions, including images, now persist as
append-only context edits; legacy repair is idempotent and limited to the active branch. Cache warming remains off
without changing stored settings. Core requirements and ADR-015 were updated. Focused checks, compilation, compiled ACP
continuation, and image-resize smoke tests passed; a transient auth-fixture failure passed on rerun. Full RunWield
validation remains pending.

## Deferred Work

The owner deferred a user-facing cache-warming setting. Full RunWield validation remains pending.

## Future Planning Notes

The cache-warming override is specific to Pi 0.87; verify upstream behavior before replacing it with a user setting.
Preserve canonical saved context edits and branch-scoped legacy repair in future Pi upgrades.
