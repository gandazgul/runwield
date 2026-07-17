---
kind: work_record
recordId: 4dca259b-0b4d-44e2-9fc6-27da62927870
status: approved
scope: feature
origin: external
completionMode: verified
createdAt: 2026-07-14T08:32:00-04:00
provenance:
    evidence:
        - path: src/shared/session/session-runtime.js
          note: Owns the small per-session message queue and publishes queued, consumed, and dequeued transitions.
        - path: src/shared/session/session-runtime-events.js
          note: Defines the adapter-neutral queued-message lifecycle event contract used by current and future UIs.
        - path: src/ui/tui/runtime-adapter.js
          note: Projects core queue snapshots and lifecycle events into TUI message blocks without owning queue state.
        - path: src/ui/tui/chat-session.js
          note: Recalls the latest core-queued message into the editor when the user presses Up on an empty input.
---

# Core-Owned Steering Message Queue

## Summary

RunWield now keeps queued steering messages in a small per-session array owned by `SessionRuntime`, while the TUI and
future interfaces react to core snapshots and lifecycle events. Queued messages appear as steering blocks, become normal
user messages when consumed, and are removed and restored to the editor when recalled with Up. Recalling the latest of
two or three messages preserves the earlier entries despite the underlying agent API only supporting whole-queue
clearing. The implementation was verified by the full repository test suite.
