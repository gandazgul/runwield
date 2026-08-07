---
kind: "work_record"
recordId: "b3d1dc0c-e754-470c-86f6-86cb2aeecd45"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-26T03:08:58.548Z"
provenance:
    sourcePlans:
        - "6be1cd31-a2a2-4ca6-9f4c-d3e7982cd121"
---

# Added TUI Terminal Bell Notifications

## Summary

RunWield TUI attention notifications now emit a portable terminal BEL by default, giving terminal emulators and
multiplexers control over audible, visual, urgency, or tab-marker feedback. The feature preserves existing macOS desktop
notification behavior, adds a `notifications.terminalBell` opt-out, updates schema/docs/TODO tracking, and was verified
with targeted notification tests, formatting checks, and full `deno run ci`.

## Deferred Work

Manual terminal-emulator checks in Kitty, WezTerm, iTerm2, or Terminal.app were not run in the non-interactive session;
automated tests cover BEL emission, opt-out, disabled events, fallback behavior, and failure isolation.

## Future Planning Notes

Keep terminal feedback owned by the TUI boundary and user terminal configuration; avoid native desktop notification
sound options so BEL and desktop alerts do not create duplicate sound behavior.
