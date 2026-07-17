---
kind: "work_record"
recordId: "9a678b00-6f99-48dc-9242-73ca8ae416e5"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:42:05.810Z"
provenance:
    sourcePlans:
        - "4c9c9710-739b-402d-8495-e53be5d1dd5f"
---

# Empty Project Directory Startup UX

## Summary

Added first-class detection and startup handling for empty project directories. Interactive sessions now provide
non-blocking greenfield guidance while suppressing the normal boot banner and init offer; initial requests still route
normally with session-scoped greenfield context. Running init in an empty directory is a no-op that does not update init
state. Detection, prompt propagation, rebuild preservation, startup behavior, and init behavior were verified with
automated tests.
