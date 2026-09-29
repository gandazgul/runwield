---
kind: "work_record"
recordId: "79c918ba-6012-4c58-a0ba-a1c568279c53"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-29T03:38:32.549Z"
provenance:
    sourcePlans:
        - "54c6f794-252f-4210-be53-ca5bf50c5ff1"
---

# Configurable Bash Allowlists for Guide and Delegates

## Summary

Delivered configurable bash command allowlists for Agent and subagent definitions, with inherited parent limits,
inspection defaults for Guide and read delegates, and checks before Pi bash and RunWield background shell execution.
Root Session rebuilds refresh the policy; restricted Pi Sessions skip Snip. Updated configuration and product
documentation. Workflow validation completed after focused tests passed (84 tests, 0 failures), along with type, seam,
skill-sync, and diff checks.

## Future Planning Notes

The filter is best-effort, not a sandbox, and does not govern native external-host shells. Scripted child turns
confirmed that denials reach delegates, but live-model compliance with blocker instructions was not tested.
