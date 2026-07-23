---
kind: "work_record"
recordId: "8a1e4845-293a-4438-a80c-dc0c04bd11a5"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-23T21:07:50.427Z"
provenance:
    sourcePlans:
        - "589dd642-b83f-4f61-ae00-9ac2f570653f"
---

# Unified runtime helper installation

## Summary

RunWield's rootless installer now provides the runtime helper binaries needed for a usable standalone install,
preserving existing user-managed helpers and treating Snip as optional. The new-user UX container now exercises the
checked-in installer as an unprivileged user instead of baking local binaries, so onboarding validation follows the
published release path.

## Future Planning Notes

The UX image validates latest published-release onboarding, not uncompiled checkout changes; use separate
source/developer flows when validating local CLI changes.
