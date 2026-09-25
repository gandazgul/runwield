---
kind: "work_record"
recordId: "15a3c6c3-168f-493f-99e5-f1457295f94f"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-25T18:30:43.114Z"
provenance:
    sourcePlans:
        - "ac424dd4-8296-41f1-aad1-2684d9d920e9"
---

# Restore long-session TUI rendering and safe scrolling

## Summary

Cached retained transcript rendering and hardened terminal input framing so long TUI conversations avoid repeated
rendering of unchanged blocks and fragmented mouse-wheel input cannot corrupt drafts or cancel Agent turns. Deliberate
Escape cancellation remains intact. Six regression tests and the Core TUI requirements were added or updated; focused
tests, type checks, lint, and seam checks passed.

## Deferred Work

Manual long-session Ghostty verification was not run in this non-interactive session. Full CI did not pass:
doc-links:check reported eight broken Plan links, including seven archived Plan links and the approved Plan link; the
same failures were observed before the PRD edit.
