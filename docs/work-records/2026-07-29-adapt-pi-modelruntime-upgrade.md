---
kind: "work_record"
recordId: "bce0330f-dbc0-4a9a-8a82-27b051646984"
status: "approved"
scope: "planned_change"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-29T03:36:45.584Z"
provenance:
    sourcePlans:
        - "adcd3dea-10bd-4f5e-98b9-9477809b315d"
---

# Adapt Pi ModelRuntime Upgrade

## Summary

RunWield was adapted to Pi 0.82.1 model/auth runtime APIs while keeping Earendil dependencies upgradeable. The change
added cached ModelRuntime integration, RunWield model facade compatibility, createAgentSession modelRuntime wiring, TUI
model selector runtime support, streamFunction temperature wrapping, and end-to-end max thinking-level support.
Verification passed with check, targeted session/model tests, lint, full test, and CI tasks.

## Future Planning Notes

Future Pi upgrades should treat ModelRuntime as the public integration boundary, avoid private or removed SDK APIs, and
keep deno.json imports range-based while allowing deno.lock to record resolved package versions.
