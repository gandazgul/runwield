---
kind: "work_record"
recordId: "09c20c7b-870b-4d13-bb62-98803cf71145"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:52:37.432Z"
provenance:
    sourcePlans:
        - "38f852a4-325e-4726-9fb2-258186fcb8ca"
---

# Added vision fallback for text-only models

## Summary

Implemented configurable vision fallback support, including the `see_image` tool, session-scoped image storage, model
capability checks, safe attachment resolution, and non-destructive paste and submission gating. Vision-capable models
continue receiving images directly, while text-only models can use a configured fallback vision model. Updated settings
documentation and verified the feature with automated tests and the full quality gate.

## Future Planning Notes

Session image cleanup remains a potential follow-up; artifacts are stored predictably so future session deletion can
remove them.
