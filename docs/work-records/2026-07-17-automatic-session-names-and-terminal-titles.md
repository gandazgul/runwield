---
kind: "work_record"
recordId: "22273507-4d84-465a-8893-7e04fe48f1a6"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:41:28.487Z"
provenance:
    sourcePlans:
        - "fcdc3cfb-4111-4ea4-bef2-9f29d0e0cf51"
---

# Automatic session names and terminal titles

## Summary

Implemented and verified automatic Router-provided session naming, terminal tab titles with project fallbacks, persisted
manual naming through the Pi-compatible `/name` command, and title updates across resumed and newly created sessions.
Existing session names remain protected from automatic replacement, and terminal titles are sanitized and applied
best-effort.

## Future Planning Notes

Terminal title behavior may still depend on emulator, tmux, screen, or shell integration support.
