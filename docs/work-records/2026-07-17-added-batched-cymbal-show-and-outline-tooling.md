---
kind: "work_record"
recordId: "d1d9245b-971a-41ac-83d2-c0813b074583"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:41:42.118Z"
provenance:
    sourcePlans:
        - "daa36ef2-5d66-4794-a61a-562d9253817c"
---

# Added batched Cymbal show and outline tooling

## Summary

Implemented and verified the `code_batch` custom tool, enabling agents to batch up to five known `show` and `outline`
operations with sequential execution, per-operation error isolation, labeled output, and bounded truncation. Integrated
the tool into relevant agent toolsets and prompt guidance.

## Deferred Work

Batch search and project-context snapshot operations remain out of scope due to context-growth and portability concerns.

## Future Planning Notes

Consider search batching separately if a deterministic query limit and strict output budget can preserve predictable
context usage.
