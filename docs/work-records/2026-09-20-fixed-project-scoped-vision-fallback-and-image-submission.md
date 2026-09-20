---
kind: "work_record"
recordId: "421bead8-a69a-46da-94cb-44d08bf2ecde"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-20T03:13:15.722Z"
provenance:
    sourcePlans:
        - "6bbcd530-97b4-471e-bf8b-a6507e808f35"
---

# Fixed Project-scoped vision fallback and image submission

## Summary

Completed and verified lazy, Project-scoped vision fallback resolution across Runtime, TUI, Workspace, steering, and
`see_image`. Text-only startup no longer validates unused fallback configuration. Image sends now validate the actual
destination model before acceptance, preserve rejected drafts and previews, avoid optimistic duplicates, and return a
specific 422 response. Focused tests, `deno task check`, `deno task seams:check`, and full `deno task ci` passed; Core,
Workspace, and settings documentation were updated.

## Deviations from Plan

The browser dev server used port 5175 because 5173 was busy. Browser snapshots plus console and network checks found no
page or request errors, but screenshot capture timed out, so no screenshot evidence was produced.

## Future Planning Notes

Keep image validation lazy and Project-scoped. Validate the same resolved model used for submission, before user events,
transcript writes, receipts, or composer clearing.
