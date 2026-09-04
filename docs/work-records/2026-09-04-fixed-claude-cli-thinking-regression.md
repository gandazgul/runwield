---
kind: "work_record"
recordId: "e783887f-bba0-442e-a730-5a29991547b4"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-04T03:29:45.805Z"
provenance:
    sourcePlans:
        - "7b1479d6-e11e-4965-884c-efec5f892f59"
---

# Fixed Claude CLI Thinking Regression

## Summary

Claude CLI root turns now build and run when an Agent or model preset has a non-off thinking level. The Prompt
Template-only protection remains in place, so unsupported Claude CLI thinking still fails before model execution.
Verification passed with targeted regression tests, full checks, full test suite, CI task, seams check, diff check,
red-before evidence, and version ancestry evidence.

## Future Planning Notes

Keep backend thinking-level rejection scoped to auxiliary Prompt Template turns without workflow authority. The
regression affected v0.9.6-rc.1 through v0.9.6-rc.4; v0.9.5 was not affected.
