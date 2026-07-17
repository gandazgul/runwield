---
kind: "work_record"
recordId: "539309ec-4d97-4968-9982-aea5d5c7a61c"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:43:58.804Z"
provenance:
    sourcePlans:
        - "3728aa70-5e7c-4af5-974c-5bc98127b9db"
---

# Added no-model TUI onboarding

## Summary

Implemented a themed RunWield welcome flow when no usable model is configured. The flow replaces the boot banner, offers
subscription or API-key login, treats Esc as quit, opens model selection after login, persists the selected default, and
initializes the root agent session. Available models bypass onboarding, with automated coverage and CI verification.

## Deviations from Plan

The welcome appears on every no-model startup rather than only the first, so the planned global shown-state persistence
was removed. Failed or cancelled setup re-enables input so users can run recovery commands such as /login, /model, or
/quit instead of leaving submissions fully blocked.

## Future Planning Notes

If once-only onboarding is desired later, reintroduce explicit global welcome-state semantics without reducing access to
recovery commands.
