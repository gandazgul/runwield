---
kind: "work_record"
recordId: "58f46331-e694-49c9-b00d-fbc19bd1d6b8"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-27T22:09:39.780Z"
provenance:
    sourcePlans:
        - "64f0a075-fa48-4ea8-a5f9-88062541a25f"
---

# Stable update notice and CLI update command

## Summary

Added a shared Stable release update-check module, non-blocking TUI boot update notice, and CLI-only `wld update`
command with `wld upgrade` alias that installs through the tag-pinned public installer while preserving
install-directory behavior. Registry, command, shared update-check, and TUI behavior are covered by tests, and
verification passed with format, lint, targeted tests, and full `deno task ci`.

## Deviations from Plan

Live interactive TUI and installer checks were not run against a real installer; automated source-order, registry, and
fake-installer tests covered those behaviors instead.

## Future Planning Notes

Keep update availability as cached release metadata recomputed against the current binary version, not as durable
availability truth, and continue keeping installer execution CLI-only rather than exposing it as a slash command.
