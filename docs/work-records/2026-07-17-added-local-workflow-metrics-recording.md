---
kind: "work_record"
recordId: "c628bcfc-c535-441d-aee4-e42a81fe0d5e"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:52:44.556Z"
provenance:
    sourcePlans:
        - "bd94f056-1974-4066-8b36-8f1bb380fa3a"
---

# Added local workflow metrics recording

## Summary

Implemented opt-in, local-only JSONL metrics for routing, planning, execution, validation, recovery, model selection,
and tool usage. Recording is best-effort and privacy-safe, defaults to disabled, stores project-scoped data under
~/.wld/workflow-metrics/, and includes settings/schema documentation and automated coverage.

## Future Planning Notes

A future feature can add CLI or Workspace reporting once the raw event vocabulary has stabilized.
