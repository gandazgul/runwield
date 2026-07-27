---
kind: "work_record"
recordId: "ebea1860-80bb-4dff-bcd7-87e95a942bbf"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-27T04:07:42.506Z"
provenance:
    sourcePlans:
        - "8fda9ae2-072a-4c8e-91dd-c635c67ffb14"
---

# Candidate-first release and promotion workflow

## Summary

Implemented and verified a candidate-capable WLD release lifecycle: `/release` now drives explicit Operator choices,
`RELEASING.md` documents portable policy, release tasks support Candidate creation, Candidate promotion, direct Stable
releases, metadata, and explicit build identity, and CI enforces Candidate prerelease/not-latest versus Stable/latest
publication semantics.

## Future Planning Notes

Release automation should keep irreversible tag pushes behind fail-closed preflight, make CI the sole release creator,
and use explicit build identity whenever Candidate and Stable tags can share a source commit.
