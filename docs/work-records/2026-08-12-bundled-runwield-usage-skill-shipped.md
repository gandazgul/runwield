---
kind: "work_record"
recordId: "ee97e725-15ec-418d-b77a-0d21fb836063"
status: "approved"
scope: "planned_change"
workKind: "DOCUMENTATION"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-12T14:31:54.359Z"
provenance:
    sourcePlans:
        - "49566e81-b105-4637-a0c7-1a465c6752b6"
---

# Bundled RunWield usage skill shipped

## Summary

Added the model-invoked `runwield` skill under `src/skills/runwield/` with concise user-facing guidance for commands,
Plans, customization, and settings. The work also added docs cross-links in `docs/index.md` and `docs/customization.md`.
RunWield Workflow Validation passed, including `deno task ci`, compile/startup proof, objective coverage checks,
docs-link checks, and line-ceiling checks.

## Deviations from Plan

The outside-repo manual Q&A acceptance test was attempted, but the TUI stopped at the first-run `/init` bootstrap prompt
and timed out before answering. The compiled binary still showed the bundled `runwield` skill in the outside-repo
startup skill list.

## Future Planning Notes

The skill intentionally duplicates a small amount of user-facing meaning from `docs/`; future user-facing docs changes
should check whether `src/skills/runwield/` also needs an update.
