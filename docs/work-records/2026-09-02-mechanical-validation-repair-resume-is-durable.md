---
kind: "work_record"
recordId: "f519c2b7-e432-44b2-b7c6-7cf2ef6ba777"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-02T01:30:55.953Z"
provenance:
    sourcePlans:
        - "49e20ce4-692f-42fb-b5a9-ecb3766640cc"
---

# Mechanical Validation repair resume is durable

## Summary

RunWield now resumes Mechanical Validation repair flows from durable validation checkpoints and current worktree facts
instead of in-memory validation position or root Task Completion journal events. Independent CI and Objective repair
completions return to the owning validation loop, while interrupted repairs recover by rerunning checks. Regression
coverage and docs were updated for live repair, restart recovery, root-journal isolation, and human-review repair
sequencing.

## Deviations from Plan

Full `deno task ci` did not finish cleanly: two golden scenarios failed after 330 files passed, but both failed
scenarios passed when rerun individually.

## Deferred Work

Manual source-mutation checks from the verification plan were not performed.

## Future Planning Notes

Keep live isolated repair results separate from restart recovery. For recovery, durable checkpoints and fresh checks are
the authority; Agent completion claims and presentation-only validation position must not decide workflow continuation.
