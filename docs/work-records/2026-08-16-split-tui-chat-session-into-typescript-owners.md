---
kind: "work_record"
recordId: "47933513-d2ba-497d-85b9-249d8c489638"
status: "approved"
scope: "planned_change"
workKind: "REFACTOR"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-16T03:51:46.830Z"
provenance:
    sourcePlans:
        - "f3183b8c-58e3-4070-af6f-67807f653cac"
    evidence:
        - path: "docs/plans/archived/split-and-convert-tui-chat-session.md"
          note: "Plan Front Matter contains accepted Objective-Failing Check waivers."
---

# Split TUI chat session into TypeScript owners

## Summary

The TUI chat-session monolith was removed and replaced with bounded TypeScript owners for footer, view, input control,
interactive composition, and startup orchestration. Public imports, fixtures, Golden scenarios, architecture checks,
model-selection tests, and the language-policy baseline now use the new entry points. Verification passed, including
objective checks, focused TUI/session tests, seam and language-policy checks, and full CI.

## Deviations from Plan

Source-order tests tied to the old private layout were deleted or replaced with owner/API checks. Mutation proof was
partial, and manual interactive TUI smoke was not run because the execution environment was non-interactive.

## Future Planning Notes

Keep objective checks fast; the full CI-style OC5 check was too long for the objective-check slot and needed a waiver.
Prefer behavior and owner-interface tests over private source-order assertions when splitting large modules.

## Objective Check Waivers

- 2026-08-11T17:16:46.597Z (mechanical_detection) OC5: Objective check timed out after 60000ms. Command: test ! -e
  src/ui/tui/chat-session.js && deno task ci User note: OC5 is just too long for an Objective check which are meant to
  be quick, this is something that RunWield should prevent but nothing we can do in this instance.
