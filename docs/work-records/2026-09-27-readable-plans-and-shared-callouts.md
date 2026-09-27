---
kind: "work_record"
recordId: "a4624808-efe4-4057-9ee9-8c7322165022"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-27T14:38:13.128Z"
provenance:
    sourcePlans:
        - "aea351ca-eab5-44e0-94e2-daaa60d43a78"
---

# Readable Plans and Shared Callouts

## Summary

Validated Planner guidance now favors point-first, concise Plans without dropping requirements or exact steps. Shared
callout styles improve Plan Review and reader scanning and print as legible gray boxes. Realistic fixtures, four added
tests, focused checks, build checks, and desktop and phone browser checks support the result; the execution report said
full CI was still pending in RunWield.

## Deviations from Plan

The planned check of saving and reloading an annotation in a temporary test Project was not completed.

## Deferred Work

Colored callouts in Changes remain deferred. Existing issues found during review remain: annotation highlights do not
redraw after Edit → View or draft restore, the editor caret jumps after the first change, and a callout longer than a
page starts on a new page.

## Future Planning Notes

Complete the annotation persistence check before relying on fixture feedback checks as evidence of saved annotations.
Preserve the existing icon, title, accessible kind, and annotation attributes when changing callout styles.
