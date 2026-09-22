---
kind: "work_record"
recordId: "943b37ec-5a4d-4a50-a51a-8998620cc916"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-22T12:34:44.772Z"
provenance:
    sourcePlans:
        - "0ae18c01-9dd4-44c8-96d5-dcf816f23c47"
---

# Delivered ACP reasoning and exact context reporting

## Summary

RunWield’s ACP adapter now exposes and persists the standard `thought_level` selector, applies it to the next provider
turn, and refreshes configuration after model or Agent changes. ACP `usage_update` now reports exact Runtime context
usage and capacity, suppresses unknown values, and preserves cumulative cost. Focused ACP tests, type checks, and lint
passed; mutation checks confirmed coverage. Repository CI passed except for nine pre-existing broken links in untouched
usage-dashboard plan files.

## Deferred Work

Manual WebStorm checks remain pending because WebStorm was unavailable. Registry PR 580 must remain at v0.10.0 until
release archives containing this work exist; then update its version, archive URLs, and checksums and run registry
release checks.

## Future Planning Notes

Treat Runtime context usage as the sole source for ACP context indicators. Never substitute per-message token counts or
fabricate capacity. Keep registry metadata tied to published release assets rather than the local build version.
