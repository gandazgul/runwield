---
kind: "work_record"
recordId: "b44de949-fa27-4c59-b7b4-eda624c44dfe"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-08T13:12:53.925Z"
tickets:
    - url: "https://app.todoist.com/app/task/collapse-the-tool-calls-between-thinking-to-1-block-with-1-line-per-tool-call-th-6hFmCQXVQHH8V7Vj"
provenance:
    sourcePlans:
        - "2661bce2-39e8-4ff0-af97-558420127efb"
---

# Collapsed TUI Tool Calls into Compact Groups

## Summary

The TUI now groups contiguous tool calls into compact one-line rows, with per-call status coloring and `Ctrl+O`
expansion for full results and images. Workflow tools such as `plan_written` and `triage_report` remain standalone full
blocks. Verification passed with the focused TUI and session-help test set.
