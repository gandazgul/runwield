---
kind: "work_record"
recordId: "f9ada355-3d09-4e27-9c13-1133a3e8b339"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-12T04:19:37.656Z"
provenance:
    sourcePlans:
        - "3847a3dc-3271-42c1-b578-8b9b10e62ef1"
---

# Upgrade Pi 0.84 and Unicode LaTeX rendering

## Summary

Upgraded the Pi package family to ^0.84.0, regenerated the lockfile, preserved RunWield's direct beautiful-mermaid
integration, and kept grok-mermaid transitive only. RunWield now uses Pi's public TuiMainScreen regular-mode API through
typed TUI/keybinding modules, adds Unicode LaTeX rendering coverage through MermaidMarkdown, documents math delimiter
behavior, and preserves Mermaid rendering. Workflow Validation passed, including focused suites, objective checks
OC1–OC6, mutation checks, and full deno task ci.

## Deviations from Plan

The manual deno task cli TUI smoke check was not run because the API session had no interactive terminal. Equivalent
behavior was covered by automated MermaidMarkdown, TUI regular-mode, Golden TUI, and mutation checks.

## Future Planning Notes

Future Pi upgrades should verify public TUI construction mode, extension context shape changes such as scopedModels, and
stream stop-reason compatibility at RunWield integration boundaries.
