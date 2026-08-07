---
kind: "work_record"
recordId: "a264cc8a-3960-42b6-95d6-ef1116da79bc"
status: "approved"
scope: "planned_change"
workKind: "MAINTENANCE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-07T03:49:13.639Z"
provenance:
    sourcePlans:
        - "cef05b40-ce1e-49db-b065-1a2054b3d8e8"
---

# Move Plan Store to docs/plans

## Summary

RunWield now uses `docs/plans/` as the only canonical Plan store. Runtime code, tools, CLI flows, TUI and workflow
surfaces, docs, release guidance, scripts, tests, and tracked Plan files were updated for the clean break. Legacy
`plans/` files are ignored, and no tracked Plan Markdown remains under `plans/`. Workflow Validation passed, including
targeted tests, `deno task test`, and `deno task ci`.

## Deviations from Plan

Implementation also fixed a discovered `plans doctor` root/path bug so active Plans under `docs/plans/` do not
false-report `plan_not_found`.

## Future Planning Notes

Clean-break storage moves need explicit negative tests for the old path and objective filesystem checks, not only
rewritten positive path assertions.
