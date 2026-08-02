---
kind: "work_record"
recordId: "bc9715b9-5a63-410b-b690-fc596e9a6ca9"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-01T20:57:51.520Z"
provenance:
    sourcePlans:
        - "6628077e-29f5-4f9c-b993-7d9e13dc7cbf"
---

# Objective checks now run in Mechanical Validation

## Summary

Persisted Plan Objective-Failing Checks as RunWield-owned Front Matter via `plan_written` and integrated their execution
into Workflow Validation's Mechanical Validation phase. Verified Plans can now fail on unmet objective checks, route
unmet checks through the existing repair loop, surface broken checks as Plan defects, and preserve legacy/QUICK_FIX
behavior without checks.

## Deferred Work

The separate baseline proof that checks were red before implementation remains outside this completed change.

## Future Planning Notes

Executable objective checks should be treated as authoritative Plan metadata, not just body prose; future validation
work can reuse the three-state met/unmet/broken contract and the isolated objective-check runner.
