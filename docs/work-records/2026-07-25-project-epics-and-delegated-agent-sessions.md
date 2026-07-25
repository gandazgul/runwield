---
kind: "work_record"
recordId: "0e208d7f-c0e2-4732-a4a5-14802e0aee27"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-25T22:09:07.422Z"
provenance:
    sourcePlans:
        - "dfe26cae-9d6f-47cc-a555-8aaf9ecc24e5"
---

# PROJECT Epics and Delegated Agent Sessions

## Summary

Completed the cleanup that makes `classification: PROJECT` the sole Epic signal, retires legacy PROJECT task-table/DAG
execution machinery, and introduces bounded foreground `delegate_agent` sessions for isolated read/write work. Active
code, prompts, Workspace behavior, and documentation now align around PROJECT Plans as non-executable Epic containers
and delegated children as capability-limited, context-isolated helpers.

## Future Planning Notes

Future PROJECT work should assume Epic behavior from classification alone and avoid reintroducing `type: epic`, task
scheduling, or executable PROJECT containers. Delegated Agent Sessions are foreground, lease-limited helpers: up to
three readers or one writer, no recursive delegation, no commits, and parent ownership of all results and edits.
