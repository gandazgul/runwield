---
kind: "work_record"
recordId: "a69e9613-2101-45c6-a899-cd89af4912d4"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-05T03:38:41.003Z"
provenance:
    sourcePlans:
        - "2a7837a7-c3da-4ba5-b374-8f5afcfbfb50"
---

# Persistent Workspace Sidebar Navigation

## Summary

RunWield Workspace now keeps the owner sidebar mounted during normal authenticated navigation while only the right-side
Workspace surface changes. Sidebar refresh is event-driven, runs once per completed in-app navigation, preserves
unchanged Project and Session rows, and avoids idle polling. Verification passed with focused Workspace tests, workspace
checks/build, full CI, and headed browser checks for desktop and mobile navigation.

## Future Planning Notes

Astro ClientRouter and transition persistence were sufficient for the app-shell behavior, avoiding a larger React shell
rewrite. Future Workspace flows that stay inside authenticated Workspace should use client navigation and initialize
page scripts on Astro navigation events.
