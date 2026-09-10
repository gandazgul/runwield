---
kind: "work_record"
recordId: "49bdda90-7a5a-4c4f-9e11-20398807cb33"
status: "draft"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "external"
completionMode: "verified"
createdAt: "2026-09-10T18:54:50.832230Z"
provenance:
    evidence:
        - path: "src/ui/workspace/session-continuation.integration.test.ts"
          note: "Session creation, continuation, cross-process steering, naming, and thinking selection."
        - path: "src/ui/workspace/workspace-session-ux.test.tsx"
          note: "All workflow tools stay expanded, including reports, QA checklists, and artifact links."
        - path: "src/ui/tui/chat-session.test.ts"
          note: "TUI resume preserves the Session's thinking choice."
---

# Workspace Session input and workflow display

## Summary

Fixed Workspace's first-send failure: it now uses the TUI's Session creation path and awaits thinking configuration. The
selected thinking level reaches the model and survives reopening the Session in the TUI. Browser image input supports
file selection, paste, drop, previews, removal, and viewing saved images. Large image drafts use IndexedDB; storage
failures do not prevent sending. Failed responses restore the submitted text and attachments.

Session lists use the saved title, then the first user message, including commands. Sessions with neither are hidden.
Every workflow tool has a full visible block. Accepted workflow records finish the block even when a tool stops its own
turn before a provider result is saved. Reports, Work Record sections, QA checklists, review notes, and registered
artifact links stay visible. Older transcript tool results still finish their corresponding calls.

## Required Record Notes

Codex verified this change directly; these are testing results, not a claim that RunWield Workflow Validation ran:

- Full `deno task ci`: 367 files passed, zero failures; type, Workspace, lint, seams, and documentation checks passed.
- Additional focused tests cover the final TUI thinking restore and workflow display changes; final type check passed.
- The production Workspace build passed and was served at port 8787 with the real owner database and authentication.
- Real Codex Luna identified uploaded shapes correctly in a new browser Session, then again while that same Session was
  open in an actual TUI. Both surfaces displayed the replies.
- A turn started in the TUI received browser steering and replied `STEERING_OK` in both surfaces.
- A 4.3 MB image draft, larger than the former localStorage limit after encoding, survived a browser reload with its
  text and preview intact. Test drafts were cleared afterward.
- Reopening the real Session in the TUI retained its low thinking selection and the browser's latest `READY` reply.
- The user's Clean Empty Sessions history displayed three completed task reports as expanded blocks, with none
  incorrectly marked running.
- At a 390 px browser viewport, the real Session and composer fit without horizontal overflow. The saved-image viewer
  opened correctly at desktop width and closed with Escape.

The real test Session is `a8a9d13f-68a0-4093-bdd2-0b4e962f14d0`. It contains only read-only model requests. This change
was not committed. Concurrent work in other Sessions was preserved.

## Future Planning Notes

These checks establish the reported input and workflow-display fixes. They do not establish exhaustive parity with every
TUI command. Physical-phone and container checks were not repeated in this change. Keep those acceptance journeys
distinct from passing component tests; prior implementation records alone do not establish product readiness.
