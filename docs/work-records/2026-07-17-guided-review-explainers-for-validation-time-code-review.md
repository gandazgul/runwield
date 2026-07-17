---
kind: "work_record"
recordId: "2eef4dd2-a6ff-4838-ab36-0f37377817cd"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:40:23.077Z"
provenance:
    sourcePlans:
        - "76e4b286-5dcf-48e2-9609-0114d07493c0"
---

# Guided Review Explainers for validation-time code review

## Summary

Added configurable Guided Review generation to validation-time human code reviews. RunWield now uses deterministic diff
and Plan signals to recommend explainers, passes generation policy through the existing review workflow, and renders
structured single-column narratives with prose, callouts, Mermaid diagrams, annotatable diffs, and sandboxed widgets.
Plain Diff review remains available and active by default, guide costs and reasons are disclosed, feedback semantics are
preserved, and automated validation passed.

## Future Planning Notes

Revisit recommendation thresholds using real-world usage data and monitor whether exceptional widget generation remains
appropriately rare.
