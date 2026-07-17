---
kind: "work_record"
recordId: "87480129-bfe6-4cb0-8eef-2e02f81f7baa"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:49:47.122Z"
provenance:
    sourcePlans:
        - "378500c6-a9b2-44e3-a9a8-a15601ac9fdf"
---

# Reorganized UI Source Tree

## Summary

Moved terminal UI modules from `src/shared/ui/` to `src/ui/tui/` and theme modules to `src/ui/theme/`. Updated
repository imports, JSDoc paths, build resources, tests, and documentation while preserving existing behavior. Removed
the obsolete `src/shared/ui/` directory and verified the refactor with the full CI suite.
