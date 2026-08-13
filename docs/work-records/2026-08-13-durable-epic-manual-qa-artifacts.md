---
kind: "work_record"
recordId: "525d3fb4-b9a7-4775-a87a-0c4707cdfa77"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-13T03:41:21.395Z"
provenance:
    sourcePlans:
        - "a9cbda90-990e-44cb-a03d-c3bdb2836bac"
---

# Durable Epic Manual QA Artifacts

## Summary

RunWield now stores each verified Epic child’s best-effort Manual QA checklist in a delivered
`docs/plans/<epic>/manual-qa.md` Epic Artifact. The artifact is advisory, excluded from Plan discovery, preserved during
archive and restore, and delivered with child publication without blocking Verified status or Epic continuation.

## Future Planning Notes

Epic Artifacts now have a narrow first implementation: exact `manual-qa.md` files beside Epics, with no Plan Lifecycle
or verification authority. Future artifacts should add dedicated shared-module writers instead of a generic artifact
platform.
