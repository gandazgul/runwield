---
kind: "work_record"
recordId: "f5bfa8dc-752c-4ade-9590-e4079e2df32c"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:51:20.908Z"
provenance:
    sourcePlans:
        - "8bc1fc1c-5747-426d-92fa-c45b8876efae"
---

# Split OPERATION and QUICK_FIX Routing

## Summary

Separated non-code OPERATION work from bounded no-plan QUICK_FIX code changes. OPERATION now routes to Operator for
self-verified repository and environment tasks, while QUICK_FIX routes to Engineer and runs completion-gated Mechanical
Validation with up to three repair attempts. Updated routing definitions, workflow dispatch, agent guidance, evaluation
tooling, tests, and documentation for the six-intent model.

## Future Planning Notes

Preserve the boundary that QUICK_FIX has no Plan lifecycle, semantic review, Plannotator review, or worktree merge-back.
Dependency upgrades that require code edits or fail CI must return to Router for fresh triage.
