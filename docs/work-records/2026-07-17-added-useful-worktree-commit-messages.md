---
kind: "work_record"
recordId: "cf8d91f9-2329-4942-b941-c3e04a7c72a2"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:52:29.893Z"
provenance:
    sourcePlans:
        - "9ba48edf-2775-4b04-9ee7-822960e5d798"
---

# Added useful worktree commit messages

## Summary

Replaced the fixed dirty-worktree commit message with deterministic, plan-aware formatting. Automatic validation and
manual recovery now forward plan names and summaries, while metadata-free callers retain a stable fallback. Tests cover
message generation and metadata forwarding, and the change passed project verification.
