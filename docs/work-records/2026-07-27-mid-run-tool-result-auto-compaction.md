---
kind: "work_record"
recordId: "dc467de9-9e61-4746-a4c0-c7b3cecae1c9"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-27T13:15:09.586Z"
provenance:
    sourcePlans:
        - "5cf1e3a4-c0fe-4407-b65f-2a7b2ba927b4"
---

# Mid-run tool-result auto-compaction

## Summary

Implemented verified context-resilience handling for long Agent Session tool-result loops so RunWield can detect context
pressure at safe completed-turn boundaries, compact, measure recovery, continue work, or pause safely without treating
stale partial outcomes as success. The work covered shared session coordination, hosted-session arbitration, runtime
events, delegated-agent behavior, TUI/ACP adapter parity, compact command handling, Pi dependency updates, and session
documentation.

## Future Planning Notes

Future session-context work should continue using public Pi contracts and the shared session-context-resilience
coordinator rather than adapter-local policy, private Pi hooks, or duplicate summarization paths.
