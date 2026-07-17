---
kind: "work_record"
recordId: "1e67b377-0802-4889-9ee0-db54bbbf4127"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:51:30.256Z"
provenance:
    sourcePlans:
        - "44a682b4-1ecf-43c0-a3f2-f8e65a3ecd26"
---

# Added system notifications with terminal activation

## Summary

RunWield now sends configurable macOS notifications when an agent returns control, requests input through
user_interview, or completes a plan through plan_written. Notifications include session context, use terminal-notifier
for click activation when available, fall back gracefully to osascript, and preserve workflow behavior when notification
delivery fails. Automated verification and human review passed.

## Deferred Work

Non-macOS notification support and exact activation for terminals without a reliable tab or pane API remain outside the
v1 scope.

## Future Planning Notes

Keep notification dispatch best-effort and centralized. Any platform expansion should preserve dependency-injected
command execution, per-event settings, session context, and graceful fallback behavior.
