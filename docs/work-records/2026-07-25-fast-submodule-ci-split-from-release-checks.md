---
kind: "work_record"
recordId: "a79d1b44-18ab-40d3-87c0-4bead5630979"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-25T22:08:59.081Z"
provenance:
    sourcePlans:
        - "0c02a8cb-829f-4809-a4df-7226b25dabbb"
---

# Fast submodule CI split from release checks

## Summary

Per-change CI now uses a fast, local-only recursive submodule integrity and cleanliness check, while remote submodule
SHA fetchability is preserved as a release-only gate before standalone binary compilation and smoke tests. This keeps
ordinary verification offline-capable and reserves slower network and binary qualification work for release preflight.

## Future Planning Notes

Keep CI and release qualification concerns separated: local checkout integrity belongs in fast per-change gates, while
remote availability and compiled binary smoke tests belong in explicit release checks.
