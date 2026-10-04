---
kind: "work_record"
recordId: "21b92d3b-60a4-4506-815a-48d48d54c168"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-10-04T00:55:05.481Z"
provenance:
    sourcePlans:
        - "29398c6b-fa02-4bb6-bada-14b2f8429451"
---

# Mascot visibility control and stable TUI blinking

## Summary

Added a default-on `mascot` setting with project overrides, a global TUI `/settings` toggle, cache invalidation, and
reload support. TUI and Workspace hide disabled mascots without layout gaps; hiding an active TUI mascot stops its
timer. Stable per-mascot drawing widths prevent horizontal movement during blinking and pose changes. Updated settings,
design-system, and PRD documentation. Focused tests passed (147), with independent reruns and desktop/mobile browser
checks. Plan metadata records verified completion at commit `a94f7e11246bb5809716984debf3d9b585b873d9`; the execution
report's pending-validation note predates that status.

## Deferred Work

Workspace toggle UI remains out of scope; Workspace honors settings changed through the TUI or settings files. The
direct Workspace JSX type check still has 223 errors also found on the unchanged baseline.

## Future Planning Notes

Cache merged settings used during animation and invalidate them on writes and reload. Center animated drawings using the
maximum width across frames and poses, not each frame's width.
