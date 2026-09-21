---
kind: "work_record"
recordId: "fcaed561-4d2c-487c-afb2-6f6871f53aee"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-21T20:51:23.715Z"
provenance:
    sourcePlans:
        - "e8781b46-e323-405e-b6b0-f3d75ed79355"
---

# Unified local Skill discovery and precedence

## Summary

RunWield now uses one Core Skill catalog for listing, model advertising, and invocation. It adds project
`.agents/skills`, applies consistent five-layer precedence and bundled-name protection, supports disabling both external
Skill locations, and prevents Pi from loading a second Skill catalog. Focused tests and required static, seam,
documentation-link, and Skill-sync checks passed.

## Deviations from Plan

The full test suite did not pass: 392 files passed, and one design-system test still failed because it expects
declarations in the import-only `workspace.css`. The same failure occurs on an archived clean baseline, so it is not
caused by this change. Three other initial failures recovered after Workspace was built.

## Future Planning Notes

Keep Skill selection centralized in the Core catalog. Preserve fresh per-project discovery and explicitly disable Pi
Skill loading, including reload, to prevent a second catalog from bypassing Core precedence and exclusions.
